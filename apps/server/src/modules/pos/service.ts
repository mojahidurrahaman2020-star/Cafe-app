import { randomUUID } from 'node:crypto';
import {
  businessDate, discountFrom, hasPermission, priceOrder,
  type OrderCreateInput, type OrderDTO, type Role,
} from '@bitebrew/shared';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { prisma, type Tx } from '../../lib/prisma.js';
import { consumeForSale, InsufficientStockError, restoreSaleLine } from '../inventory/stock.js';
import { queueJob, receiptPayload, ticketPayload } from '../printing/jobs.js';
import { getSettings } from '../settings/service.js';

export const orderInclude = {
  lines: { orderBy: { sortOrder: 'asc' } },
  payments: { orderBy: { createdAt: 'asc' } },
  refunds: { orderBy: { createdAt: 'asc' } },
} as const;

type OrderRow = NonNullable<Awaited<ReturnType<typeof loadOrder>>>;
export const loadOrder = (id: string, tx: Tx | typeof prisma = prisma) => tx.order.findUnique({ where: { id }, include: orderInclude });

export async function userNames(ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  const users = list.length ? await prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, fullName: true } }) : [];
  return new Map(users.map((u) => [u.id, u.fullName]));
}

export function toOrderDTO(o: OrderRow, names: Map<string, string>): OrderDTO {
  return {
    id: o.id, orderNo: o.orderNo, businessDate: o.businessDate, serviceType: o.serviceType, tableNo: o.tableNo, customerName: o.customerName,
    status: o.status, paymentStatus: o.paymentStatus, subtotalMinor: o.subtotalMinor, discountMinor: o.discountMinor, discountReason: o.discountReason,
    taxMinor: o.taxMinor, totalMinor: o.totalMinor, paidMinor: o.paidMinor, refundedMinor: o.refundedMinor,
    dueMinor: o.status === 'CANCELLED' ? 0 : o.totalMinor - o.paidMinor,
    taxes: o.taxSnapshot as OrderDTO['taxes'], notes: o.notes, placedOffline: o.placedOffline, needsReview: o.needsReview, reviewNote: o.reviewNote,
    createdBy: o.createdById ? names.get(o.createdById) ?? null : null, createdAt: o.createdAt.toISOString(),
    completedAt: o.completedAt?.toISOString() ?? null, cancelledAt: o.cancelledAt?.toISOString() ?? null, cancelReason: o.cancelReason,
    lines: o.lines.map((l) => ({
      id: l.id, productId: l.productId, name: l.name, categoryName: l.categoryName, unitPriceMinor: l.unitPriceMinor, quantity: l.quantity,
      lineTotalMinor: l.lineTotalMinor, modifiers: l.modifiers as never, notes: l.notes, station: l.station, prepStatus: l.prepStatus, stockState: l.stockState,
    })),
    payments: o.payments.map((p) => ({
      id: p.id, methodId: p.methodId, methodName: p.methodName, kind: p.kind, amountMinor: p.amountMinor, tenderedMinor: p.tenderedMinor,
      changeMinor: p.changeMinor, reference: p.reference, receivedBy: p.receivedById ? names.get(p.receivedById) ?? null : null, createdAt: p.createdAt.toISOString(),
    })),
    refunds: o.refunds.map((r) => ({ id: r.id, methodName: r.methodName, amountMinor: r.amountMinor, reason: r.reason, approvedBy: r.approvedById ? names.get(r.approvedById) ?? null : null, createdAt: r.createdAt.toISOString() })),
    version: o.version,
  };
}

export async function orderDTO(id: string) {
  const o = await loadOrder(id);
  if (!o) throw notFound('Order not found');
  const names = await userNames([o.createdById, ...o.payments.map((p) => p.receivedById), ...o.refunds.map((r) => r.approvedById)]);
  return toOrderDTO(o, names);
}

export async function currentBusinessDate(tx: Tx | typeof prisma = prisma, at = new Date()) {
  const s = await getSettings(tx);
  return businessDate(at, s.timezone, s.businessDayStartHour);
}

async function nextOrderNo(tx: Tx, date: string) {
  // Serialise numbering per business day across all tills.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'order_no:' + date}))`;
  const max = await tx.order.aggregate({ where: { businessDate: date }, _max: { orderNo: true } });
  return (max._max.orderNo ?? 0) + 1;
}

/** Validate items/options and compute line prices on the server (never trust the till's prices). */
async function buildLines(tx: Tx, input: OrderCreateInput, opts: { offline: boolean }) {
  const ids = [...new Set(input.lines.map((l) => l.productId))];
  const products = await tx.product.findMany({ where: { id: { in: ids } }, include: { category: true, modifierGroups: { include: { modifiers: true } } } });
  const map = new Map(products.map((p) => [p.id, p]));
  return input.lines.map((l, idx) => {
    const p = map.get(l.productId);
    if (!p || (!p.isActive && !opts.offline)) throw badRequest('An item in this order is no longer on the menu');
    if (!p) throw badRequest('Unknown item');
    if (!p.isAvailable && !opts.offline) throw new HttpError(409, 'UNAVAILABLE', `${p.name} is switched off`);
    const chosen = l.modifierIds ?? [];
    const all = p.modifierGroups.flatMap((g) => g.modifiers);
    for (const id of chosen) if (!all.some((m) => m.id === id)) throw badRequest(`An option chosen for ${p.name} is not valid`);
    for (const g of p.modifierGroups) {
      const n = g.modifiers.filter((m) => chosen.includes(m.id)).length;
      if (n < g.minSelect) throw badRequest(`${p.name}: choose at least ${g.minSelect} for "${g.name}"`);
      if (n > g.maxSelect) throw badRequest(`${p.name}: choose at most ${g.maxSelect} for "${g.name}"`);
    }
    const modifiers = all.filter((m) => chosen.includes(m.id)).map((m) => ({ id: m.id, name: m.name, priceDeltaMinor: m.priceDeltaMinor }));
    const unit = Math.max(0, p.priceMinor + modifiers.reduce((s, m) => s + m.priceDeltaMinor, 0));
    return {
      id: randomUUID(), product: p, productId: p.id, name: p.name, categoryName: p.category.name, unitPriceMinor: unit, quantity: l.quantity,
      lineTotalMinor: unit * l.quantity, modifiers, modifierIds: chosen, notes: l.notes ?? '', station: p.stationOverride ?? p.category.station, sortOrder: idx,
    };
  });
}

/** Deduct stock for a sent order. Offline-synced orders never fail: shortages are flagged for review. */
async function consumeOrderStock(tx: Tx, orderId: string, lines: { id: string; productId: string; quantity: number; modifierIds: string[] }[], actorId: string | null, offline: boolean) {
  const conflicts: string[] = [];
  if (!offline) {
    const costs = await consumeForSale(tx, lines.map((l) => ({ productId: l.productId, quantity: l.quantity, modifierIds: l.modifierIds, lineId: l.id })), { refType: 'ORDER', refId: orderId, actorId });
    for (const c of costs) {
      await tx.orderLine.update({ where: { id: c.lineId! }, data: { costMinor: Number(c.costMinor), stockState: c.tracked ? 'CONSUMED' : 'NOT_TRACKED' } });
    }
    return conflicts;
  }
  for (const l of lines) {
    try {
      const [c] = await consumeForSale(tx, [{ productId: l.productId, quantity: l.quantity, modifierIds: l.modifierIds, lineId: l.id, allowUnavailable: true }], { refType: 'ORDER', refId: orderId, actorId });
      await tx.orderLine.update({ where: { id: l.id }, data: { costMinor: Number(c!.costMinor), stockState: c!.tracked ? 'CONSUMED' : 'NOT_TRACKED' } });
    } catch (err) {
      // consumeForSale checks everything before changing anything, so a shortage leaves no partial change.
      if (!(err instanceof InsufficientStockError)) throw err;
      const s = (err.details as { shortages: { name: string; onHand: number; required: number }[] }).shortages;
      conflicts.push(s.map((x) => `${x.name}: needed ${x.required}, had ${x.onHand}`).join('; '));
      await tx.orderLine.update({ where: { id: l.id }, data: { stockState: 'CONFLICT' } });
    }
  }
  return conflicts;
}

async function queueTickets(tx: Tx, orderId: string) {
  const o = (await loadOrder(orderId, tx))!;
  const s = await getSettings(tx);
  for (const station of ['KITCHEN', 'BARISTA'] as const) {
    const payload = ticketPayload(o, station, s);
    if (payload) await queueJob(tx, { key: `${orderId}:${station}:TICKET:0`, role: station, kind: 'TICKET', orderId, payload });
  }
}

async function queueReceipt(tx: Tx, orderId: string) {
  const o = (await loadOrder(orderId, tx))!;
  const s = await getSettings(tx);
  await queueJob(tx, { key: `${orderId}:RECEIPT:RECEIPT:0`, role: 'RECEIPT', kind: 'RECEIPT', orderId, payload: receiptPayload(o, s) });
}

export interface Actor { id: string; role: Role }

export async function createOrder(tx: Tx, input: OrderCreateInput, actor: Actor, opts: { offline?: boolean } = {}) {
  const offline = !!opts.offline;
  const existing = await tx.order.findUnique({ where: { clientRequestId: input.clientRequestId } });
  if (existing) return { orderId: existing.id, replayed: true, conflicts: [] as string[] };

  if (input.discount && !hasPermission(actor.role, 'orders.discount')) throw forbidden('Only a manager or the owner can give discounts');
  const settings = await getSettings(tx);
  if (input.serviceType === 'DINE_IN' && !settings.dineInEnabled && !offline) throw badRequest('Dine-in is switched off in settings');
  if (input.serviceType === 'TAKEAWAY' && !settings.takeawayEnabled && !offline) throw badRequest('Takeaway is switched off in settings');

  let reuseNo: { date: string; no: number } | null = null;
  if (input.replacesHeldOrderId) {
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${input.replacesHeldOrderId}::uuid FOR UPDATE`;
    const held = await tx.order.findUnique({ where: { id: input.replacesHeldOrderId } });
    if (!held || held.status !== 'HELD') throw conflict('That held order was already resumed or cancelled on another till');
    reuseNo = { date: held.businessDate, no: held.orderNo };
    await tx.order.delete({ where: { id: held.id } }); // held orders have no stock, payment or ticket effects
  }

  const lines = await buildLines(tx, input, { offline });
  const discount = discountFrom(input.discount ?? null, lines.reduce((s, l) => s + l.lineTotalMinor, 0));
  const rates = await tx.taxRate.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
  const totals = priceOrder(lines.map((l) => l.lineTotalMinor), discount, rates.map((r) => ({ id: r.id, name: r.name, rateBp: r.rateBp, inclusive: r.inclusive })));
  const placedAt = input.offlinePlacedAt ? new Date(input.offlinePlacedAt) : new Date();
  const date = businessDate(placedAt, settings.timezone, settings.businessDayStartHour);
  const orderNo = reuseNo && reuseNo.date === date ? reuseNo.no : await nextOrderNo(tx, date);
  const hold = !!input.hold;

  const order = await tx.order.create({
    data: {
      orderNo, businessDate: date, serviceType: input.serviceType, tableNo: input.serviceType === 'DINE_IN' ? input.tableNo ?? null : null,
      customerName: input.customerName ?? '', status: hold ? 'HELD' : 'OPEN', subtotalMinor: totals.subtotalMinor, discountMinor: totals.discountMinor,
      discountReason: input.discount?.reason ?? null, taxMinor: totals.taxMinor, totalMinor: totals.totalMinor, taxSnapshot: totals.taxes,
      notes: input.notes ?? '', clientRequestId: input.clientRequestId, placedOffline: offline, offlinePlacedAt: offline ? placedAt : null,
      createdById: actor.id, sentAt: hold ? null : new Date(),
      lines: { create: lines.map((l) => ({ id: l.id, productId: l.productId, name: l.name, categoryName: l.categoryName, unitPriceMinor: l.unitPriceMinor, quantity: l.quantity, lineTotalMinor: l.lineTotalMinor, modifiers: l.modifiers, notes: l.notes, station: l.station, sortOrder: l.sortOrder })) },
    },
  });
  let conflicts: string[] = [];
  if (!hold) {
    conflicts = await consumeOrderStock(tx, order.id, lines, actor.id, offline);
    if (conflicts.length) {
      await tx.order.update({ where: { id: order.id }, data: { needsReview: true, reviewNote: `Offline order synced after stock ran out — ${conflicts.join(' | ')}`.slice(0, 300) } });
    }
    await queueTickets(tx, order.id);
    if (totals.totalMinor === 0) {
      await tx.order.update({ where: { id: order.id }, data: { status: 'COMPLETED', paymentStatus: 'PAID', completedAt: new Date() } });
      await queueReceipt(tx, order.id);
    }
  }
  return { orderId: order.id, replayed: false, conflicts };
}

export async function sendHeldOrder(tx: Tx, orderId: string, actor: Actor) {
  await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
  const o = await loadOrder(orderId, tx);
  if (!o) throw notFound('Order not found');
  if (o.status !== 'HELD') throw conflict('This order has already been sent');
  const lines = o.lines.map((l) => ({ id: l.id, productId: l.productId, quantity: l.quantity, modifierIds: (l.modifiers as { id: string }[]).map((m) => m.id) }));
  await consumeOrderStock(tx, o.id, lines, actor.id, false);
  await tx.order.update({ where: { id: o.id }, data: { status: 'OPEN', sentAt: new Date(), version: { increment: 1 } } });
  await queueTickets(tx, o.id);
}

export async function addPayment(
  tx: Tx,
  orderId: string,
  input: { methodId: string; amountMinor: number; tenderedMinor?: number | null; reference?: string | null; idempotencyKey: string },
  actor: Actor,
) {
  const dup = await tx.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (dup) return { replayed: true };
  await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
  // Re-check after waiting for the lock: an identical payment may have just committed.
  if (await tx.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } })) return { replayed: true };
  const o = await tx.order.findUnique({ where: { id: orderId } });
  if (!o) throw notFound('Order not found');
  if (o.status === 'HELD') throw conflict('Send the order before taking payment');
  if (o.status === 'CANCELLED') throw conflict('This order was cancelled');
  const due = o.totalMinor - o.paidMinor;
  if (due <= 0) throw conflict('This order is already fully paid');
  if (input.amountMinor > due) throw badRequest(`Only ${due / 100} is still due on this order`);
  const method = await tx.paymentMethod.findUnique({ where: { id: input.methodId } });
  if (!method || !method.isActive) throw badRequest('Choose an active payment method');
  if (method.requiresReference && !input.reference) throw badRequest(`Enter the ${method.name} transaction ID`);
  let tendered: number | null = null;
  let change = 0;
  if (method.kind === 'CASH' && input.tenderedMinor) {
    if (input.tenderedMinor < input.amountMinor) throw badRequest('Cash given is less than the amount');
    tendered = input.tenderedMinor;
    change = input.tenderedMinor - input.amountMinor;
  }
  const session = method.kind === 'CASH' ? await tx.cashSession.findFirst({ where: { closedAt: null } }) : null;
  await tx.payment.create({
    data: {
      orderId, methodId: method.id, methodName: method.name, kind: method.kind, amountMinor: input.amountMinor, tenderedMinor: tendered, changeMinor: change,
      reference: input.reference || null, idempotencyKey: input.idempotencyKey, cashSessionId: session?.id ?? null, receivedById: actor.id,
    },
  });
  const paid = o.paidMinor + input.amountMinor;
  const full = paid >= o.totalMinor;
  await tx.order.update({
    where: { id: orderId },
    data: { paidMinor: paid, paymentStatus: full ? 'PAID' : 'PARTIALLY_PAID', ...(full ? { status: 'COMPLETED', completedAt: new Date() } : {}), version: { increment: 1 } },
  });
  if (full) await queueReceipt(tx, orderId);
  return { replayed: false, changeMinor: change };
}

export async function cancelOrder(tx: Tx, orderId: string, reason: string, actor: Actor) {
  await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
  const o = await loadOrder(orderId, tx);
  if (!o) throw notFound('Order not found');
  if (o.status === 'CANCELLED') throw conflict('This order is already cancelled');
  if (o.status !== 'HELD' && !hasPermission(actor.role, 'orders.cancel')) throw forbidden('Only a manager or the owner can cancel a sent order');
  if (o.paidMinor - o.refundedMinor > 0) throw conflict('Refund the payment before cancelling this order');
  let restored = 0;
  let wasted = 0;
  for (const l of o.lines) {
    if (l.stockState === 'CONSUMED' && l.prepStatus === 'PENDING') {
      await restoreSaleLine(tx, l.id, { actorId: actor.id, reason: `Order #${o.orderNo} cancelled before preparation` });
      await tx.orderLine.update({ where: { id: l.id }, data: { stockState: 'RESTORED', prepStatus: 'CANCELLED' } });
      restored++;
    } else if (l.stockState === 'CONSUMED') {
      // Already being prepared or served: the goods are used up → recorded as a loss, not returned to stock.
      await tx.orderLine.update({ where: { id: l.id }, data: { stockState: 'WASTED', prepStatus: 'CANCELLED' } });
      wasted++;
    } else {
      await tx.orderLine.update({ where: { id: l.id }, data: { prepStatus: 'CANCELLED' } });
    }
  }
  await tx.order.update({ where: { id: orderId }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason, version: { increment: 1 } } });
  if (o.status !== 'HELD') {
    const fresh = (await loadOrder(orderId, tx))!;
    const s = await getSettings(tx);
    for (const station of ['KITCHEN', 'BARISTA'] as const) {
      const payload = ticketPayload(fresh, station, s, { cancelled: true });
      if (payload && o.lines.some((l) => l.station === station && l.prepStatus !== 'SERVED')) {
        await queueJob(tx, { key: `${orderId}:${station}:CANCEL:0`, role: station, kind: 'TICKET', orderId, payload, requestedById: actor.id });
      }
    }
  }
  return { restored, wasted, wasHeld: o.status === 'HELD' };
}

export async function addRefund(tx: Tx, orderId: string, input: { methodId: string; amountMinor: number; reason: string; idempotencyKey: string }, actor: Actor) {
  const dup = await tx.refund.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (dup) return { replayed: true };
  await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
  if (await tx.refund.findUnique({ where: { idempotencyKey: input.idempotencyKey } })) return { replayed: true };
  const o = await tx.order.findUnique({ where: { id: orderId } });
  if (!o) throw notFound('Order not found');
  const refundable = o.paidMinor - o.refundedMinor;
  if (refundable <= 0) throw conflict('Nothing has been paid on this order that can be refunded');
  if (input.amountMinor > refundable) throw badRequest(`At most ${refundable / 100} can be refunded`);
  const method = await tx.paymentMethod.findUnique({ where: { id: input.methodId } });
  if (!method) throw badRequest('Choose a payment method for the refund');
  const session = method.kind === 'CASH' ? await tx.cashSession.findFirst({ where: { closedAt: null } }) : null;
  await tx.refund.create({
    data: { orderId, methodId: method.id, methodName: method.name, kind: method.kind, amountMinor: input.amountMinor, reason: input.reason, idempotencyKey: input.idempotencyKey, cashSessionId: session?.id ?? null, approvedById: actor.id },
  });
  const refunded = o.refundedMinor + input.amountMinor;
  await tx.order.update({ where: { id: orderId }, data: { refundedMinor: refunded, paymentStatus: refunded >= o.paidMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED', version: { increment: 1 } } });
  return { replayed: false };
}

export async function reprint(tx: Tx, orderId: string, role: 'RECEIPT' | 'KITCHEN' | 'BARISTA', reason: string, actorId: string) {
  const o = await loadOrder(orderId, tx);
  if (!o) throw notFound('Order not found');
  const s = await getSettings(tx);
  const last = await tx.printJob.aggregate({ where: { orderId, role }, _max: { reprintNo: true } });
  const n = (last._max.reprintNo ?? 0) + 1;
  const payload = role === 'RECEIPT' ? receiptPayload(o, s, { reprint: n }) : ticketPayload(o, role, s, { reprint: n });
  if (!payload) throw badRequest(`This order has no ${role === 'KITCHEN' ? 'food' : 'drink'} items`);
  return queueJob(tx, { key: `${orderId}:${role}:${role === 'RECEIPT' ? 'RECEIPT' : 'TICKET'}:${n}`, role, kind: role === 'RECEIPT' ? 'RECEIPT' : 'TICKET', orderId, payload, reprintNo: n, reprintReason: reason, requestedById: actorId });
}
