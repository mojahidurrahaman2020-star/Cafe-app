import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export interface PlannedModule {
  title: string;
  phase: number;
  summary: string;
  features: string[];
}

export const PLANNED: Record<string, PlannedModule> = {
  pos: {
    title: 'POS / Orders',
    phase: 3,
    summary: 'Touchscreen order taking for dine-in and takeaway, with live availability on every item.',
    features: [
      'Category tiles showing how many portions / orders can still be taken',
      'Table numbers, order numbers, notes and customisations',
      'Cash, card, bKash, Nagad and split payments; discounts; owner-configured VAT',
      'Held, cancelled and refunded orders with correct stock reversal or waste',
      'Atomic stock reservation so two tills can never sell the last portion twice',
      'Daily cash reconciliation',
    ],
  },
  kitchen: {
    title: 'Kitchen display',
    phase: 4,
    summary: 'Live queue of food tickets, mirrored on the kitchen thermal printer.',
    features: ['Food-only tickets split automatically from each order', 'Bump / served status updates the owner dashboard live', 'Pending count and ticket age'],
  },
  barista: {
    title: 'Barista display',
    phase: 4,
    summary: 'Live queue of drinks tickets, mirrored on the barista thermal printer.',
    features: ['Drinks-only tickets (coffee, tea, beverages)', 'Customisations shown prominently', 'Pending count and ticket age'],
  },


  expenses: {
    title: 'Purchases & expenses',
    phase: 5,
    summary: 'Stock purchases (to inventory, not COGS) and operating expenses kept separate.',
    features: ['Supplier purchases update stock and average cost', 'Expense categories: rent, electricity, salaries, …', 'Daily / weekly / monthly totals'],
  },
  reports: {
    title: 'Reports',
    phase: 5,
    summary: 'Sales, COGS, expenses, gross and estimated net profit by any date range.',
    features: ['Daily, weekly, monthly and custom ranges in Asia/Dhaka time', 'Payment method and category breakdowns', 'PDF, CSV and Excel exports'],
  },
  printers: {
    title: 'Printers',
    phase: 4,
    summary: 'Three destinations: customer receipt, barista drinks, kitchen food.',
    features: ['Local print agent sending ESC/POS over Ethernet / Wi-Fi / USB', '58 mm and 80 mm paper', 'Status, test print, controlled reprint, failure log, no duplicate tickets'],
  },
};

export function PlannedModulePage({ moduleKey }: { moduleKey: keyof typeof PLANNED }) {
  const m = PLANNED[moduleKey]!;
  const { can } = useAuth();
  return (
    <div className="page" style={{ maxWidth: 860 }} data-testid={`planned-${moduleKey}`}>
      <div className="page-head">
        <div>
          <span className="badge gold">Planned · Phase {m.phase}</span>
          <h1 style={{ marginTop: 10 }}>{m.title}</h1>
          <p>{m.summary}</p>
        </div>
      </div>
      <div className="card card-pad stack">
        <h3>What this module will do</h3>
        <ul style={{ margin: 0, paddingLeft: 22, display: 'grid', gap: 6 }}>
          {m.features.map((f) => <li key={f}>{f}</li>)}
        </ul>
        <p className="muted small">This screen is a placeholder so navigation is complete; the module is not yet functional.</p>
        {can('menu.view') && <Link className="btn secondary" to="/menu" style={{ alignSelf: 'flex-start' }}>View menu categories</Link>}
      </div>
    </div>
  );
}
