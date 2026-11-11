import type { NextFunction, Request, Response } from 'express';
import type { Permission, SessionUser } from '@bitebrew/shared';
import { hasPermission } from '@bitebrew/shared';
import { forbidden, unauthorized } from '../lib/errors.js';
import { resolveSession, SESSION_COOKIE } from '../modules/auth/session.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
      sessionId?: string;
    }
  }
}

/** Attaches req.user when a valid session cookie is present. Never rejects. */
export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  const resolved = await resolveSession(req.cookies?.[SESSION_COOKIE]);
  if (resolved) {
    req.user = resolved.user;
    req.sessionId = resolved.sessionId;
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw unauthorized();
  next();
}

export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw unauthorized();
    if (!hasPermission(req.user.role, permission)) throw forbidden();
    next();
  };
}
