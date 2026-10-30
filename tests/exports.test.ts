import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { strFromU8, unzipSync } from 'fflate';
import {
  exportEligibility,
  salesRows,
  salesCsv,
  salesXlsx,
  salesPrintHtml,
  safeCell,
} from '../src/exports';
import { confidentialProduct, product, SECRET } from './fixtures';
describe('sanitized sales exports', () => {
  const p = confidentialProduct({
    salesDescription: 'Approved customer description',
    salesNotes: 'Customer-facing test note',
  });
  const rows = salesRows([p]).rows;
  it('exports only explicitly approved, visible positive-price records', () => {
    const data = salesRows([
      p,
      product(),
      product({ approvalStatus: 'archived' }),
      confidentialProduct({ salesVisible: false }),
      confidentialProduct({ frostSalePriceGbpExVat: 0 }),
    ]);
    expect(data.rows).toHaveLength(1);
    expect(data.excluded).toHaveLength(4);
    expect(data.excluded.every((e) => e.reasons.length)).toBe(true);
  });
  it('rejects nonfinite selling prices defensively', () =>
    expect(
      exportEligibility(confidentialProduct({ frostSalePriceGbpExVat: NaN })),
    ).not.toHaveLength(0));
  it('uses an explicit field allow-list', () => {
    expect(Object.keys(rows[0]).sort()).toEqual(
      [
        'Category',
        'Brand',
        'Model / SKU',
        'Product Name',
        'Sales Description',
        'Frost Selling Price (£ ex VAT)',
      ].sort(),
    );
    expect(JSON.stringify(rows)).not.toContain(SECRET);
  });
  it('includes descriptions and sales notes only when requested', () => {
    expect(salesRows([p], false, false).rows[0]).not.toHaveProperty('Sales Description');
    expect(salesRows([p], true, true).rows[0]['Sales Notes']).toBe('Customer-facing test note');
  });
  it('creates one visible XLSX sheet with no confidential fields, hidden data or metadata', () => {
    const data = salesXlsx(rows, 'Synthetic sales list');
    const wb = XLSX.read(data, { type: 'array' });
    expect(wb.SheetNames).toEqual(['Sales Price List']);
    const xml = Object.entries(unzipSync(new Uint8Array(data)))
      .filter(([k]) => /\.xml$/.test(k))
      .map(([, v]) => strFromU8(v))
      .join('\n');
    expect(xml).not.toContain(SECRET);
    for (const forbidden of [
      'Supplier unit cost',
      'sourceDocument',
      'freightGbpPerUnit',
      'internalNotes',
      'grossMarginFraction',
      'matchedProductId',
      'xl/externalLinks',
    ])
      expect(xml).not.toContain(forbidden);
    expect(xml).not.toMatch(/state="(?:hidden|veryHidden)"/);
    const table = XLSX.utils.sheet_to_json(wb.Sheets['Sales Price List'], { range: 3 });
    expect(table).toHaveLength(1);
    expect(table[0]).toHaveProperty('Frost Selling Price (£ ex VAT)', 200);
  });
  it('writes formula-looking XLSX labels as literal text, never formulas', () => {
    const injection = salesRows([confidentialProduct({ description: '=HYPERLINK("bad")' })]).rows;
    const wb = XLSX.read(salesXlsx(injection, '=SUM(1,2)'), { type: 'array' });
    expect(wb.Sheets['Sales Price List'].D5).toMatchObject({ t: 's', v: '=HYPERLINK("bad")' });
    expect(wb.Sheets['Sales Price List'].D5.f).toBeUndefined();
  });
  it('excludes confidential data from CSV and handles quoted multiline fields', () => {
    const csv = salesCsv(
      salesRows([confidentialProduct({ description: 'Synthetic, "quoted"\nname' })]).rows,
    );
    expect(csv).not.toContain(SECRET);
    expect(csv).toContain('"Synthetic, ""quoted""\nname"');
    expect(csv).toContain('"200.00"');
  });
  it.each(['=SUM(1,2)', ' +cmd', '\t@evil', '\r\n-1+2'])(
    'neutralizes CSV formula prefix %s',
    (text) => expect(safeCell(text)).toBe("'" + text),
  );
  it('escapes print text, includes no executable scripts or private fields', () => {
    const html = salesPrintHtml(
      salesRows([confidentialProduct({ description: '<script>alert(1)</script>' })]).rows,
      '<img src=x onerror=alert(1)>',
    );
    expect(html).not.toContain(SECRET);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelector('script')).toBeNull();
    expect(doc.querySelector('img')).toBeNull();
    expect(doc.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(doc.body.textContent).toContain('<script>alert(1)</script>');
    expect(doc.body.textContent).toContain('All prices in GBP excluding VAT');
  });
});
