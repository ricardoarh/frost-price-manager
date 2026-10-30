import { describe, expect, it } from 'vitest';
import { parseWorkbook } from '../src/importer';
import { bytes, workbook } from './fixtures';
import { calculate } from '../src/pricing';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
describe('exact row-5 workbook mapping', () => {
  const parse = () => parseWorkbook(bytes(workbook()), 'synthetic.xlsx');
  it('finds named sheets in any order; starts at row 6', () => {
    const p = parse();
    expect(p.state.products).toHaveLength(3);
    expect(p.state.offers).toHaveLength(3);
    expect(p.state.products[0]).toMatchObject({
      brand: 'Example Optics',
      modelSku: 'TEST-100',
      description: 'Synthetic instrument',
      originalSupplierCost: 100,
      originalCurrency: 'USD',
      freightGbpPerUnit: 10,
      frostSalePriceGbpExVat: 200,
      sourceRow: 'row 8',
      approvalStatus: 'draft',
    });
  });
  it('retains variants as separate immutable UUID records', () => {
    const p = parse();
    expect(new Set(p.state.products.map((p) => p.id)).size).toBe(3);
    expect(p.duplicates).toBe(2);
  });
  it('retains quantities, special terms and ambiguous offers without changing cost', () => {
    const p = parse();
    expect(p.state.offers[0].matchedProductId).toBe(p.state.products[0].id);
    expect(p.state.offers[1]).toMatchObject({
      quantityFrom: 5,
      tierDescription: 'Demo only',
      unitPrice: 75,
      quoteClass: 'Demo',
    });
    expect(p.state.products[0].originalSupplierCost).toBe(100);
    expect(p.state.offers[2].matchedProductId).toBeNull();
    expect(p.ambiguousOffers).toBe(1);
  });
  it('imports FX and original settings; requires confirmation', () => {
    const { state } = parse();
    expect(state.fx.rates).toEqual({ GBP: 1, USD: 0.8, EUR: 0.9 });
    expect(state.fx.lastConfirmedAt).toBeNull();
    expect(state.fx.importedSettings).toHaveLength(5);
    expect(calculate(state.products[0], state.fx).supplierGbp).toBeNull();
  });
  it('ignores source-derived cached values', () => {
    const { state } = parse();
    const c = calculate(state.products[0], {
      ...state.fx,
      lastConfirmedAt: new Date().toISOString(),
    });
    expect(c.supplierGbp).toBe(84);
    expect(c.landedGbp).toBe(94);
    expect(c.suggestedSaleGbp).toBeCloseTo(94 / 0.7);
  });
  it('imports existing review issues', () =>
    expect(
      parse().state.issues.some(
        (i) => i.priority === 'high' && i.issue === 'Synthetic source issue',
      ),
    ).toBe(true));
  it('keeps final populated cells beyond an understated sheet dimension', () => {
    const files = unzipSync(bytes(workbook()));
    const path = 'xl/worksheets/sheet4.xml';
    files[path] = strToU8(
      strFromU8(files[path]).replace(/<dimension ref="[^"]+"\/>/, '<dimension ref="A1:D9"/>'),
    );
    const p = parseWorkbook(zipSync(files), 'synthetic.xlsx');
    expect(p.state.fx.importedSettings).toHaveLength(5);
  });
  it('rejects a missing required sheet', () => {
    const wb = workbook();
    delete wb.Sheets['Supplier Offers'];
    wb.SheetNames = wb.SheetNames.filter((n) => n !== 'Supplier Offers');
    expect(() => parseWorkbook(bytes(wb), 'test.xlsx')).toThrow('Missing required sheet');
  });
  it('rejects incorrect or shifted headers', () => {
    const wb = workbook();
    wb.Sheets['Master Price List'].E5.v = 'Wrong';
    expect(() => parseWorkbook(bytes(wb), 'test.xlsx')).toThrow('column E5');
  });
  it('preserves blank versus zero freight', () => {
    const p = parse().state.products;
    expect(p[1].freightGbpPerUnit).toBeNull();
    expect(p[2].freightGbpPerUnit).toBe(0);
  });
  it('flags invalid numeric inputs and leaves them unknown', () => {
    const wb = workbook();
    wb.Sheets['Master Price List'].E6.v = -50;
    const p = parseWorkbook(bytes(wb), 'synthetic.xlsx');
    expect(p.state.products[0].originalSupplierCost).toBeNull();
    expect(p.warnings.some((w) => w.includes('Invalid supplier cost'))).toBe(true);
  });
  it('does not silently assume a currency', () => {
    const wb = workbook();
    delete wb.Sheets['Master Price List'].F6;
    const p = parseWorkbook(bytes(wb), 'synthetic.xlsx');
    expect(p.state.products[0].originalCurrency).toBe('UNKNOWN');
    expect(p.warnings.some((w) => w.includes('Currency missing'))).toBe(true);
  });
  it('requires nonempty identity fields instead of silently dropping a record', () => {
    const wb = workbook();
    delete wb.Sheets['Master Price List'].A6;
    expect(() => parseWorkbook(bytes(wb), 'test.xlsx')).toThrow('Brand and Product');
  });
  it('rejects empty / corrupt files and macro workbooks', () => {
    expect(() => parseWorkbook(new Uint8Array(), 'test.xlsx')).toThrow();
    expect(() => parseWorkbook(bytes(workbook()), 'test.xlsm')).toThrow('Macro-enabled');
  });
});
