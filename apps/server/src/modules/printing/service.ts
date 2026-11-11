/**
 * Print service: runs inside the café server (same LAN as the printers) and delivers queued
 * print jobs to network thermal printers over raw TCP (port 9100, ESC/POS).
 *
 * Duplicate protection: a job is claimed atomically (FOR UPDATE SKIP LOCKED). A job is only
 * retried automatically when the connection failed BEFORE any data was sent; if the result
 * is unknown (connection dropped mid-print) it is marked FAILED for a person to check and
 * reprint deliberately — so a ticket is never printed twice by the system on its own.
 */
import net from 'node:net';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { broadcast } from '../../realtime/hub.js';
import { renderEscPos, type PrintPayload } from './render.js';

const MAX_CONNECT_ATTEMPTS = 3;
const TIMEOUT_MS = 8000;

class ConnectError extends Error {}

export function sendToPrinter(host: string, port: number, data: Buffer, timeoutMs = TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let connected = false;
    const fail = (err: Error) => { socket.destroy(); reject(connected ? err : new ConnectError(err.message)); };
    socket.setTimeout(timeoutMs, () => fail(new Error(connected ? 'Printer stopped responding' : 'Printer did not answer (timeout)')));
    socket.once('error', fail);
    socket.connect(port, host, () => {
      connected = true;
      socket.end(data, () => undefined);
    });
    socket.once('close', (hadError) => { if (!hadError && connected) resolve(); });
  });
}

export function probePrinter(host: string, port: number, timeoutMs = 2500): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok: boolean) => { s.destroy(); resolve(ok); };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

/** Claim and print one job. Returns true if a job was processed. */
export async function processNextJob(): Promise<boolean> {
  const printers = await prisma.printer.findMany({ where: { isActive: true, NOT: { host: '' } } });
  if (!printers.length) return false;
  const roles = printers.map((p) => p.role);
  const claimed = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE print_jobs SET status = 'PRINTING', claimed_at = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM print_jobs
      WHERE status = 'PENDING' AND role::text = ANY(${roles}::text[])
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id`;
  if (!claimed.length) return false;
  const job = await prisma.printJob.findUniqueOrThrow({ where: { id: claimed[0]!.id } });
  const printer = printers.find((p) => p.role === job.role)!;
  const data = renderEscPos(job.payload as unknown as PrintPayload, { paperWidthMm: printer.paperWidthMm, cut: printer.cutPaper, openDrawer: printer.openDrawer && job.kind === 'RECEIPT' && job.reprintNo === 0 });
  try {
    await sendToPrinter(printer.host, printer.port, data);
    await prisma.printJob.update({ where: { id: job.id }, data: { status: 'PRINTED', printedAt: new Date(), lastError: null } });
    await prisma.printer.update({ where: { id: printer.id }, data: { status: 'ONLINE', lastSeenAt: new Date(), lastError: null } });
  } catch (err) {
    const message = (err as Error).message.slice(0, 280);
    const retry = err instanceof ConnectError && job.attempts < MAX_CONNECT_ATTEMPTS;
    await prisma.printJob.update({
      where: { id: job.id },
      data: { status: retry ? 'PENDING' : 'FAILED', lastError: retry ? message : err instanceof ConnectError ? message : `Result unknown — check the printer and reprint if needed (${message})` },
    });
    await prisma.printer.update({ where: { id: printer.id }, data: { status: 'OFFLINE', lastError: message } });
    logger.warn({ jobId: job.id, role: job.role, err: message, retry }, 'Print job failed');
  }
  broadcast({ type: 'printers.changed' });
  return true;
}

/** Jobs stuck in PRINTING (e.g. server restarted mid-print) → FAILED, never auto-reprinted. */
export async function failStuckJobs() {
  const r = await prisma.printJob.updateMany({
    where: { status: 'PRINTING', claimedAt: { lt: new Date(Date.now() - 60_000) } },
    data: { status: 'FAILED', lastError: 'Result unknown (service interrupted) — check the printer and reprint if needed' },
  });
  if (r.count) broadcast({ type: 'printers.changed' });
}

export async function refreshPrinterStatus() {
  const printers = await prisma.printer.findMany({ where: { isActive: true } });
  for (const p of printers) {
    const status = !p.host ? 'NOT_CONFIGURED' : (await probePrinter(p.host, p.port)) ? 'ONLINE' : 'OFFLINE';
    if (status !== p.status) {
      await prisma.printer.update({ where: { id: p.id }, data: { status, ...(status === 'ONLINE' ? { lastSeenAt: new Date() } : {}) } });
      broadcast({ type: 'printers.changed' });
    }
  }
}

export function startPrintService() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      while (await processNextJob()) { /* drain queue */ }
    } catch (err) {
      logger.error({ err }, 'Print service error');
    } finally {
      busy = false;
    }
  };
  setInterval(tick, 1000).unref();
  setInterval(() => void failStuckJobs().catch(() => undefined), 30_000).unref();
  setInterval(() => void refreshPrinterStatus().catch(() => undefined), 30_000).unref();
  void failStuckJobs().then(refreshPrinterStatus).catch(() => undefined);
  logger.info('Print service started');
}
