import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { MENU_GROUP_LABELS, MENU_GROUPS, ROLE_LABELS, ROLES } from '@bitebrew/shared';
import { get } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Loading } from '../components/ui';
import { useFormat } from '../lib/hooks';
import { useConnection } from '../realtime/ConnectionContext';

interface Summary {
  businessDate: string;
  timezone: string;
  utcOffset: string;
  serverTime: string;
  database: { ok: boolean; latencyMs: number | null };
  realtimeClients: number;
  staffSignedIn: number;
  categories: { byGroup: Partial<Record<string, number>>; inactive: number };
  activeUsersByRole: Partial<Record<string, number>>;
}

type Period = 'day' | 'week' | 'month';

/** Business KPIs that need data from later phases. Shown honestly as pending — never with invented numbers. */
const PENDING_KPIS: { label: string; phase: number; note: string }[] = [
  { label: "Today's sales", phase: 3, note: 'From completed POS orders' },
  { label: "Today's orders", phase: 3, note: 'Dine-in and takeaway' },
  { label: "Today's expenses", phase: 5, note: 'Operating expenses recorded today' },
  { label: 'Estimated profit', phase: 5, note: 'Revenue − COGS − expenses' },
  { label: 'Current stock value', phase: 2, note: 'Raw + finished inventory at cost' },
  { label: 'Low-stock alerts', phase: 2, note: 'Ingredients below minimum level' },
  { label: 'Sold-out products', phase: 2, note: 'Finished portions at zero' },
  { label: 'Kitchen pending', phase: 4, note: 'Food tickets not yet served' },
  { label: 'Barista pending', phase: 4, note: 'Drink tickets not yet served' },
];

const PENDING_PANELS: { title: string; phase: number }[] = [
  { title: 'Best-selling items', phase: 3 },
  { title: 'Category-wise revenue', phase: 3 },
  { title: 'Payment method breakdown', phase: 3 },
  { title: 'Printer status', phase: 4 },
];


export function DashboardPage() {
  const { user } = useAuth();
  const fmt = useFormat();
  const conn = useConnection();
  const [period, setPeriod] = useState<Period>('day');
  const summary = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: () => get<Summary>('/dashboard/summary'),
    refetchInterval: 30_000,
  });

  const s = summary.data;
  const totalCategories = s ? Object.values(s.categories.byGroup).reduce<number>((a, b) => a + (b ?? 0), 0) : 0;
  const totalStaff = s ? Object.values(s.activeUsersByRole).reduce<number>((a, b) => a + (b ?? 0), 0) : 0;

  return (
    <div className="page" data-testid="dashboard">
      <div className="page-head">
        <div>
          <h1>Good to see you, {user?.fullName.split(' ')[0]}</h1>
          <p>
            Business day <b className="num" data-testid="business-date">{s?.businessDate ?? '—'}</b> · {fmt.timezone} (UTC{s?.utcOffset ?? ''}) · Currency{' '}
            <b data-testid="currency-display">{fmt.currency.currencyCode} {fmt.currency.currencySymbol}</b>
          </p>
        </div>
        <div className="segmented" role="group" aria-label="Report period">
          {(['day', 'week', 'month'] as Period[]).map((p) => (
            <button key={p} aria-pressed={period === p} onClick={() => setPeriod(p)}>
              {p === 'day' ? 'Today' : p === 'week' ? 'This week' : 'This month'}
            </button>
          ))}
        </div>
      </div>

      <div className="alert info">
        <b>Phase 1 foundation.</b> Sales, stock, expense and printer figures will appear here automatically once those modules are built — the
        dashboard never shows estimated or sample figures in their place. Example of how money will display: <b className="num">{fmt.money(125050)}</b>,{' '}
        <b className="num">{fmt.money(1_25_000_00)}</b>.
      </div>

      <section className="grid-kpi" aria-label="Key figures">
        {PENDING_KPIS.map((k) => (
          <div key={k.label} className="card kpi">
            <span className="label">
              {period === 'day' ? k.label : k.label.replace("Today's", period === 'week' ? "This week's" : "This month's")}
            </span>
            <span className="value pending">Available in Phase {k.phase}</span>
            <span className="foot">{k.note}</span>
          </div>
        ))}
      </section>

      <h2>System status</h2>
      {summary.isPending ? (
        <Loading />
      ) : summary.isError ? (
        <div className="alert error">Could not load the dashboard summary.</div>
      ) : (
        s && (
          <section className="grid-kpi">
            <div className="card kpi accent">
              <span className="label">Connection</span>
              <span className="value" style={{ fontSize: '1.4rem' }} data-testid="dash-connection">
                {conn.status}
              </span>
              <span className="foot">Live updates {conn.liveConnected ? 'active' : 'reconnecting'} · {s.realtimeClients} device(s) connected</span>
            </div>
            <div className="card kpi accent">
              <span className="label">Database</span>
              <span className="value" style={{ fontSize: '1.4rem' }}>
                {s.database.ok ? 'Connected' : 'Unavailable'}
              </span>
              <span className="foot">Round-trip {s.database.latencyMs ?? '—'} ms</span>
            </div>
            <div className="card kpi accent">
              <span className="label">Staff signed in</span>
              <span className="value num">{s.staffSignedIn}</span>
              <span className="foot">of {totalStaff} active accounts</span>
            </div>
            <div className="card kpi accent">
              <span className="label">Menu categories</span>
              <span className="value num" data-testid="dash-category-count">{totalCategories}</span>
              <span className="foot">
                {MENU_GROUPS.map((g) => `${MENU_GROUP_LABELS[g]} ${s.categories.byGroup[g] ?? 0}`).join(' · ')}
                {s.categories.inactive ? ` · ${s.categories.inactive} hidden` : ''}
              </span>
            </div>
          </section>
        )
      )}

      <div className="grid-2">
        {PENDING_PANELS.map((p) => (
          <div key={p.title} className="card">
            <div className="card-header">
              <h3>{p.title}</h3>
              <span className="badge neutral">Phase {p.phase}</span>
            </div>
            <div className="empty">No data yet — this panel fills in once the module is live.</div>
          </div>
        ))}
        {s && (
          <div className="card">
            <div className="card-header">
              <h3>Team</h3>
              <Link to="/users" className="btn sm secondary">
                Manage staff
              </Link>
            </div>
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {ROLES.map((r) => (
                    <tr key={r}>
                      <td>{ROLE_LABELS[r]}</td>
                      <td className="num" style={{ textAlign: 'right' }}>
                        {s.activeUsersByRole[r] ?? 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
