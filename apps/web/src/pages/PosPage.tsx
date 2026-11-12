import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  discountFrom, MENU_GROUP_LABELS, priceOrder, SERVICE_LABELS,
  type OrderDTO, type PaymentMethodDTO, type ProductDTO, type ServiceType,
} from '@bitebrew/shared';
import { ApiError, errorMessage, NetworkError, post } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icons';
import { MoneyInput, Tabs } from '../components/inputs';
import { Field, Loading, Modal, useToast } from '../components/ui';
import { useFormat, useSettings } from '../lib/hooks';
import { requestId } from '../lib/ids';
import { cacheMenu, cachedMenu, cacheMethods, cachedMethods, enqueueOrder, offlineAllowed, queuedOrders, syncQueue, type QueuedOrder } from '../lib/offlineQueue';
import { useCashSession, useOrders, usePaymentMethods, useProducts, useTaxRates } from '../lib/queries';
import { useConnection } from '../realtime/ConnectionContext';
import { OrderDetail } from './OrderDetail';
import { CustomerForm } from '../components/CustomerForm';
import { useCustomers } from '../lib/queries';
import { formatPhone, type CustomerDTO } from '@bitebrew/shared';

interface CartLine { key: string; product: ProductDTO; quantity: number; modifierIds: string[]; notes: string }

const unitPrice = (p: ProductDTO, modifierIds: string[]) =>
  p.priceMinor + p.modifierGroups.flatMap((g) => g.options).filter((o) => modifierIds.includes(o.id)).reduce((s, o) => s + o.priceDeltaMinor, 0);

// ─────────── options picker ───────────
function OptionsDialog({ product, onAdd, onClose }: { product: ProductDTO; onAdd: (modifierIds: string[], notes: string) => void; onClose: () => void }) {
  const fmt = useFormat();
  const [chosen, setChosen] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const invalid = product.modifierGroups.find((g) => {
    const n = g.options.filter((o) => chosen.includes(o.id)).length;
    return n < g.minSelect || n > g.maxSelect;
  });
  return (
    <Modal title={product.name} onClose={onClose}
      footer={<><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn gold" disabled={!!invalid} onClick={() => onAdd(chosen, notes)} data-testid="options-add">Add · {fmt.money(unitPrice(product, chosen))}</button></>}>
      {product.modifierGroups.map((g) => (
        <div key={g.id} className="stack" style={{ gap: 8 }}>
          <b>{g.name} <span className="muted small">{g.minSelect ? `choose ${g.minSelect === g.maxSelect ? g.minSelect : `${g.minSelect}–${g.maxSelect}`}` : `optional, up to ${g.maxSelect}`}</span></b>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {g.options.filter((o) => o.isAvailable).map((o) => {
              const on = chosen.includes(o.id);
              return (
                <button key={o.id} type="button" className={`btn ${on ? '' : 'secondary'}`} aria-pressed={on} onClick={() => {
                  const inGroup = chosen.filter((id) => g.options.some((x) => x.id === id));
                  if (on) setChosen(chosen.filter((id) => id !== o.id));
                  else if (g.maxSelect === 1) setChosen([...chosen.filter((id) => !inGroup.includes(id)), o.id]);
                  else if (inGroup.length < g.maxSelect) setChosen([...chosen, o.id]);
                }}>
                  {o.name}{o.priceDeltaMinor ? ` ${o.priceDeltaMinor > 0 ? '+' : ''}${fmt.money(o.priceDeltaMinor)}` : ''}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <Field label="Note for kitchen / barista" htmlFor="opt-note"><input id="opt-note" className="input" maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. no onion, extra hot" /></Field>
    </Modal>
  );
}

// ─────────── payment ───────────
export function PaymentDialog({ order, onClose, onDone, offlineQueued }: { order: OrderDTO | null; offlineQueued?: { totalMinor: number; onCash: (tendered: number | null) => void }; onClose: () => void; onDone?: (o: OrderDTO, change: number) => void }) {
  const fmt = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const methods = usePaymentMethods();
  const due = order ? order.dueMinor : offlineQueued!.totalMinor;
  const [method, setMethod] = useState<PaymentMethodDTO | null>(null);
  const [amount, setAmount] = useState<number | null>(due);
  const [tendered, setTendered] = useState<number | null>(null);
  const [reference, setReference] = useState('');
  const [key, setKey] = useState(requestId);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ order: OrderDTO; change: number } | null>(null);
  useEffect(() => setAmount(due), [due]);
  useEffect(() => { if (methods.data) cacheMethods(methods.data); }, [methods.data]);
  const active = (methods.data ?? cachedMethods()).filter((m) => m.isActive && (!offlineQueued || m.kind === 'CASH'));
  useEffect(() => { if (!method && active.length) setMethod(active[0]!); }, [active, method]);
  const isCash = method?.kind === 'CASH';
  const change = isCash && tendered && amount ? Math.max(0, tendered - amount) : 0;
  const pay = useMutation({
    mutationFn: () => post<{ order: OrderDTO; changeMinor: number }>(`/orders/${order!.id}/payments`, { methodId: method!.id, amountMinor: amount, tenderedMinor: isCash ? tendered : null, reference: reference || null, idempotencyKey: key }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['cash'] });
      setKey(requestId());
      setReference('');
      setTendered(null);
      if (r.order.dueMinor === 0) { setResult({ order: r.order, change: r.changeMinor }); onDone?.(r.order, r.changeMinor); }
      else toast('success', `Payment added. ${fmt.money(r.order.dueMinor)} still due.`);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  if (result) {
    return (
      <Modal title="Payment complete" onClose={onClose} footer={<button className="btn gold" onClick={onClose} data-testid="payment-done">New order</button>}>
        <div className="stack" style={{ alignItems: 'center', textAlign: 'center', gap: 10 }} data-testid="payment-complete">
          <span className="badge ok" style={{ fontSize: '1rem' }}>Order #{result.order.orderNo} paid</span>
          {result.change > 0 && <><span className="muted">Give change</span><span style={{ font: '800 2.4rem var(--font-num)' }} data-testid="change-due">{fmt.money(result.change)}</span></>}
          <span className="muted small">The receipt is sent to the receipt printer.</span>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title={order ? `Payment · Order #${order.orderNo}` : 'Payment (offline — cash only)'} onClose={onClose}
      footer={<>
        <button className="btn secondary" onClick={onClose}>{order && order.paidMinor > 0 ? 'Close' : 'Pay later'}</button>
        <button className="btn gold" style={{ minWidth: 160 }} data-testid="payment-confirm"
          disabled={pay.isPending || !method || !amount || amount > due || (isCash && !!tendered && tendered < (amount ?? 0)) || (!!method?.requiresReference && !reference)}
          onClick={() => {
            setError(null);
            if (offlineQueued) offlineQueued.onCash(tendered);
            else pay.mutate();
          }}>
          {pay.isPending ? 'Saving…' : `Take ${fmt.money(amount ?? 0)}`}
        </button>
      </>}>
      {error && <div className="alert error" role="alert">{error}</div>}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted">Due</span>
        <b style={{ font: '800 1.8rem var(--font-num)' }} data-testid="payment-due">{fmt.money(due)}</b>
      </div>
      {order && order.payments.length > 0 && <p className="small muted">Already paid: {order.payments.map((p) => `${p.methodName} ${fmt.money(p.amountMinor)}`).join(', ')}</p>}
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }} role="group" aria-label="Payment method">
        {active.map((m) => (
          <button key={m.id} type="button" className={`btn ${method?.id === m.id ? '' : 'secondary'}`} style={{ minWidth: 100 }} aria-pressed={method?.id === m.id} onClick={() => setMethod(m)} data-testid={`pay-${m.name}`}>{m.name}</button>
        ))}
      </div>
      <Field label="Amount (less than due = split payment)" htmlFor="pay-amount"><MoneyInput id="pay-amount" value={amount} onChange={setAmount} symbol={fmt.currency.currencySymbol} testId="pay-amount" /></Field>
      {isCash && (
        <>
          <Field label="Cash given (optional — calculates change)" htmlFor="pay-tendered"><MoneyInput id="pay-tendered" value={tendered} onChange={setTendered} symbol={fmt.currency.currencySymbol} testId="pay-tendered" /></Field>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {[amount ?? 0, 50000, 100000, 200000].filter((v, i, a) => v >= (amount ?? 0) && a.indexOf(v) === i).map((v) => (
              <button key={v} type="button" className="btn sm secondary" onClick={() => setTendered(v)}>{v === amount ? 'Exact' : fmt.money(v)}</button>
            ))}
          </div>
          {change > 0 && <p>Change: <b className="num" style={{ fontSize: '1.3rem' }}>{fmt.money(change)}</b></p>}
        </>
      )}
      {method?.requiresReference && (
        <Field label={`${method.name} transaction ID`} htmlFor="pay-ref" hint="Required — from the customer's confirmation SMS/app"><input id="pay-ref" className="input" maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} data-testid="pay-reference" /></Field>
      )}
      {method?.kind === 'CARD' && <p className="small muted">Never type card numbers. Take the payment on the card machine, then confirm here.</p>}
    </Modal>
  );
}

// ─────────── regular customer picker ───────────
function CustomerPicker({ value, onChange, disabled }: { value: CustomerDTO | null; onChange: (c: CustomerDTO | null) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const list = useCustomers(q.trim(), false, open);
  if (disabled) return null;
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="customer-picker">
      {value ? (
        <div className="row chosen-customer">
          <div style={{ flex: 1, minWidth: 0 }}><b>{value.name}</b><div className="small muted num">{formatPhone(value.phone)} · {value.visits} visit(s)</div></div>
          <button className="btn sm ghost" onClick={() => onChange(null)} aria-label="Remove customer">Remove</button>
        </div>
      ) : (
        <button className="btn secondary sm" onClick={() => setOpen(true)} data-testid="customer-choose">+ Regular customer (optional)</button>
      )}
      {open && (
        <Modal title="Choose a customer" onClose={() => setOpen(false)} footer={<button className="btn gold" onClick={() => setAdding(true)} data-testid="customer-add-new">New customer</button>}>
          <input className="input" autoFocus placeholder="Type a name or phone number…" aria-label="Search customers" value={q} onChange={(e) => setQ(e.target.value)} data-testid="customer-pick-search" />
          <div className="stack" style={{ gap: 6, maxHeight: 320, overflowY: 'auto' }}>
            {list.isPending ? <Loading /> : (list.data ?? []).length === 0 ? <div className="empty small">No match. Add them as a new customer.</div> : (list.data ?? []).map((c) => (
              <button key={c.id} className="btn secondary" style={{ justifyContent: 'space-between' }} onClick={() => { onChange(c); setOpen(false); setQ(''); }} data-testid="customer-option">
                <span>{c.name}</span><span className="num muted small">{formatPhone(c.phone)}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {adding && <CustomerForm initial={null} presetPhone={/^[\d+\s-]{4,}$/.test(q) ? q : undefined} onClose={() => setAdding(false)} onSaved={(c) => { onChange(c); setOpen(false); setQ(''); }} />}
    </div>
  );
}

// ─────────── cash drawer ───────────
function DrawerButton() {
  const fmt = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = useAuth();
  const session = useCashSession();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const isOpen = !!session.data;
  const m = useMutation({
    mutationFn: () => (isOpen ? post('/cash/close', { countedCashMinor: amount ?? 0, notes }) : post('/cash/open', { openingFloatMinor: amount ?? 0 })),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['cash'] }); toast('success', isOpen ? 'Drawer closed' : 'Drawer opened'); setOpen(false); setAmount(null); },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const s = session.data;
  return (
    <>
      <button className={`btn sm ${isOpen ? 'secondary' : 'gold'}`} onClick={() => setOpen(true)} data-testid="drawer-button">
        {isOpen ? `Drawer open · ${fmt.money(s!.expectedCashMinor)}` : 'Open cash drawer'}
      </button>
      {open && (
        <Modal title={isOpen ? 'Close cash drawer' : 'Open cash drawer'} onClose={() => setOpen(false)}
          footer={<><button className="btn secondary" onClick={() => setOpen(false)}>Cancel</button>{(!isOpen || can('cash.reconcile')) && <button className="btn" disabled={amount === null || m.isPending} onClick={() => m.mutate()}>{isOpen ? 'Close drawer' : 'Open drawer'}</button>}</>}>
          {isOpen && s ? (
            <>
              <dl className="kv">
                <dt>Opened</dt><dd>{fmt.dateTime(s.openedAt)} by {s.openedBy}</dd>
                <dt>Opening float</dt><dd className="num">{fmt.money(s.openingFloatMinor)}</dd>
                <dt>Cash sales</dt><dd className="num">{fmt.money(s.cashSalesMinor)}</dd>
                <dt>Cash refunds</dt><dd className="num">−{fmt.money(s.cashRefundsMinor)}</dd>
                <dt>Expected in drawer</dt><dd className="num" style={{ fontSize: '1.2rem' }}>{fmt.money(s.expectedCashMinor)}</dd>
              </dl>
              {can('cash.reconcile') ? (
                <>
                  <Field label="Cash counted" htmlFor="drawer-count"><MoneyInput id="drawer-count" value={amount} onChange={setAmount} symbol={fmt.currency.currencySymbol} /></Field>
                  {amount !== null && <p>Difference: <b className="num" style={{ color: amount - s.expectedCashMinor === 0 ? 'var(--success)' : 'var(--danger)' }}>{fmt.money(amount - s.expectedCashMinor)}</b></p>}
                  <Field label="Notes" htmlFor="drawer-notes"><input id="drawer-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
                </>
              ) : <div className="alert info">A manager or the owner closes the drawer and counts the cash.</div>}
            </>
          ) : (
            <Field label="Opening float (cash in the drawer now)" htmlFor="drawer-float"><MoneyInput id="drawer-float" value={amount} onChange={setAmount} symbol={fmt.currency.currencySymbol} /></Field>
          )}
        </Modal>
      )}
    </>
  );
}

// ─────────── page ───────────
type PosTab = 'new' | 'open' | 'held' | 'today';

export function PosPage() {
  const fmt = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = useAuth();
  const conn = useConnection();
  const settings = useSettings();
  const productsQ = useProducts(false);
  const taxRates = useTaxRates();
  const [tab, setTab] = useState<PosTab>('new');
  const today = useOrders({}, tab !== 'new');
  const active = useOrders({ status: 'ACTIVE' });
  const [group, setGroup] = useState<string>('ALL');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [serviceType, setServiceType] = useState<ServiceType>('TAKEAWAY');
  const [tableNo, setTableNo] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [discount, setDiscount] = useState<{ type: 'PERCENT' | 'AMOUNT'; value: number; reason: string } | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [picking, setPicking] = useState<ProductDTO | null>(null);
  const [paying, setPaying] = useState<OrderDTO | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [resumeFrom, setResumeFrom] = useState<OrderDTO | null>(null);
  const [customer, setCustomer] = useState<CustomerDTO | null>(null);
  const [submitKey, setSubmitKey] = useState(requestId);
  const [queued, setQueued] = useState(queuedOrders().length);
  const [offlinePay, setOfflinePay] = useState<QueuedOrder | null>(null);
  const [allowOffline] = useState(offlineAllowed());
  const offline = conn.status === 'OFFLINE';

  // Keep a copy of the menu on this device so an authorised till can take orders offline.
  useEffect(() => { if (productsQ.data) cacheMenu(productsQ.data); }, [productsQ.data]);
  const products = productsQ.data ?? (offline ? cachedMenu()?.products ?? [] : []);
  useEffect(() => {
    const onQ = () => setQueued(queuedOrders().length);
    window.addEventListener('bb:queue-changed', onQ);
    return () => window.removeEventListener('bb:queue-changed', onQ);
  }, []);
  // Upload offline orders as soon as the connection is back.
  useEffect(() => {
    if (conn.status === 'ONLINE' && queuedOrders().length) {
      syncQueue().then((r) => {
        if (r.sent) toast('success', `${r.sent} offline order(s) uploaded${r.flagged ? ` — ${r.flagged} need a manager's review (stock ran out)` : ''}`);
        void qc.invalidateQueries();
      }).catch(() => undefined);
    }
  }, [conn.status, qc, toast]);

  const groups = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of products) seen.set(p.categoryId, p.categoryName);
    return [...seen.entries()];
  }, [products]);
  const visible = products.filter((p) => p.isActive && (group === 'ALL' || p.categoryId === group));
  const inCart = (id: string) => cart.filter((l) => l.product.id === id).reduce((s, l) => s + l.quantity, 0);
  const lineTotals = cart.map((l) => unitPrice(l.product, l.modifierIds) * l.quantity);
  const subtotal = lineTotals.reduce((a, b) => a + b, 0);
  const totals = priceOrder(lineTotals, discountFrom(discount, subtotal), (taxRates.data ?? []).filter((t) => t.isActive));
  const tableCount = settings.data?.tableCount ?? 12;

  const add = (p: ProductDTO, modifierIds: string[] = [], notes = '') => {
    if (p.available !== null && inCart(p.id) + 1 > p.available) { toast('error', `Only ${p.available} ${p.name} left`); return; }
    setCart((c) => {
      const same = c.find((l) => l.product.id === p.id && l.notes === notes && l.modifierIds.join() === modifierIds.join());
      return same ? c.map((l) => (l === same ? { ...l, quantity: l.quantity + 1 } : l)) : [...c, { key: requestId(), product: p, quantity: 1, modifierIds, notes }];
    });
  };
  const reset = () => { setCustomer(null); setCart([]); setOrderNotes(''); setDiscount(null); setTableNo(''); setResumeFrom(null); setSubmitKey(requestId()); };

  const place = useMutation({
    mutationFn: (hold: boolean) => post<{ order: OrderDTO }>('/orders', {
      clientRequestId: submitKey, serviceType, tableNo: serviceType === 'DINE_IN' ? tableNo : null, notes: orderNotes || undefined, hold, customerId: customer?.id,
      discount: discount ?? undefined, replacesHeldOrderId: resumeFrom?.id,
      lines: cart.map((l) => ({ productId: l.product.id, quantity: l.quantity, modifierIds: l.modifierIds, notes: l.notes || undefined })),
    }),
    onSuccess: ({ order }, hold) => {
      reset();
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
      if (hold) toast('success', `Order #${order.orderNo} held`);
      else { toast('success', `Order #${order.orderNo} sent`); if (order.dueMinor > 0) setPaying(order); }
    },
    onError: (e, hold) => {
      if (e instanceof NetworkError && !hold && allowOffline) return queueOffline();
      toast('error', e instanceof ApiError && e.code === 'INSUFFICIENT_STOCK' ? `${e.message}: ${(e.details as { shortages: { name: string; onHand: number }[] }).shortages.map((s) => `${s.name} (${s.onHand} left)`).join(', ')}` : errorMessage(e));
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
  });

  function queueOffline() {
    const q: QueuedOrder = {
      clientRequestId: submitKey, serviceType, tableNo: serviceType === 'DINE_IN' ? tableNo : null, notes: orderNotes || undefined, customerId: customer?.id, customerName: customer?.name,
      lines: cart.map((l) => ({ productId: l.product.id, quantity: l.quantity, modifierIds: l.modifierIds, notes: l.notes || undefined, name: l.product.name, unitPriceMinor: unitPrice(l.product, l.modifierIds) })),
      offlinePlacedAt: new Date().toISOString(), totalMinor: totals.totalMinor, payments: [], localNo: `OFF-${String(queuedOrders().length + 1).padStart(3, '0')}`,
    };
    setOfflinePay(q);
  }
  const canSend = cart.length > 0 && (serviceType === 'TAKEAWAY' || tableNo);

  return (
    <div className="pos" data-testid="pos-page">
      <h1 className="sr-only">Point of sale</h1>
      <div className="pos-head">
        <Tabs<PosTab> value={tab} onChange={setTab} tabs={[
          { id: 'new', label: resumeFrom ? `Resume #${resumeFrom.orderNo}` : 'New order' },
          { id: 'open', label: `Open (${(active.data?.orders ?? []).filter((o) => o.status === 'OPEN').length})` },
          { id: 'held', label: `Held (${(active.data?.orders ?? []).filter((o) => o.status === 'HELD').length})` },
          { id: 'today', label: "Today's orders" },
        ]} />
        <span className="spacer" />
        {queued > 0 && <button className="btn sm secondary" onClick={() => syncQueue().then((r) => toast('success', `${r.sent} uploaded`)).catch(() => toast('error', 'Still offline'))} data-testid="queued-orders">{queued} offline order(s) waiting</button>}
        {!offline && <DrawerButton />}
      </div>
      {offline && (
        <div className={`alert ${allowOffline ? 'warn' : 'error'}`} data-testid="pos-offline">
          {allowOffline
            ? 'OFFLINE MODE — orders are kept on this till and sent automatically when the connection returns. Cash only. Stock counts may be out of date.'
            : 'OFFLINE — this till is not allowed to take orders without a connection. A manager can allow it in Settings → This device.'}
        </div>
      )}

      {tab === 'new' && (
        <div className="pos-grid">
          <section className="pos-menu">
            <div className="chips" role="group" aria-label="Categories">
              <button aria-pressed={group === 'ALL'} onClick={() => setGroup('ALL')}>All</button>
              {groups.map(([id, name]) => <button key={id} aria-pressed={group === id} onClick={() => setGroup(id)}>{name}</button>)}
            </div>
            {productsQ.isPending && !offline ? <Loading /> : visible.length === 0 ? (
              <div className="empty">No menu items yet. Add them under Menu items.</div>
            ) : (
              <div className="tiles">
                {visible.map((p) => {
                  const left = p.available === null ? null : p.available - inCart(p.id);
                  const out = !p.isAvailable || (left !== null && left <= 0);
                  return (
                    <button key={p.id} className={`tile ${out ? 'out' : ''}`} disabled={out || (offline && !allowOffline)} data-testid="pos-tile"
                      onClick={() => (p.modifierGroups.length ? setPicking(p) : add(p))}>
                      <span className="tile-name">{p.name}</span>
                      <span className="tile-price num">{fmt.money(p.priceMinor)}</span>
                      <span className={`tile-left ${out ? 'out' : left !== null && left <= 5 ? 'low' : ''}`}>
                        {!p.isAvailable ? 'Off' : left === null ? MENU_GROUP_LABELS[p.group] : out ? 'Sold out' : `${left} left`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <aside className="pos-cart card">
            <div className="segmented" role="group" aria-label="Service type" style={{ width: '100%' }}>
              {(['TAKEAWAY', 'DINE_IN'] as ServiceType[]).filter((t) => (t === 'DINE_IN' ? settings.data?.dineInEnabled !== false : settings.data?.takeawayEnabled !== false)).map((t) => (
                <button key={t} style={{ flex: 1 }} aria-pressed={serviceType === t} onClick={() => setServiceType(t)} data-testid={`service-${t}`}>{SERVICE_LABELS[t]}</button>
              ))}
            </div>
            {serviceType === 'DINE_IN' && (
              tableCount > 0 ? (
                <div className="table-picker" role="group" aria-label="Table">
                  {Array.from({ length: tableCount }, (_, i) => String(i + 1)).map((t) => (
                    <button key={t} aria-pressed={tableNo === t} onClick={() => setTableNo(t)} data-testid={`table-${t}`}>{t}</button>
                  ))}
                </div>
              ) : <input className="input" placeholder="Table number" value={tableNo} onChange={(e) => setTableNo(e.target.value.slice(0, 10))} />
            )}
            <div className="cart-lines" data-testid="cart">
              {cart.length === 0 ? <div className="empty small">Tap items to add them.</div> : cart.map((l) => (
                <div key={l.key} className="cart-line">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b>{l.product.name}</b>
                    {l.modifierIds.length > 0 && <div className="small muted">{l.product.modifierGroups.flatMap((g) => g.options).filter((o) => l.modifierIds.includes(o.id)).map((o) => o.name).join(', ')}</div>}
                    {l.notes && <div className="small" style={{ color: 'var(--warning)' }}>Note: {l.notes}</div>}
                    <div className="small num muted">{fmt.money(unitPrice(l.product, l.modifierIds))} each</div>
                  </div>
                  <div className="qty">
                    <button aria-label="Less" onClick={() => setCart(cart.flatMap((x) => (x === l ? (x.quantity > 1 ? [{ ...x, quantity: x.quantity - 1 }] : []) : [x])))}>−</button>
                    <span className="num">{l.quantity}</span>
                    <button aria-label="More" onClick={() => add(l.product, l.modifierIds, l.notes)}>+</button>
                  </div>
                  <b className="num" style={{ minWidth: 76, textAlign: 'right' }}>{fmt.money(unitPrice(l.product, l.modifierIds) * l.quantity)}</b>
                </div>
              ))}
            </div>
            <CustomerPicker value={customer} onChange={setCustomer} disabled={offline} />
            <input className="input" placeholder="Order note (optional)" value={orderNotes} maxLength={300} onChange={(e) => setOrderNotes(e.target.value)} />
            <div className="totals">
              <div><span>Subtotal</span><span className="num">{fmt.money(totals.subtotalMinor)}</span></div>
              {totals.discountMinor > 0 && <div><span>Discount ({discount?.reason})</span><span className="num">−{fmt.money(totals.discountMinor)}</span></div>}
              {totals.taxes.map((t) => <div key={t.id}><span>{t.name} {t.rateBp / 100}%{t.inclusive ? ' incl.' : ''}</span><span className="num">{fmt.money(t.amountMinor)}</span></div>)}
              <div className="grand"><span>Total</span><span className="num" data-testid="cart-total">{fmt.money(totals.totalMinor)}</span></div>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {can('orders.discount') && !offline && <button className="btn secondary sm" disabled={!cart.length} onClick={() => setDiscountOpen(true)}>{discount ? 'Edit discount' : 'Discount'}</button>}
              {cart.length > 0 && <button className="btn ghost sm" onClick={reset}>Clear</button>}
              <span className="spacer" />
              {!offline && <button className="btn secondary" disabled={!canSend || place.isPending} onClick={() => place.mutate(true)} data-testid="hold-order">Hold</button>}
            </div>
            <button className="btn gold" style={{ minHeight: 60, fontSize: '1.15rem' }} disabled={!canSend || place.isPending || (offline && !allowOffline)}
              onClick={() => (offline ? queueOffline() : place.mutate(false))} data-testid="send-order">
              {place.isPending ? 'Sending…' : `Send & pay · ${fmt.money(totals.totalMinor)}`}
            </button>
          </aside>
        </div>
      )}

      {tab !== 'new' && (
        <div className="card">
          {(tab === 'today' ? today : active).isPending ? <Loading /> : (
            <div className="table-wrap">
              <table className="table" data-testid="orders-table">
                <thead><tr><th>#</th><th>Time</th><th>Type</th><th>Items</th><th className="text-right">Total</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {((tab === 'today' ? today.data?.orders : active.data?.orders) ?? []).filter((o) => tab === 'today' || o.status === (tab === 'open' ? 'OPEN' : 'HELD')).map((o) => (
                    <tr key={o.id} data-testid="order-row">
                      <td className="num"><b>{o.orderNo}</b>{o.placedOffline && <span className="badge warn" style={{ marginLeft: 6 }}>offline</span>}{o.needsReview && <span className="badge bad" style={{ marginLeft: 6 }}>review</span>}</td>
                      <td className="small num">{fmt.dateTime(o.createdAt).split(', ').pop()}</td>
                      <td className="small">{SERVICE_LABELS[o.serviceType]}{o.tableNo ? ` · T${o.tableNo}` : ''}</td>
                      <td className="small" style={{ maxWidth: 280 }}>{o.lines.map((l) => `${l.quantity}× ${l.name}`).join(', ')}</td>
                      <td className="num text-right"><b>{fmt.money(o.totalMinor)}</b>{o.dueMinor > 0 && o.status !== 'HELD' && <div className="small" style={{ color: 'var(--danger)' }}>due {fmt.money(o.dueMinor)}</div>}</td>
                      <td><StatusBadge o={o} /></td>
                      <td className="text-right" style={{ whiteSpace: 'nowrap' }}>
                        {o.status === 'HELD' && <button className="btn sm" onClick={() => {
                          setResumeFrom(o); setServiceType(o.serviceType); setTableNo(o.tableNo ?? ''); setOrderNotes(o.notes);
                          setCart(o.lines.flatMap((l) => { const p = products.find((x) => x.id === l.productId); return p ? [{ key: requestId(), product: p, quantity: l.quantity, modifierIds: l.modifiers.map((m) => m.id), notes: l.notes }] : []; }));
                          setSubmitKey(requestId()); setTab('new');
                        }}>Resume</button>}
                        {o.status === 'OPEN' && o.dueMinor > 0 && <button className="btn sm gold" onClick={() => setPaying(o)}>Pay</button>}{' '}
                        <button className="btn sm secondary" onClick={() => setViewing(o.id)}>Details</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {picking && <OptionsDialog product={picking} onClose={() => setPicking(null)} onAdd={(ids, notes) => { add(picking, ids, notes); setPicking(null); }} />}
      {paying && <PaymentDialog order={paying} onClose={() => { setPaying(null); void qc.invalidateQueries({ queryKey: ['orders'] }); }} />}
      {viewing && <OrderDetail orderId={viewing} onClose={() => setViewing(null)} onPay={(o) => { setViewing(null); setPaying(o); }} />}
      {offlinePay && (
        <PaymentDialog order={null} onClose={() => setOfflinePay(null)} offlineQueued={{
          totalMinor: offlinePay.totalMinor,
          onCash: (tendered) => {
            const cashId = queryClientCashId(qc);
            const q = { ...offlinePay, payments: cashId ? [{ methodId: cashId, amountMinor: offlinePay.totalMinor, tenderedMinor: tendered, idempotencyKey: requestId() }] : [] };
            try {
              enqueueOrder(q);
              toast('success', `Saved offline as ${q.localNo}${tendered ? ` · change ${fmt.money(Math.max(0, tendered - q.totalMinor))}` : ''}. It will be sent when the connection returns.`);
              reset();
            } catch (e) { toast('error', (e as Error).message); }
            setOfflinePay(null);
          },
        }} />
      )}
      {discountOpen && <DiscountDialog initial={discount} subtotal={subtotal} onClose={() => setDiscountOpen(false)} onSave={(d) => { setDiscount(d); setDiscountOpen(false); }} />}
    </div>
  );
}

function queryClientCashId(qc: ReturnType<typeof useQueryClient>) {
  const methods = qc.getQueryData<PaymentMethodDTO[]>(['payment-methods']) ?? cachedMethods();
  return methods.find((m) => m.kind === 'CASH' && m.isActive)?.id ?? null;
}

export function StatusBadge({ o }: { o: OrderDTO }) {
  if (o.status === 'CANCELLED') return <span className="badge bad">Cancelled</span>;
  if (o.status === 'HELD') return <span className="badge neutral">Held</span>;
  const pay = { UNPAID: ['warn', 'Unpaid'], PARTIALLY_PAID: ['warn', 'Part paid'], PAID: ['ok', 'Paid'], PARTIALLY_REFUNDED: ['gold', 'Part refunded'], REFUNDED: ['bad', 'Refunded'] }[o.paymentStatus] as [string, string];
  return <span className={`badge ${pay[0]}`}>{pay[1]}</span>;
}

function DiscountDialog({ initial, subtotal, onClose, onSave }: { initial: { type: 'PERCENT' | 'AMOUNT'; value: number; reason: string } | null; subtotal: number; onClose: () => void; onSave: (d: { type: 'PERCENT' | 'AMOUNT'; value: number; reason: string } | null) => void }) {
  const fmt = useFormat();
  const [type, setType] = useState<'PERCENT' | 'AMOUNT'>(initial?.type ?? 'PERCENT');
  const [pct, setPct] = useState(initial?.type === 'PERCENT' ? String(initial.value) : '10');
  const [amt, setAmt] = useState<number | null>(initial?.type === 'AMOUNT' ? initial.value : null);
  const [reason, setReason] = useState(initial?.reason ?? '');
  const value = type === 'PERCENT' ? Number(pct) : amt ?? 0;
  return (
    <Modal title="Discount" onClose={onClose} footer={<>
      {initial && <button className="btn ghost" onClick={() => onSave(null)}>Remove discount</button>}
      <button className="btn secondary" onClick={onClose}>Cancel</button>
      <button className="btn" disabled={!reason.trim() || !(value > 0)} onClick={() => onSave({ type, value, reason: reason.trim() })}>Apply</button></>}>
      <div className="segmented"><button aria-pressed={type === 'PERCENT'} onClick={() => setType('PERCENT')}>Percent</button><button aria-pressed={type === 'AMOUNT'} onClick={() => setType('AMOUNT')}>Amount</button></div>
      {type === 'PERCENT' ? (
        <Field label="Percent off" htmlFor="disc-pct"><input id="disc-pct" className="input num" inputMode="decimal" value={pct} onChange={(e) => /^\d{0,3}(\.\d{0,2})?$/.test(e.target.value) && setPct(e.target.value)} /></Field>
      ) : (
        <Field label="Amount off" htmlFor="disc-amt"><MoneyInput id="disc-amt" value={amt} onChange={setAmt} symbol={fmt.currency.currencySymbol} /></Field>
      )}
      <p className="muted">= {fmt.money(discountFrom({ type, value: type === 'PERCENT' ? value : value }, subtotal))} off</p>
      <Field label="Reason (required)" htmlFor="disc-reason"><input id="disc-reason" className="input" maxLength={120} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Regular customer, staff meal" /></Field>
    </Modal>
  );
}
