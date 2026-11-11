import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { loadSession, requireAuth } from './middleware/auth.js';
import { requireClientHeader } from './middleware/csrf.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { auditRouter } from './modules/audit/routes.js';
import { authRouter } from './modules/auth/routes.js';
import { categoriesRouter } from './modules/categories/routes.js';
import { dashboardRouter } from './modules/dashboard/routes.js';
import { healthRouter } from './modules/health/routes.js';
import { inventoryRouter } from './modules/inventory/routes.js';
import { productionRouter } from './modules/production/routes.js';
import { productsRouter } from './modules/products/routes.js';
import { settingsRouter } from './modules/settings/routes.js';
import { usersRouter } from './modules/users/routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          workerSrc: ["'self'"],
          manifestSrc: ["'self'"],
          // Only force HTTPS sub-requests when the deployment actually serves HTTPS.
          upgradeInsecureRequests: env.COOKIE_SECURE ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  if (env.APP_ENV !== 'test') {
    app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
  }
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(requireClientHeader);
  api.use(healthRouter);
  api.use(loadSession);
  api.use('/auth', authRouter);
  api.use(requireAuth);
  api.use('/settings', settingsRouter);
  api.use('/categories', categoriesRouter);
  api.use('/users', usersRouter);
  api.use('/audit', auditRouter);
  api.use('/dashboard', dashboardRouter);
  api.use(inventoryRouter);
  api.use(productsRouter);
  api.use(productionRouter);
  api.use(notFoundHandler);
  app.use('/api', api);

  // In production the API server also serves the built web app (single origin).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDist = env.WEB_DIST_DIR ?? path.resolve(here, '../../web/dist');
  if (env.APP_ENV !== 'test' && existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/|\/ws).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(webDist, 'index.html'));
    });
    logger.info({ webDist }, 'Serving web app');
  }

  app.use(errorHandler);
  return app;
}
