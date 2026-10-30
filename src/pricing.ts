import type { AppState, FxSettings, Product, SupplierOffer } from './model';
export const gbp = (n: number | null) =>
  n == null
    ? '—'
    : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n);
export const percent = (n: number | null) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`);
export function fxStale(fx: FxSettings) {
  return !fx.lastConfirmedAt || Date.now() - Date.parse(fx.lastConfirmedAt) > 30 * 86400000;
}
export function calculate(p: Product, fx: FxSettings) {
  const foreign = p.originalCurrency !== 'GBP';
  const rate = p.originalCurrency === 'GBP' ? 1 : fx.rates[p.originalCurrency];
  const supplierGbp =
    p.originalSupplierCost != null && rate > 0 && (!foreign || !fxStale(fx))
      ? p.originalSupplierCost * rate * (1 + (foreign ? fx.fxProtectionFraction : 0))
      : null;
  const landedGbp =
    supplierGbp != null && p.freightGbpPerUnit != null ? supplierGbp + p.freightGbpPerUnit : null;
  const sale = p.frostSalePriceGbpExVat;
  const grossProfitGbp = sale != null && landedGbp != null ? sale - landedGbp : null;
  const grossMarginFraction =
    grossProfitGbp != null && sale != null && sale > 0 ? grossProfitGbp / sale : null;
  const target = p.targetMarginFraction ?? fx.defaultTargetMarginFraction;
  const suggestedSaleGbp =
    landedGbp != null && target >= 0 && target < 1 ? landedGbp / (1 - target) : null;
  const warnings: string[] = [];
  if (p.originalSupplierCost == null) warnings.push('Missing supplier cost');
  if (p.freightGbpPerUnit == null) warnings.push('Freight unknown');
  if (!rate) warnings.push(`Missing ${p.originalCurrency} FX rate`);
  if (foreign && fxStale(fx)) warnings.push('FX unconfirmed or older than 30 days');
  if (sale == null || sale <= 0) warnings.push('Missing positive selling price');
  if (grossMarginFraction != null && grossMarginFraction < target)
    warnings.push(grossMarginFraction < 0 ? 'Negative gross margin' : 'Below target margin');
  if (/expir|out.of.date/i.test(p.sourceStatus + ' ' + p.validationNotes))
    warnings.push('Expired / dated source — confirm validity');
  if (p.validationNotes.trim()) warnings.push('Source caveat: ' + p.validationNotes);
  return {
    supplierGbp,
    landedGbp,
    grossProfitGbp,
    grossMarginFraction,
    suggestedSaleGbp,
    warnings,
  };
}
export function approvalErrors(p: Product, fx: FxSettings) {
  const errors = [];
  if (p.frostSalePriceGbpExVat == null || p.frostSalePriceGbpExVat <= 0)
    errors.push('Enter a positive selling price before approval.');
  if (p.originalCurrency !== 'GBP' && (fxStale(fx) || !fx.rates[p.originalCurrency]))
    errors.push('Confirm current FX assumptions in Settings before approval.');
  return errors;
}
export function productWarnings(p: Product, s: AppState) {
  return [
    ...calculate(p, s.fx).warnings,
    ...s.issues
      .filter((i) => i.status === 'open' && i.productId === p.id)
      .map((i) => `${i.priority.toUpperCase()}: ${i.issue}`),
  ];
}
export const offerWarnings = (o: SupplierOffer) =>
  [
    !o.matchedProductId ? 'Needs manual product match' : '',
    /demo/i.test(o.tierDescription + ' ' + o.specialTerms + ' ' + o.quoteClass)
      ? 'Demo / special terms — reference only'
      : '',
    /expir/i.test(o.sourceStatus + ' ' + o.specialTerms)
      ? 'Expiry mentioned — confirm validity'
      : '',
  ].filter(Boolean);
