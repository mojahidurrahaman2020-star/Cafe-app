import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ReportDTO } from '@bitebrew/shared';
import { errorMessage, get } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Field, Loading, useToast } from '../components/ui';
import { useFormat } from '../lib/hooks';

const addDays = (d: string, n: number) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
type Preset = 'today' | 'week' | 'month' | 'last-month' | 'custom';

function range(preset: Preset, today: string): [string, string] {
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  if (preset === 'today') return [today, today];
  if (preset === 'week') return [addDays(today, -dow), today];
  if (preset === 'month') return [`${today.slice(0, 8)}01`, today];
  const firstThis = `${today.slice(0, 8)}01`;
  const lastPrev = addDays(firstThis, -1);
  return [`${lastPrev.slice(0, 8)}01`, lastPrev];
}

export function KpiGrid({ r }: { r: ReportDTO }) {
  const fmt = useFormat();
  const cards: [string, number, string, boolean?][] = [
    ['Net sales', r.netSalesMinor, `${r.orders} orders · avg ${fmt.money(r.averageOrderMinor)}`],
    ['Cost of goods sold', r.cogsMinor, 'Ingredients & portions actually sold'],
    ['Gross profit', r.grossProfitMinor, r.netSalesMinor ? `${Math.round((r.grossProfitMinor / r.netSalesMinor) * 100)}% margin` : '—'],
    ['Expenses', r.expensesMinor, 'Rent, salaries, utilities…'],
    ['Inventory losses', r.inventoryLossesMinor, 'Waste, spoilage, corrections'],
    ['Net profit (estimate)', r.netProfitMinor, 'Gross profit − expenses − losses', true],
  ];
  return (
    <section className="grid-kpi">
      {cards.map(([label, v, foot, strong]) => (
        <div key={label} className={`card kpi ${strong ? 'accent' : ''}`}>
          <span className="label">{label}</span>
          <span className="value num" style={{ color: v < 0 ? 'var(--danger)' : undefined, fontSize: '1.6rem' }}>{fmt.money(v)}</span>
          <span className="foot">{foot}</span>
        </div>
      ))}
    </section>
  );
}

export function SalesChart({ r }: { r: ReportDTO }) {
  const fmt = useFormat();
  const max = Math.max(1, ...r.series.map((s) => Math.max(s.salesMinor, s.expensesMinor)));
  return (
    <div className="chart" role="img" aria-label="Net sales and expenses by period">
      {r.series.map((s) => (
        <div key={s.period} className="bar-col" title={`${s.period}: sales ${fmt.money(s.salesMinor)}, expenses ${fmt.money(s.expensesMinor)}`}>
          <div className="bars">
            <span className="bar sales" style={{ height: `${(s.salesMinor / max) * 100}%` }} />
            <span className="bar expenses" style={{ height: `${(s.expensesMinor / max) * 100}%` }} />
          </div>
          <span className="bar-label">{s.period.length === 10 ? s.period.slice(8) : s.period.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

export function ReportsPage() {
  const fmt = useFormat();
  const toast = useToast();
  const { can } = useAuth();
  const today = useQuery({ queryKey: ['dashboard', 'date'], queryFn: async () => (await get<{ businessDate: string }>('/dashboard/summary')).businessDate });
  const [preset, setPreset] = useState<Preset>('month');
  const [custom, setCustom] = useState<[string, string]>(['', '']);
  const [from, to] = today.data ? (preset === 'custom' ? [custom[0] || today.data, custom[1] || today.data] : range(preset, today.data)) : ['', ''];
  const q = useQuery({ queryKey: ['report', from, to], queryFn: async () => (await get<{ report: ReportDTO }>(`/reports/summary?from=${from}&to=${to}`)).report, enabled: !!from });
  const download = async (format: 'csv' | 'xlsx' | 'pdf') => {
    // The Android app's browser cannot save in-page (blob) files; a direct link is saved by the
    // phone's download manager instead (the server sends the file as an attachment).
    if (navigator.userAgent.includes('BiteBrewApp')) {
      window.location.assign(`/api/reports/export?from=${from}&to=${to}&format=${format}`);
      return;
    }
    try {
      const res = await fetch(`/api/reports/export?from=${from}&to=${to}&format=${format}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? 'Export failed');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `bite-and-brew-report-${from}_to_${to}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      toast('error', errorMessage(e) || (e as Error).message);
    }
  };
  const r = q.data;
  return (
    <div className="page" data-testid="reports-page">
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p>{from && `${from} → ${to}`} · business days in {fmt.timezone}</p>
        </div>
        {can('reports.export') && r && (
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn secondary sm" onClick={() => download('pdf')} data-testid="export-pdf">PDF</button>
            <button className="btn secondary sm" onClick={() => download('xlsx')} data-testid="export-xlsx">Excel</button>
            <button className="btn secondary sm" onClick={() => download('csv')} data-testid="export-csv">CSV</button>
          </div>
        )}
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <div className="segmented" role="group" aria-label="Period">
          {([['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['last-month', 'Last month'], ['custom', 'Custom']] as [Preset, string][]).map(([p, l]) => (
            <button key={p} aria-pressed={preset === p} onClick={() => setPreset(p)}>{l}</button>
          ))}
        </div>
        {preset === 'custom' && (
          <>
            <Field label="From" htmlFor="rp-from"><input id="rp-from" type="date" className="input" value={custom[0] || from} onChange={(e) => setCustom([e.target.value, custom[1]])} /></Field>
            <Field label="To" htmlFor="rp-to"><input id="rp-to" type="date" className="input" value={custom[1] || to} onChange={(e) => setCustom([custom[0], e.target.value])} /></Field>
          </>
        )}
      </div>
      {!r ? (q.isError ? <div className="alert error">{errorMessage(q.error)}</div> : <Loading />) : (
        <>
          <KpiGrid r={r} />
          <section className="card card-pad stack">
            <div className="row"><h3>Sales and expenses</h3><span className="spacer" /><span className="small"><span className="legend sales" /> Net sales <span className="legend expenses" /> Expenses</span></div>
            <SalesChart r={r} />
          </section>
          <div className="grid-2">
            <section className="card">
              <div className="card-header"><h3>Sales summary</h3></div>
              <div className="card-pad">
                <dl className="kv" data-testid="report-summary">
                  <dt>Gross sales</dt><dd className="num">{fmt.money(r.grossSalesMinor)}</dd>
                  <dt>Discounts</dt><dd className="num">−{fmt.money(r.discountsMinor)}</dd>
                  <dt>Tax / VAT collected</dt><dd className="num">{fmt.money(r.taxMinor)}</dd>
                  <dt>Refunds</dt><dd className="num">−{fmt.money(r.refundsMinor)}</dd>
                  <dt>Net sales (excl. tax)</dt><dd className="num">{fmt.money(r.netSalesMinor)}</dd>
                  <dt>Items sold</dt><dd className="num">{r.itemsSold}</dd>
                  <dt>Cancelled orders</dt><dd className="num">{r.cancelledOrders}</dd>
                  <dt>Stock purchased</dt><dd className="num">{fmt.money(r.inventoryPurchasesMinor)} <span className="small muted">(stock, not an expense)</span></dd>
                </dl>
              </div>
            </section>
            <section className="card">
              <div className="card-header"><h3>Payment methods</h3></div>
              <div className="table-wrap"><table className="table"><tbody>
                {r.paymentMethods.length === 0 ? <tr><td className="muted">No payments</td></tr> : r.paymentMethods.map((m) => (
                  <tr key={m.name}><td>{m.name}</td><td className="num text-right">{fmt.money(m.netMinor)}{m.refundedMinor ? <div className="small muted">refunded {fmt.money(m.refundedMinor)}</div> : null}</td></tr>
                ))}
              </tbody></table></div>
            </section>
            <section className="card">
              <div className="card-header"><h3>Best sellers</h3></div>
              <div className="table-wrap"><table className="table"><tbody>
                {r.topItems.length === 0 ? <tr><td className="muted">No sales</td></tr> : r.topItems.map((i) => (
                  <tr key={i.name}><td>{i.name}</td><td className="num text-right">{i.quantity}</td><td className="num text-right">{fmt.money(i.revenueMinor)}</td></tr>
                ))}
              </tbody></table></div>
            </section>
            <section className="card">
              <div className="card-header"><h3>By category</h3></div>
              <div className="table-wrap"><table className="table"><tbody>
                {r.categories.length === 0 ? <tr><td className="muted">No sales</td></tr> : r.categories.map((c) => (
                  <tr key={c.name}><td>{c.name}</td><td className="num text-right">{c.quantity}</td><td className="num text-right">{fmt.money(c.revenueMinor)}</td></tr>
                ))}
              </tbody></table></div>
            </section>
            <section className="card">
              <div className="card-header"><h3>Expenses by category</h3></div>
              <div className="table-wrap"><table className="table"><tbody>
                {r.expensesByCategory.length === 0 ? <tr><td className="muted">No expenses</td></tr> : r.expensesByCategory.map((e) => (
                  <tr key={e.name}><td>{e.name}</td><td className="num text-right">{fmt.money(e.amountMinor)}</td></tr>
                ))}
              </tbody></table></div>
            </section>
          </div>
          <p className="small muted">Cost of goods sold comes from the stock actually used for the items sold (batch cost for prepared portions, recipe cost for made-to-order items). Stock purchases are not counted as costs until used.</p>
        </>
      )}
    </div>
  );
}
