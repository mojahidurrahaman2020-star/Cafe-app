import { MENU_GROUP_LABELS } from '@bitebrew/shared';
import { errorMessage } from '../api/client';
import { Loading } from '../components/ui';
import { useFormat } from '../lib/hooks';
import { useAvailability } from '../lib/queries';
import { AvailabilityPill } from './ProductsPage';

export function AvailabilityPage() {
  const fmt = useFormat();
  const q = useAvailability();
  return (
    <div className="page" data-testid="availability-page">
      <div className="page-head">
        <div>
          <h1>What can we sell now?</h1>
          <p>Live count of portions and orders that can still be taken, per category. Updates automatically on every device.</p>
        </div>
      </div>
      {q.isPending ? <Loading /> : q.isError ? <div className="alert error">{errorMessage(q.error)}</div> : (
        <div className="avail-grid">
          {q.data.map((c) => (
            <section key={c.categoryId} className="card" data-testid="avail-category">
              <div className="card-header">
                <div>
                  <h3>{c.name}</h3>
                  <span className="small muted">{MENU_GROUP_LABELS[c.group]} · {c.station === 'KITCHEN' ? 'Kitchen' : 'Barista'}</span>
                </div>
                <div className="text-right small">
                  {c.portionsReady > 0 && <div><b className="num">{c.portionsReady}</b> portions ready</div>}
                  <div className="muted">{c.itemsAvailable} available{c.itemsSoldOut ? ` · ${c.itemsSoldOut} sold out` : ''}</div>
                </div>
              </div>
              {c.products.length === 0 ? <div className="empty small">No items in this category yet.</div> : c.products.map((p) => (
                <div key={p.id} className="avail-item" data-testid="avail-item">
                  <span className="name">{p.name}<div className="small muted num">{fmt.money(p.priceMinor)}{p.limitingIngredient && p.available !== null && p.available <= 5 ? ` · limited by ${p.limitingIngredient}` : ''}</div></span>
                  <AvailabilityPill p={p} />
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
      <p className="muted small">Made-to-order items share ingredients, so their counts are per item (e.g. selling a latte also reduces cappuccinos that use the same milk).</p>
    </div>
  );
}
