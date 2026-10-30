import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutGrid,
  ListFilter,
  ClipboardCheck,
  FileDown,
  Settings as SettingsIcon,
  Upload,
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ArrowUpRight,
  HardDrive,
  Check,
  X,
  AlertTriangle,
  PackageOpen,
  Pencil,
  RotateCcw,
  Snowflake,
  LockKeyhole,
} from 'lucide-react';
import { z } from 'zod';
import {
  id,
  newProduct,
  now,
  emptyState,
  type AppState,
  type Product,
  type FxSettings,
} from './model';
import { calculate, gbp, percent, productWarnings, offerWarnings } from './pricing';
import { parseWorkbook, type ImportPreview } from './importer';
import {
  db,
  loadState,
  saveState,
  recordProduct,
  removeProduct,
  serializeBackup,
  parseBackup,
  markBackedUp,
  type BackupMeta,
  type Snapshot,
} from './storage';
import { download, localDate } from './exports';
import { Badge, Modal, Field, NumberInput } from './components';
import { ProductDrawer } from './ProductDrawer';
import { ExportPage } from './ExportPage';
import { Settings } from './Settings';

type Page =
  'Catalogue' | 'Supplier Offers' | 'Review Queue' | 'Export Sales List' | 'Settings & Backup';
const pages: { name: Page; icon: typeof LayoutGrid }[] = [
  { name: 'Catalogue', icon: LayoutGrid },
  { name: 'Supplier Offers', icon: ListFilter },
  { name: 'Review Queue', icon: ClipboardCheck },
  { name: 'Export Sales List', icon: FileDown },
  { name: 'Settings & Backup', icon: SettingsIcon },
];
const pageFromHash = (): Page => {
  try {
    return (
      pages.find((p) => p.name === decodeURIComponent(location.hash.slice(1)))?.name || 'Catalogue'
    );
  } catch {
    return 'Catalogue';
  }
};
type Confirmation = {
  title: string;
  description: string;
  phrase: string;
  action: () => Promise<void>;
};
function errorText(e: unknown) {
  return e instanceof z.ZodError
    ? e.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')
    : e instanceof Error
      ? e.message
      : 'The action failed. Please try again.';
}
export default function App() {
  const [state, setState] = useState<AppState>(),
    [fatal, setFatal] = useState(''),
    [page, setPage] = useState<Page>(pageFromHash),
    [message, setMessage] = useState<{ text: string; error?: boolean }>(),
    [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImportPreview>(),
    [importStep, setImportStep] = useState(1),
    [confirm, setConfirm] = useState<Confirmation>(),
    [typed, setTyped] = useState('');
  const [editing, setEditing] = useState<Product>(),
    [quick, setQuick] = useState<Product>(),
    [quickPrice, setQuickPrice] = useState<number | null>(null),
    [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState(''),
    [filtersOpen, setFiltersOpen] = useState(false),
    [brand, setBrand] = useState(''),
    [category, setCategory] = useState(''),
    [status, setStatus] = useState(''),
    [problem, setProblem] = useState(''),
    [visible, setVisible] = useState(''),
    [sort, setSort] = useState('brand'),
    [ascending, setAscending] = useState(true),
    [pageNo, setPageNo] = useState(1);
  const [offerSearch, setOfferSearch] = useState(''),
    [issueFilter, setIssueFilter] = useState('open'),
    [priority, setPriority] = useState(''),
    [issueSearch, setIssueSearch] = useState('');
  const [meta, setMeta] = useState<BackupMeta>(),
    [snapshots, setSnapshots] = useState<Snapshot[]>([]),
    [undo, setUndo] = useState<AppState>();
  const importRef = useRef<HTMLInputElement>(null),
    backupRef = useRef<HTMLInputElement>(null);
  const notify = (text: string, error = false) => setMessage({ text, error });
  async function refreshMeta() {
    setMeta(await db.meta.get('lastBackup'));
    setSnapshots(await db.snapshots.orderBy('timestamp').reverse().toArray());
  }
  useEffect(() => {
    void loadState()
      .then((s) => {
        setState(s);
        return refreshMeta();
      })
      .catch((e) => setFatal(errorText(e)));
    const h = () => setPage(pageFromHash());
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  useEffect(() => {
    setPageNo(1);
  }, [search, brand, category, status, problem, visible, sort, ascending]);
  const go = (p: Page) => {
    location.hash = encodeURIComponent(p);
    setPage(p);
  };
  async function commit(next: AppState, reason?: string, allowUndo = false) {
    if (!state) return false;
    setBusy(true);
    try {
      const saved = await saveState(next, state.revision, reason);
      if (allowUndo) setUndo(state);
      else setUndo(undefined);
      setState(saved);
      await refreshMeta();
      return true;
    } catch (e) {
      notify(errorText(e), true);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function saveProduct(p: Product, note = '', approve = false) {
    if (!state) return false;
    try {
      if (await commit(recordProduct(state, p, note, approve))) {
        notify(
          approve
            ? 'Price approved for sales.'
            : 'Product saved. Edited approvals return to Draft.',
        );
        return true;
      }
    } catch (e) {
      notify(errorText(e), true);
    }
    return false;
  }
  function ask(c: Confirmation) {
    setTyped('');
    setConfirm(c);
  }
  function deleteProduct(p: Product) {
    if (!state) return;
    ask({
      title: 'Permanently delete product',
      description: `Delete ${p.brand} ${p.modelSku}? Linked offers will remain as unlinked references. A local recovery snapshot will be created first.`,
      phrase: 'DELETE',
      action: async () => {
        if (await commit(removeProduct(state, p.id), 'Before permanent product deletion', true)) {
          setEditing(undefined);
          setSelected((s) => new Set([...s].filter((x) => x !== p.id)));
          notify('Product deleted. You can undo or recover the snapshot.');
        }
      },
    });
  }
  async function archive(p: Product) {
    if (!state) return;
    try {
      const archived = p.approvalStatus !== 'archived';
      if (
        await commit(
          recordProduct(
            state,
            { ...p, approvalStatus: archived ? 'archived' : 'draft' },
            archived ? 'Archived' : 'Unarchived to Draft',
          ),
          archived ? 'Before archive' : 'Before unarchive',
          true,
        )
      ) {
        setEditing(undefined);
        notify(
          archived
            ? 'Product archived and excluded from sales exports.'
            : 'Product returned to Draft.',
        );
      }
    } catch (e) {
      notify(errorText(e), true);
    }
  }
  function duplicate(p: Product) {
    setEditing({
      ...p,
      id: id(),
      approvalStatus: 'draft',
      variant: p.variant ? `${p.variant} (copy)` : 'Copy',
      createdAt: now(),
      updatedAt: now(),
      sourceRow: p.sourceRow ? `Copy of ${p.sourceRow}` : 'Manual duplicate',
    });
    notify('Copy created in editor. Save it to add it to the catalogue.');
  }
  async function importFile(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Workbook exceeds 20 MB.');
      setPreview(parseWorkbook(await file.arrayBuffer(), file.name));
      setImportStep(1);
      setTyped('');
    } catch (e) {
      notify(errorText(e), true);
    } finally {
      setBusy(false);
      if (importRef.current) importRef.current.value = '';
    }
  }
  async function restoreFile(file?: File) {
    if (!file || !state) return;
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('Backup exceeds 50 MB.');
      const restored = parseBackup(await file.text());
      ask({
        title: 'Restore confidential backup',
        description: `Replace current data with ${restored.products.length} products, ${restored.offers.length} offers and ${restored.issues.length} issues? A recovery snapshot of current data will be saved first.`,
        phrase: 'RESTORE',
        action: async () => {
          if (await commit(restored, 'Before backup restore', true)) {
            setSelected(new Set());
            setEditing(undefined);
            notify('Confidential backup restored.');
          }
        },
      });
    } catch (e) {
      notify(`Backup rejected: ${errorText(e)}`, true);
    } finally {
      if (backupRef.current) backupRef.current.value = '';
    }
  }
  async function exportBackup() {
    if (!state) return;
    try {
      download(
        serializeBackup(state),
        `Frost_CONFIDENTIAL_Backup_${localDate()}_${Date.now()}.json`,
        'application/json',
      );
      await markBackedUp(state);
      await refreshMeta();
      notify('Confidential backup download requested. Store the file securely.');
    } catch (e) {
      notify(errorText(e), true);
    }
  }
  async function saveFx(fx: FxSettings) {
    if (!state) return false;
    let next = { ...state, fx };
    if (
      JSON.stringify({ ...state.fx, lastConfirmedAt: null }) !==
      JSON.stringify({ ...fx, lastConfirmedAt: null })
    )
      for (const p of state.products.filter((p) => p.approvalStatus === 'approved'))
        next = recordProduct(
          next,
          { ...p, approvalStatus: 'draft' },
          'Pricing assumptions changed; approval requires review',
        );
    if (await commit(next, 'Before FX settings update', true)) {
      notify('FX assumptions confirmed. Affected approvals require review.');
      return true;
    }
    return false;
  }
  const products = state?.products || [];
  const filtered = useMemo(() => {
    if (!state) return [];
    const query = search.toLocaleLowerCase().trim();
    const data = products.filter(
      (p) =>
        (!query ||
          [p.brand, p.modelSku, p.description, p.category, p.variant]
            .join(' ')
            .toLocaleLowerCase()
            .includes(query)) &&
        (!brand || p.brand === brand) &&
        (!category || p.category === category) &&
        (!status || p.approvalStatus === status) &&
        (!visible || p.salesVisible === (visible === 'yes')) &&
        (!problem ||
          (problem === 'issues'
            ? productWarnings(p, state).length > 0
            : productWarnings(p, state).length === 0)),
    );
    const value = (p: Product): string | number | null =>
      sort === 'sale'
        ? p.frostSalePriceGbpExVat
        : sort === 'cost'
          ? calculate(p, state.fx).supplierGbp
          : sort === 'margin'
            ? calculate(p, state.fx).grossMarginFraction
            : sort === 'model'
              ? p.modelSku
              : p.brand;
    return data.sort((a, b) => {
      const av = value(a),
        bv = value(b);
      if (av == null) return bv == null ? 0 : 1;
      if (bv == null) return -1;
      const result =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true });
      return (ascending ? 1 : -1) * result;
    });
  }, [state, search, brand, category, status, visible, problem, sort, ascending]);
  const maxPage = Math.max(1, Math.ceil(filtered.length / 25)),
    currentPage = Math.min(pageNo, maxPage),
    paged = filtered.slice((currentPage - 1) * 25, currentPage * 25);
  const openIssues = state?.issues.filter((i) => i.status === 'open') || [],
    critical = openIssues.filter((i) => ['critical', 'high'].includes(i.priority));
  const approved = products.filter((p) => p.approvalStatus === 'approved').length,
    needsReview = state
      ? products.filter((p) => p.approvalStatus !== 'archived' && productWarnings(p, state).length)
          .length
      : 0;
  const unbacked = state && state.revision > 0 && (!meta || meta.revision !== state.revision);
  const activeFilters = [brand, category, status, problem, visible].filter(Boolean).length;
  function sortBy(s: string) {
    if (sort === s) setAscending((v) => !v);
    else {
      setSort(s);
      setAscending(true);
    }
  }
  function select(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function recover(snapshot: Snapshot) {
    ask({
      title: 'Recover local snapshot',
      description: `Replace the current catalogue with the snapshot from ${new Date(snapshot.timestamp).toLocaleString('en-GB')} (${snapshot.state.products.length} products). Current data will be snapshotted first.`,
      phrase: 'RECOVER',
      action: async () => {
        if (await commit(snapshot.state, 'Before snapshot recovery', true)) {
          setSelected(new Set());
          setEditing(undefined);
          notify('Snapshot recovered.');
        }
      },
    });
  }
  if (fatal)
    return (
      <main className="startup">
        <h1>Browser storage unavailable</h1>
        <p role="alert">{fatal}</p>
        <p>Enable IndexedDB for this site and reload. No changes have been saved.</p>
        <button className="button" onClick={() => location.reload()}>
          Reload
        </button>
      </main>
    );
  if (!state)
    return (
      <main className="startup">
        <Snowflake size={32} />
        <p>Opening your local workspace…</p>
      </main>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#Catalogue">
          <span className="brand-symbol">
            <Snowflake size={25} />
          </span>
          <div>
            <strong>
              FROST<span>OPTICAL</span>
            </strong>
            <small>PRICE MANAGER</small>
          </div>
        </a>
        <div className="workspace-label">
          WORKSPACE <span>V1.0</span>
        </div>
        <nav aria-label="Main navigation">
          {pages.map(({ name, icon: Icon }) => (
            <a
              key={name}
              href={`#${encodeURIComponent(name)}`}
              className={page === name ? 'active' : ''}
            >
              <Icon size={18} />
              <span>{name}</span>
              {name === 'Review Queue' && openIssues.length > 0 && <b>{openIssues.length}</b>}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div>
            <HardDrive size={18} />
            <span>
              Local workspace<small>No cloud sync</small>
            </span>
            <i />
          </div>
          <p>
            Frost Optical Services Ltd
            <br />
            Equipment pricing administration
          </p>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumbs">
            Workspace <ChevronRight size={13} /> <strong>{page}</strong>
          </div>
          <span className="local-pill">
            <span /> Browser storage
          </span>
        </header>
        <div className="storage-banner">
          <LockKeyhole size={14} />
          <span>Saved in this browser only — export a backup to protect your changes.</span>
          {unbacked && (
            <button onClick={() => void exportBackup()}>
              Backup needed <ArrowUpRight size={13} />
            </button>
          )}
        </div>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">FROST PRICE MANAGER</div>
              <h1>{page === 'Catalogue' ? 'Product catalogue' : page}</h1>
              <p>
                {page === 'Catalogue'
                  ? 'Maintain your equipment prices. Review with confidence.'
                  : page === 'Supplier Offers'
                    ? 'Compare supplier tiers and source terms. All offers are confidential reference data.'
                    : page === 'Review Queue'
                      ? 'Resolve source questions and pricing warnings before approving sales prices.'
                      : page === 'Export Sales List'
                        ? 'Create a clean, customer-facing list from approved prices.'
                        : 'Manage pricing assumptions and protect your local data.'}
              </p>
            </div>
            <div className="heading-actions">
              {page === 'Catalogue' && (
                <>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => importRef.current?.click()}
                  >
                    <Upload size={16} /> Import workbook
                  </button>
                  <button
                    className="button primary"
                    onClick={() => setEditing(newProduct(state.fx))}
                  >
                    <Plus size={17} /> Add product
                  </button>
                </>
              )}
              {page === 'Supplier Offers' && (
                <span className="confidential-label">
                  <LockKeyhole size={14} /> CONFIDENTIAL
                </span>
              )}
            </div>
          </div>
          {message && (
            <div
              role={message.error ? 'alert' : 'status'}
              className={`notice ${message.error ? 'error' : ''}`}
            >
              <span>
                {message.error ? <AlertTriangle size={17} /> : <Check size={17} />} {message.text}
              </span>
              <button
                className="icon-button"
                aria-label="Dismiss notification"
                onClick={() => setMessage(undefined)}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {undo && (
            <div className="undo-bar">
              <span>A recovery point is available for the last action.</span>
              <button
                className="button small"
                disabled={busy}
                onClick={async () => {
                  const previous = undo;
                  if (await commit(previous, 'Before undo')) {
                    setEditing(undefined);
                    setSelected(new Set());
                    notify('Previous state restored.');
                  }
                }}
              >
                <RotateCcw size={14} /> Undo
              </button>
            </div>
          )}
          {page === 'Catalogue' && (
            <>
              <div className="stat-grid">
                <div>
                  <span>Total products</span>
                  <strong>
                    {products.length}
                    <PackageOpen size={20} />
                  </strong>
                  <small>
                    Across {[...new Set(products.map((p) => p.brand))].length} manufacturers
                  </small>
                </div>
                <div>
                  <span>Approved for sales</span>
                  <strong>
                    {approved}
                    <Check size={20} />
                  </strong>
                  <small>Intentionally reviewed prices</small>
                </div>
                <div>
                  <span>Pricing needs review</span>
                  <strong>
                    {needsReview}
                    <AlertTriangle size={20} />
                  </strong>
                  <small>Missing inputs or pricing caveats</small>
                </div>
                <div>
                  <span>Open high / critical issues</span>
                  <strong>
                    {critical.length}
                    <ClipboardCheck size={20} />
                  </strong>
                  <button onClick={() => go('Review Queue')}>
                    View review queue <ArrowUpRight size={12} />
                  </button>
                </div>
              </div>
              <section className="panel catalogue-panel">
                <div className="catalogue-top">
                  <div>
                    <h2>
                      All products <span className="count">{filtered.length}</span>
                    </h2>
                    <p>Internal pricing · GBP excluding VAT</p>
                  </div>
                  <button className="text-button" onClick={() => go('Export Sales List')}>
                    Export sales list <ArrowUpRight size={15} />
                  </button>
                </div>
                <div className="table-toolbar">
                  <div className="search-field">
                    <Search size={17} />
                    <input
                      aria-label="Search catalogue"
                      placeholder="Search brand, model, product or category…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    {search && (
                      <button
                        aria-label="Clear search"
                        className="icon-button"
                        onClick={() => setSearch('')}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  <button
                    className={`button ${activeFilters ? 'filter-active' : ''}`}
                    aria-expanded={filtersOpen}
                    onClick={() => setFiltersOpen((v) => !v)}
                  >
                    <ListFilter size={16} /> Filters{activeFilters > 0 && ` (${activeFilters})`}
                  </button>
                  <select
                    aria-label="Sort products"
                    className="sort-select"
                    value={sort}
                    onChange={(e) => {
                      setSort(e.target.value);
                      setAscending(true);
                    }}
                  >
                    <option value="brand">Sort: Brand</option>
                    <option value="model">Sort: Model</option>
                    <option value="cost">Sort: Cost GBP</option>
                    <option value="sale">Sort: Selling price</option>
                    <option value="margin">Sort: Margin</option>
                  </select>
                  {selected.size > 0 && (
                    <button className="button" onClick={() => go('Export Sales List')}>
                      Export selected ({selected.size})
                    </button>
                  )}
                </div>
                {filtersOpen && (
                  <div className="filter-panel">
                    <Field label="Manufacturer">
                      <select value={brand} onChange={(e) => setBrand(e.target.value)}>
                        <option value="">All manufacturers</option>
                        {[...new Set(products.map((p) => p.brand))].sort().map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Category">
                      <select value={category} onChange={(e) => setCategory(e.target.value)}>
                        <option value="">All categories</option>
                        {[...new Set(products.map((p) => p.category))].sort().map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Approval status">
                      <select value={status} onChange={(e) => setStatus(e.target.value)}>
                        <option value="">All statuses</option>
                        <option value="draft">Draft</option>
                        <option value="approved">Approved</option>
                        <option value="archived">Archived</option>
                      </select>
                    </Field>
                    <Field label="Pricing issue">
                      <select value={problem} onChange={(e) => setProblem(e.target.value)}>
                        <option value="">Any pricing</option>
                        <option value="issues">Has warnings</option>
                        <option value="clear">No warnings</option>
                      </select>
                    </Field>
                    <Field label="Sales visible">
                      <select value={visible} onChange={(e) => setVisible(e.target.value)}>
                        <option value="">Any visibility</option>
                        <option value="yes">Visible</option>
                        <option value="no">Hidden</option>
                      </select>
                    </Field>
                    <button
                      className="text-button"
                      onClick={() => {
                        setBrand('');
                        setCategory('');
                        setStatus('');
                        setProblem('');
                        setVisible('');
                      }}
                    >
                      Clear filters
                    </button>
                  </div>
                )}
                {products.length ? (
                  <>
                    <div className="table-wrap">
                      <table className="catalogue-table">
                        <thead>
                          <tr>
                            <th className="selection-cell">
                              <input
                                type="checkbox"
                                aria-label="Select current page"
                                checked={!!paged.length && paged.every((p) => selected.has(p.id))}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setSelected((old) => {
                                    const n = new Set(old);
                                    paged.forEach((p) => (checked ? n.add(p.id) : n.delete(p.id)));
                                    return n;
                                  });
                                }}
                              />
                            </th>
                            <th>
                              <button onClick={() => sortBy('brand')}>
                                Brand <ChevronsUpDown size={12} />
                              </button>
                            </th>
                            <th>
                              <button onClick={() => sortBy('model')}>
                                Model / product <ChevronsUpDown size={12} />
                              </button>
                            </th>
                            <th>Category</th>
                            <th className="numeric">
                              <button onClick={() => sortBy('cost')}>
                                Supplier price <ChevronsUpDown size={12} />
                              </button>
                            </th>
                            <th className="numeric">
                              <button onClick={() => sortBy('sale')}>
                                Frost sale <ChevronsUpDown size={12} />
                              </button>
                            </th>
                            <th className="numeric">
                              <button onClick={() => sortBy('margin')}>
                                Margin <ChevronsUpDown size={12} />
                              </button>
                            </th>
                            <th>Status</th>
                            <th>
                              <span className="sr-only">Open product</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {paged.map((p) => {
                            const c = calculate(p, state.fx),
                              w = productWarnings(p, state);
                            return (
                              <tr
                                key={p.id}
                                className={selected.has(p.id) ? 'selected' : ''}
                                onClick={() => setEditing(p)}
                              >
                                <td onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="checkbox"
                                    aria-label={`Select ${p.brand} ${p.modelSku}`}
                                    checked={selected.has(p.id)}
                                    onChange={() => select(p.id)}
                                  />
                                </td>
                                <td className="brand-cell">{p.brand}</td>
                                <td className="product-cell">
                                  <button
                                    className="product-link"
                                    aria-label={p.modelSku || p.description}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditing(p);
                                    }}
                                  >
                                    {p.modelSku || 'No model'}
                                    {w.length > 0 && (
                                      <AlertTriangle
                                        size={13}
                                        className="warning-icon"
                                        aria-label="Pricing warnings"
                                      />
                                    )}
                                  </button>
                                  <span title={p.description}>
                                    {p.variant ? `${p.variant} · ` : ''}
                                    {p.description}
                                  </span>
                                </td>
                                <td>
                                  <span className="category-label">
                                    {p.category || 'Uncategorised'}
                                  </span>
                                </td>
                                <td className="numeric">
                                  <span className="supplier-number">
                                    {p.originalSupplierCost == null
                                      ? '—'
                                      : new Intl.NumberFormat('en-GB', {
                                          minimumFractionDigits: 2,
                                          maximumFractionDigits: 2,
                                        }).format(p.originalSupplierCost)}
                                  </span>
                                  <small>{p.originalCurrency}</small>
                                </td>
                                <td className="numeric">
                                  <button
                                    className="price-button"
                                    aria-label={`Edit selling price for ${p.modelSku || p.description}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setQuick(p);
                                      setQuickPrice(p.frostSalePriceGbpExVat);
                                    }}
                                  >
                                    {gbp(p.frostSalePriceGbpExVat)} <Pencil size={11} />
                                  </button>
                                  <small>ex VAT</small>
                                </td>
                                <td
                                  className={`numeric ${c.grossMarginFraction != null && c.grossMarginFraction < 0 ? 'text-danger' : ''}`}
                                >
                                  {percent(c.grossMarginFraction)}
                                </td>
                                <td>
                                  <Badge value={p.approvalStatus} />
                                  {!p.salesVisible && <small>Sales hidden</small>}
                                </td>
                                <td>
                                  <ChevronRight size={16} className="subtle" />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {!filtered.length && (
                        <div className="small-empty">
                          No products match your search and filters.
                        </div>
                      )}
                    </div>
                    <div className="table-footer">
                      <span>
                        {filtered.length
                          ? `${(currentPage - 1) * 25 + 1}–${Math.min(currentPage * 25, filtered.length)}`
                          : '0'}{' '}
                        of {filtered.length} products
                        {selected.size ? ` · ${selected.size} selected` : ''}
                      </span>
                      <div>
                        <button
                          aria-label="Previous page"
                          disabled={currentPage === 1}
                          onClick={() => setPageNo(currentPage - 1)}
                        >
                          <ChevronLeft size={16} />
                        </button>
                        <span>
                          Page {currentPage} of {maxPage}
                        </span>
                        <button
                          aria-label="Next page"
                          disabled={currentPage === maxPage}
                          onClick={() => setPageNo(currentPage + 1)}
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="empty-state">
                    <div className="empty-icon">
                      <PackageOpen size={33} />
                    </div>
                    <h3>Your pricing workspace starts here</h3>
                    <p>
                      Import the Frost master workbook to review products and supplier offers, or
                      add your first product.
                    </p>
                    <button className="button primary" onClick={() => importRef.current?.click()}>
                      <Upload size={16} /> Import master workbook
                    </button>
                    <small>Files stay in your browser. Nothing is uploaded.</small>
                  </div>
                )}
              </section>
              <div className="catalogue-note">
                <LockKeyhole size={13} /> Administrator view contains confidential costs. Share only
                the safe sales exports.
              </div>
            </>
          )}
          {page === 'Supplier Offers' && (
            <section className="panel">
              <div className="catalogue-top">
                <div>
                  <h2>
                    Supplier offers <span className="count">{state.offers.length}</span>
                  </h2>
                  <p>Separate quantity tiers · No automatic price application</p>
                </div>
              </div>
              <div className="table-toolbar">
                <div className="search-field">
                  <Search size={17} />
                  <input
                    aria-label="Search supplier offers"
                    placeholder="Search brand, model, terms or source…"
                    value={offerSearch}
                    onChange={(e) => setOfferSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="table-wrap">
                <table className="offers-table">
                  <thead>
                    <tr>
                      <th>Brand / model</th>
                      <th>Quantity / tier</th>
                      <th>Unit price</th>
                      <th>Source & conditions</th>
                      <th>Product match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.offers
                      .filter((o) =>
                        [
                          o.brand,
                          o.modelSku,
                          o.description,
                          o.category,
                          o.sourceDocument,
                          o.sourceLocation,
                          o.tierDescription,
                          o.specialTerms,
                          o.quoteClass,
                          o.sourceStatus,
                        ]
                          .join(' ')
                          .toLowerCase()
                          .includes(offerSearch.toLowerCase()),
                      )
                      .map((o) => (
                        <tr key={o.id}>
                          <td>
                            <strong>
                              {o.brand} · {o.modelSku}
                            </strong>
                            <small>{o.description}</small>
                            <small>{o.category}</small>
                          </td>
                          <td>
                            <strong>Qty {o.quantityFrom ?? '—'}+</strong>
                            <small>{o.tierDescription}</small>
                            <small>{o.quoteClass}</small>
                          </td>
                          <td className="nowrap">
                            {o.currency}{' '}
                            {o.unitPrice?.toLocaleString('en-GB', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            }) ?? '—'}
                          </td>
                          <td>
                            <strong>{o.sourceStatus}</strong>
                            <p>{o.specialTerms}</p>
                            <small>
                              {o.sourceDocument} · {o.sourceLocation}
                            </small>
                            {offerWarnings(o).map((w) => (
                              <small className="text-warning" key={w}>
                                {w}
                              </small>
                            ))}
                          </td>
                          <td>
                            <select
                              aria-label={`Match offer ${o.modelSku} ${o.sourceLocation}`}
                              value={o.matchedProductId || ''}
                              disabled={busy}
                              onChange={async (e) => {
                                const match = e.target.value || null;
                                await commit({
                                  ...state,
                                  offers: state.offers.map((x) =>
                                    x.id === o.id ? { ...x, matchedProductId: match } : x,
                                  ),
                                });
                              }}
                            >
                              <option value="">Unlinked — manual review</option>
                              {products.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.brand} {p.modelSku} · {p.variant || p.description} ·{' '}
                                  {p.sourceRow || p.id.slice(0, 8)}
                                </option>
                              ))}
                            </select>
                            {o.matchedProductId && (
                              <button
                                className="text-button"
                                onClick={() =>
                                  setEditing(products.find((p) => p.id === o.matchedProductId))
                                }
                              >
                                Open product <ArrowUpRight size={13} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {!state.offers.length && (
                  <div className="small-empty">
                    Import a master workbook to inspect supplier tiers and source terms.
                  </div>
                )}
              </div>
            </section>
          )}
          {page === 'Review Queue' && (
            <section className="panel">
              <div className="catalogue-top">
                <div>
                  <h2>
                    Source & pricing review <span className="count">{openIssues.length} open</span>
                  </h2>
                  <p>High-priority workbook issues and import validation notes</p>
                </div>
              </div>
              <div className="table-toolbar">
                <div className="search-field">
                  <Search size={17} />
                  <input
                    aria-label="Search review issues"
                    placeholder="Search issues or evidence…"
                    value={issueSearch}
                    onChange={(e) => setIssueSearch(e.target.value)}
                  />
                </div>
                <select
                  aria-label="Issue status"
                  value={issueFilter}
                  onChange={(e) => setIssueFilter(e.target.value)}
                >
                  <option value="open">Open issues</option>
                  <option value="resolved">Resolved issues</option>
                  <option value="">All issues</option>
                </select>
                <select
                  aria-label="Issue priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                >
                  <option value="">All priorities</option>
                  {['critical', 'high', 'medium', 'low'].map((s) => (
                    <option value={s} key={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="issue-list">
                {state.issues
                  .filter(
                    (i) =>
                      (!issueFilter || i.status === issueFilter) &&
                      (!priority || i.priority === priority) &&
                      [i.issue, i.evidence, i.action, i.source]
                        .join(' ')
                        .toLowerCase()
                        .includes(issueSearch.toLowerCase()),
                  )
                  .sort(
                    (a, b) =>
                      ['critical', 'high', 'medium', 'low'].indexOf(a.priority) -
                      ['critical', 'high', 'medium', 'low'].indexOf(b.priority),
                  )
                  .map((i) => (
                    <article className="issue" key={i.id}>
                      <Badge value={i.priority} />
                      <div>
                        <h3>{i.issue}</h3>
                        <p>{i.evidence}</p>
                        <p className="issue-action">
                          <strong>Action:</strong> {i.action}
                        </p>
                        <small>
                          {i.source} · {i.location}
                        </small>
                        {i.productId && (
                          <button
                            className="text-button"
                            onClick={() => setEditing(products.find((p) => p.id === i.productId))}
                          >
                            Open affected product
                          </button>
                        )}
                      </div>
                      <button
                        className="button small"
                        disabled={busy}
                        onClick={async () => {
                          if (
                            await commit({
                              ...state,
                              issues: state.issues.map((x) =>
                                x.id === i.id
                                  ? { ...x, status: x.status === 'open' ? 'resolved' : 'open' }
                                  : x,
                              ),
                            })
                          )
                            notify(i.status === 'open' ? 'Issue resolved.' : 'Issue reopened.');
                        }}
                      >
                        {i.status === 'open' ? (
                          <>
                            <Check size={14} /> Resolve
                          </>
                        ) : (
                          <>
                            <RotateCcw size={14} /> Reopen
                          </>
                        )}
                      </button>
                    </article>
                  ))}
                {!state.issues.filter(
                  (i) =>
                    (!issueFilter || i.status === issueFilter) &&
                    (!priority || i.priority === priority) &&
                    [i.issue, i.evidence, i.action, i.source]
                      .join(' ')
                      .toLowerCase()
                      .includes(issueSearch.toLowerCase()),
                ).length && <div className="small-empty">No review issues match this view.</div>}
              </div>
            </section>
          )}
          {page === 'Export Sales List' && (
            <ExportPage
              products={products}
              filtered={filtered}
              selected={selected}
              onError={(s) => notify(s, true)}
            />
          )}
          {page === 'Settings & Backup' && (
            <Settings
              key={JSON.stringify(state.fx)}
              state={state}
              meta={meta}
              snapshots={snapshots}
              onFx={saveFx}
              onBackup={() => void exportBackup()}
              onRestore={() => backupRef.current?.click()}
              onReset={() =>
                ask({
                  title: 'Reset local data',
                  description:
                    'Remove all current products, offers, issues and history in this browser. A recovery snapshot is saved first. Export a confidential backup before clearing browser storage.',
                  phrase: 'RESET',
                  action: async () => {
                    if (await commit(emptyState(), 'Before local data reset', true)) {
                      setSelected(new Set());
                      setEditing(undefined);
                      notify('Local data reset. A recovery snapshot is available in Settings.');
                    }
                  },
                })
              }
              onRecover={recover}
            />
          )}
          <footer className="app-footer">
            <span>Frost Optical Services Ltd</span>
            <span>{busy ? 'Working…' : `Local workspace · ${products.length} products`}</span>
          </footer>
        </main>
      </div>
      <input
        hidden
        ref={importRef}
        type="file"
        accept=".xlsx"
        aria-label="Import workbook file"
        onChange={(e) => void importFile(e.target.files?.[0])}
      />
      <input
        hidden
        ref={backupRef}
        type="file"
        accept=".json"
        aria-label="Restore backup file"
        onChange={(e) => void restoreFile(e.target.files?.[0])}
      />
      {editing && (
        <ProductDrawer
          key={editing.id}
          product={editing}
          state={state}
          onClose={() => setEditing(undefined)}
          onSave={saveProduct}
          onDelete={deleteProduct}
          onArchive={(p) => void archive(p)}
          onDuplicate={duplicate}
        />
      )}
      {quick && (
        <Modal title="Quick selling-price edit" onClose={() => setQuick(undefined)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await saveProduct({ ...quick, frostSalePriceGbpExVat: quickPrice }))
                setQuick(undefined);
            }}
          >
            <div className="panel-body">
              <p>
                <strong>
                  {quick.brand} {quick.modelSku}
                </strong>{' '}
                · {quick.description}
              </p>
              <Field label="Frost selling price (£ ex VAT)">
                <NumberInput value={quickPrice} onChange={setQuickPrice} />
              </Field>
              <p className="help">
                The product returns to Draft when its price changes. Review and approve it from
                Product details → Selling Price.
              </p>
            </div>
            <div className="panel-footer">
              <button className="button" type="button" onClick={() => setQuick(undefined)}>
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                Save price
              </button>
            </div>
          </form>
        </Modal>
      )}
      {preview && (
        <Modal
          title={importStep === 1 ? 'Workbook import preview' : 'Confirm catalogue replacement'}
          onClose={() => {
            if (!busy) setPreview(undefined);
          }}
        >
          <div className="panel-body">
            {importStep === 1 ? (
              <>
                <p className="file-label">{preview.fileName}</p>
                <p className="help">
                  Inspected {new Date(preview.date).toLocaleString('en-GB')}. All prices remain in
                  Draft until you approve them.
                </p>
                <div className="import-counts">
                  <div>
                    <strong>{preview.state.products.length}</strong>
                    <span>Products</span>
                  </div>
                  <div>
                    <strong>{preview.state.offers.length}</strong>
                    <span>Supplier offers</span>
                  </div>
                  <div>
                    <strong>{preview.warnings.length}</strong>
                    <span>Import warnings</span>
                  </div>
                </div>
                <dl className="provenance">
                  <dt>Detected sheets</dt>
                  <dd>{preview.sheets.join(', ')}</dd>
                  <dt>Duplicate / variant keys</dt>
                  <dd>{preview.duplicates} records retained separately</dd>
                  <dt>Unlinked offers</dt>
                  <dd>{preview.ambiguousOffers} need manual matching</dd>
                  <dt>Review notes</dt>
                  <dd>{preview.state.issues.length} administrator-only issues</dd>
                  <dt>FX status</dt>
                  <dd>Historic and unconfirmed — verify in Settings</dd>
                </dl>
                <p className="help">
                  This import replaces the current catalogue, offers, review queue and history.{' '}
                  {products.length} current products will be replaced. A local recovery snapshot is
                  created first.
                </p>
                <details>
                  <summary>Import warnings ({preview.warnings.length})</summary>
                  <ul className="warning-list">
                    {preview.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </details>
              </>
            ) : (
              <>
                <div className="warning-box">
                  <strong>Replace the current catalogue?</strong>
                  <p>
                    This will replace {products.length} current products with{' '}
                    {preview.state.products.length} imported Draft products. Unsaved edits will be
                    discarded. Download a confidential backup if you need a portable copy.
                  </p>
                </div>
                <Field label="Type REPLACE to continue">
                  <input
                    value={typed}
                    autoComplete="off"
                    onChange={(e) => setTyped(e.target.value)}
                  />
                </Field>
              </>
            )}
          </div>
          <div className="panel-footer">
            <button
              className="button"
              disabled={busy}
              onClick={() => (importStep === 1 ? setPreview(undefined) : setImportStep(1))}
            >
              {importStep === 1 ? 'Cancel' : 'Back'}
            </button>
            {importStep === 1 ? (
              <button
                className="button primary"
                onClick={() => {
                  setImportStep(2);
                  setTyped('');
                }}
              >
                Continue to replace
              </button>
            ) : (
              <button
                className="button danger"
                disabled={typed !== 'REPLACE' || busy}
                onClick={async () => {
                  if (await commit(preview.state, 'Before replacement workbook import', true)) {
                    setPreview(undefined);
                    setEditing(undefined);
                    setSelected(new Set());
                    setSearch('');
                    setBrand('');
                    setCategory('');
                    setStatus('');
                    setProblem('');
                    setVisible('');
                    notify(
                      'Workbook imported. Products are Draft; confirm FX and review before approving.',
                    );
                    go('Catalogue');
                  }
                }}
              >
                {busy ? 'Replacing…' : 'Replace catalogue'}
              </button>
            )}
          </div>
        </Modal>
      )}
      {confirm && (
        <Modal
          title={confirm.title}
          onClose={() => {
            if (!busy) setConfirm(undefined);
          }}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (typed !== confirm.phrase || busy) return;
              try {
                await confirm.action();
                setConfirm((current) => (current === confirm ? undefined : current));
              } catch (e) {
                notify(errorText(e), true);
              }
            }}
          >
            <div className="panel-body">
              <p>{confirm.description}</p>
              <Field label={`Type ${confirm.phrase} to continue`}>
                <input
                  autoComplete="off"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                />
              </Field>
            </div>
            <div className="panel-footer">
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => setConfirm(undefined)}
              >
                Cancel
              </button>
              <button className="button danger" disabled={typed !== confirm.phrase || busy}>
                {busy ? 'Working…' : 'Confirm'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
