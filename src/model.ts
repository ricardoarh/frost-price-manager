import { z } from 'zod';

const text = z.string().trim().max(20000);
const amount = z.number().finite().nonnegative().max(1e12).nullable();
const fraction = z.number().finite().min(0).max(0.999999).nullable();
const stamp = z.string().datetime();
export const productSchema = z
  .object({
    id: z.string().uuid(),
    brand: text.min(1),
    modelSku: text,
    description: text.min(1),
    category: text,
    variant: text,
    originalSupplierCost: amount,
    originalCurrency: text.min(1),
    moq: amount,
    primaryPricingTier: text,
    freightGbpPerUnit: amount,
    targetMarginFraction: fraction,
    frostSalePriceGbpExVat: amount,
    sourceStatus: text,
    validationNotes: text,
    sourceDocument: text,
    sourceRow: text,
    costingBasis: text,
    internalNotes: text,
    salesDescription: text,
    salesNotes: text,
    salesVisible: z.boolean(),
    approvalStatus: z.enum(['draft', 'approved', 'archived']),
    createdAt: stamp,
    updatedAt: stamp,
  })
  .strict()
  .superRefine((p, ctx) => {
    if (
      p.approvalStatus === 'approved' &&
      !(p.frostSalePriceGbpExVat != null && p.frostSalePriceGbpExVat > 0)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'An approved product needs a positive selling price.',
        path: ['frostSalePriceGbpExVat'],
      });
  });
export type Product = z.infer<typeof productSchema>;
export const offerSchema = z
  .object({
    id: z.string().uuid(),
    brand: text,
    modelSku: text,
    description: text,
    category: text,
    quantityFrom: amount,
    tierDescription: text,
    unitPrice: amount,
    currency: text,
    sourceStatus: text,
    sourceDocument: text,
    sourceLocation: text,
    specialTerms: text,
    quoteClass: text,
    matchedProductId: z.string().uuid().nullable(),
  })
  .strict();
export type SupplierOffer = z.infer<typeof offerSchema>;
export const fxSchema = z
  .object({
    rates: z.record(z.string(), z.number().finite().positive().max(1e6)),
    lastConfirmedAt: stamp.nullable(),
    fxProtectionFraction: z.number().finite().min(0).max(1),
    defaultTargetMarginFraction: z.number().finite().min(0).max(0.999999),
    source: text,
    importedSettings: z
      .array(
        z
          .object({
            setting: text,
            value: z.union([text, z.number().finite(), z.null()]),
            unit: text,
            basis: text,
          })
          .strict(),
      )
      .max(1000),
  })
  .strict()
  .refine((f) => f.rates.GBP === 1, 'GBP conversion must equal 1.');
export type FxSettings = z.infer<typeof fxSchema>;
export const issueSchema = z
  .object({
    id: z.string().uuid(),
    priority: z.enum(['critical', 'high', 'medium', 'low']),
    issue: text,
    evidence: text,
    action: text,
    source: text,
    location: text,
    status: z.enum(['open', 'resolved']),
    productId: z.string().uuid().nullable(),
  })
  .strict();
export type ReviewIssue = z.infer<typeof issueSchema>;
export const eventSchema = z
  .object({
    id: z.string().uuid(),
    productId: z.string().uuid(),
    timestamp: stamp,
    field: text,
    previousValue: z.union([text, z.number().finite(), z.boolean(), z.null()]),
    newValue: z.union([text, z.number().finite(), z.boolean(), z.null()]),
    changeNote: text,
  })
  .strict();
export type PriceChangeEvent = z.infer<typeof eventSchema>;
export const stateSchema = z
  .object({
    products: z.array(productSchema).max(20000),
    offers: z.array(offerSchema).max(50000),
    issues: z.array(issueSchema).max(50000),
    events: z.array(eventSchema).max(200000),
    fx: fxSchema,
    importedAt: stamp.nullable(),
    revision: z.number().int().nonnegative(),
    updatedAt: stamp,
  })
  .strict()
  .superRefine((s, ctx) => {
    for (const key of ['products', 'offers', 'issues', 'events'] as const) {
      if (new Set(s[key].map((r) => r.id)).size !== s[key].length)
        ctx.addIssue({ code: 'custom', message: `Duplicate IDs in ${key}` });
    }
    const ids = new Set(s.products.map((p) => p.id));
    if (
      s.offers.some((o) => o.matchedProductId && !ids.has(o.matchedProductId)) ||
      s.issues.some((i) => i.productId && !ids.has(i.productId))
    )
      ctx.addIssue({ code: 'custom', message: 'Backup has dangling product links.' });
  });
export type AppState = z.infer<typeof stateSchema>;
export const now = () => new Date().toISOString();
export const id = () => crypto.randomUUID();
export function emptyState(): AppState {
  return {
    products: [],
    offers: [],
    issues: [],
    events: [],
    fx: {
      rates: { GBP: 1 },
      lastConfirmedAt: null,
      fxProtectionFraction: 0,
      defaultTargetMarginFraction: 0.3,
      source: 'Not configured',
      importedSettings: [],
    },
    importedAt: null,
    revision: 0,
    updatedAt: now(),
  };
}
export function newProduct(fx: FxSettings): Product {
  return {
    id: id(),
    brand: '',
    modelSku: '',
    description: '',
    category: '',
    variant: '',
    originalSupplierCost: null,
    originalCurrency: 'GBP',
    moq: 1,
    primaryPricingTier: '',
    freightGbpPerUnit: null,
    targetMarginFraction: fx.defaultTargetMarginFraction,
    frostSalePriceGbpExVat: null,
    sourceStatus: 'Manual entry',
    validationNotes: '',
    sourceDocument: '',
    sourceRow: '',
    costingBasis: '',
    internalNotes: '',
    salesDescription: '',
    salesNotes: '',
    salesVisible: true,
    approvalStatus: 'draft',
    createdAt: now(),
    updatedAt: now(),
  };
}
