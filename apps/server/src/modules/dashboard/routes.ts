import { Router } from 'express';
import { businessDate, utcOffset } from '@bitebrew/shared';
import { prisma } from '../../lib/prisma.js';
import { requirePermission } from '../../middleware/auth.js';
import { connectedClientCount } from '../../realtime/hub.js';
import { getSettings } from '../settings/service.js';
import { checkDatabase } from '../health/routes.js';
import { stockSummary } from '../inventory/routes.js';
import { hasPermission } from '@bitebrew/shared';
import { z } from 'zod';
import { buildReport, addDays } from '../finance/report.js';
import { printersDTO } from '../printing/routes.js';
import { parseBody } from '../../lib/validate.js';

export const dashboardRouter = Router();

/**
 * Phase 1 dashboard summary. Only figures the system can actually know today
 * are returned. Sales, expenses, stock and printer figures arrive with the
 * phases that create that data — the UI shows them as "not yet available"
 * rather than inventing numbers.
 */
dashboardRouter.get('/summary', requirePermission('dashboard.view'), async (req, res) => {
  const now = new Date();
  const [settings, db, groups, inactiveCategories, usersByRole, activeSessions, stock] = await Promise.all([
    getSettings(),
    checkDatabase(),
    prisma.menuCategory.groupBy({ by: ['group'], where: { isActive: true }, _count: { _all: true } }),
    prisma.menuCategory.count({ where: { isActive: false } }),
    prisma.user.groupBy({ by: ['role'], where: { isActive: true }, _count: { _all: true } }),
    prisma.session.findMany({
      where: { revokedAt: null, expiresAt: { gt: now } },
      select: { userId: true },
      distinct: ['userId'],
    }),
    stockSummary(hasPermission(req.user!.role, 'reports.view')),
  ]);

  res.json({
    businessDate: businessDate(now, settings.timezone, settings.businessDayStartHour),
    timezone: settings.timezone,
    utcOffset: utcOffset(settings.timezone, now),
    serverTime: now.toISOString(),
    database: { ok: db.ok, latencyMs: db.latencyMs },
    realtimeClients: connectedClientCount(),
    staffSignedIn: activeSessions.length,
    categories: {
      byGroup: Object.fromEntries(groups.map((g) => [g.group, g._count._all])),
      inactive: inactiveCategories,
    },
    activeUsersByRole: Object.fromEntries(usersByRole.map((u) => [u.role, u._count._all])),
    stock,
    ...(await liveFigures(req, settings)),
  });
});

async function liveFigures(req: import('express').Request, settings: { timezone: string; businessDayStartHour: number }) {
  const { period } = parseBody(z.object({ period: z.enum(['day', 'week', 'month']).default('day') }), req.query);
  const today = businessDate(new Date(), settings.timezone, settings.businessDayStartHour);
  const from = period === 'day' ? today : period === 'month' ? `${today.slice(0, 8)}01` : addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  const canMoney = hasPermission(req.user!.role, 'reports.view');
  const [report, pending, openOrders, heldOrders, needsReview, printers] = await Promise.all([
    canMoney ? buildReport(from, today) : null,
    prisma.orderLine.groupBy({ by: ['station'], where: { prepStatus: { in: ['PENDING', 'PREPARING', 'READY'] }, order: { status: { in: ['OPEN', 'COMPLETED'] }, sentAt: { gte: new Date(Date.now() - 86_400_000) } } }, _count: { _all: true } }),
    prisma.order.count({ where: { status: 'OPEN' } }),
    prisma.order.count({ where: { status: 'HELD' } }),
    prisma.order.count({ where: { needsReview: true } }),
    printersDTO(),
  ]);
  return {
    period, periodFrom: from, periodTo: today, report,
    kitchenPending: pending.find((p) => p.station === 'KITCHEN')?._count._all ?? 0,
    baristaPending: pending.find((p) => p.station === 'BARISTA')?._count._all ?? 0,
    openOrders, heldOrders, needsReview,
    printers: printers.map((p) => ({ role: p.role, name: p.name, status: p.status, pendingJobs: p.pendingJobs, failedJobs: p.failedJobs })),
  };
}
