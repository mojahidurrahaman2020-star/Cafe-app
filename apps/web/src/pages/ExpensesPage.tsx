import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ExpenseCategoryDTO, ExpenseDTO } from '@bitebrew/shared';
import { errorMessage, get, post } from '../api/client';
import { MoneyInput } from '../components/inputs';
import { Field, Loading, Modal, useToast } from '../components/ui';
import { useFormat } from '../lib/hooks';
import { requestId } from '../lib/ids';
import { useNavigate } from 'react-router-dom';

export function ExpensesPage() {
  const fmt = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const today = useQuery({ queryKey: ['dashboard', 'date'], queryFn: async () => (await get<{ businessDate: string }>('/dashboard/summary')).businessDate });
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const f = from || today.data?.slice(0, 8) + '01';
  const t = to || today.data || '';
  const cats = useQuery({ queryKey: ['expense-categories'], queryFn: async () => (await get<{ categories: ExpenseCategoryDTO[] }>('/expense-categories')).categories });
  const list = useQuery({ queryKey: ['expenses', f, t], queryFn: async () => (await get<{ expenses: ExpenseDTO[] }>(`/expenses?from=${f}&to=${t}`)).expenses, enabled: !!today.data });
  const [d, setD] = useState({ categoryId: '', amountMinor: null as number | null, businessDate: '', paidWith: 'Cash', note: '' });
  const [rid, setRid] = useState(requestId);
  const [voiding, setVoiding] = useState<ExpenseDTO | null>(null);
  const [reason, setReason] = useState('');
  const [newCat, setNewCat] = useState('');
  const add = useMutation({
    mutationFn: () => post('/expenses', { ...d, businessDate: d.businessDate || today.data, requestId: rid }),
    onSuccess: () => { toast('success', 'Expense recorded'); setD({ ...d, amountMinor: null, note: '' }); setRid(requestId()); void qc.invalidateQueries({ queryKey: ['expenses'] }); },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const voidM = useMutation({
    mutationFn: () => post(`/expenses/${voiding!.id}/void`, { reason }),
    onSuccess: () => { toast('success', 'Expense voided'); setVoiding(null); setReason(''); void qc.invalidateQueries({ queryKey: ['expenses'] }); },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const addCat = useMutation({
    mutationFn: () => post('/expense-categories', { name: newCat }),
    onSuccess: () => { setNewCat(''); void qc.invalidateQueries({ queryKey: ['expense-categories'] }); },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const rows = list.data ?? [];
  const total = rows.filter((e) => !e.voidedAt).reduce((s, e) => s + e.amountMinor, 0);
  return (
    <div className="page" data-testid="expenses-page">
      <div className="page-head">
        <div>
          <h1>Expenses</h1>
          <p>Running costs such as rent, electricity and salaries. Ingredient deliveries are recorded under Inventory → Receive (they are stock, not expenses).</p>
        </div>
        <button className="btn secondary" onClick={() => navigate('/inventory')}>Record a stock purchase</button>
      </div>
      <section className="card card-pad stack" style={{ gap: 14 }}>
        <h2 style={{ fontSize: '1.1rem' }}>Add expense</h2>
        <div className="form-grid">
          <Field label="Category" htmlFor="ex-cat">
            <select id="ex-cat" className="input" value={d.categoryId} onChange={(e) => setD({ ...d, categoryId: e.target.value })} data-testid="expense-category">
              <option value="">Choose…</option>
              {(cats.data ?? []).filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Amount" htmlFor="ex-amt"><MoneyInput id="ex-amt" value={d.amountMinor} onChange={(v) => setD({ ...d, amountMinor: v })} symbol={fmt.currency.currencySymbol} testId="expense-amount" /></Field>
          <Field label="Date" htmlFor="ex-date"><input id="ex-date" type="date" className="input" value={d.businessDate || today.data || ''} onChange={(e) => setD({ ...d, businessDate: e.target.value })} /></Field>
          <Field label="Paid with" htmlFor="ex-paid"><input id="ex-paid" className="input" value={d.paidWith} onChange={(e) => setD({ ...d, paidWith: e.target.value })} placeholder="Cash, bKash, bank…" /></Field>
        </div>
        <Field label="Note" htmlFor="ex-note"><input id="ex-note" className="input" maxLength={300} value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} placeholder="e.g. November electricity bill" /></Field>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn gold" disabled={!d.categoryId || !d.amountMinor || add.isPending} onClick={() => add.mutate()} data-testid="expense-save">Record expense</button>
        </div>
      </section>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <Field label="From" htmlFor="ex-from"><input id="ex-from" type="date" className="input" value={f} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To" htmlFor="ex-to"><input id="ex-to" type="date" className="input" value={t} onChange={(e) => setTo(e.target.value)} /></Field>
        <span className="spacer" />
        <b className="num" style={{ fontSize: '1.2rem' }}>Total {fmt.money(total)}</b>
      </div>
      <div className="card">
        {list.isPending ? <Loading /> : !rows.length ? <div className="empty">No expenses in this period.</div> : (
          <div className="table-wrap">
            <table className="table" data-testid="expenses-table">
              <thead><tr><th>Date</th><th>Category</th><th>Note</th><th>Paid with</th><th className="text-right">Amount</th><th /></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className={e.voidedAt ? 'inactive' : ''}>
                    <td className="num small">{e.businessDate}</td>
                    <td>{e.categoryName}</td>
                    <td className="small">{e.note}{e.voidedAt && <div style={{ color: 'var(--danger)' }}>Voided: {e.voidReason}</div>}</td>
                    <td className="small">{e.paidWith}</td>
                    <td className="num text-right">{fmt.money(e.amountMinor)}</td>
                    <td className="text-right">{!e.voidedAt && <button className="btn sm ghost" onClick={() => setVoiding(e)}>Void</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <details className="card">
        <summary className="card-header" style={{ cursor: 'pointer', minHeight: 56 }}><h3>Expense categories</h3></summary>
        <div className="card-pad stack">
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>{(cats.data ?? []).map((c) => <span key={c.id} className="badge neutral">{c.name}</span>)}</div>
          <div className="row"><input className="input" placeholder="New category" value={newCat} onChange={(e) => setNewCat(e.target.value)} style={{ maxWidth: 280 }} /><button className="btn secondary" disabled={!newCat.trim()} onClick={() => addCat.mutate()}>Add</button></div>
        </div>
      </details>
      {voiding && (
        <Modal title="Void expense" onClose={() => setVoiding(null)} footer={<><button className="btn secondary" onClick={() => setVoiding(null)}>Cancel</button><button className="btn danger" disabled={!reason.trim()} onClick={() => voidM.mutate()}>Void</button></>}>
          <p>{voiding.categoryName} · {fmt.money(voiding.amountMinor)} on {voiding.businessDate}. Voided expenses stay in the records but are excluded from reports.</p>
          <Field label="Reason" htmlFor="void-r"><input id="void-r" className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </Modal>
      )}
    </div>
  );
}
