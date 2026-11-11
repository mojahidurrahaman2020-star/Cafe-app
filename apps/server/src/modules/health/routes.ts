import { Router } from 'express';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { APP_VERSION } from '../../version.js';

export const healthRouter = Router();

export async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number | null }> {
  const started = performance.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch {
    return { ok: false, latencyMs: null };
  }
}

/** Public, unauthenticated. Used by devices to detect connectivity and by uptime monitors. */
healthRouter.get('/health', async (_req, res) => {
  const db = await checkDatabase();
  res.status(db.ok ? 200 : 503).json({
    status: db.ok ? 'ok' : 'degraded',
    database: db.ok ? 'up' : 'down',
    dbLatencyMs: db.latencyMs,
    serverTime: new Date().toISOString(),
  });
});

/** Public: lets the login screen show which environment it is connected to. */
healthRouter.get('/info', (_req, res) => {
  res.json({ appEnv: env.APP_ENV, version: APP_VERSION, serverTime: new Date().toISOString() });
});
