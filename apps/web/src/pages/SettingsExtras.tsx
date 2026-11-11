import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PAYMENT_KINDS, type PaymentKind, type PaymentMethodDTO, type TaxRateDTO } from '@bitebrew/shared';
import { errorMessage, patch, post } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Field, Loading, Modal, useToast } from '../components/ui';
import { offlineAllowed, setOfflineAllowed, queuedOrders } from '../lib/offlineQueue';
import { usePaymentMethods, useTaxRates } from '../lib/queries';

function TaxRates() {
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = useAuth();
  const q = useTaxRates();
  const [editing, setEditing] = useState<TaxRateDTO | 'new' | null>(null);
  const [d, setD] = useState({ name: 'VAT', ratePercent: '', inclusive: true, isActive: true });
  const save = useMutation({
    mutationFn: () => {
      const body = { name: d.name, ratePercent: Number(d.ratePercent), inclusive: d.inclusive, isActive: d.isActive };
      return editing && editing !== 'new' ? patch(`/tax-rates/${editing.id}`, { ...body, version: editing.version }) : post('/tax-rates', body);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['tax-rates'] }); toast('success', 'Tax rate saved'); setEditing(null); },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const open = (t: TaxRateDTO | 'new') => {
    setEditing(t);
    setD(t === 'new' ? { name: 'VAT', ratePercent: '', inclusive: true, isActive: true } : { name: t.name, ratePercent: String(t.rateBp / 100), inclusive: t.inclusive, isActive: t.isActive });
  };
  return (
    <section className="card card-pad stack" data-testid="tax-rates">
      <div className="row"><h2>Tax / VAT</h2><span className="spacer" />{can('settings.manage') && <button className="btn sm gold" onClick={() => open('new')} data-testid="tax-add">Add tax rate</button>}</div>
      {q.isPending ? <Loading /> : !q.data?.length ? <p className="muted">No tax rate set — orders are charged without VAT. Add your rate if you are VAT-registered.</p> : (
        <div className="table-wrap"><table className="table"><tbody>
          {q.data.map((t) => (
            <tr key={t.id} className={t.isActive ? '' : 'inactive'}>
              <td><b>{t.name}</b></td><td className="num">{t.rateBp / 100}%</td><td>{t.inclusive ? 'Included in menu prices' : 'Added on top of menu prices'}</td><td>{t.isActive ? <span className="badge ok">Active</span> : <span className="badge neutral">Off</span>}</td>
              <td className="text-right">{can('settings.manage') && <button className="btn sm ghost" onClick={() => open(t)}>Edit</button>}</td>
            </tr>
          ))}
        </tbody></table></div>
      )}
      {editing && (
        <Modal title={editing === 'new' ? 'Add tax rate' : 'Edit tax rate'} onClose={() => setEditing(null)}
          footer={<><button className="btn secondary" onClick={() => setEditing(null)}>Cancel</button><button className="btn" disabled={!d.name.trim() || d.ratePercent === '' || save.isPending} onClick={() => save.mutate()} data-testid="tax-save">Save</button></>}>
          <div className="form-grid">
            <Field label="Name" htmlFor="tx-name"><input id="tx-name" className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
            <Field label="Rate %" htmlFor="tx-rate"><input id="tx-rate" className="input num" inputMode="decimal" value={d.ratePercent} onChange={(e) => /^\d{0,3}(\.\d{0,2})?$/.test(e.target.value) && setD({ ...d, ratePercent: e.target.value })} data-testid="tax-rate" /></Field>
          </div>
          <div className="segmented">
            <button type="button" aria-pressed={d.inclusive} onClick={() => setD({ ...d, inclusive: true })}>Included in prices</button>
            <button type="button" aria-pressed={!d.inclusive} onClick={() => setD({ ...d, inclusive: false })}>Added on top</button>
          </div>
          <label className="check"><input type="checkbox" checked={d.isActive} onChange={(e) => setD({ ...d, isActive: e.target.checked })} /> Active</label>
        </Modal>
      )}
    </section>
  );
}

const KIND_LABEL: Record<PaymentKind, string> = { CASH: 'Cash', CARD: 'Card', MOBILE: 'Mobile wallet', OTHER: 'Other' };
function PaymentMethods() {
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = useAuth();
  const q = usePaymentMethods();
  const [editing, setEditing] = useState<PaymentMethodDTO | 'new' | null>(null);
  const [d, setD] = useState({ name: '', kind: 'MOBILE' as PaymentKind, requiresReference: true, isActive: true });
  const save = useMutation({
    mutationFn: () => (editing && editing !== 'new' ? patch(`/payment-methods/${editing.id}`, { ...d, version: editing.version }) : post('/payment-methods', d)),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['payment-methods'] }); toast('success', 'Payment method saved'); setEditing(null); },
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <section className="card card-pad stack">
      <div className="row"><h2>Payment methods</h2><span className="spacer" />{can('settings.manage') && <button className="btn sm gold" onClick={() => { setEditing('new'); setD({ name: '', kind: 'MOBILE', requiresReference: true, isActive: true }); }}>Add method</button>}</div>
      {q.isPending ? <Loading /> : (
        <div className="table-wrap"><table className="table"><tbody>
          {q.data?.map((m) => (
            <tr key={m.id} className={m.isActive ? '' : 'inactive'}>
              <td><b>{m.name}</b></td><td>{KIND_LABEL[m.kind]}</td><td className="small">{m.requiresReference ? 'Asks for transaction ID' : ''}</td><td>{m.isActive ? <span className="badge ok">Shown on POS</span> : <span className="badge neutral">Hidden</span>}</td>
              <td className="text-right">{can('settings.manage') && <button className="btn sm ghost" onClick={() => { setEditing(m); setD({ name: m.name, kind: m.kind, requiresReference: m.requiresReference, isActive: m.isActive }); }}>Edit</button>}</td>
            </tr>
          ))}
        </tbody></table></div>
      )}
      {editing && (
        <Modal title={editing === 'new' ? 'Add payment method' : `Edit ${editing.name}`} onClose={() => setEditing(null)}
          footer={<><button className="btn secondary" onClick={() => setEditing(null)}>Cancel</button><button className="btn" disabled={!d.name.trim() || save.isPending} onClick={() => save.mutate()}>Save</button></>}>
          <Field label="Name" htmlFor="pm-name"><input id="pm-name" className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. Rocket, Upay, Bank transfer" /></Field>
          <Field label="Type" htmlFor="pm-kind"><select id="pm-kind" className="input" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as PaymentKind })}>{PAYMENT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></Field>
          <label className="check"><input type="checkbox" checked={d.requiresReference} onChange={(e) => setD({ ...d, requiresReference: e.target.checked })} /> Ask for a transaction ID</label>
          <label className="check"><input type="checkbox" checked={d.isActive} onChange={(e) => setD({ ...d, isActive: e.target.checked })} /> Show on the POS</label>
        </Modal>
      )}
    </section>
  );
}

function ThisDevice() {
  const { can } = useAuth();
  const [allowed, setAllowed] = useState(offlineAllowed());
  const manage = can('orders.cancel'); // manager or owner
  return (
    <section className="card card-pad stack" data-testid="this-device">
      <h2>This device</h2>
      <p className="muted small">Lets this till keep taking orders (cash only) if it loses the connection to the café server. Orders are stored on this device and sent automatically when it reconnects; any stock clashes are flagged for a manager. Only switch this on for the main till(s).</p>
      <label className="check">
        <input type="checkbox" disabled={!manage} checked={allowed} onChange={(e) => { setOfflineAllowed(e.target.checked); setAllowed(e.target.checked); }} data-testid="allow-offline" />
        Allow offline orders on this device
      </label>
      {!manage && <p className="small muted">Only a manager or the owner can change this.</p>}
      {queuedOrders().length > 0 && <div className="alert warn">{queuedOrders().length} offline order(s) on this device are waiting to be sent.</div>}
    </section>
  );
}

export function SettingsExtras() {
  return (
    <div className="page" style={{ paddingTop: 0 }}>
      <TaxRates />
      <PaymentMethods />
      <ThisDevice />
    </div>
  );
}
