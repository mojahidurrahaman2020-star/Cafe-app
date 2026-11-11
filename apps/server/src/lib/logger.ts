import { pino } from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.APP_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]', '*.password', '*.passwordHash'],
    censor: '[redacted]',
  },
  // Human-readable logs only in local development (pino-pretty is a dev dependency).
  // Every deployed environment (demo, production) logs structured JSON.
  ...(env.APP_ENV !== 'development'
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } } }),
});
