import { createHash, randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { permissionsFor, type SessionUser } from '@bitebrew/shared';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';

export const SESSION_COOKIE = 'bb_session';
const TOUCH_INTERVAL_MS = 60_000;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(userId: string, ip: string | undefined, userAgent: string | undefined) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3_600_000);
  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      ipAddress: ip?.slice(0, 64),
      userAgent: userAgent?.slice(0, 300),
    },
  });
  return { token, expiresAt };
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'strict', path: '/' });
}

/** Resolve a raw session token to the signed-in user, or null if invalid/expired/revoked. */
export async function resolveSession(token: string | undefined): Promise<{ sessionId: string; user: SessionUser } | null> {
  if (!token || token.length > 200) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  const now = new Date();
  if (!session || session.revokedAt || session.expiresAt <= now || !session.user.isActive) return null;

  if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now } }).catch(() => undefined);
  }
  const u = session.user;
  return {
    sessionId: session.id,
    user: { id: u.id, username: u.username, fullName: u.fullName, role: u.role, permissions: permissionsFor(u.role) },
  };
}

export async function revokeUserSessions(userId: string, exceptSessionId?: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}
