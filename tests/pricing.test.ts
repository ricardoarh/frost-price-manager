import { describe, expect, it } from 'vitest';
import { calculate, approvalErrors, fxStale } from '../src/pricing';
import { product, syntheticFx } from './fixtures';
import { productSchema } from '../src/model';
describe('GBP ex VAT costing', () => {
  it('calculates gross margin, not markup', () => {
    const c = calculate(product(), syntheticFx());
    expect(c.supplierGbp).toBe(100);
    expect(c.landedGbp).toBe(110);
    expect(c.grossProfitGbp).toBe(90);
    expect(c.grossMarginFraction).toBe(0.45);
    expect(c.suggestedSaleGbp).toBeCloseTo(110 / 0.7);
  });
  it('converts foreign input and protects only foreign FX', () => {
    const c = calculate(product({ originalCurrency: 'USD' }), syntheticFx());
    expect(c.supplierGbp).toBe(84);
    expect(c.landedGbp).toBe(94);
  });
  it('preserves unknown freight instead of inventing zero', () => {
    const c = calculate(product({ freightGbpPerUnit: null }), syntheticFx());
    expect(c.supplierGbp).toBe(100);
    expect(c.landedGbp).toBeNull();
    expect(c.grossMarginFraction).toBeNull();
    expect(c.suggestedSaleGbp).toBeNull();
  });
  it('accepts explicit zero freight', () =>
    expect(calculate(product({ freightGbpPerUnit: 0 }), syntheticFx()).landedGbp).toBe(100));
  it('accepts explicit zero supplier cost', () =>
    expect(calculate(product({ originalSupplierCost: 0 }), syntheticFx()).landedGbp).toBe(10));
  it('keeps missing cost and selling price unknown', () => {
    const c = calculate(
      product({ originalSupplierCost: null, frostSalePriceGbpExVat: null }),
      syntheticFx(),
    );
    expect(c.landedGbp).toBeNull();
    expect(c.grossProfitGbp).toBeNull();
    expect(c.grossMarginFraction).toBeNull();
  });
  it('blocks unknown, stale or unconfirmed foreign FX', () => {
    for (const fx of [
      { ...syntheticFx(), lastConfirmedAt: null },
      { ...syntheticFx(), lastConfirmedAt: '2020-01-01T00:00:00.000Z' },
      { ...syntheticFx(), rates: { GBP: 1 } },
    ]) {
      expect(calculate(product({ originalCurrency: 'USD' }), fx).supplierGbp).toBeNull();
      expect(approvalErrors(product({ originalCurrency: 'USD' }), fx)).not.toHaveLength(0);
    }
  });
  it('uses GBP factor 1 without requiring FX confirmation', () =>
    expect(calculate(product(), { ...syntheticFx(), lastConfirmedAt: null }).supplierGbp).toBe(
      100,
    ));
  it('rejects zero selling prices for approval', () => {
    expect(approvalErrors(product({ frostSalePriceGbpExVat: 0 }), syntheticFx())).toHaveLength(1);
    expect(
      productSchema.safeParse(product({ approvalStatus: 'approved', frostSalePriceGbpExVat: 0 }))
        .success,
    ).toBe(false);
  });
  it('does not divide by zero', () =>
    expect(
      calculate(product({ frostSalePriceGbpExVat: 0 }), syntheticFx()).grossMarginFraction,
    ).toBeNull());
  it('uses explicit default target when product target is blank', () =>
    expect(
      calculate(product({ targetMarginFraction: null }), {
        ...syntheticFx(),
        defaultTargetMarginFraction: 0.4,
      }).suggestedSaleGbp,
    ).toBeCloseTo(110 / 0.6));
  it('keeps precision through intermediates', () => {
    const c = calculate(
      product({ originalCurrency: 'USD', originalSupplierCost: 123.456, freightGbpPerUnit: 2.345 }),
      syntheticFx(),
    );
    expect(c.landedGbp).toBeCloseTo(123.456 * 0.8 * 1.05 + 2.345, 10);
  });
  it('flags negative margin and source expiry', () => {
    const c = calculate(
      product({ frostSalePriceGbpExVat: 50, sourceStatus: 'Expired test quote' }),
      syntheticFx(),
    );
    expect(c.warnings).toContain('Negative gross margin');
    expect(c.warnings.some((w) => w.includes('Expired'))).toBe(true);
  });
  it.each([-1, NaN, Infinity])('rejects invalid numeric input %s', (n) =>
    expect(productSchema.safeParse(product({ originalSupplierCost: n })).success).toBe(false),
  );
  it('rejects impossible target margin', () =>
    expect(productSchema.safeParse(product({ targetMarginFraction: 1 })).success).toBe(false));
  it('labels never-confirmed assumptions stale', () =>
    expect(fxStale({ ...syntheticFx(), lastConfirmedAt: null })).toBe(true));
});
