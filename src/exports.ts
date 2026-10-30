import * as XLSX from 'xlsx';
import type { Product } from './model';

export const exportColumns = [
  'Category',
  'Brand',
  'Model / SKU',
  'Product Name',
  'Sales Description',
  'Frost Selling Price (£ ex VAT)',
  'Sales Notes',
] as const;
export type SalesRow = {
  Category: string;
  Brand: string;
  'Model / SKU': string;
  'Product Name': string;
  'Sales Description'?: string;
  'Frost Selling Price (£ ex VAT)': number;
  'Sales Notes'?: string;
};
export function exportEligibility(p: Product): string[] {
  return [
    p.approvalStatus !== 'approved' ? `Status: ${p.approvalStatus}` : '',
    !p.salesVisible ? 'Sales visibility off' : '',
    p.frostSalePriceGbpExVat == null ||
    !Number.isFinite(p.frostSalePriceGbpExVat) ||
    p.frostSalePriceGbpExVat <= 0
      ? 'No valid positive selling price'
      : '',
  ].filter(Boolean);
}
export function salesRows(
  products: Product[],
  description = true,
  notes = false,
): { rows: SalesRow[]; excluded: { id: string; name: string; reasons: string[] }[] } {
  const rows: SalesRow[] = [],
    excluded: { id: string; name: string; reasons: string[] }[] = [];
  for (const p of products) {
    const reasons = exportEligibility(p);
    if (reasons.length) {
      excluded.push({ id: p.id, name: `${p.brand} ${p.modelSku}`, reasons });
      continue;
    }
    const row: SalesRow = {
      Category: p.category,
      Brand: p.brand,
      'Model / SKU': p.modelSku,
      'Product Name': p.description,
      'Frost Selling Price (£ ex VAT)': p.frostSalePriceGbpExVat!,
    };
    if (description) row['Sales Description'] = p.salesDescription;
    if (notes) row['Sales Notes'] = p.salesNotes;
    rows.push(row);
  }
  return { rows, excluded };
}
const columns = (desc: boolean, notes: boolean) =>
  exportColumns.filter(
    (c) => (desc || c !== 'Sales Description') && (notes || c !== 'Sales Notes'),
  );
// Prevent CSV spreadsheet formula injection, including whitespace/control-character prefixes.
export const safeCell = (s: string) => (/^[\s\u0000-\u001f]*[=+\-@]/.test(s) ? `'${s}` : s);
export function salesCsv(rows: SalesRow[], desc = true, notes = false): string {
  const keys = columns(desc, notes);
  const quote = (v: unknown) =>
    `"${(typeof v === 'number' ? v.toFixed(2) : safeCell(String(v ?? ''))).replace(/"/g, '""')}"`;
  return (
    '\uFEFF' +
    [keys, ...rows.map((r) => keys.map((k) => r[k] ?? ''))]
      .map((r) => r.map(quote).join(','))
      .join('\r\n')
  );
}
export function salesXlsx(
  rows: SalesRow[],
  heading: string,
  desc = true,
  notes = false,
  date = localDate(),
): Uint8Array {
  const keys = columns(desc, notes);
  const matrix = [
    [heading],
    [`Generated ${date} · All prices in GBP excluding VAT`],
    [],
    [...keys],
    ...rows.map((r) => keys.map((k) => r[k] ?? '')),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(matrix);
  sheet['!cols'] = keys.map((k) => ({
    wch:
      k === 'Product Name' || k === 'Sales Description' || k === 'Sales Notes'
        ? 40
        : k.includes('Price')
          ? 28
          : 20,
  }));
  const priceColumn = keys.indexOf('Frost Selling Price (£ ex VAT)');
  rows.forEach((_, i) => {
    const c = sheet[XLSX.utils.encode_cell({ r: i + 4, c: priceColumn })];
    if (c) c.z = '"£"#,##0.00';
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Sales Price List');
  wb.Props = {
    Title: heading,
    Subject: 'Sales price list — GBP excluding VAT',
    Author: 'Frost Optical Services Ltd',
    CreatedDate: new Date(date + 'T12:00:00Z'),
  };
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true });
}
export const escapeHtml = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function salesPrintHtml(
  rows: SalesRow[],
  heading: string,
  desc = true,
  notes = false,
  date = localDate(),
) {
  const keys = columns(desc, notes);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(heading)}</title><style>@page{size:A4 landscape;margin:14mm}body{font:11px Arial,sans-serif;color:#183048;margin:24px}h1{font-size:23px;margin-bottom:8px}p{color:#526274}table{width:100%;border-collapse:collapse;margin-top:24px;table-layout:fixed}th,td{border-bottom:1px solid #d7dfe5;text-align:left;padding:9px 7px;overflow-wrap:anywhere;vertical-align:top}th{background:#ecf1f5}thead{display:table-header-group}tr{break-inside:avoid}th:last-child,td:last-child{text-align:right}footer{margin-top:20px;color:#526274}@media print{body{margin:0}}</style></head><body><h1>${escapeHtml(heading)}</h1><p>Generated ${escapeHtml(date)} · All prices in GBP excluding VAT</p><table><thead><tr>${keys.map((k) => `<th>${escapeHtml(k)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${keys.map((k) => `<td>${escapeHtml(typeof r[k] === 'number' ? '£' + Number(r[k]).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table><footer>${rows.length} approved products · Frost Optical Services Ltd</footer></body></html>`;
}
export function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const salesFilename = (ext: string) => `Frost_Sales_Price_List_${localDate()}.${ext}`;
export function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
