// SYNTHETIC DATA ONLY. Never copy supplier records into this file.
import * as XLSX from 'xlsx';
import { emptyState, id, newProduct, now, type Product } from '../src/model';
import { headers } from '../src/importer';
export const syntheticFx = () => ({
  ...emptyState().fx,
  rates: { GBP: 1, USD: 0.8, EUR: 0.9 },
  lastConfirmedAt: now(),
  fxProtectionFraction: 0.05,
  source: 'SYNTHETIC TEST RATES',
});
export function product(overrides: Partial<Product> = {}): Product {
  return {
    ...newProduct(syntheticFx()),
    brand: 'Example Optics',
    modelSku: 'TEST-100',
    description: 'Synthetic examination instrument',
    category: 'Test equipment',
    originalSupplierCost: 100,
    freightGbpPerUnit: 10,
    frostSalePriceGbpExVat: 200,
    targetMarginFraction: 0.3,
    ...overrides,
  };
}
export const SECRET = 'SYNTHETIC_CONFIDENTIAL_MARKER_X7K2';
export function confidentialProduct(overrides: Partial<Product> = {}): Product {
  return product({
    approvalStatus: 'approved',
    sourceDocument: SECRET,
    sourceRow: SECRET,
    sourceStatus: SECRET,
    validationNotes: SECRET,
    costingBasis: SECRET,
    internalNotes: SECRET,
    ...overrides,
  });
}
export function workbook() {
  const wb = XLSX.utils.book_new();
  const data: Record<keyof typeof headers, unknown[][]> = {
    'Master Price List': [
      [
        ' Example Optics ',
        ' TEST-100 ',
        ' Synthetic instrument ',
        'Test equipment',
        100,
        'USD',
        1,
        'Ordinary',
        99999,
        10,
        99999,
        0.3,
        99999,
        200,
        99999,
        0.99,
        'Reference',
        'Synthetic caveat',
        SECRET,
        'row 8',
        'Synthetic unit basis',
        'Private test note',
      ],
      [
        'Example Optics',
        'TEST-200',
        'Variant A',
        'Test equipment',
        150,
        'EUR',
        1,
        'Ordinary',
        1,
        null,
        1,
        0.3,
        1,
        300,
        1,
        1,
        'Reference',
        '',
        'Synthetic quote',
        'row 9',
        '',
        '',
      ],
      [
        'Example Optics',
        'TEST-200',
        'Variant B',
        'Test equipment',
        175,
        'EUR',
        1,
        'Ordinary',
        1,
        0,
        1,
        0.3,
        1,
        null,
        1,
        1,
        'Reference',
        '',
        'Synthetic quote',
        'row 10',
        '',
        '',
      ],
    ],
    'Supplier Offers': [
      [
        'Example Optics',
        'TEST-100',
        'Synthetic instrument',
        'Test equipment',
        1,
        'Ordinary',
        100,
        'USD',
        99999,
        'Reference',
        SECRET,
        'row 1',
        'Test conditions',
        'Normal',
      ],
      [
        'Example Optics',
        'TEST-100',
        'Synthetic instrument',
        'Test equipment',
        5,
        'Demo only',
        75,
        'USD',
        99999,
        'Expired',
        SECRET,
        'row 2',
        'Initial demo only',
        'Demo',
      ],
      [
        'Example Optics',
        'TEST-200',
        'Variant A',
        'Test equipment',
        10,
        'Volume tier',
        120,
        'EUR',
        99999,
        'Reference',
        SECRET,
        'row 3',
        'Test terms',
        'Volume',
      ],
    ],
    'FX & Settings': [
      ['Currency USD → GBP', 0.8, 'GBP per USD', 'Synthetic'],
      ['Currency EUR → GBP', 0.9, 'GBP per EUR', 'Synthetic'],
      ['FX protection', 0.05, 'Percent', 'Synthetic'],
      ['Default gross margin', 0.3, 'Percent', 'Synthetic'],
      ['Price validity', 'Review before quote', '', 'Synthetic final row'],
    ],
    'Review Queue': [
      [
        'HIGH',
        'Synthetic source issue',
        'Synthetic evidence',
        'Confirm synthetic quote',
        SECRET,
        'row 1',
      ],
    ],
  };
  // Deliberately different sheet order; real parsing must be by name.
  for (const name of [
    'Review Queue',
    'Supplier Offers',
    'Master Price List',
    'FX & Settings',
  ] as const) {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Synthetic workbook'],
      [],
      ['Not real prices'],
      [],
      [...headers[name]],
      ...data[name],
    ]);
    XLSX.utils.book_append_sheet(wb, sheet, name);
  }
  return wb;
}
export const bytes = (wb = XLSX.utils.book_new()) =>
  new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
export function populatedState() {
  const state = emptyState();
  const p = confidentialProduct();
  state.products = [p];
  state.fx = syntheticFx();
  state.offers = [
    {
      id: id(),
      brand: p.brand,
      modelSku: p.modelSku,
      description: p.description,
      category: p.category,
      quantityFrom: 5,
      tierDescription: 'Synthetic volume',
      unitPrice: 80,
      currency: 'USD',
      sourceStatus: SECRET,
      sourceDocument: SECRET,
      sourceLocation: 'row 1',
      specialTerms: SECRET,
      quoteClass: 'Synthetic',
      matchedProductId: p.id,
    },
  ];
  state.issues = [
    {
      id: id(),
      priority: 'high',
      issue: SECRET,
      evidence: SECRET,
      action: 'Test action',
      source: SECRET,
      location: 'row 1',
      status: 'resolved',
      productId: p.id,
    },
  ];
  state.events = [
    {
      id: id(),
      productId: p.id,
      timestamp: now(),
      field: 'internalNotes',
      previousValue: null,
      newValue: SECRET,
      changeNote: SECRET,
    },
  ];
  return state;
}
