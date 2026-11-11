import { Router } from 'express';
import { z } from 'zod';
import type { AuditLogDTO } from '@bitebrew/shared';
import { prisma } from '../../lib/prisma.js';
import { parseBody } from '../../lib/validate.js';
import { requirePermission } from '../../middleware/auth.js';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.bigint().optional(),
  entityType: z.string().max(60).optional(),
});

export const auditRouter = Router();

auditRouter.get('/', requirePermission('audit.view'), async (req, res) => {
  const q = parseBody(querySchema, req.query);
  const rows = await prisma.auditLog.findMany({
    where: {
      ...(q.before ? { id: { lt: q.before } } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
    },
    orderBy: { id: 'desc' },
    take: q.limit,
    include: { actor: { select: { id: true, username: true, fullName: true } } },
  });
  const entries: AuditLogDTO[] = rows.map((r) => ({
    id: r.id.toString(),
    occurredAt: r.occurredAt.toISOString(),
    actor: r.actor,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    before: r.before,
    after: r.after,
    ipAddress: r.ipAddress,
  }));
  res.json({ entries, nextBefore: rows.length === q.limit ? rows.at(-1)!.id.toString() : null });
});
