import { createServer } from 'node:http';
import { env } from './config/env.js';
import { createApp } from './app.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { attachRealtime } from './realtime/hub.js';
import { getSettings } from './modules/settings/service.js';

async function main() {
  await prisma.$queryRaw`SELECT 1`;
  await getSettings(); // ensure the settings singleton exists
  logger.info('Database connection OK');

  const server = createServer(createApp());
  attachRealtime(server);
  server.listen(env.PORT, () => {
    logger.info(`Bite & Brew API listening on http://localhost:${env.PORT} (APP_ENV=${env.APP_ENV})`);
  });

  // Purge long-expired sessions daily.
  setInterval(() => {
    prisma.session
      .deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 7 * 86_400_000) } } })
      .catch((err) => logger.warn({ err }, 'Session cleanup failed'));
  }, 86_400_000).unref();

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

process.on('unhandledRejection', (err) => logger.error({ err }, 'Unhandled promise rejection'));

main().catch((err) => {
  logger.fatal({ err }, 'Server failed to start — is PostgreSQL running and DATABASE_URL correct?');
  process.exit(1);
});
