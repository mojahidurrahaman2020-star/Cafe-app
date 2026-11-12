import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatPhone, type CustomerDetailDTO, type CustomerDTO } from '@bitebrew/shared';
import { del, errorMessage, get } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { CustomerForm } from '../components/CustomerForm';
import { Icon } from '../components/Icons';
import { ConfirmDialog, Loading, Modal, useToast } from '../components/ui';
import { useFormat } from '../lib/hooks';
import { useCustomers } from '../lib/queries';
import { useQueryClient } from '@tanstack/react-query';

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const fmt = useFormat();
  const q = useQuery({ queryKey: ['customer', id], queryFn: async () => (await get<{ customer: CustomerDetailDTO }>(`/customers/${id}`)).customer });
  const c = q.data;
  return (
    <Modal title={c?.name ?? 'Customer'} onClose={onClose} wide>
      {!c ? <Loading /> : (
        <div className="stack" style={{ gap: 14 }}>
          <dl className="kv">
            <dt>Phone</dt><dd className="num">{formatPhone(c.phone)}</dd>
            <dt>Visits</dt><dd className="num">{c.visits}</dd>
            <dt>Total spent</dt><dd className="num">{fmt.money(c.spentMinor)}</dd>
            <dt>Last visit</dt><dd>{c.lastVisitAt ? fmt.dateTime(c.lastVisitAt) : '—'}</dd>
            {c.notes && <><dt>Notes</dt><dd>{c.notes}</dd></>}
          </dl>
          <h3>Recent orders</h3>
          {c.recentOrders.length === 0 ? <p className="muted">No orders yet.</p> : (
            <div className="table-wrap"><table className="table"><tbody>
              {c.recentOrders.map((o) => <tr key={o.id}><td className="num">#{o.orderNo}</td><td className="small num">{o.businessDate}</td><td className="small">{o.items}</td><td className="num text-right">{fmt.money(o.totalMinor)}</td><td className="small">{o.status.toLowerCase()}</td></tr>)}
            </tbody></table></div>
          )}
        </div>
      )}
    </Modal>
  );
}

export function CustomersPage() {
  const fmt = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const list = useCustomers(search.trim(), showInactive);
  const [editing, setEditing] = useState<CustomerDTO | 'new' | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CustomerDTO | null>(null);
  const rows = list.data ?? [];
  return (
    <div className="page" data-testid="customers-page">
      <div className="page-head">
        <div>
          <h1>Regular customers</h1>
          <p>Save a name and phone number, then pick the customer at the till. Their visits and spending are tracked automatically.</p>
        </div>
        <button className="btn gold" onClick={() => setEditing('new')} data-testid="customer-new"><Icon.plus width={20} /> New customer</button>
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <input className="input" style={{ maxWidth: 320 }} placeholder="Search by name or phone…" aria-label="Search customers" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="customer-search" />
        <label className="check" style={{ minHeight: 40 }}><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive</label>
        <span className="spacer" /><span className="muted small">{rows.length} customer(s)</span>
      </div>
      <div className="card">
        {list.isPending ? <Loading /> : list.isError ? <div className="alert error" style={{ margin: 16 }}>{errorMessage(list.error)}</div> : rows.length === 0 ? (
          <div className="empty">{search ? 'No customer matches.' : 'No regular customers yet. Add your first one.'}</div>
        ) : (
          <div className="table-wrap">
            <table className="table" data-testid="customers-table">
              <thead><tr><th>Name</th><th>Phone</th><th className="text-right">Visits</th><th className="text-right">Spent</th><th>Last visit</th><th /></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className={c.isActive ? '' : 'inactive'} data-testid="customer-row">
                    <td><b>{c.name}</b>{c.notes && <div className="small muted">{c.notes}</div>}{!c.isActive && <span className="badge neutral" style={{ marginLeft: 6 }}>inactive</span>}</td>
                    <td className="num">{formatPhone(c.phone)}</td>
                    <td className="num text-right">{c.visits}</td>
                    <td className="num text-right">{fmt.money(c.spentMinor)}</td>
                    <td className="small">{c.lastVisitAt ? fmt.dateTime(c.lastVisitAt).split(',').slice(0, 2).join(',') : '—'}</td>
                    <td className="text-right" style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn sm ghost" onClick={() => setViewing(c.id)}>History</button>
                      <button className="btn ghost icon" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)} data-testid="customer-edit"><Icon.edit width={20} /></button>
                      {can('orders.cancel') && <button className="btn ghost icon" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}><Icon.trash width={20} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && <CustomerForm initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {viewing && <Detail id={viewing} onClose={() => setViewing(null)} />}
      {deleting && (
        <ConfirmDialog title="Delete customer?" danger confirmLabel="Delete" message={<p>Delete <b>{deleting.name}</b>? Customers with past orders cannot be deleted — mark them inactive instead.</p>}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => { try { await del(`/customers/${deleting.id}`); toast('success', 'Customer deleted'); void qc.invalidateQueries({ queryKey: ['customers'] }); } catch (e) { toast('error', errorMessage(e)); } setDeleting(null); }} />
      )}
    </div>
  );
}
