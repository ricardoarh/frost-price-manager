/** Local-only acceptance check. Reads the supplied path without writing workbook data. */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseWorkbook } from '../src/importer';
import { salesRows, salesXlsx, salesCsv, salesPrintHtml } from '../src/exports';
import { serializeBackup, parseBackup } from '../src/storage';
import { calculate } from '../src/pricing';
import * as XLSX from 'xlsx';
import { unzipSync, strFromU8 } from 'fflate';
const path = process.argv[2];
if (!path)
  throw new Error('Usage: npm run validate:workbook -- <path-to-confidential-workbook.xlsx>');
const buffer = readFileSync(path);
const preview = parseWorkbook(buffer, path.split(/[\\/]/).pop()!);
const { state } = preview;
assert(state.products.length > 0);
assert.equal(new Set(state.products.map((p) => p.id)).size, state.products.length);
assert(state.products.every((p) => p.approvalStatus === 'draft'));
assert(state.products.some((p) => p.modelSku.toUpperCase().includes('S260')));
assert(state.products.some((p) => p.modelSku.toUpperCase().includes('HRK-9000A')));
assert(state.fx.lastConfirmedAt === null);
assert(state.products.some((p) => p.freightGbpPerUnit === null));
assert(
  state.offers.some((o) =>
    /demo/i.test(o.tierDescription + ' ' + o.specialTerms + ' ' + o.quoteClass),
  ),
);
assert.deepEqual(parseBackup(serializeBackup(state)), state);
const candidates = state.products
  .filter((p) => p.frostSalePriceGbpExVat != null && p.frostSalePriceGbpExVat > 0)
  .slice(0, 5)
  .map((p) => ({ ...p, approvalStatus: 'approved' as const }));
const { rows } = salesRows(candidates);
assert.equal(rows.length, candidates.length);
const xlsx = salesXlsx(rows, 'Local acceptance sales list');
const out = XLSX.read(xlsx, { type: 'array' });
assert.deepEqual(out.SheetNames, ['Sales Price List']);
const xml = Object.entries(unzipSync(new Uint8Array(xlsx)))
  .filter(([k]) => k.endsWith('.xml'))
  .map(([, v]) => strFromU8(v))
  .join('');
const outputs = [xml, salesCsv(rows), salesPrintHtml(rows, 'Local acceptance sales list')];
for (const p of candidates)
  for (const field of [
    'internalNotes',
    'sourceDocument',
    'validationNotes',
    'costingBasis',
  ] as const) {
    if (p[field].length > 15)
      for (const output of outputs)
        assert(!output.includes(p[field]), 'Confidential source text appeared in a sales output');
  }
for (const p of state.products.filter((p) => p.freightGbpPerUnit === null))
  assert.equal(calculate(p, state.fx).landedGbp, null);
console.log(
  JSON.stringify(
    {
      result: 'PASS — no confidential data written',
      products: state.products.length,
      offers: state.offers.length,
      reviewIssues: state.issues.length,
      importWarnings: preview.warnings.length,
      duplicateVariantRecords: preview.duplicates,
      unlinkedOffers: preview.ambiguousOffers,
      settings: state.fx.importedSettings.length,
      checks: [
        'named sheets and offsets',
        'acceptance search keys',
        'UUID preservation',
        'draft approval',
        'unknown freight',
        'demo offers retained',
        'backup round-trip',
        'sales XLSX/CSV/print confidentiality',
      ],
    },
    null,
    2,
  ),
);
