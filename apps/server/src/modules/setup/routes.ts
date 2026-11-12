import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { passwordSchema, usernameSchema, permissionsFor } from '@bitebrew/shared';
import { env } from '../../config/env.js';
import { audit } from '../../lib/audit.js';
import { HttpError, conflict } from '../../lib/errors.js';
import { hashPassword } from '../../lib/password.js';
import { prisma } from '../../lib/prisma.js';
import { parseBody } from '../../lib/validate.js';
import { seedBase } from '../../scripts/seed.js';
import { createSession, setSessionCookie } from '../auth/session.js';

/**
 * First-run setup for a freshly deployed website (no command line needed).
 * Works only while there are NO user accounts, and only with the SETUP_TOKEN that was
 * configured on the server — so nobody who merely finds the address can claim the café.
 */
export const setupRouter = Router();

const limiter = rateLimit({ windowMs: 15 * 60_000, limit: env.APP_ENV === 'test' ? 1000 : 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes.' } } });

setupRouter.get('/setup/status', async (_req, res) => {
  const users = await prisma.user.count();
  res.json({ needsSetup: users === 0, tokenRequired: !!env.SETUP_TOKEN });
});

const schema = z.object({ setupToken: z.string().max(200).default(''), username: usernameSchema, fullName: z.string().trim().min(1).max(100), password: passwordSchema });

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

setupRouter.post('/setup', limiter, async (req, res) => {
  const d = parseBody(schema, req.body);
  if (env.isProduction && !env.SETUP_TOKEN) throw new HttpError(503, 'SETUP_DISABLED', 'First-run setup is not enabled on this server. Set SETUP_TOKEN, or create the owner from the command line.');
  if (env.SETUP_TOKEN && !same(d.setupToken, env.SETUP_TOKEN)) throw new HttpError(403, 'BAD_SETUP_TOKEN', 'The setup code is not correct. Find it in your hosting dashboard under the SETUP_TOKEN setting.');
  const passwordHash = await hashPassword(d.password);
  const user = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('first_run_setup'))`;
    if ((await tx.user.count()) > 0) throw conflict('Setup has already been completed. Please sign in.');
    const u = await tx.user.create({ data: { username: d.username, fullName: d.fullName, role: 'OWNER', passwordHash } });
    await audit(null, { action: 'user.create_owner_setup', entityType: 'User', entityId: u.id, after: { username: u.username, role: u.role } }, tx);
    return u;
  });
  await seedBase();
  const { token, expiresAt } = await createSession(user.id, req.ip, req.get('user-agent'));
  setSessionCookie(res, token, expiresAt);
  res.status(201).json({ user: { id: user.id, username: user.username, fullName: user.fullName, role: user.role, permissions: permissionsFor(user.role) } });
});
