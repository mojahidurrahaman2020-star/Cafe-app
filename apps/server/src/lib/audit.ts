import type { Request } from 'express';
import type { Tx } from './prisma.js';
import { prisma } from './prisma.js';

export interface AuditEntry {
  action: string; // e.g. "category.update"
  entityType: string; // e.g. "MenuCategory"
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

const SENSITIVE = new Set(['passwordHash', 'password', 'tokenHash']);

function scrub(value: unknown): unknown {
  if (value === undefined || value === null) return value ?? undefined;
  return JSON.parse(
    JSON.stringify(value, (k, v) => (SENSITIVE.has(k) ? '[redacted]' : typeof v === 'bigint' ? v.toString() : v)),
  );
}

/** Write an audit entry. Pass the transaction client so the audit row commits
 *  (or rolls back) together with the change it describes. */
export async function audit(req: Request | null, entry: AuditEntry, tx: Tx | typeof prisma = prisma) {
  await tx.auditLog.create({
    data: {
      actorId: req?.user?.id ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: scrub(entry.before) as never,
      after: scrub(entry.after) as never,
      ipAddress: req?.ip?.slice(0, 64) ?? null,
      userAgent: req?.get('user-agent')?.slice(0, 300) ?? null,
    },
  });
}
