import { utcOffset, type PaymentKind, type ReportDTO } from '@bitebrew/shared';
import { prisma } from '../../lib/prisma.js';
import { getSettings } from '../settings/service.js';

export const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

/** UTC instants covering business days [from, to] in the café's timezone and day-start hour. */
export function businessRangeToUtc(from: string, to: string, tz: string, startHour: number) {
  const at = (d: string) => {
    const offset = utcOffset(tz, new Date(`${d}T12:00:00Z`));
    return new Date(`${d}T${String(startHour).padStart(2, '0')}:00:00${offset}`);
  };
  return { start: at(from), end: at(addDays(to, 1)) };
}

function periodKey(date: string, granularity: 'day' | 'week' | 'month') {
  if (granularity === 'day') return date;
  if (granularity === 'month') return date.slice(0, 7);
  const t = new Date(`${date}T00:00:00Z`);
  const dow = (t.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(date, -dow); // week starting Monday
}

export async function buildReport(from: string, to: string, granularity?: 'day' | 'week' | 'month'): Promise<ReportDTO> {
  const s = await getSettings();
  const { start, end } = businessRangeToUtc(from, to, s.timezone, s.businessDayStartHour);
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const gran = granularity ?? (days <= 31 ? 'day' : days <= 120 ? 'week' : 'month');

  const [orders, cancelled, payments, refunds, expenses, ingMoves, finMoves, wastedLines] = await Promise.all([
    prisma.order.findMany({ where: { businessDate: { gte: from, lte: to }, status: { in: ['OPEN', 'COMPLETED'] } }, include: { lines: true } }),
    prisma.order.count({ where: { businessDate: { gte: from, lte: to }, status: 'CANCELLED', sentAt: { not: null } } }),
    prisma.payment.findMany({ where: { createdAt: { gte: start, lt: end } } }),
    prisma.refund.findMany({ where: { createdAt: { gte: start, lt: end } } }),
    prisma.expense.findMany({ where: { businessDate: { gte: from, lte: to }, voidedAt: null }, include: { category: true } }),
    prisma.stockMovement.findMany({ where: { occurredAt: { gte: start, lt: end }, type: { in: ['RECEIVE', 'WASTE', 'SPOILAGE', 'ADJUSTMENT', 'COUNT'] } } }),
    prisma.finishedMovement.findMany({ where: { occurredAt: { gte: start, lt: end }, type: { in: ['RECEIVE', 'WASTE', 'SPOILAGE', 'ADJUSTMENT', 'COUNT'] } } }),
    prisma.orderLine.findMany({ where: { stockState: 'WASTED', order: { cancelledAt: { gte: start, lt: end } } } }),
  ]);

  const lines = orders.flatMap((o) => o.lines.filter((l) => l.prepStatus !== 'CANCELLED').map((l) => ({ ...l, businessDate: o.businessDate })));
  const grossSales = orders.reduce((a, o) => a + o.subtotalMinor, 0);
  const discounts = orders.reduce((a, o) => a + o.discountMinor, 0);
  const tax = orders.reduce((a, o) => a + o.taxMinor, 0);
  const refundsTotal = refunds.reduce((a, r) => a + r.amountMinor, 0);
  const netSales = orders.reduce((a, o) => a + o.totalMinor - o.taxMinor, 0) - refundsTotal;
  const cogs = lines.reduce((a, l) => a + l.costMinor, 0);
  const lossMoves = [...ingMoves, ...finMoves].filter((m) => m.type !== 'RECEIVE' && m.valueMinor < 0n);
  const gains = [...ingMoves, ...finMoves].filter((m) => m.type !== 'RECEIVE' && m.valueMinor > 0n);
  const losses = Number(lossMoves.reduce((a, m) => a - m.valueMinor, 0n) - gains.reduce((a, m) => a + m.valueMinor, 0n)) + wastedLines.reduce((a, l) => a + l.costMinor, 0);
  const purchases = Number([...ingMoves, ...finMoves].filter((m) => m.type === 'RECEIVE').reduce((a, m) => a + m.valueMinor, 0n));
  const expensesTotal = expenses.reduce((a, e) => a + e.amountMinor, 0);
  const grossProfit = netSales - cogs;

  const methodMap = new Map<string, { name: string; kind: PaymentKind; receivedMinor: number; refundedMinor: number }>();
  for (const p of payments) {
    const m = methodMap.get(p.methodName) ?? { name: p.methodName, kind: p.kind, receivedMinor: 0, refundedMinor: 0 };
    m.receivedMinor += p.amountMinor;
    methodMap.set(p.methodName, m);
  }
  for (const r of refunds) {
    const m = methodMap.get(r.methodName) ?? { name: r.methodName, kind: r.kind, receivedMinor: 0, refundedMinor: 0 };
    m.refundedMinor += r.amountMinor;
    methodMap.set(r.methodName, m);
  }
  const group = <K extends string>(items: { key: K; q: number; v: number }[]) => {
    const m = new Map<K, { quantity: number; revenueMinor: number }>();
    for (const i of items) {
      const cur = m.get(i.key) ?? { quantity: 0, revenueMinor: 0 };
      cur.quantity += i.q;
      cur.revenueMinor += i.v;
      m.set(i.key, cur);
    }
    return [...m.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenueMinor - a.revenueMinor);
  };
  const expMap = new Map<string, number>();
  for (const e of expenses) expMap.set(e.category.name, (expMap.get(e.category.name) ?? 0) + e.amountMinor);

  const series = new Map<string, { period: string; salesMinor: number; orders: number; expensesMinor: number; cogsMinor: number }>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const k = periodKey(d, gran);
    if (!series.has(k)) series.set(k, { period: k, salesMinor: 0, orders: 0, expensesMinor: 0, cogsMinor: 0 });
  }
  for (const o of orders) {
    const p = series.get(periodKey(o.businessDate, gran))!;
    p.salesMinor += o.totalMinor - o.taxMinor;
    p.orders += 1;
    p.cogsMinor += o.lines.filter((l) => l.prepStatus !== 'CANCELLED').reduce((a, l) => a + l.costMinor, 0);
  }
  for (const e of expenses) series.get(periodKey(e.businessDate, gran))!.expensesMinor += e.amountMinor;

  return {
    from, to,
    orders: orders.length,
    itemsSold: lines.reduce((a, l) => a + l.quantity, 0),
    grossSalesMinor: grossSales,
    discountsMinor: discounts,
    taxMinor: tax,
    refundsMinor: refundsTotal,
    netSalesMinor: netSales,
    cogsMinor: cogs,
    grossProfitMinor: grossProfit,
    inventoryLossesMinor: losses,
    expensesMinor: expensesTotal,
    netProfitMinor: grossProfit - expensesTotal - losses,
    inventoryPurchasesMinor: purchases,
    averageOrderMinor: orders.length ? Math.round(orders.reduce((a, o) => a + o.totalMinor, 0) / orders.length) : 0,
    cancelledOrders: cancelled,
    paymentMethods: [...methodMap.values()].map((m) => ({ ...m, netMinor: m.receivedMinor - m.refundedMinor })).sort((a, b) => b.netMinor - a.netMinor),
    categories: group(lines.map((l) => ({ key: l.categoryName, q: l.quantity, v: l.lineTotalMinor }))),
    topItems: group(lines.map((l) => ({ key: l.name, q: l.quantity, v: l.lineTotalMinor }))).slice(0, 10),
    expensesByCategory: [...expMap.entries()].map(([name, amountMinor]) => ({ name, amountMinor })).sort((a, b) => b.amountMinor - a.amountMinor),
    series: [...series.values()],
  };
}
