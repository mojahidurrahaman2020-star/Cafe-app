import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { printerSchema, type PrintJobDTO, type PrinterDTO } from '@bitebrew/shared';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound, staleVersion } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { parseBody } from '../../lib/validate.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { broadcast } from '../../realtime/hub.js';
import { getSettings } from '../settings/service.js';
import { queueJob, testPayload } from './jobs.js';
import { renderText, type PrintPayload } from './render.js';
import { probePrinter } from './service.js';

export const printingRouter = Router();

export async function printersDTO(): Promise<PrinterDTO[]> {
  const [printers, counts] = await Promise.all([
    prisma.printer.findMany({ orderBy: { role: 'asc' } }),
    prisma.printJob.groupBy({ by: ['role', 'status'], where: { status: { in: ['PENDING', 'FAILED', 'PRINTING'] } }, _count: { _all: true } }),
  ]);
  const order = { RECEIPT: 0, BARISTA: 1, KITCHEN: 2 } as const;
  return printers
    .sort((a, b) => order[a.role] - order[b.role])
    .map((p) => ({
      id: p.id, name: p.name, role: p.role, host: p.host, port: p.port, paperWidthMm: p.paperWidthMm as 58 | 80, isActive: p.isActive,
      cutPaper: p.cutPaper, openDrawer: p.openDrawer, status: p.host ? p.status : 'NOT_CONFIGURED', lastSeenAt: p.lastSeenAt?.toISOString() ?? null,
      lastError: p.lastError, version: p.version,
      pendingJobs: counts.filter((c) => c.role === p.role && (c.status === 'PENDING' || c.status === 'PRINTING')).reduce((s, c) => s + c._count._all, 0),
      failedJobs: counts.filter((c) => c.role === p.role && c.status === 'FAILED').reduce((s, c) => s + c._count._all, 0),
    }));
}

printingRouter.get('/printers', requireAuth, async (_req, res) => {
  res.json({ printers: await printersDTO() });
});

printingRouter.patch('/printers/:id', requirePermission('printers.manage'), async (req, res) => {
  const { version, ...d } = parseBody(printerSchema, req.body);
  const id = String(req.params.id);
  await prisma.$transaction(async (tx) => {
    const before = await tx.printer.findUnique({ where: { id } });
    if (!before) throw notFound('Printer not found');
    const r = await tx.printer.updateMany({ where: { id, version }, data: { ...d, status: 'UNKNOWN', version: { increment: 1 } } });
    if (!r.count) throw staleVersion({ id, version: before.version });
    await audit(req, { action: 'printer.update', entityType: 'Printer', entityId: id, before: { host: before.host, port: before.port, paperWidthMm: before.paperWidthMm }, after: d }, tx);
  });
  const p = await prisma.printer.findUniqueOrThrow({ where: { id } });
  if (p.host) {
    const ok = await probePrinter(p.host, p.port);
    await prisma.printer.update({ where: { id }, data: { status: ok ? 'ONLINE' : 'OFFLINE', ...(ok ? { lastSeenAt: new Date(), lastError: null } : { lastError: 'Could not connect' }) } });
  }
  broadcast({ type: 'printers.changed' });
  res.json({ printers: await printersDTO() });
});

printingRouter.post('/printers/:id/test', requirePermission('printers.manage'), async (req, res) => {
  const p = await prisma.printer.findUnique({ where: { id: String(req.params.id) } });
  if (!p) throw notFound('Printer not found');
  if (!p.host) throw badRequest('Enter the printer’s IP address first');
  const s = await getSettings();
  await prisma.$transaction(async (tx) => {
    await queueJob(tx, { key: `test:${randomUUID()}`, role: p.role, kind: 'TEST', payload: testPayload(p.role, p.name, p.paperWidthMm, s), requestedById: req.user!.id });
    await audit(req, { action: 'printer.test', entityType: 'Printer', entityId: p.id }, tx);
  });
  broadcast({ type: 'printers.changed' });
  res.status(201).json({ ok: true });
});

const jobsQuery = z.object({ status: z.enum(['PENDING', 'PRINTING', 'PRINTED', 'FAILED', 'CANCELLED']).optional(), orderId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });
printingRouter.get('/print-jobs', requireAuth, async (req, res) => {
  const q = parseBody(jobsQuery, req.query);
  const rows = await prisma.printJob.findMany({
    where: { ...(q.status ? { status: q.status } : {}), ...(q.orderId ? { orderId: q.orderId } : {}) },
    include: { order: { select: { orderNo: true } } },
    orderBy: { createdAt: 'desc' },
    take: q.limit,
  });
  const jobs: PrintJobDTO[] = rows.map((j) => ({
    id: j.id, role: j.role, kind: j.kind, orderNo: j.order?.orderNo ?? null, status: j.status, attempts: j.attempts, lastError: j.lastError,
    reprintNo: j.reprintNo, reprintReason: j.reprintReason, createdAt: j.createdAt.toISOString(), printedAt: j.printedAt?.toISOString() ?? null,
  }));
  res.json({ jobs });
});

/** Plain-text preview of exactly what the printer receives (useful before printers are installed). */
printingRouter.get('/print-jobs/:id/preview', requireAuth, async (req, res) => {
  const j = await prisma.printJob.findUnique({ where: { id: String(req.params.id) } });
  if (!j) throw notFound('Print job not found');
  const printer = await prisma.printer.findUnique({ where: { role: j.role } });
  res.json({ text: renderText(j.payload as unknown as PrintPayload, printer?.paperWidthMm ?? 80), paperWidthMm: printer?.paperWidthMm ?? 80 });
});

/** Send a FAILED job again — a deliberate person decision (the system never re-prints by itself). */
printingRouter.post('/print-jobs/:id/retry', requirePermission('orders.reprint'), async (req, res) => {
  const id = String(req.params.id);
  const r = await prisma.printJob.updateMany({ where: { id, status: 'FAILED' }, data: { status: 'PENDING', lastError: null } });
  if (!r.count) throw conflict('Only failed print jobs can be retried');
  await audit(req, { action: 'print_job.retry', entityType: 'PrintJob', entityId: id });
  broadcast({ type: 'printers.changed' });
  res.json({ ok: true });
});

printingRouter.post('/print-jobs/:id/cancel', requirePermission('orders.reprint'), async (req, res) => {
  const id = String(req.params.id);
  const r = await prisma.printJob.updateMany({ where: { id, status: { in: ['PENDING', 'FAILED'] } }, data: { status: 'CANCELLED' } });
  if (!r.count) throw conflict('This job can no longer be cancelled');
  await audit(req, { action: 'print_job.cancel', entityType: 'PrintJob', entityId: id });
  broadcast({ type: 'printers.changed' });
  res.json({ ok: true });
});
