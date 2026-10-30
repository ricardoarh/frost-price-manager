import Dexie, { type Table } from 'dexie';
import { z } from 'zod';
import {
  emptyState,
  id,
  now,
  stateSchema,
  type AppState,
  type Product,
  type PriceChangeEvent,
  productSchema,
} from './model';
import { approvalErrors } from './pricing';

export type Snapshot = { id: string; timestamp: string; reason: string; state: AppState };
export type BackupMeta = { key: string; at: string; revision: number };
export class FrostDB extends Dexie {
  catalogue!: Table<{ key: string; state: AppState }, string>;
  snapshots!: Table<Snapshot, string>;
  meta!: Table<BackupMeta, string>;
  constructor(name = 'frost-price-manager-v1') {
    super(name);
    this.version(1).stores({ catalogue: 'key', snapshots: 'id,timestamp', meta: 'key' });
  }
}
export const db = new FrostDB();
export async function loadState(database = db) {
  return stateSchema.parse((await database.catalogue.get('current'))?.state || emptyState());
}
export async function saveState(
  next: AppState,
  expectedRevision: number,
  reason?: string,
  database = db,
): Promise<AppState> {
  return database.transaction('rw', database.catalogue, database.snapshots, async () => {
    const current = await loadState(database);
    if (current.revision !== expectedRevision)
      throw new Error(
        'Data changed in another tab. Reload this page before saving; your edit has not overwritten it.',
      );
    if (reason)
      await database.snapshots.add({ id: id(), timestamp: now(), reason, state: current });
    const valid = stateSchema.parse({ ...next, revision: current.revision + 1, updatedAt: now() });
    await database.catalogue.put({ key: 'current', state: valid });
    if (reason) {
      const old = await database.snapshots.orderBy('timestamp').reverse().offset(10).toArray();
      await database.snapshots.bulkDelete(old.map((s) => s.id));
    }
    return valid;
  });
}
export function recordProduct(
  state: AppState,
  input: Product,
  changeNote = '',
  intentionallyApprove = false,
): AppState {
  const old = state.products.find((p) => p.id === input.id);
  let p = productSchema.parse({
    ...input,
    updatedAt: now(),
    createdAt: old?.createdAt || input.createdAt,
  });
  const fields = Object.keys(p) as (keyof Product)[];
  const changed =
    old && fields.some((k) => !['updatedAt', 'approvalStatus'].includes(k) && p[k] !== old[k]);
  if (old?.approvalStatus === 'approved' && changed && !intentionallyApprove)
    p = { ...p, approvalStatus: 'draft' };
  if (p.approvalStatus === 'approved') {
    if (old?.approvalStatus !== 'approved' && !intentionallyApprove)
      throw new Error('Approve explicitly in the selling-price editor.');
    const errors = approvalErrors(p, state.fx);
    if (errors.length) throw new Error(errors.join(' '));
  }
  const events: PriceChangeEvent[] = [];
  for (const field of fields.filter((k) => !['updatedAt', 'createdAt', 'id'].includes(k))) {
    const previousValue = old?.[field] ?? null;
    if (p[field] !== previousValue)
      events.push({
        id: id(),
        productId: p.id,
        timestamp: now(),
        field,
        previousValue,
        newValue: p[field],
        changeNote,
      });
  }
  return {
    ...state,
    products: old ? state.products.map((x) => (x.id === p.id ? p : x)) : [...state.products, p],
    events: [...state.events, ...events],
  };
}
export function removeProduct(state: AppState, productId: string): AppState {
  return {
    ...state,
    products: state.products.filter((p) => p.id !== productId),
    offers: state.offers.map((o) =>
      o.matchedProductId === productId ? { ...o, matchedProductId: null } : o,
    ),
    issues: state.issues.map((i) => (i.productId === productId ? { ...i, productId: null } : i)),
    events: [
      ...state.events,
      {
        id: id(),
        productId,
        timestamp: now(),
        field: 'deleted',
        previousValue: false,
        newValue: true,
        changeNote: 'Permanent deletion; pre-delete snapshot retained',
      },
    ],
  };
}
export const backupSchema = z
  .object({
    format: z.literal('FROST_CONFIDENTIAL_BACKUP'),
    version: z.literal(1),
    exportedAt: z.string().datetime(),
    state: stateSchema,
  })
  .strict();
export function serializeBackup(state: AppState) {
  return JSON.stringify(
    {
      format: 'FROST_CONFIDENTIAL_BACKUP',
      version: 1,
      exportedAt: now(),
      state: stateSchema.parse(state),
    },
    null,
    2,
  );
}
export function parseBackup(content: string): AppState {
  if (content.length > 50 * 1024 * 1024) throw new Error('Backup exceeds the 50 MB limit.');
  return backupSchema.parse(JSON.parse(content)).state;
}
export async function markBackedUp(state: AppState, database = db) {
  await database.meta.put({ key: 'lastBackup', at: now(), revision: state.revision });
}
