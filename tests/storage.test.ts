import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  FrostDB,
  loadState,
  saveState,
  recordProduct,
  removeProduct,
  serializeBackup,
  parseBackup,
  markBackedUp,
} from '../src/storage';
import { emptyState, id } from '../src/model';
import { populatedState, product, syntheticFx } from './fixtures';
describe('IndexedDB and confidential backups', () => {
  let db: FrostDB;
  beforeEach(() => {
    db = new FrostDB('test-' + id());
  });
  afterEach(async () => {
    await db.delete();
  });
  it('starts empty without real or demo seed data', async () => {
    const s = await loadState(db);
    expect(s.products).toEqual([]);
    expect(s.offers).toEqual([]);
  });
  it('persists edits through new database connections', async () => {
    let s = await loadState(db);
    s = await saveState(recordProduct(s, product()), s.revision, undefined, db);
    db.close();
    db = new FrostDB(db.name);
    expect((await loadState(db)).products).toEqual(s.products);
  });
  it('records price history and invalidates previous approval after edits', () => {
    const s = populatedState(),
      p = s.products[0];
    const next = recordProduct(s, { ...p, frostSalePriceGbpExVat: 250 }, 'Synthetic edit');
    expect(next.products[0].approvalStatus).toBe('draft');
    expect(
      next.events.some(
        (e) =>
          e.field === 'frostSalePriceGbpExVat' && e.previousValue === 200 && e.newValue === 250,
      ),
    ).toBe(true);
  });
  it('requires intentional approval, verified FX and a positive selling price', () => {
    const s = emptyState();
    s.fx = syntheticFx();
    expect(() => recordProduct(s, product({ approvalStatus: 'approved' }))).toThrow(
      'Approve explicitly',
    );
    expect(
      recordProduct(s, product({ approvalStatus: 'approved' }), '', true).products[0]
        .approvalStatus,
    ).toBe('approved');
    expect(() =>
      recordProduct(
        { ...s, fx: { ...s.fx, lastConfirmedAt: null } },
        product({ approvalStatus: 'approved', originalCurrency: 'USD' }),
        '',
        true,
      ),
    ).toThrow('Confirm current FX');
  });
  it('takes recovery snapshots atomically before replacement and deletion', async () => {
    let s = await saveState(populatedState(), 0, undefined, db);
    const pid = s.products[0].id;
    s = await saveState(removeProduct(s, pid), s.revision, 'Before deletion', db);
    expect(s.products).toHaveLength(0);
    expect(s.offers[0].matchedProductId).toBeNull();
    const snapshots = await db.snapshots.toArray();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].state.products).toHaveLength(1);
  });
  it('retains at most 10 automatic snapshots', async () => {
    let s = await loadState(db);
    for (let i = 0; i < 12; i++) s = await saveState(s, s.revision, 'Synthetic action ' + i, db);
    expect(await db.snapshots.count()).toBe(10);
  });
  it('rejects stale-tab writes instead of losing newer changes', async () => {
    const s = await loadState(db);
    await saveState(s, 0, undefined, db);
    await expect(saveState(s, 0, 'Must not snapshot', db)).rejects.toThrow('another tab');
    expect(await db.snapshots.count()).toBe(0);
  });
  it('does not commit a snapshot or invalid state if validation fails', async () => {
    const s = populatedState();
    s.products[0].originalSupplierCost = -1;
    await expect(saveState(s, 0, 'Invalid transaction', db)).rejects.toThrow();
    expect(await db.snapshots.count()).toBe(0);
    expect((await loadState(db)).revision).toBe(0);
  });
  it('round-trips all confidential data, flags, IDs and timestamps', () => {
    const s = populatedState();
    expect(parseBackup(serializeBackup(s))).toEqual(s);
  });
  it('restores a full backup after reset while preserving links and dates', async () => {
    let s = await saveState(populatedState(), 0, undefined, db);
    const json = serializeBackup(s);
    s = await saveState(emptyState(), s.revision, 'Reset', db);
    expect(s.products).toHaveLength(0);
    s = await saveState(parseBackup(json), s.revision, 'Restore', db);
    expect(s.products).toEqual(parseBackup(json).products);
    expect(s.offers[0].matchedProductId).toBe(s.products[0].id);
  });
  it('tracks backup revision separately from pricing state', async () => {
    const s = await saveState(populatedState(), 0, undefined, db);
    await markBackedUp(s, db);
    expect((await db.meta.get('lastBackup'))?.revision).toBe(s.revision);
    expect((await loadState(db)).revision).toBe(s.revision);
  });
  it('rejects corrupt, incompatible and unexpected backup data', () => {
    for (const json of [
      '{}',
      'not json',
      JSON.stringify({ format: 'FROST_CONFIDENTIAL_BACKUP', version: 99, state: emptyState() }),
    ])
      expect(() => parseBackup(json)).toThrow();
    const raw = JSON.parse(serializeBackup(populatedState()));
    raw.state.products[0].unexpected = 'bad';
    expect(() => parseBackup(JSON.stringify(raw))).toThrow();
  });
  it('rejects duplicate UUIDs and dangling references', () => {
    const s = populatedState();
    s.products.push(s.products[0]);
    expect(() => serializeBackup(s)).toThrow('Duplicate IDs');
    const d = populatedState();
    d.offers[0].matchedProductId = id();
    expect(() => serializeBackup(d)).toThrow('dangling');
  });
});
