import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { changePasswordSchema, loginSchema, permissionsFor } from '@bitebrew/shared';
import { env } from '../../config/env.js';
import { audit } from '../../lib/audit.js';
import { badRequest, HttpError } from '../../lib/errors.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../../lib/password.js';
import { prisma } from '../../lib/prisma.js';
import { parseBody } from '../../lib/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { clearSessionCookie, createSession, revokeUserSessions, setSessionCookie } from './session.js';

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.APP_ENV === 'test' ? 1000 : 50,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Please wait a few minutes.' } },
});

export const authRouter = Router();

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = parseBody(loginSchema, req.body);
  const invalid = new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect username or password');

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    await burnPasswordCheck(password);
    throw invalid;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new HttpError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. This account is temporarily locked — try again later or ask the owner.');
  }

  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok || !user.isActive) {
    if (ok && !user.isActive) {
      throw new HttpError(403, 'ACCOUNT_DISABLED', 'This account has been deactivated');
    }
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
    });
    if (updated.failedLoginCount >= MAX_FAILED_LOGINS) {
      await prisma.user.update({
        where: { id: user.id },
        data: { lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000), failedLoginCount: 0 },
      });
      await audit(req, { action: 'auth.lockout', entityType: 'User', entityId: user.id });
    }
    throw invalid;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  const { token, expiresAt } = await createSession(user.id, req.ip, req.get('user-agent'));
  setSessionCookie(res, token, expiresAt);
  req.user = { id: user.id, username: user.username, fullName: user.fullName, role: user.role, permissions: [] };
  await audit(req, { action: 'auth.login', entityType: 'User', entityId: user.id });

  res.json({
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      permissions: permissionsFor(user.role),
    },
    expiresAt: expiresAt.toISOString(),
  });
});

authRouter.post('/logout', async (req, res) => {
  if (req.sessionId) {
    await prisma.session.update({ where: { id: req.sessionId }, data: { revokedAt: new Date() } });
    await audit(req, { action: 'auth.logout', entityType: 'User', entityId: req.user?.id });
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

/** Who is signed in on this device? Returns { user: null } (not 401) when nobody is. */
authRouter.get('/me', (req, res) => {
  res.json({ user: req.user ?? null });
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = parseBody(changePasswordSchema, req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw badRequest('Current password is incorrect');
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword), version: { increment: 1 } },
  });
  // Sign out every other device that was using the old password.
  await revokeUserSessions(user.id, req.sessionId);
  await audit(req, { action: 'auth.change_password', entityType: 'User', entityId: user.id });
  res.json({ ok: true });
});
