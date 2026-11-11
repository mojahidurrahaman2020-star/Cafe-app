import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  cancelOrderSchema, cashCloseSchema, cashOpenSchema, hasPermission, orderCreateSchema, paymentMethodSchema, paymentMethodUpdateSchema,
  paymentSchema, prepStatusSchema, PREP_FLOW, refundSchema, reprintSchema, taxRateSchema, taxRateUpdateSchema,
  type CashSessionDTO, type PaymentMethodDTO, type PrepStatus, type StationTicketDTO, type TaxRateDTO,
} from '@bitebrew/shared';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, notFound, staleVersion } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { idempotent } from '../../lib/idempotency.js';
import { parseBody } from '../../lib/validate.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { broadcast } from '../../realtime/hub.js';
import { normalizeName } from '../categories/routes.js';
import { addPayment, addRefund, cancelOrder, createOrder, currentBusinessDate, loadOrder, orderDTO, orderInclude, reprint, sendHeldOrder, toOrderDTO, userNames } from './service.js';

const actor = (req: Request) => ({ id: req.user!.id, role: req.user!.role });
const changed = (orderId?: string) => {
  broadcast({ type: 'orders.changed', orderId });
  broadcast({ type: 'inventory.changed' });
  broadcast({ type: 'printers.changed' });
};

export const posRouter = Router();

// ───────────── orders ─────────────
posRouter.post('/orders', requirePermission('pos.use'), async (req, res) => {
  const input = parseBody(orderCreateSchema, req.body);
  const findExisting = async () => {
    const o = await prisma.order.findUnique({ where: { clientRequestId: input.clientRequestId } });
    return o ? { orderId: o.id, replayed: true, conflicts: [] as string[] } : null;
  };
  // A double-tap racing the first submission hits the UNIQUE(client_request_id) and gets the first result.
  const { result: r } = await idempotent(
    () => prisma.$transaction(async (tx) => {
      const out = await createOrder(tx, input, actor(req));
      if (!out.replayed) await audit(req, { action: input.hold ? 'order.hold' : 'order.create', entityType: 'Order', entityId: out.orderId }, tx);
      return out;
    }),
    findExisting,
  );
  if (!r.replayed) changed(r.orderId);
  res.status(r.replayed ? 200 : 201).json({ order: await orderDTO(r.orderId), replayed: r.replayed });
});

const listQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['HELD', 'OPEN', 'COMPLETED', 'CANCELLED', 'ACTIVE']).optional(),
  needsReview: z.enum(['true']).optional(),
  limit: z.coerce.number().int().min(1).max(300).default(100),
});
posRouter.get('/orders', requirePermission('orders.view'), async (req, res) => {
  const q = parseBody(listQuery, req.query);
  const where: Record<string, unknown> = {};
  if (q.needsReview) where.needsReview = true;
  else where.businessDate = q.date ?? (await currentBusinessDate());
  if (q.status === 'ACTIVE') where.status = { in: ['HELD', 'OPEN'] };
  else if (q.status) where.status = q.status;
  const rows = await prisma.order.findMany({ where, include: orderInclude, orderBy: { orderNo: 'desc' }, take: q.limit });
  const names = await userNames(rows.flatMap((o) => [o.createdById, ...o.payments.map((p) => p.receivedById), ...o.refunds.map((x) => x.approvedById)]));
  res.json({ orders: rows.map((o) => toOrderDTO(o, names)), businessDate: where.businessDate ?? null });
});

posRouter.get('/orders/:id', requirePermission('orders.view'), async (req, res) => {
  res.json({ order: await orderDTO(String(req.params.id)) });
});

posRouter.post('/orders/:id/send', requirePermission('pos.use'), async (req, res) => {
  const id = String(req.params.id);
  await prisma.$transaction(async (tx) => {
    await sendHeldOrder(tx, id, actor(req));
    await audit(req, { action: 'order.send', entityType: 'Order', entityId: id }, tx);
  });
  changed(id);
  res.json({ order: await orderDTO(id) });
});

posRouter.post('/orders/:id/payments', requirePermission('pos.use'), async (req, res) => {
  const input = parseBody(paymentSchema, req.body);
  const id = String(req.params.id);
  const { result: r } = await idempotent(
    () => prisma.$transaction(async (tx) => {
      const out = await addPayment(tx, id, input, actor(req));
      if (!out.replayed) await audit(req, { action: 'order.payment', entityType: 'Order', entityId: id, after: { methodId: input.methodId, amountMinor: input.amountMinor } }, tx);
      return out;
    }),
    async () => ((await prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } })) ? { replayed: true as const, changeMinor: 0 } : null),
  );
  if (!r.replayed) changed(id);
  res.status(r.replayed ? 200 : 201).json({ order: await orderDTO(id), replayed: r.replayed, changeMinor: r.changeMinor ?? 0 });
});

posRouter.post('/orders/:id/cancel', requirePermission('pos.use'), async (req, res) => {
  const { reason } = parseBody(cancelOrderSchema, req.body);
  const id = String(req.params.id);
  const r = await prisma.$transaction(async (tx) => {
    const out = await cancelOrder(tx, id, reason, actor(req));
    await audit(req, { action: 'order.cancel', entityType: 'Order', entityId: id, after: { reason, ...out } }, tx);
    return out;
  });
  changed(id);
  res.json({ order: await orderDTO(id), ...r });
});

posRouter.post('/orders/:id/refunds', requirePermission('orders.refund'), async (req, res) => {
  const input = parseBody(refundSchema, req.body);
  const id = String(req.params.id);
  const { result: r } = await idempotent(
    () => prisma.$transaction(async (tx) => {
      const out = await addRefund(tx, id, input, actor(req));
      if (!out.replayed) await audit(req, { action: 'order.refund', entityType: 'Order', entityId: id, after: { amountMinor: input.amountMinor, reason: input.reason } }, tx);
      return out;
    }),
    async () => ((await prisma.refund.findUnique({ where: { idempotencyKey: input.idempotencyKey } })) ? { replayed: true as const } : null),
  );
  if (!r.replayed) changed(id);
  res.status(r.replayed ? 200 : 201).json({ order: await orderDTO(id), replayed: r.replayed });
});

posRouter.post('/orders/:id/reprint', requirePermission('orders.reprint'), async (req, res) => {
  const { role, reason } = parseBody(reprintSchema, req.body);
  const id = String(req.params.id);
  await prisma.$transaction(async (tx) => {
    const job = await reprint(tx, id, role, reason, req.user!.id);
    await audit(req, { action: 'order.reprint', entityType: 'Order', entityId: id, after: { role, reason, reprintNo: job.reprintNo } }, tx);
  });
  broadcast({ type: 'printers.changed' });
  res.status(201).json({ ok: true });
});

posRouter.post('/orders/:id/review', requirePermission('orders.cancel'), async (req, res) => {
  const { note } = parseBody(z.object({ note: z.string().trim().min(1).max(200) }), req.body);
  const id = String(req.params.id);
  await prisma.$transaction(async (tx) => {
    const o = await tx.order.findUnique({ where: { id } });
    if (!o) throw notFound('Order not found');
    await tx.order.update({ where: { id }, data: { needsReview: false, reviewNote: `${o.reviewNote ?? ''} — Reviewed: ${note}`.slice(0, 300) } });
    await audit(req, { action: 'order.review', entityType: 'Order', entityId: id, after: { note } }, tx);
  });
  changed(id);
  res.json({ order: await orderDTO(id) });
});

/** Upload orders taken while a till was offline. Each is idempotent by clientRequestId. */
posRouter.post('/sync/orders', requirePermission('pos.use'), async (req, res) => {
  const { orders } = parseBody(z.object({ orders: z.array(z.unknown()).min(1).max(200) }), req.body);
  const results: { clientRequestId: string; status: 'created' | 'duplicate' | 'error'; orderNo?: number; needsReview?: boolean; message?: string }[] = [];
  for (const raw of orders) {
    const parsed = orderCreateSchema.safeParse(raw);
    const payments = z.array(paymentSchema).max(10).safeParse((raw as { payments?: unknown })?.payments ?? []);
    const crid = String((raw as { clientRequestId?: unknown })?.clientRequestId ?? '');
    if (!parsed.success || !payments.success) {
      results.push({ clientRequestId: crid, status: 'error', message: 'Invalid offline order data' });
      continue;
    }
    try {
      const r = await prisma.$transaction(async (tx) => {
        const out = await createOrder(tx, { ...parsed.data, hold: false, replacesHeldOrderId: undefined }, actor(req), { offline: true });
        for (const p of payments.data) await addPayment(tx, out.orderId, p, actor(req));
        if (!out.replayed) await audit(req, { action: 'order.sync_offline', entityType: 'Order', entityId: out.orderId, after: { conflicts: out.conflicts } }, tx);
        return out;
      });
      const o = await prisma.order.findUniqueOrThrow({ where: { id: r.orderId } });
      results.push({ clientRequestId: crid, status: r.replayed ? 'duplicate' : 'created', orderNo: o.orderNo, needsReview: o.needsReview });
    } catch (err) {
      results.push({ clientRequestId: crid, status: 'error', message: (err as Error).message });
    }
  }
  changed();
  res.json({ results });
});

// ───────────── kitchen / barista stations ─────────────
const stationParam = z.enum(['kitchen', 'barista']);
function stationPermission(req: Request, station: 'kitchen' | 'barista') {
  if (!hasPermission(req.user!.role, station === 'kitchen' ? 'kitchen.view' : 'barista.view')) throw forbidden();
}

posRouter.get('/stations/:station', requireAuth, async (req, res) => {
  const station = parseBody(stationParam, req.params.station);
  stationPermission(req, station);
  const st = station === 'kitchen' ? 'KITCHEN' : 'BARISTA';
  const since = new Date(Date.now() - 24 * 3600_000);
  const orders = await prisma.order.findMany({
    where: { status: { in: ['OPEN', 'COMPLETED'] }, sentAt: { gte: since }, lines: { some: { station: st, prepStatus: { in: ['PENDING', 'PREPARING', 'READY'] } } } },
    include: { lines: { where: { station: st, prepStatus: { not: 'CANCELLED' } }, orderBy: { sortOrder: 'asc' } } },
    orderBy: { sentAt: 'asc' },
  });
  const tickets: StationTicketDTO[] = orders.map((o) => ({
    orderId: o.id, orderNo: o.orderNo, serviceType: o.serviceType, tableNo: o.tableNo, customerName: o.customerName, notes: o.notes,
    createdAt: (o.sentAt ?? o.createdAt).toISOString(),
    lines: o.lines.map((l) => ({ id: l.id, name: l.name, quantity: l.quantity, modifiers: l.modifiers as never, notes: l.notes, prepStatus: l.prepStatus })),
  }));
  res.json({ tickets });
});

/** Advance every item of one station on an order to the next step (Start → Ready → Served). */
posRouter.post('/stations/:station/orders/:orderId/advance', requireAuth, async (req, res) => {
  const station = parseBody(stationParam, req.params.station);
  stationPermission(req, station);
  const st = station === 'kitchen' ? 'KITCHEN' : 'BARISTA';
  const orderId = String(req.params.orderId);
  const lines = await prisma.orderLine.findMany({ where: { orderId, station: st, prepStatus: { in: ['PENDING', 'PREPARING', 'READY'] } } });
  if (!lines.length) throw conflict('Nothing left to prepare on this order');
  const lowest = Math.min(...lines.map((l) => PREP_FLOW.indexOf(l.prepStatus as PrepStatus)));
  const next = PREP_FLOW[lowest + 1]!;
  await prisma.orderLine.updateMany({ where: { id: { in: lines.filter((l) => PREP_FLOW.indexOf(l.prepStatus as PrepStatus) === lowest).map((l) => l.id) } }, data: { prepStatus: next } });
  await audit(req, { action: `station.${station}.${next.toLowerCase()}`, entityType: 'Order', entityId: orderId });
  broadcast({ type: 'orders.changed', orderId });
  res.json({ status: next });
});

posRouter.post('/order-lines/:id/status', requireAuth, async (req, res) => {
  const { status } = parseBody(prepStatusSchema, req.body);
  const line = await prisma.orderLine.findUnique({ where: { id: String(req.params.id) } });
  if (!line) throw notFound('Item not found');
  stationPermission(req, line.station === 'KITCHEN' ? 'kitchen' : 'barista');
  if (line.prepStatus === 'CANCELLED') throw conflict('This item was cancelled');
  await prisma.orderLine.update({ where: { id: line.id }, data: { prepStatus: status } });
  broadcast({ type: 'orders.changed', orderId: line.orderId });
  res.json({ ok: true });
});

// ───────────── tax rates & payment methods ─────────────
const taxDTO = (t: { id: string; name: string; rateBp: number; inclusive: boolean; isActive: boolean; version: number }): TaxRateDTO => ({ id: t.id, name: t.name, rateBp: t.rateBp, inclusive: t.inclusive, isActive: t.isActive, version: t.version });

posRouter.get('/tax-rates', requireAuth, async (_req, res) => {
  res.json({ taxRates: (await prisma.taxRate.findMany({ orderBy: { createdAt: 'asc' } })).map(taxDTO) });
});
posRouter.post('/tax-rates', requirePermission('settings.manage'), async (req, res) => {
  const d = parseBody(taxRateSchema, req.body);
  const t = await prisma.$transaction(async (tx) => {
    const row = await tx.taxRate.create({ data: { name: d.name, rateBp: Math.round(d.ratePercent * 100), inclusive: d.inclusive, isActive: d.isActive ?? true } });
    await audit(req, { action: 'tax.create', entityType: 'TaxRate', entityId: row.id, after: taxDTO(row) }, tx);
    return row;
  });
  broadcast({ type: 'settings.changed', version: 0 });
  res.status(201).json({ taxRate: taxDTO(t) });
});
posRouter.patch('/tax-rates/:id', requirePermission('settings.manage'), async (req, res) => {
  const { version, ratePercent, ...d } = parseBody(taxRateUpdateSchema, req.body);
  const id = String(req.params.id);
  const t = await prisma.$transaction(async (tx) => {
    const before = await tx.taxRate.findUnique({ where: { id } });
    if (!before) throw notFound('Tax rate not found');
    const r = await tx.taxRate.updateMany({ where: { id, version }, data: { ...d, ...(ratePercent !== undefined ? { rateBp: Math.round(ratePercent * 100) } : {}), version: { increment: 1 } } });
    if (!r.count) throw staleVersion(taxDTO(before));
    const after = await tx.taxRate.findUniqueOrThrow({ where: { id } });
    await audit(req, { action: 'tax.update', entityType: 'TaxRate', entityId: id, before: taxDTO(before), after: taxDTO(after) }, tx);
    return after;
  });
  broadcast({ type: 'settings.changed', version: 0 });
  res.json({ taxRate: taxDTO(t) });
});

const pmDTO = (m: { id: string; name: string; kind: PaymentMethodDTO['kind']; requiresReference: boolean; isActive: boolean; sortOrder: number; version: number }): PaymentMethodDTO => ({ id: m.id, name: m.name, kind: m.kind, requiresReference: m.requiresReference, isActive: m.isActive, sortOrder: m.sortOrder, version: m.version });
posRouter.get('/payment-methods', requireAuth, async (_req, res) => {
  res.json({ paymentMethods: (await prisma.paymentMethod.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] })).map(pmDTO) });
});
posRouter.post('/payment-methods', requirePermission('settings.manage'), async (req, res) => {
  const d = parseBody(paymentMethodSchema, req.body);
  if (await prisma.paymentMethod.findUnique({ where: { normalizedName: normalizeName(d.name) } })) throw conflict('A payment method with this name exists');
  const m = await prisma.$transaction(async (tx) => {
    const row = await tx.paymentMethod.create({ data: { ...d, normalizedName: normalizeName(d.name) } });
    await audit(req, { action: 'payment_method.create', entityType: 'PaymentMethod', entityId: row.id, after: pmDTO(row) }, tx);
    return row;
  });
  broadcast({ type: 'settings.changed', version: 0 });
  res.status(201).json({ paymentMethod: pmDTO(m) });
});
posRouter.patch('/payment-methods/:id', requirePermission('settings.manage'), async (req, res) => {
  const { version, ...d } = parseBody(paymentMethodUpdateSchema, req.body);
  const id = String(req.params.id);
  const m = await prisma.$transaction(async (tx) => {
    const before = await tx.paymentMethod.findUnique({ where: { id } });
    if (!before) throw notFound('Payment method not found');
    if (d.name) {
      const clash = await tx.paymentMethod.findUnique({ where: { normalizedName: normalizeName(d.name) } });
      if (clash && clash.id !== id) throw conflict('A payment method with this name exists');
    }
    const r = await tx.paymentMethod.updateMany({ where: { id, version }, data: { ...d, ...(d.name ? { normalizedName: normalizeName(d.name) } : {}), version: { increment: 1 } } });
    if (!r.count) throw staleVersion(pmDTO(before));
    const after = await tx.paymentMethod.findUniqueOrThrow({ where: { id } });
    await audit(req, { action: 'payment_method.update', entityType: 'PaymentMethod', entityId: id, before: pmDTO(before), after: pmDTO(after) }, tx);
    return after;
  });
  broadcast({ type: 'settings.changed', version: 0 });
  res.json({ paymentMethod: pmDTO(m) });
});

// ───────────── cash drawer ─────────────
async function sessionDTO(id: string): Promise<CashSessionDTO> {
  const s = await prisma.cashSession.findUniqueOrThrow({ where: { id }, include: { payments: true, refunds: true } });
  const cashSales = s.payments.filter((p) => p.kind === 'CASH').reduce((a, p) => a + p.amountMinor, 0);
  const cashRefunds = s.refunds.filter((r) => r.kind === 'CASH').reduce((a, r) => a + r.amountMinor, 0);
  const names = await userNames([s.openedById, s.closedById]);
  return {
    id: s.id, openedBy: names.get(s.openedById) ?? null, openedAt: s.openedAt.toISOString(), openingFloatMinor: s.openingFloatMinor,
    cashSalesMinor: cashSales, cashRefundsMinor: cashRefunds, expectedCashMinor: s.expectedCashMinor ?? s.openingFloatMinor + cashSales - cashRefunds,
    closedBy: s.closedById ? names.get(s.closedById) ?? null : null, closedAt: s.closedAt?.toISOString() ?? null,
    countedCashMinor: s.countedCashMinor, varianceMinor: s.varianceMinor, notes: s.notes,
  };
}
posRouter.get('/cash/current', requirePermission('pos.use'), async (_req, res) => {
  const s = await prisma.cashSession.findFirst({ where: { closedAt: null } });
  res.json({ session: s ? await sessionDTO(s.id) : null });
});
posRouter.get('/cash/sessions', requirePermission('cash.reconcile'), async (_req, res) => {
  const rows = await prisma.cashSession.findMany({ orderBy: { openedAt: 'desc' }, take: 30 });
  res.json({ sessions: await Promise.all(rows.map((r) => sessionDTO(r.id))) });
});
posRouter.post('/cash/open', requirePermission('pos.use'), async (req, res) => {
  const { openingFloatMinor } = parseBody(cashOpenSchema, req.body);
  if (await prisma.cashSession.findFirst({ where: { closedAt: null } })) throw conflict('The cash drawer is already open');
  const s = await prisma.$transaction(async (tx) => {
    const row = await tx.cashSession.create({ data: { openedById: req.user!.id, openingFloatMinor } });
    await audit(req, { action: 'cash.open', entityType: 'CashSession', entityId: row.id, after: { openingFloatMinor } }, tx);
    return row;
  });
  broadcast({ type: 'finance.changed' });
  res.status(201).json({ session: await sessionDTO(s.id) });
});
posRouter.post('/cash/close', requirePermission('cash.reconcile'), async (req, res) => {
  const { countedCashMinor, notes } = parseBody(cashCloseSchema, req.body);
  const open = await prisma.cashSession.findFirst({ where: { closedAt: null } });
  if (!open) throw badRequest('No cash drawer session is open');
  const current = await sessionDTO(open.id);
  await prisma.$transaction(async (tx) => {
    await tx.cashSession.update({
      where: { id: open.id },
      data: { closedAt: new Date(), closedById: req.user!.id, expectedCashMinor: current.expectedCashMinor, countedCashMinor, varianceMinor: countedCashMinor - current.expectedCashMinor, notes: notes ?? '' },
    });
    await audit(req, { action: 'cash.close', entityType: 'CashSession', entityId: open.id, after: { expected: current.expectedCashMinor, counted: countedCashMinor } }, tx);
  });
  broadcast({ type: 'finance.changed' });
  res.json({ session: await sessionDTO(open.id) });
});

export { loadOrder };
