import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/errors.js';

/**
 * CSRF defence in depth. The session cookie is SameSite=Strict, and every
 * state-changing request must also carry a custom header, which browsers will
 * not let another site attach to a cross-origin request without a CORS
 * preflight (and we do not grant cross-origin CORS).
 */
export const CSRF_HEADER = 'x-bitebrew-client';

export function requireClientHeader(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get(CSRF_HEADER) !== 'web') {
    throw new HttpError(403, 'CSRF', 'Request blocked: missing client header');
  }
  next();
}
