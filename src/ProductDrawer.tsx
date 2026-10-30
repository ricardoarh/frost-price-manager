import { useState } from 'react';
import { Archive, Copy, Save, ShieldCheck, Trash2, AlertTriangle } from 'lucide-react';
import { Modal, Field, NumberInput, Badge } from './components';
import { productSchema, type AppState, type Product } from './model';
import { approvalErrors, calculate, gbp, percent, offerWarnings, productWarnings } from './pricing';

type Props = {
  product: Product;
  state: AppState;
  onClose: () => void;
  onSave: (p: Product, note: string, approve: boolean) => Promise<boolean>;
  onDelete: (p: Product) => void;
  onDuplicate: (p: Product) => void;
  onArchive: (p: Product) => void;
};
export function ProductDrawer({
  product,
  state,
  onClose,
  onSave,
  onDelete,
  onDuplicate,
  onArchive,
}: Props) {
  const [p, setP] = useState<Product>(product),
    [tab, setTab] = useState('General'),
    [note, setNote] = useState(''),
    [ack, setAck] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const change = <K extends keyof Product>(key: K, value: Product[K]) => {
    setP((x) => ({ ...x, [key]: value }));
    setAck(false);
  };
  const totals = calculate(p, state.fx),
    warnings = productWarnings(p, state),
    approval = approvalErrors(p, state.fx);
  const edited = JSON.stringify(p) !== JSON.stringify(product);
  function close() {
    if (!edited || window.confirm('Discard unsaved product changes?')) onClose();
  }
  const save = async (approve = false) => {
    setError('');
    const validation = productSchema.safeParse({
      ...p,
      approvalStatus: approve ? 'approved' : p.approvalStatus,
    });
    if (!validation.success) {
      setError(validation.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      return;
    }
    if (approve && approval.length) {
      setError(approval.join(' '));
      return;
    }
    if (approve && warnings.length && !ack) {
      setError('Acknowledge the pricing warnings before approving.');
      return;
    }
    setSaving(true);
    const okay = await onSave(
      { ...p, approvalStatus: approve ? 'approved' : p.approvalStatus },
      note,
      approve,
    );
    setSaving(false);
    if (okay) onClose();
    else
      setError(
        'Save failed. Your changes are still in the editor. Check the values, or reload if another tab has changed the catalogue.',
      );
  };
  const offers = state.offers.filter((o) => o.matchedProductId === p.id);
  const history = state.events
    .filter((e) => e.productId === p.id)
    .slice()
    .reverse();
  return (
    <Modal
      drawer
      title={state.products.some((x) => x.id === p.id) ? 'Product details' : 'Add product'}
      onClose={close}
    >
      <div className="drawer-heading">
        <div>
          <span className="eyebrow">{p.brand || 'NEW PRODUCT'}</span>
          <h3>{p.modelSku || 'New product'}</h3>
          <p>{p.description || 'Enter the product details below.'}</p>
        </div>
        <Badge value={p.approvalStatus} />
      </div>
      <div className="tabs" role="tablist" aria-label="Product sections">
        {['General', 'Selling Price', 'Supplier Costs', 'Supplier Offers', 'Notes & History'].map(
          (t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={tab === t ? 'active' : ''}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ),
        )}
      </div>
      <form
        id="product-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="drawer-body" role="tabpanel" aria-label={tab}>
          {tab === 'General' && (
            <>
              <div className="form-grid">
                <Field label="Brand / manufacturer *">
                  <input
                    required
                    value={p.brand}
                    onChange={(e) => change('brand', e.target.value)}
                  />
                </Field>
                <Field label="Model / SKU">
                  <input value={p.modelSku} onChange={(e) => change('modelSku', e.target.value)} />
                </Field>
              </div>
              <Field label="Product name *">
                <input
                  required
                  value={p.description}
                  onChange={(e) => change('description', e.target.value)}
                />
              </Field>
              <div className="form-grid">
                <Field label="Category">
                  <input
                    list="categories"
                    value={p.category}
                    onChange={(e) => change('category', e.target.value)}
                  />
                  <datalist id="categories">
                    {[...new Set(state.products.map((x) => x.category))].sort().map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </datalist>
                </Field>
                <Field label="Variant / display name">
                  <input value={p.variant} onChange={(e) => change('variant', e.target.value)} />
                </Field>
              </div>
              <Field
                label="Sales description"
                hint="Customer-facing text; included only when selected during sales export."
              >
                <textarea
                  rows={3}
                  value={p.salesDescription}
                  onChange={(e) => change('salesDescription', e.target.value)}
                />
              </Field>
              <Field
                label="General sales notes"
                hint="Customer-facing notes. Never enter confidential terms here."
              >
                <textarea
                  rows={2}
                  value={p.salesNotes}
                  onChange={(e) => change('salesNotes', e.target.value)}
                />
              </Field>
              <label className="check">
                <input
                  type="checkbox"
                  checked={p.salesVisible}
                  onChange={(e) => change('salesVisible', e.target.checked)}
                />{' '}
                Visible in sales exports when approved
              </label>
              <p className="help">
                Editing an approved record returns it to Draft. Approve intentionally after
                reviewing the changes.
              </p>
            </>
          )}
          {tab === 'Selling Price' && (
            <>
              <div className="section-label">GBP · EXCLUDING VAT</div>
              <Field label="Frost selling price (£ ex VAT)">
                <NumberInput
                  value={p.frostSalePriceGbpExVat}
                  onChange={(v) => change('frostSalePriceGbpExVat', v)}
                />
              </Field>
              <Field
                label="Target gross margin (%)"
                hint={`Default: ${percent(state.fx.defaultTargetMarginFraction)}. Blank uses this default.`}
              >
                <NumberInput
                  max={99.9999}
                  value={p.targetMarginFraction == null ? null : p.targetMarginFraction * 100}
                  onChange={(v) => change('targetMarginFraction', v == null ? null : v / 100)}
                />
              </Field>
              <div className="calculation-grid">
                <div>
                  <span>Landed cost</span>
                  <strong>{gbp(totals.landedGbp)}</strong>
                </div>
                <div>
                  <span>Suggested sale</span>
                  <strong>{gbp(totals.suggestedSaleGbp)}</strong>
                </div>
                <div>
                  <span>Gross profit</span>
                  <strong>{gbp(totals.grossProfitGbp)}</strong>
                </div>
                <div>
                  <span>Gross margin</span>
                  <strong
                    className={
                      totals.grossMarginFraction != null && totals.grossMarginFraction < 0
                        ? 'text-danger'
                        : ''
                    }
                  >
                    {percent(totals.grossMarginFraction)}
                  </strong>
                </div>
              </div>
              {warnings.length > 0 && (
                <div className="warning-box">
                  <strong>
                    <AlertTriangle size={15} /> Pricing review
                  </strong>
                  <ul>
                    {warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              {warnings.length > 0 && (
                <label className="check">
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />{' '}
                  I have reviewed these warnings and verified this selling price.
                </label>
              )}
              {approval.length > 0 && <p className="help">{approval.join(' ')}</p>}
              <button
                type="button"
                className="button primary full"
                disabled={saving || approval.length > 0}
                onClick={() => void save(true)}
              >
                <ShieldCheck size={17} /> Save & approve for sales
              </button>
            </>
          )}
          {tab === 'Supplier Costs' && (
            <>
              <div className="confidential-label">CONFIDENTIAL · ADMINISTRATOR ONLY</div>
              <div className="form-grid">
                <Field label="Original supplier unit cost">
                  <NumberInput
                    value={p.originalSupplierCost}
                    onChange={(v) => change('originalSupplierCost', v)}
                  />
                </Field>
                <Field label="Original currency *">
                  <input
                    required
                    value={p.originalCurrency}
                    onChange={(e) =>
                      change('originalCurrency', e.target.value.toUpperCase().trim())
                    }
                  />
                </Field>
                <Field
                  label="Freight (£ / unit)"
                  hint="Blank = unknown. Enter 0 only when confirmed."
                >
                  <NumberInput
                    value={p.freightGbpPerUnit}
                    onChange={(v) => change('freightGbpPerUnit', v)}
                  />
                </Field>
                <Field label="Minimum order">
                  <NumberInput value={p.moq} onChange={(v) => change('moq', v)} />
                </Field>
              </div>
              <Field label="Primary pricing tier">
                <input
                  value={p.primaryPricingTier}
                  onChange={(e) => change('primaryPricingTier', e.target.value)}
                />
              </Field>
              <div className="calculation-grid">
                <div>
                  <span>Converted supplier cost</span>
                  <strong>{gbp(totals.supplierGbp)}</strong>
                </div>
                <div>
                  <span>Landed cost / unit</span>
                  <strong>{gbp(totals.landedGbp)}</strong>
                </div>
              </div>
              <p className="help">
                Currency assumptions: {state.fx.source}. Foreign-currency calculations require FX
                confirmation within 30 days. GBP uses factor 1 with no FX protection.
              </p>
              <Field label="Source status">
                <input
                  value={p.sourceStatus}
                  onChange={(e) => change('sourceStatus', e.target.value)}
                />
              </Field>
              <Field label="Validation / caveat">
                <textarea
                  rows={3}
                  value={p.validationNotes}
                  onChange={(e) => change('validationNotes', e.target.value)}
                />
              </Field>
              <dl className="provenance">
                <dt>Source document</dt>
                <dd>{p.sourceDocument || '—'}</dd>
                <dt>Source row</dt>
                <dd>{p.sourceRow || '—'}</dd>
                <dt>Costing basis</dt>
                <dd>{p.costingBasis || '—'}</dd>
              </dl>
            </>
          )}
          {tab === 'Supplier Offers' && (
            <>
              <p className="help">
                Offers are reference records. Quantity tiers and demo conditions never change the
                product cost automatically. Match unlinked offers on the Supplier Offers page.
              </p>
              {offers.length ? (
                offers.map((o) => (
                  <article className="offer-card" key={o.id}>
                    <strong>
                      {o.currency} {o.unitPrice?.toLocaleString('en-GB') ?? '—'}{' '}
                      <span className="subtle">/ unit · Qty {o.quantityFrom ?? '—'}+</span>
                    </strong>
                    <p>
                      {o.tierDescription} · {o.quoteClass}
                    </p>
                    <p>{o.specialTerms}</p>
                    <small>
                      {o.sourceDocument} · {o.sourceLocation}
                    </small>
                    {offerWarnings(o).map((w) => (
                      <p className="text-warning" key={w}>
                        {w}
                      </p>
                    ))}
                  </article>
                ))
              ) : (
                <div className="small-empty">No unambiguously matched offers.</div>
              )}
            </>
          )}
          {tab === 'Notes & History' && (
            <>
              <div className="confidential-label">CONFIDENTIAL · LOCAL HISTORY</div>
              <Field label="Internal notes">
                <textarea
                  rows={5}
                  value={p.internalNotes}
                  onChange={(e) => change('internalNotes', e.target.value)}
                />
              </Field>
              <Field label="Change note">
                <input value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <h4>
                Change history <span className="count">{history.length}</span>
              </h4>
              <p className="help">
                Local history is editable browser data, not a tamper-proof audit.
              </p>
              <div className="history">
                {history.map((e) => (
                  <div key={e.id}>
                    <strong>{e.field}</strong>
                    <small>{new Date(e.timestamp).toLocaleString('en-GB')}</small>
                    <p>
                      {String(e.previousValue ?? '—')} → {String(e.newValue ?? '—')}
                    </p>
                    {e.changeNote && <p>{e.changeNote}</p>}
                  </div>
                ))}
                {!history.length && <p className="subtle">No changes recorded yet.</p>}
              </div>
            </>
          )}
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="drawer-footer">
          <div className="row-actions">
            <button
              type="button"
              title="Duplicate product as Draft"
              aria-label="Duplicate product"
              onClick={() => onDuplicate(p)}
            >
              <Copy size={16} />
            </button>
            {state.products.some((x) => x.id === p.id) && (
              <>
                <button
                  type="button"
                  title={p.approvalStatus === 'archived' ? 'Unarchive to Draft' : 'Archive product'}
                  aria-label={
                    p.approvalStatus === 'archived' ? 'Unarchive product' : 'Archive product'
                  }
                  onClick={() => onArchive(product)}
                >
                  <Archive size={16} />
                </button>
                <button
                  type="button"
                  className="text-danger"
                  title="Permanently delete"
                  aria-label="Permanently delete product"
                  onClick={() => onDelete(product)}
                >
                  <Trash2 size={16} />
                </button>
              </>
            )}
          </div>
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
          <button className="button primary" type="submit" disabled={saving}>
            <Save size={16} />
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
