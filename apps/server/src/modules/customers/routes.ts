import { Router } from 'express';
import { z } from 'zod';
import { customerCreateSchema, customerUpdateSchema, normalizePhone, type CustomerDetailDTO, type CustomerDTO } from '@bitebrew/shared';
import { audit } from '../../lib/audit.js';
import { conflict, notFound, staleVersion } from '../../lib/errors.js';
import { prisma, type Tx } from '../../lib/prisma.js';
import { parseBody } from '../../lib/validate.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { broadcast } from '../../realtime/hub.js';

type Row = Awaited<ReturnType<typeof prisma.customer.findUniqueOrThrow>>;

async function stats(ids: string[]) {
  if (!ids.length) return new Map<string, { visits: number; spent: number; last: Date | null }>();
  const rows = await prisma.order.groupBy({
    by: ['customerId'],
    where: { customerId: { in: ids }, status: 'COMPLETED' },
    _count: { _all: true },
    _sum: { totalMinor: true, refundedMinor: true },
    _max: { createdAt: true },
  });
  return new Map(rows.map((r) => [r.customerId!, { visits: r._count._all, spent: (r._sum.totalMinor ?? 0) - (r._sum.refundedMinor ?? 0), last: r._max.createdAt }]));
}

const toDTO = (c: Row, s?: { visits: number; spent: number; last: Date | null }): CustomerDTO => ({
  id: c.id, name: c.name, phone: c.phone, notes: c.notes, isActive: c.isActive, visits: s?.visits ?? 0, spentMinor: s?.spent ?? 0,
  lastVisitAt: s?.last?.toISOString() ?? null, version: c.version, createdAt: c.createdAt.toISOString(),
});

/** Existing customer with this number (any spelling), or null. */
const findByPhone = (tx: Tx | typeof prisma, phone: string) => tx.customer.findUnique({ where: { normalizedPhone: normalizePhone(phone) } });

export const customersRouter = Router();

const listQuery = z.object({ q: z.string().trim().max(60).optional(), includeInactive: z.enum(['true']).optional(), limit: z.coerce.number().int().min(1).max(500).default(200) });

/** Anyone who takes orders can search customers; managing them needs customers.manage. */
customersRouter.get('/customers', requireAuth, requirePermission('pos.use'), async (req, res) => {
  const { q, includeInactive, limit } = parseBody(listQuery, req.query);
  const digits = q ? q.replace(/\D/g, '') : '';
  const rows = await prisma.customer.findMany({
    where: {
      ...(includeInactive ? {} : { isActive: true }),
      ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, ...(digits.length >= 3 ? [{ normalizedPhone: { contains: normalizePhone(digits).replace(/^0/, '') } }] : [])] } : {}),
    },
    orderBy: { name: 'asc' },
    take: limit,
  });
  const st = await stats(rows.map((r) => r.id));
  res.json({ customers: rows.map((r) => toDTO(r, st.get(r.id))) });
});

customersRouter.get('/customers/:id', requirePermission('customers.manage'), async (req, res) => {
  const id = String(req.params.id);
  const c = await prisma.customer.findUnique({ where: { id } });
  if (!c) throw notFound('Customer not found');
  const [st, orders] = await Promise.all([
    stats([id]),
    prisma.order.findMany({ where: { customerId: id, status: { not: 'HELD' } }, orderBy: { createdAt: 'desc' }, take: 15, include: { lines: { select: { name: true, quantity: true } } } }),
  ]);
  const dto: CustomerDetailDTO = {
    ...toDTO(c, st.get(id)),
    recentOrders: orders.map((o) => ({ id: o.id, orderNo: o.orderNo, businessDate: o.businessDate, totalMinor: o.totalMinor, status: o.status, items: o.lines.map((l) => `${l.quantity}× ${l.name}`).join(', ') })),
  };
  res.json({ customer: dto });
});

customersRouter.post('/customers', requirePermission('customers.manage'), async (req, res) => {
  const d = parseBody(customerCreateSchema, req.body);
  const existing = await findByPhone(prisma, d.phone);
  if (existing) throw conflict(`${existing.name} already has this phone number`, { customer: toDTO(existing) });
  const c = await prisma.$transaction(async (tx) => {
    const row = await tx.customer.create({ data: { name: d.name.replace(/\s+/g, ' '), phone: d.phone.trim(), normalizedPhone: normalizePhone(d.phone), notes: d.notes ?? '', createdById: req.user!.id } });
    await audit(req, { action: 'customer.create', entityType: 'Customer', entityId: row.id, after: { name: row.name, phone: row.phone } }, tx);
    return row;
  });
  broadcast({ type: 'customers.changed' });
  res.status(201).json({ customer: toDTO(c) });
});

customersRouter.patch('/customers/:id', requirePermission('customers.manage'), async (req, res) => {
  const { version, ...ch } = parseBody(customerUpdateSchema, req.body);
  const id = String(req.params.id);
  const c = await prisma.$transaction(async (tx) => {
    const before = await tx.customer.findUnique({ where: { id } });
    if (!before) throw notFound('Customer not found');
    const data: Record<string, unknown> = {};
    if (ch.name !== undefined) data.name = ch.name.replace(/\s+/g, ' ');
    if (ch.notes !== undefined) data.notes = ch.notes;
    if (ch.isActive !== undefined) data.isActive = ch.isActive;
    if (ch.phone !== undefined) {
      const clash = await findByPhone(tx, ch.phone);
      if (clash && clash.id !== id) throw conflict(`${clash.name} already has this phone number`);
      data.phone = ch.phone.trim();
      data.normalizedPhone = normalizePhone(ch.phone);
    }
    const r = await tx.customer.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
    if (!r.count) throw staleVersion(toDTO(before));
    const after = await tx.customer.findUniqueOrThrow({ where: { id } });
    await audit(req, { action: 'customer.update', entityType: 'Customer', entityId: id, before: { name: before.name, phone: before.phone, isActive: before.isActive }, after: { name: after.name, phone: after.phone, isActive: after.isActive } }, tx);
    return after;
  });
  broadcast({ type: 'customers.changed' });
  res.json({ customer: toDTO(c, (await stats([id])).get(id)) });
});

/** Deleting is for mistakes only; customers with orders are deactivated instead. */
customersRouter.delete('/customers/:id', requirePermission('orders.cancel'), async (req, res) => {
  const id = String(req.params.id);
  await prisma.$transaction(async (tx) => {
    const c = await tx.customer.findUnique({ where: { id }, include: { _count: { select: { orders: true } } } });
    if (!c) throw notFound('Customer not found');
    if (c._count.orders) throw conflict('This customer has past orders, so they cannot be deleted. Mark them inactive instead.');
    await tx.customer.delete({ where: { id } });
    await audit(req, { action: 'customer.delete', entityType: 'Customer', entityId: id, before: { name: c.name, phone: c.phone } }, tx);
  });
  broadcast({ type: 'customers.changed' });
  res.status(204).end();
});
