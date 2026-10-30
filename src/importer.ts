import * as XLSX from 'xlsx';
import {
  emptyState,
  id,
  now,
  stateSchema,
  type AppState,
  type Product,
  type ReviewIssue,
  type SupplierOffer,
} from './model';

export const headers = {
  'Master Price List': [
    'Brand',
    'Model / SKU',
    'Product / description',
    'Category',
    'Supplier unit cost',
    'Currency',
    'Min order',
    'Pricing tier',
    'Cost GBP (FX)',
    'Freight GBP / unit',
    'Landed GBP',
    'Target margin',
    'Suggested sale GBP',
    'Frost sale GBP',
    'Gross profit GBP',
    'Gross margin',
    'Source status',
    'Validation / caveat',
    'Source document',
    'Source row',
    'Basis',
    'Notes',
  ],
  'Supplier Offers': [
    'Brand',
    'Model / SKU',
    'Description',
    'Category',
    'Quantity from',
    'Tier / condition',
    'Unit price',
    'Currency',
    'FX value GBP',
    'Source status',
    'Document',
    'Source location',
    'Special terms / notes',
    'Quote class',
  ],
  'FX & Settings': ['Setting', 'Value', 'Unit', 'Basis / instructions'],
  'Review Queue': ['Priority', 'Issue', 'Evidence / impact', 'Action', 'Source', 'Location'],
} as const;
export type ImportPreview = {
  state: AppState;
  sheets: string[];
  warnings: string[];
  duplicates: number;
  ambiguousOffers: number;
  fileName: string;
  date: string;
};
const str = (v: unknown) => (v == null ? '' : String(v).trim());
const norm = (v: unknown) => str(v).replace(/\s+/g, ' ').toLowerCase();
export function parseWorkbook(data: ArrayBuffer | Uint8Array, fileName: string): ImportPreview {
  if (!/\.xlsx$/i.test(fileName))
    throw new Error('Choose an .xlsx workbook. Macro-enabled workbooks are not supported.');
  if (data.byteLength > 20 * 1024 * 1024) throw new Error('Workbook exceeds the 20 MB limit.');
  const wb = XLSX.read(data, { type: 'array', cellFormula: true, cellHTML: false, bookVBA: false });
  const state = emptyState(),
    warnings: string[] = [];
  const issue = (message: string, location: string, productId: string | null = null) => {
    warnings.push(`${location}: ${message}`);
    state.issues.push({
      id: id(),
      priority: 'medium',
      issue: message,
      evidence: 'Detected during workbook import',
      action: 'Review and correct before approval.',
      source: fileName,
      location,
      status: 'open',
      productId,
    });
  };
  const rows = (name: keyof typeof headers): unknown[][] => {
    const sheet = wb.Sheets[name];
    if (!sheet) throw new Error(`Missing required sheet: ${name}. Expected row-5 headers.`);
    const dimension = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
    if (!dimension || dimension.e.r > 50000 || dimension.e.c > 200)
      throw new Error(`${name}: invalid or oversized sheet dimensions.`);
    // Some source workbooks understate !ref. Inspect actual cells so the last FX / review row is retained.
    const lastRow = Math.max(
      dimension.e.r,
      ...Object.keys(sheet)
        .filter((k) => /^[A-Z]+\d+$/.test(k))
        .map((k) => XLSX.utils.decode_cell(k).r),
    );
    if (lastRow > 50000) throw new Error(`${name}: too many rows.`);
    const actual = headers[name].map((_, c) => sheet[XLSX.utils.encode_cell({ r: 4, c })]?.v);
    headers[name].forEach((h, c) => {
      if (norm(actual[c]) !== norm(h))
        throw new Error(
          `${name}: column ${XLSX.utils.encode_col(c)}5 must be “${h}”; found “${str(actual[c]) || '(blank)'}”.`,
        );
    });
    return Array.from({ length: lastRow - 4 }, (_, i) =>
      headers[name].map((_, c) => {
        const cell = sheet[XLSX.utils.encode_cell({ r: i + 5, c })];
        if (cell?.t === 'e') return null;
        return cell?.v ?? null;
      }),
    );
  };
  const master = rows('Master Price List'),
    offers = rows('Supplier Offers'),
    settings = rows('FX & Settings'),
    reviews = rows('Review Queue');
  const number = (
    v: unknown,
    location: string,
    field: string,
    productId: string | null = null,
    frac = false,
  ): number | null => {
    if (v == null || str(v) === '') return null;
    let value =
      typeof v === 'number'
        ? v
        : /^[-+]?\d+(?:\.\d+)?%?$/.test(str(v))
          ? Number(str(v).replace('%', '')) / (str(v).endsWith('%') ? 100 : 1)
          : NaN;
    if (!Number.isFinite(value) || value < 0 || value > 1e12 || (frac && value >= 1)) {
      issue(`Invalid ${field}; left unknown`, location, productId);
      value = NaN;
    }
    return Number.isNaN(value) ? null : value;
  };
  state.fx.source = `Imported historic assumptions from ${fileName}; confirmation required`;
  for (let i = 0; i < settings.length; i++) {
    const r = settings[i];
    if (!r.some((v) => str(v))) continue;
    state.fx.importedSettings.push({
      setting: str(r[0]),
      value: typeof r[1] === 'number' ? r[1] : str(r[1]),
      unit: str(r[2]),
      basis: str(r[3]),
    });
    const key = norm(r[0]),
      loc = `FX & Settings!${i + 6}`;
    if (/currency.*usd.*gbp/.test(key) || /currency.*eur.*gbp/.test(key)) {
      const rate = number(r[1], loc, 'FX rate');
      if (rate && rate <= 1e6) state.fx.rates[key.includes('usd') ? 'USD' : 'EUR'] = rate;
      else issue('Missing or invalid FX rate', loc);
    } else if (key === 'fx protection') {
      const v = number(r[1], loc, 'FX protection');
      if (v != null && v <= 1) state.fx.fxProtectionFraction = v;
      else issue('Invalid FX protection; review settings', loc);
    } else if (key === 'default gross margin') {
      const v = number(r[1], loc, 'default gross margin', null, true);
      if (v != null) state.fx.defaultTargetMarginFraction = v;
      else issue('Default gross margin unavailable; review settings', loc);
    }
  }
  master.forEach((r, i) => {
    if (!r.some((v) => str(v))) return;
    const loc = `Master Price List!${i + 6}`,
      pid = id();
    if (!str(r[0]) || !str(r[2]))
      throw new Error(`${loc}: Brand and Product / description are required.`);
    let currency = str(r[5]).toUpperCase();
    if (!currency) {
      currency = 'UNKNOWN';
      issue('Currency missing; no conversion assumed', loc, pid);
    }
    const p: Product = {
      id: pid,
      brand: str(r[0]),
      modelSku: str(r[1]),
      description: str(r[2]),
      category: str(r[3]),
      variant: '',
      originalSupplierCost: number(r[4], loc, 'supplier cost', pid),
      originalCurrency: currency,
      moq: number(r[6], loc, 'minimum order', pid),
      primaryPricingTier: str(r[7]),
      freightGbpPerUnit: number(r[9], loc, 'freight', pid),
      targetMarginFraction: number(r[11], loc, 'target margin', pid, true),
      frostSalePriceGbpExVat: number(r[13], loc, 'selling price', pid),
      sourceStatus: str(r[16]),
      validationNotes: str(r[17]),
      sourceDocument: str(r[18]),
      sourceRow: str(r[19]) || loc,
      costingBasis: str(r[20]),
      internalNotes: str(r[21]),
      salesDescription: '',
      salesNotes: '',
      salesVisible: true,
      approvalStatus: 'draft',
      createdAt: now(),
      updatedAt: now(),
    };
    state.products.push(p);
  });
  if (!state.products.length) throw new Error('Master Price List contains no product rows.');
  const groups = new Map<string, Product[]>();
  state.products.forEach((p) => {
    const key = norm(p.brand) + '|' + norm(p.modelSku);
    groups.set(key, [...(groups.get(key) || []), p]);
  });
  const duplicates = [...groups.values()]
    .filter((g) => g.length > 1)
    .reduce((n, g) => n + g.length, 0);
  if (duplicates)
    issue(
      `${duplicates} products share brand / model keys. Variants retained with separate UUIDs.`,
      'Master Price List',
    );
  offers.forEach((r, i) => {
    if (!r.some((v) => str(v))) return;
    const loc = `Supplier Offers!${i + 6}`;
    const candidates =
      str(r[0]) && str(r[1]) ? groups.get(norm(r[0]) + '|' + norm(r[1])) || [] : [];
    // Do not guess between variants, aliases, or descriptions.
    const matchedProductId = candidates.length === 1 ? candidates[0].id : null;
    const o: SupplierOffer = {
      id: id(),
      brand: str(r[0]),
      modelSku: str(r[1]),
      description: str(r[2]),
      category: str(r[3]),
      quantityFrom: number(r[4], loc, 'quantity'),
      tierDescription: str(r[5]),
      unitPrice: number(r[6], loc, 'unit price'),
      currency: str(r[7]).toUpperCase(),
      sourceStatus: str(r[9]),
      sourceDocument: str(r[10]),
      sourceLocation: str(r[11]) || loc,
      specialTerms: str(r[12]),
      quoteClass: str(r[13]),
      matchedProductId,
    };
    state.offers.push(o);
    if (!matchedProductId) issue('Supplier offer has no unambiguous product match', loc);
  });
  reviews.forEach((r, i) => {
    if (!r.some((v) => str(v))) return;
    const pri = norm(r[0]);
    const priority: ReviewIssue['priority'] = ['critical', 'high', 'medium', 'low'].includes(pri)
      ? (pri as ReviewIssue['priority'])
      : 'medium';
    state.issues.push({
      id: id(),
      priority,
      issue: str(r[1]),
      evidence: str(r[2]),
      action: str(r[3]),
      source: str(r[4]),
      location: str(r[5]) || `Review Queue!${i + 6}`,
      status: 'open',
      productId: null,
    });
  });
  state.importedAt = now();
  state.updatedAt = now();
  return {
    state: stateSchema.parse(state),
    sheets: wb.SheetNames,
    warnings,
    duplicates,
    ambiguousOffers: state.offers.filter((o) => !o.matchedProductId).length,
    fileName,
    date: state.importedAt,
  };
}
