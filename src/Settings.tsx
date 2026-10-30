import { useState } from 'react';
import { Download, Upload, Database, RotateCcw, ShieldAlert, Save } from 'lucide-react';
import type { AppState, FxSettings } from './model';
import type { BackupMeta, Snapshot } from './storage';
import { Field, NumberInput } from './components';
type Props = {
  state: AppState;
  meta?: BackupMeta;
  snapshots: Snapshot[];
  onFx: (f: FxSettings) => Promise<boolean>;
  onBackup: () => void;
  onRestore: () => void;
  onReset: () => void;
  onRecover: (s: Snapshot) => void;
};
export function Settings({
  state,
  meta,
  snapshots,
  onFx,
  onBackup,
  onRestore,
  onReset,
  onRecover,
}: Props) {
  const [fx, setFx] = useState(state.fx),
    [confirm, setConfirm] = useState(false),
    [currency, setCurrency] = useState(''),
    [error, setError] = useState('');
  const dirty = !!state.products.length && (!meta || meta.revision !== state.revision);
  return (
    <div className="settings-grid">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>FX & pricing assumptions</h2>
            <p>Historic rates are never live market rates.</p>
          </div>
          <span className="tag">GBP ex VAT</span>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            if (!confirm) {
              setError('Confirm that you have checked the rates and source.');
              return;
            }
            if (await onFx({ ...fx, lastConfirmedAt: new Date().toISOString() })) setConfirm(false);
          }}
        >
          <div className="panel-body">
            <div className="form-grid">
              {Object.keys(fx.rates).map((c) => (
                <Field key={c} label={`${c} → GBP`} hint={`GBP per 1 ${c}`}>
                  <input
                    type="number"
                    step="any"
                    min="0.000001"
                    required
                    disabled={c === 'GBP'}
                    value={fx.rates[c] ?? ''}
                    onChange={(e) => {
                      setFx({ ...fx, rates: { ...fx.rates, [c]: Number(e.target.value) } });
                      setConfirm(false);
                    }}
                  />
                </Field>
              ))}
            </div>
            <div className="inline-form">
              <input
                aria-label="Additional currency code"
                placeholder="Other currency, e.g. CHF"
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
              <button
                type="button"
                className="button"
                onClick={() => {
                  if (/^[A-Z]{3,10}$/.test(currency) && currency !== 'GBP') {
                    setFx({ ...fx, rates: { ...fx.rates, [currency]: fx.rates[currency] || 1 } });
                    setCurrency('');
                    setConfirm(false);
                  }
                }}
              >
                Add rate
              </button>
            </div>
            <div className="form-grid">
              <Field label="FX protection (%)" hint="Applied to non-GBP supplier costs only.">
                <NumberInput
                  value={fx.fxProtectionFraction * 100}
                  max={100}
                  required
                  onChange={(v) => {
                    setFx({ ...fx, fxProtectionFraction: (v ?? 0) / 100 });
                    setConfirm(false);
                  }}
                />
              </Field>
              <Field label="Default gross margin (%)">
                <NumberInput
                  value={fx.defaultTargetMarginFraction * 100}
                  max={99.9999}
                  required
                  onChange={(v) => {
                    setFx({ ...fx, defaultTargetMarginFraction: (v ?? 0) / 100 });
                    setConfirm(false);
                  }}
                />
              </Field>
            </div>
            <Field label="Rate source / confirmation basis *">
              <textarea
                required
                rows={3}
                value={fx.source}
                onChange={(e) => {
                  setFx({ ...fx, source: e.target.value });
                  setConfirm(false);
                }}
              />
            </Field>
            <dl className="provenance">
              <dt>Last confirmed</dt>
              <dd>
                {state.fx.lastConfirmedAt
                  ? new Date(state.fx.lastConfirmedAt).toLocaleString('en-GB')
                  : 'Never — confirmation required'}
              </dd>
            </dl>
            <p className="help">
              FX expires after 30 days. Unknown or unconfirmed foreign-currency conversion leaves
              derived costs blank. Saving changed assumptions returns approved products to Draft for
              review.
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={confirm}
                onChange={(e) => setConfirm(e.target.checked)}
              />{' '}
              I verified these assumptions against the stated source.
            </label>
            {error && (
              <p role="alert" className="text-danger">
                {error}
              </p>
            )}
          </div>
          <div className="panel-footer">
            <button className="button primary">
              <Save size={16} /> Save & confirm assumptions
            </button>
          </div>
        </form>
        {state.fx.importedSettings.length > 0 && (
          <details className="imported-settings">
            <summary>Original imported settings ({state.fx.importedSettings.length})</summary>
            {state.fx.importedSettings.map((s, i) => (
              <div key={i}>
                <strong>{s.setting}</strong>
                <p>
                  {String(s.value ?? '—')} {s.unit}
                </p>
                <small>{s.basis}</small>
              </div>
            ))}
          </details>
        )}
      </section>
      <div>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>
                <ShieldAlert size={18} /> Confidential backup
              </h2>
              <p>Full administrative data — store securely.</p>
            </div>
          </div>
          <div className="panel-body">
            <p>
              Includes supplier costs, offers, notes, approvals and local history. This is separate
              from the safe sales list.
            </p>
            <div className={`backup-state ${dirty ? 'pending' : ''}`}>
              <Database size={19} />
              <div>
                <strong>{dirty ? 'Changes need a backup' : 'Backup status'}</strong>
                <small>
                  {meta
                    ? `Last download requested: ${new Date(meta.at).toLocaleString('en-GB')}`
                    : 'No backup exported from this browser.'}
                </small>
              </div>
            </div>
            <button className="button full" onClick={onBackup}>
              <Download size={16} /> Export confidential backup (.json)
            </button>
            <button className="button full" onClick={onRestore}>
              <Upload size={16} /> Restore confidential backup (.json)
            </button>
            <p className="help">
              Keep the downloaded file somewhere safe. The app cannot verify that a download was
              saved. Recovery snapshots stay in this browser and are not included in backup files.
            </p>
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Local recovery snapshots</h2>
              <p>The 10 most recent destructive actions.</p>
            </div>
          </div>
          <div className="panel-body">
            {snapshots.length ? (
              snapshots.map((s) => (
                <div className="snapshot" key={s.id}>
                  <div>
                    <strong>{s.reason}</strong>
                    <small>
                      {new Date(s.timestamp).toLocaleString('en-GB')} · {s.state.products.length}{' '}
                      products
                    </small>
                  </div>
                  <button
                    className="icon-button"
                    aria-label={`Recover snapshot ${s.reason}`}
                    title="Recover snapshot"
                    onClick={() => onRecover(s)}
                  >
                    <RotateCcw size={16} />
                  </button>
                </div>
              ))
            ) : (
              <p className="subtle">No recovery snapshots yet.</p>
            )}
          </div>
        </section>
        <section className="panel danger-panel">
          <div className="panel-body">
            <h3>Reset local data</h3>
            <p>
              Remove the current catalogue, offers, issues and history. A recovery snapshot is
              created first.
            </p>
            <button className="button danger" onClick={onReset}>
              Reset this browser’s data
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
