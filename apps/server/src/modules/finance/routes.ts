import { Router } from 'express';
import { z } from 'zod';
import { expenseCategorySchema, expenseCreateSchema, expenseVoidSchema, hasPermission, type ExpenseDTO } from '@bitebrew/shared';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { idempotent } from '../../lib/idempotency.js';
import { prisma } from '../../lib/prisma.js';
import { parseBody } from '../../lib/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { broadcast } from '../../realtime/hub.js';
import { normalizeName } from '../categories/routes.js';
import { currentBusinessDate, userNames } from '../pos/service.js';
import { getSettings } from '../settings/service.js';
import { reportCsv, reportPdf, reportXlsx } from './export.js';
import { buildReport } from './report.js';

export const financeRouter = Router();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ───────────── expense categories ─────────────
financeRouter.get('/expense-categories', requirePermission('expenses.manage'), async (_req, res) => {
  const rows = await prisma.expenseCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  res.json({ categories: rows.map((c) => ({ id: c.id, name: c.name, isActive: c.isActive })) });
});
financeRouter.post('/expense-categories', requirePermission('expenses.manage'), async (req, res) => {
  const d = parseBody(expenseCategorySchema, req.body);
  if (await prisma.expenseCategory.findUnique({ where: { normalizedName: normalizeName(d.name) } })) throw conflict('This category already exists');
  const max = await prisma.expenseCategory.aggregate({ _max: { sortOrder: true } });
  const c = await prisma.expenseCategory.create({ data: { name: d.name, normalizedName: normalizeName(d.name), sortOrder: (max._max.sortOrder ?? 0) + 10 } });
  await audit(req, { action: 'expense_category.create', entityType: 'ExpenseCategory', entityId: c.id, after: { name: c.name } });
  res.status(201).json({ category: { id: c.id, name: c.name, isActive: c.isActive } });
});
financeRouter.patch('/expense-categories/:id', requirePermission('expenses.manage'), async (req, res) => {
  const d = parseBody(expenseCategorySchema.partial(), req.body);
  const id = String(req.params.id);
  if (d.name) {
    const clash = await prisma.expenseCategory.findUnique({ where: { normalizedName: normalizeName(d.name) } });
    if (clash && clash.id !== id) throw conflict('This category already exists');
  }
  const c = await prisma.expenseCategory.update({ where: { id }, data: { ...d, ...(d.name ? { normalizedName: normalizeName(d.name) } : {}) } });
  await audit(req, { action: 'expense_category.update', entityType: 'ExpenseCategory', entityId: id, after: d });
  res.json({ category: { id: c.id, name: c.name, isActive: c.isActive } });
});

// ───────────── expenses ─────────────
const listQuery = z.object({ from: date.optional(), to: date.optional() });
financeRouter.get('/expenses', requirePermission('expenses.manage'), async (req, res) => {
  const q = parseBody(listQuery, req.query);
  const today = await currentBusinessDate();
  const rows = await prisma.expense.findMany({
    where: { businessDate: { gte: q.from ?? today, lte: q.to ?? today } },
    include: { category: true },
    orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }],
  });
  const names = await userNames(rows.map((r) => r.createdById));
  const expenses: ExpenseDTO[] = rows.map((e) => ({
    id: e.id, categoryId: e.categoryId, categoryName: e.category.name, amountMinor: e.amountMinor, businessDate: e.businessDate, paidWith: e.paidWith,
    note: e.note, createdBy: e.createdById ? names.get(e.createdById) ?? null : null, createdAt: e.createdAt.toISOString(),
    voidedAt: e.voidedAt?.toISOString() ?? null, voidReason: e.voidReason,
  }));
  res.json({ expenses });
});
financeRouter.post('/expenses', requirePermission('expenses.manage'), async (req, res) => {
  const d = parseBody(expenseCreateSchema, req.body);
  const cat = await prisma.expenseCategory.findUnique({ where: { id: d.categoryId } });
  if (!cat || !cat.isActive) throw badRequest('Choose an expense category');
  const { replayed } = await idempotent(
    () => prisma.$transaction(async (tx) => {
      const e = await tx.expense.create({ data: { categoryId: d.categoryId, amountMinor: d.amountMinor, businessDate: d.businessDate, paidWith: d.paidWith ?? '', note: d.note ?? '', requestId: d.requestId, createdById: req.user!.id } });
      await audit(req, { action: 'expense.create', entityType: 'Expense', entityId: e.id, after: { category: cat.name, amountMinor: e.amountMinor, businessDate: e.businessDate } }, tx);
      return e.id;
    }),
    async () => (await prisma.expense.findUnique({ where: { requestId: d.requestId } }))?.id ?? null,
  );
  if (!replayed) broadcast({ type: 'finance.changed' });
  res.status(replayed ? 200 : 201).json({ ok: true, replayed });
});
financeRouter.post('/expenses/:id/void', requirePermission('expenses.manage'), async (req, res) => {
  const { reason } = parseBody(expenseVoidSchema, req.body);
  const id = String(req.params.id);
  const e = await prisma.expense.findUnique({ where: { id } });
  if (!e) throw notFound('Expense not found');
  if (e.voidedAt) throw conflict('This expense is already voided');
  await prisma.$transaction(async (tx) => {
    await tx.expense.update({ where: { id }, data: { voidedAt: new Date(), voidReason: reason, voidedById: req.user!.id } });
    await audit(req, { action: 'expense.void', entityType: 'Expense', entityId: id, after: { reason, amountMinor: e.amountMinor } }, tx);
  });
  broadcast({ type: 'finance.changed' });
  res.json({ ok: true });
});

// ───────────── reports ─────────────
const reportQuery = z.object({ from: date, to: date, granularity: z.enum(['day', 'week', 'month']).optional() }).refine((q) => q.from <= q.to, { message: '"From" must be before "to"', path: ['from'] }).refine((q) => Date.parse(q.to) - Date.parse(q.from) <= 400 * 86_400_000, { message: 'Choose at most about 13 months', path: ['to'] });

financeRouter.get('/reports/summary', requirePermission('reports.view'), async (req, res) => {
  const q = parseBody(reportQuery, req.query);
  res.json({ report: await buildReport(q.from, q.to, q.granularity) });
});

financeRouter.get('/reports/export', requirePermission('reports.export'), async (req, res) => {
  const q = parseBody(reportQuery.and(z.object({ format: z.enum(['csv', 'xlsx', 'pdf']) })), req.query);
  const report = await buildReport(q.from, q.to, q.granularity);
  const s = await getSettings();
  const base = `bite-and-brew-report-${q.from}_to_${q.to}`;
  await audit(req, { action: 'report.export', entityType: 'Report', entityId: null, after: { from: q.from, to: q.to, format: q.format } });
  if (q.format === 'csv') {
    res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
    res.type('text/csv; charset=utf-8').send(reportCsv(report, s.businessName));
  } else if (q.format === 'xlsx') {
    res.setHeader('Content-Disposition', `attachment; filename="${base}.xlsx"`);
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(await reportXlsx(report, s.businessName));
  } else {
    res.setHeader('Content-Disposition', `attachment; filename="${base}.pdf"`);
    res.type('application/pdf').send(await reportPdf(report, s));
  }
});

export { hasPermission };
