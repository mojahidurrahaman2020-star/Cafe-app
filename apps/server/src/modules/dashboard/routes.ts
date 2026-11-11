import { Router } from 'express';
import { businessDate, utcOffset } from '@bitebrew/shared';
import { prisma } from '../../lib/prisma.js';
import { requirePermission } from '../../middleware/auth.js';
import { connectedClientCount } from '../../realtime/hub.js';
import { getSettings } from '../settings/service.js';
import { checkDatabase } from '../health/routes.js';

export const dashboardRouter = Router();

/**
 * Phase 1 dashboard summary. Only figures the system can actually know today
 * are returned. Sales, expenses, stock and printer figures arrive with the
 * phases that create that data — the UI shows them as "not yet available"
 * rather than inventing numbers.
 */
dashboardRouter.get('/summary', requirePermission('dashboard.view'), async (_req, res) => {
  const now = new Date();
  const [settings, db, groups, inactiveCategories, usersByRole, activeSessions] = await Promise.all([
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
  });
});
