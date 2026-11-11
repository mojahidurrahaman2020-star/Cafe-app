import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { formatQty, PRINTER_ROLE_LABELS, type ReportDTO, type StockSummaryDTO } from '@bitebrew/shared';
import { get } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Loading } from '../components/ui';
import { useFormat } from '../lib/hooks';
import { useConnection } from '../realtime/ConnectionContext';
import { SalesChart } from './ReportsPage';

interface Summary {
  businessDate: string;
  timezone: string;
  utcOffset: string;
  database: { ok: boolean; latencyMs: number | null };
  realtimeClients: number;
  staffSignedIn: number;
  stock: StockSummaryDTO;
  period: 'day' | 'week' | 'month';
  periodFrom: string;
  periodTo: string;
  report: ReportDTO | null;
  kitchenPending: number;
  baristaPending: number;
  openOrders: number;
  heldOrders: number;
  needsReview: number;
  printers: { role: 'RECEIPT' | 'BARISTA' | 'KITCHEN'; name: string; status: string; pendingJobs: number; failedJobs: number }[];
}
type Period = 'day' | 'week' | 'month';

function Kpi({ label, value, foot, to, testId, tone }: { label: string; value: string; foot?: string; to?: string; testId?: string; tone?: 'warn' | 'bad' }) {
  const body = (
    <>
      <span className="label">{label}</span>
      <span className="value num" data-testid={testId} style={{ color: tone === 'bad' ? 'var(--danger)' : tone === 'warn' ? 'var(--warning)' : undefined }}>{value}</span>
      {foot && <span className="foot">{foot}</span>}
    </>
  );
  return to ? <Link to={to} className="card kpi accent" style={{ textDecoration: 'none', color: 'inherit' }}>{body}</Link> : <div className="card kpi accent">{body}</div>;
}

export function DashboardPage() {
  const { user } = useAuth();
  const fmt = useFormat();
  const conn = useConnection();
  const [period, setPeriod] = useState<Period>('day');
  const q = useQuery({ queryKey: ['dashboard', 'summary', period], queryFn: () => get<Summary>(`/dashboard/summary?period=${period}`), refetchInterval: 30_000 });
  const s = q.data;
  const r = s?.report;
  const word = period === 'day' ? "Today's" : period === 'week' ? "This week's" : "This month's";
  return (
    <div className="page" data-testid="dashboard">
      <div className="page-head">
        <div>
          <h1>Good to see you, {user?.fullName.split(' ')[0]}</h1>
          <p>
            Business day <b className="num" data-testid="business-date">{s?.businessDate ?? '—'}</b> · {fmt.timezone} (UTC{s?.utcOffset ?? ''}) · Currency{' '}
            <b data-testid="currency-display">{fmt.currency.currencyCode} {fmt.currency.currencySymbol}</b> · {conn.status}
          </p>
        </div>
        <div className="segmented" role="group" aria-label="Period">
          {(['day', 'week', 'month'] as Period[]).map((p) => (
            <button key={p} aria-pressed={period === p} onClick={() => setPeriod(p)} data-testid={`period-${p}`}>{p === 'day' ? 'Today' : p === 'week' ? 'This week' : 'This month'}</button>
          ))}
        </div>
      </div>
      {!s ? <Loading /> : (
        <>
          {s.needsReview > 0 && <Link to="/pos" className="alert error" style={{ textDecoration: 'none' }}>{s.needsReview} offline order(s) need review — stock ran out while a till was offline. Open POS → Today's orders.</Link>}
          <section className="grid-kpi" aria-label="Sales">
            {r && <Kpi label={`${word} sales`} value={fmt.money(r.netSalesMinor)} foot={`excl. tax · gross ${fmt.money(r.grossSalesMinor)}`} to="/reports" testId="dash-sales" />}
            {r && <Kpi label={`${word} orders`} value={String(r.orders)} foot={`${s.openOrders} open · ${s.heldOrders} held · avg ${fmt.money(r.averageOrderMinor)}`} to="/pos" testId="dash-orders" />}
            {r && <Kpi label={`${word} expenses`} value={fmt.money(r.expensesMinor)} foot="Operating costs recorded" to="/expenses" testId="dash-expenses" />}
            {r && <Kpi label="Estimated profit" value={fmt.money(r.netProfitMinor)} foot={`Gross profit ${fmt.money(r.grossProfitMinor)} − expenses − losses`} to="/reports" testId="dash-profit" tone={r.netProfitMinor < 0 ? 'bad' : undefined} />}
            <Kpi label="Current stock value" value={fmt.money(s.stock.totalValueMinor)} foot={`Ingredients ${fmt.money(s.stock.ingredientValueMinor)} · portions ${fmt.money(s.stock.finishedValueMinor)}`} to="/inventory" testId="dash-stock-value" />
            <Kpi label="Low-stock alerts" value={String(s.stock.lowStock.length)} foot={s.stock.lowStock.slice(0, 3).map((l) => l.name).join(', ') || 'All above minimum'} to="/inventory" testId="dash-low-stock" tone={s.stock.lowStock.length ? 'warn' : undefined} />
            <Kpi label="Sold-out products" value={String(s.stock.soldOut.length)} foot={s.stock.soldOut.slice(0, 3).map((x) => x.name).join(', ') || 'Nothing sold out'} to="/availability" testId="dash-sold-out" tone={s.stock.soldOut.length ? 'bad' : undefined} />
            <Kpi label="Kitchen pending" value={String(s.kitchenPending)} foot="Food items not yet served" to="/kitchen" testId="dash-kitchen" />
            <Kpi label="Barista pending" value={String(s.baristaPending)} foot="Drinks not yet served" to="/barista" testId="dash-barista" />
          </section>

          {r && (
            <section className="card card-pad stack">
              <div className="row"><h3>Sales and expenses · {s.periodFrom === s.periodTo ? s.periodFrom : `${s.periodFrom} → ${s.periodTo}`}</h3><span className="spacer" /><span className="small"><span className="legend sales" /> Net sales <span className="legend expenses" /> Expenses</span></div>
              <SalesChart r={r} />
            </section>
          )}

          <div className="grid-2">
            {r && (
              <section className="card">
                <div className="card-header"><h3>Best-selling items</h3><Link to="/reports" className="btn sm secondary">Reports</Link></div>
                <div className="table-wrap"><table className="table" data-testid="dash-top"><tbody>
                  {r.topItems.length === 0 ? <tr><td className="muted">No sales yet in this period.</td></tr> : r.topItems.slice(0, 6).map((i) => (
                    <tr key={i.name}><td>{i.name}</td><td className="num text-right">{i.quantity} sold</td><td className="num text-right">{fmt.money(i.revenueMinor)}</td></tr>
                  ))}
                </tbody></table></div>
              </section>
            )}
            {r && (
              <section className="card">
                <div className="card-header"><h3>Category-wise revenue</h3></div>
                <div className="table-wrap"><table className="table"><tbody>
                  {r.categories.length === 0 ? <tr><td className="muted">No sales yet in this period.</td></tr> : r.categories.map((c) => (
                    <tr key={c.name}><td>{c.name}</td><td style={{ width: '40%' }}><div className="meter"><span style={{ width: `${(c.revenueMinor / Math.max(1, r.categories[0]!.revenueMinor)) * 100}%` }} /></div></td><td className="num text-right">{fmt.money(c.revenueMinor)}</td></tr>
                  ))}
                </tbody></table></div>
              </section>
            )}
            {r && (
              <section className="card">
                <div className="card-header"><h3>Payment method breakdown</h3></div>
                <div className="table-wrap"><table className="table" data-testid="dash-payments"><tbody>
                  {r.paymentMethods.length === 0 ? <tr><td className="muted">No payments yet in this period.</td></tr> : r.paymentMethods.map((m) => (
                    <tr key={m.name}><td>{m.name}</td><td className="num text-right">{fmt.money(m.netMinor)}</td></tr>
                  ))}
                </tbody></table></div>
              </section>
            )}
            <section className="card">
              <div className="card-header"><h3>Printer status</h3><Link to="/printers" className="btn sm secondary">Printers</Link></div>
              <div className="table-wrap"><table className="table" data-testid="dash-printers"><tbody>
                {s.printers.map((p) => (
                  <tr key={p.role}>
                    <td>{PRINTER_ROLE_LABELS[p.role]}</td>
                    <td className="text-right">
                      <span className={`badge ${p.status === 'ONLINE' ? 'ok' : p.status === 'NOT_CONFIGURED' ? 'neutral' : 'bad'}`}>{p.status === 'NOT_CONFIGURED' ? 'Not set up' : p.status.toLowerCase()}</span>
                      {(p.pendingJobs > 0 || p.failedJobs > 0) && <div className="small muted">{p.pendingJobs} waiting · {p.failedJobs} failed</div>}
                    </td>
                  </tr>
                ))}
              </tbody></table></div>
            </section>
            {s.stock.lowStock.length > 0 && (
              <section className="card">
                <div className="card-header"><h3>Low stock</h3><Link to="/inventory" className="btn sm secondary">Inventory</Link></div>
                <div className="table-wrap"><table className="table"><tbody>
                  {s.stock.lowStock.map((l) => (
                    <tr key={l.id}><td>{l.name}</td><td className="num text-right"><b>{formatQty(l.onHand, l.displayUnit)}</b> <span className="muted small">/ min {formatQty(l.minLevel, l.displayUnit)}</span></td></tr>
                  ))}
                </tbody></table></div>
              </section>
            )}
            <section className="card">
              <div className="card-header"><h3>System</h3></div>
              <div className="card-pad">
                <dl className="kv">
                  <dt>Connection</dt><dd data-testid="dash-connection">{conn.status}</dd>
                  <dt>Database</dt><dd>{s.database.ok ? `Connected (${s.database.latencyMs} ms)` : 'Unavailable'}</dd>
                  <dt>Devices connected</dt><dd>{s.realtimeClients}</dd>
                  <dt>Staff signed in</dt><dd>{s.staffSignedIn}</dd>
                </dl>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
