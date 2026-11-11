import type { BusinessSettingsDTO } from '@bitebrew/shared';
import { prisma } from '../../lib/prisma.js';
import type { Tx } from '../../lib/prisma.js';

type Row = Awaited<ReturnType<typeof prisma.businessSettings.findUniqueOrThrow>>;

export function toSettingsDTO(s: Row): BusinessSettingsDTO {
  const { id: _id, updatedById: _u, updatedAt, ...rest } = s;
  return { ...rest, updatedAt: updatedAt.toISOString() };
}

/** Returns the singleton settings row, creating it with defaults on first use. */
export async function getSettings(tx: Tx | typeof prisma = prisma): Promise<Row> {
  return tx.businessSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}
