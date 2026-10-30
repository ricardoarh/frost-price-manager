import { useRef, useState } from 'react';
import { Download, Printer, ShieldCheck } from 'lucide-react';
import type { Product } from './model';
import { download, salesRows, salesXlsx, salesCsv, salesPrintHtml, salesFilename } from './exports';
import { Field, Modal } from './components';
import { gbp } from './pricing';

export function ExportPage({
  products,
  filtered,
  selected,
  onError,
}: {
  products: Product[];
  filtered: Product[];
  selected: Set<string>;
  onError: (s: string) => void;
}) {
  const [scope, setScope] = useState(selected.size ? 'selected' : 'all'),
    [description, setDescription] = useState(true),
    [notes, setNotes] = useState(false),
    [heading, setHeading] = useState('Frost Optical — Equipment Price List'),
    [print, setPrint] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const candidates =
    scope === 'filtered'
      ? filtered
      : scope === 'selected'
        ? products.filter((p) => selected.has(p.id))
        : products;
  const { rows, excluded } = salesRows(candidates, description, notes);
  const exportFile = (type: 'xlsx' | 'csv') => {
    try {
      if (!heading.trim()) throw new Error('Enter a heading for the sales list.');
      if (!rows.length)
        throw new Error('There are no eligible approved products in this selection.');
      if (type === 'xlsx')
        download(
          salesXlsx(rows, heading, description, notes),
          salesFilename('xlsx'),
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
      else
        download(
          salesCsv(rows, description, notes),
          salesFilename('csv'),
          'text/csv;charset=utf-8',
        );
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Export failed.');
    }
  };
  return (
    <>
      <div className="export-layout">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Sales list options</h2>
              <p>Only approved, visible, positive-price records qualify.</p>
            </div>
          </div>
          <div className="panel-body">
            <Field label="List heading">
              <input maxLength={200} value={heading} onChange={(e) => setHeading(e.target.value)} />
            </Field>
            <Field label="Products to include">
              <select value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="all">All approved & active products</option>
                <option value="filtered">Currently filtered catalogue ({filtered.length})</option>
                <option value="selected">Selected products ({selected.size})</option>
              </select>
            </Field>
            <label className="check">
              <input
                type="checkbox"
                checked={description}
                onChange={(e) => setDescription(e.target.checked)}
              />{' '}
              Include sales description
            </label>
            <label className="check">
              <input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} />{' '}
              Include general sales notes
            </label>
            <div className="safe-box">
              <ShieldCheck size={23} />
              <div>
                <strong>Safe sales fields only</strong>
                <p>Supplier costs, margins, FX, source files and internal notes are excluded.</p>
              </div>
            </div>
            <div className="export-buttons">
              <button
                disabled={!rows.length || !heading.trim()}
                className="button primary full"
                onClick={() => exportFile('xlsx')}
              >
                <Download size={16} /> Download Excel (.xlsx)
              </button>
              <button
                disabled={!rows.length || !heading.trim()}
                className="button full"
                onClick={() => exportFile('csv')}
              >
                <Download size={16} /> Download CSV
              </button>
              <button
                disabled={!rows.length || !heading.trim()}
                className="button full"
                onClick={() => setPrint(true)}
              >
                <Printer size={16} /> Print / Save as PDF
              </button>
            </div>
          </div>
        </section>
        <section className="panel preview-panel">
          <div className="panel-heading">
            <div>
              <h2>Live sales preview</h2>
              <p>This is the exact field set used for all sales outputs.</p>
            </div>
            <span className="tag">{rows.length} included</span>
          </div>
          <div className="sales-preview-heading">
            <h3>{heading || 'Untitled list'}</h3>
            <p>
              Generated {new Date().toLocaleDateString('en-GB')} · All prices in GBP excluding VAT
            </p>
          </div>
          <div className="table-wrap">
            <table className="sales-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Brand</th>
                  <th>Model / SKU</th>
                  <th>Product Name</th>
                  {description && <th>Sales Description</th>}
                  <th className="numeric">Frost selling price</th>
                  {notes && <th>Sales Notes</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.Category}</td>
                    <td>{r.Brand}</td>
                    <td>{r['Model / SKU']}</td>
                    <td>{r['Product Name']}</td>
                    {description && <td>{r['Sales Description']}</td>}
                    <td className="numeric">{gbp(r['Frost Selling Price (£ ex VAT)'])}</td>
                    {notes && <td>{r['Sales Notes']}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <div className="small-empty">
                No products qualify. Approve positive selling prices in the catalogue first.
              </div>
            )}
          </div>
          <details className="exclusions">
            <summary>{excluded.length} products excluded — view reasons</summary>
            {excluded.map((p) => (
              <div key={p.id}>
                <strong>{p.name}</strong>
                <span>{p.reasons.join(' · ')}</span>
              </div>
            ))}
          </details>
        </section>
      </div>
      {print && (
        <Modal title="Sales print preview" onClose={() => setPrint(false)}>
          <div className="print-toolbar">
            <p>
              Choose your printer’s “Save as PDF” destination. The isolated document contains sales
              fields only.
            </p>
            <button
              className="button primary"
              onClick={() => frame.current?.contentWindow?.print()}
            >
              <Printer size={16} /> Print / Save as PDF
            </button>
          </div>
          <iframe
            ref={frame}
            title="Sanitized sales print document"
            className="print-frame"
            sandbox="allow-same-origin allow-modals"
            srcDoc={salesPrintHtml(rows, heading, description, notes)}
          />
        </Modal>
      )}
    </>
  );
}
