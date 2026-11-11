import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SERVICE_LABELS, type OrderDTO, type PrinterRole } from '@bitebrew/shared';
import { errorMessage, get, post } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { MoneyInput } from '../components/inputs';
import { Field, Loading, Modal, useToast } from '../components/ui';
import { useFormat } from '../lib/hooks';
import { requestId } from '../lib/ids';
import { usePaymentMethods, usePrintJobs } from '../lib/queries';

const PREP_LABEL: Record<string, string> = { PENDING: 'Waiting', PREPARING: 'Preparing', READY: 'Ready', SERVED: 'Served', CANCELLED: 'Cancelled' };

export function OrderDetail({ orderId, onClose, onPay }: { orderId: string; onClose: () => void; onPay?: (o: OrderDTO) => void }) {
  const fmt = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['order', orderId], queryFn: async () => (await get<{ order: OrderDTO }>(`/orders/${orderId}`)).order });
  const jobs = usePrintJobs({ orderId, limit: 20 });
  const methods = usePaymentMethods();
  const [action, setAction] = useState<null | 'cancel' | 'refund' | 'reprint' | 'review'>(null);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [methodId, setMethodId] = useState('');
  const [role, setRole] = useState<PrinterRole>('RECEIPT');
  const [key] = useState(requestId);
  const refresh = () => ['orders', 'order', 'products', 'cash', 'print-jobs', 'availability'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
  const m = useMutation({
    mutationFn: async () => {
      if (action === 'cancel') return post(`/orders/${orderId}/cancel`, { reason });
      if (action === 'refund') return post(`/orders/${orderId}/refunds`, { methodId, amountMinor: amount, reason, idempotencyKey: key });
      if (action === 'reprint') return post(`/orders/${orderId}/reprint`, { role, reason });
      if (action === 'review') return post(`/orders/${orderId}/review`, { note: reason });
      return null;
    },
    onSuccess: () => { toast('success', action === 'cancel' ? 'Order cancelled' : action === 'refund' ? 'Refund recorded' : action === 'reprint' ? 'Sent to printer' : 'Marked as reviewed'); setAction(null); setReason(''); refresh(); },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const send = useMutation({ mutationFn: () => post(`/orders/${orderId}/send`), onSuccess: () => { toast('success', 'Sent to kitchen/barista'); refresh(); }, onError: (e) => toast('error', errorMessage(e)) });
  const o = q.data;
  return (
    <Modal title={o ? `Order #${o.orderNo}` : 'Order'} onClose={onClose} wide>
      {!o ? <Loading /> : (
        <div className="stack" style={{ gap: 16 }} data-testid="order-detail">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <span className="badge neutral">{SERVICE_LABELS[o.serviceType]}{o.tableNo ? ` · Table ${o.tableNo}` : ''}</span>
            <span className="muted small">{fmt.dateTime(o.createdAt)} · {o.createdBy}</span>
            {o.placedOffline && <span className="badge warn">Taken offline</span>}
            {o.status === 'CANCELLED' && <span className="badge bad">Cancelled: {o.cancelReason}</span>}
          </div>
          {o.needsReview && <div className="alert error">{o.reviewNote}</div>}
          {!o.needsReview && o.reviewNote && <div className="alert info small">{o.reviewNote}</div>}
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {o.lines.map((l) => (
                  <tr key={l.id}>
                    <td><b>{l.quantity} × {l.name}</b>{l.modifiers.length > 0 && <div className="small muted">{l.modifiers.map((x) => x.name).join(', ')}</div>}{l.notes && <div className="small">Note: {l.notes}</div>}</td>
                    <td className="small">{l.station === 'KITCHEN' ? 'Kitchen' : 'Barista'} · {PREP_LABEL[l.prepStatus]}{l.stockState === 'WASTED' ? ' · recorded as waste' : l.stockState === 'RESTORED' ? ' · stock returned' : l.stockState === 'CONFLICT' ? ' · stock conflict' : ''}</td>
                    <td className="num text-right">{fmt.money(l.lineTotalMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="kv">
            <dt>Subtotal</dt><dd className="num">{fmt.money(o.subtotalMinor)}</dd>
            {o.discountMinor > 0 && <><dt>Discount ({o.discountReason})</dt><dd className="num">−{fmt.money(o.discountMinor)}</dd></>}
            {o.taxes.map((t) => <Fragment key={t.id}><dt>{t.name} {t.rateBp / 100}%{t.inclusive ? ' (included)' : ''}</dt><dd className="num">{fmt.money(t.amountMinor)}</dd></Fragment>)}
            <dt>Total</dt><dd className="num" style={{ fontSize: '1.2rem' }}>{fmt.money(o.totalMinor)}</dd>
            {o.payments.map((p) => <Fragment key={p.id}><dt>{p.methodName}{p.reference ? ` (${p.reference})` : ''}</dt><dd className="num">{fmt.money(p.amountMinor)}{p.changeMinor ? ` · change ${fmt.money(p.changeMinor)}` : ''}</dd></Fragment>)}
            {o.refunds.map((r) => <Fragment key={r.id}><dt>Refund · {r.methodName} ({r.reason})</dt><dd className="num" style={{ color: 'var(--danger)' }}>−{fmt.money(r.amountMinor)}</dd></Fragment>)}
            {o.dueMinor > 0 && o.status !== 'HELD' && <><dt>Still due</dt><dd className="num" style={{ color: 'var(--danger)' }}>{fmt.money(o.dueMinor)}</dd></>}
          </dl>
          {jobs.data && jobs.data.length > 0 && (
            <div className="small muted">Printing: {jobs.data.map((j) => `${j.role.toLowerCase()}${j.reprintNo ? ` reprint ${j.reprintNo}` : ''} — ${j.status.toLowerCase()}`).join(' · ')}</div>
          )}
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {o.status === 'HELD' && <button className="btn" onClick={() => send.mutate()} disabled={send.isPending}>Send to kitchen/barista</button>}
            {o.status === 'OPEN' && o.dueMinor > 0 && onPay && <button className="btn gold" onClick={() => onPay(o)}>Take payment</button>}
            {o.status !== 'CANCELLED' && (o.status === 'HELD' || can('orders.cancel')) && <button className="btn secondary" onClick={() => setAction('cancel')} data-testid="order-cancel">Cancel order</button>}
            {can('orders.refund') && o.paidMinor - o.refundedMinor > 0 && <button className="btn secondary" onClick={() => { setAction('refund'); setAmount(o.paidMinor - o.refundedMinor); setMethodId(o.payments[0]?.methodId ?? ''); }}>Refund</button>}
            {can('orders.reprint') && o.status !== 'HELD' && <button className="btn secondary" onClick={() => setAction('reprint')}>Reprint</button>}
            {o.needsReview && can('orders.cancel') && <button className="btn secondary" onClick={() => setAction('review')}>Mark reviewed</button>}
          </div>
          {action && (
            <div className="card card-pad stack" style={{ gap: 12, background: 'var(--cream-100)' }}>
              <b>{action === 'cancel' ? 'Cancel this order' : action === 'refund' ? 'Refund' : action === 'reprint' ? 'Reprint' : 'Review note'}</b>
              {action === 'cancel' && <p className="small muted">Items not yet started go back into stock. Items already being prepared or served are recorded as waste. {o.paidMinor - o.refundedMinor > 0 ? 'Refund the payment first.' : ''}</p>}
              {action === 'refund' && (
                <div className="form-grid">
                  <Field label="Amount" htmlFor="rf-amt"><MoneyInput id="rf-amt" value={amount} onChange={setAmount} symbol={fmt.currency.currencySymbol} /></Field>
                  <Field label="Refund by" htmlFor="rf-m"><select id="rf-m" className="input" value={methodId} onChange={(e) => setMethodId(e.target.value)}>{(methods.data ?? []).map((pm) => <option key={pm.id} value={pm.id}>{pm.name}</option>)}</select></Field>
                </div>
              )}
              {action === 'reprint' && (
                <div className="segmented">{(['RECEIPT', 'KITCHEN', 'BARISTA'] as PrinterRole[]).map((r) => <button key={r} aria-pressed={role === r} onClick={() => setRole(r)}>{r === 'RECEIPT' ? 'Receipt' : r === 'KITCHEN' ? 'Kitchen ticket' : 'Barista ticket'}</button>)}</div>
              )}
              <Field label="Reason (required, recorded in the audit log)" htmlFor="od-reason"><input id="od-reason" className="input" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn ghost" onClick={() => setAction(null)}>Back</button>
                <button className={`btn ${action === 'cancel' ? 'danger' : ''}`} disabled={!reason.trim() || m.isPending || (action === 'refund' && (!amount || !methodId))} onClick={() => m.mutate()} data-testid="order-action-confirm">Confirm</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
