import type { PrinterRole } from '@bitebrew/shared';
import type { Tx } from '../../lib/prisma.js';
import type { PrintPayload } from './render.js';
export { receiptPayload, testPayload, ticketPayload } from '@bitebrew/shared';

/** Queue a job unless an identical one exists (UNIQUE idempotency key). */
export async function queueJob(
  tx: Tx,
  job: { key: string; role: PrinterRole; kind: 'RECEIPT' | 'TICKET' | 'TEST'; orderId?: string | null; payload: PrintPayload; reprintNo?: number; reprintReason?: string | null; requestedById?: string | null },
) {
  const existing = await tx.printJob.findUnique({ where: { idempotencyKey: job.key } });
  if (existing) return existing;
  return tx.printJob.create({
    data: {
      idempotencyKey: job.key, role: job.role, kind: job.kind, orderId: job.orderId ?? null, payload: job.payload as never,
      reprintNo: job.reprintNo ?? 0, reprintReason: job.reprintReason ?? null, requestedById: job.requestedById ?? null,
    },
  });
}
