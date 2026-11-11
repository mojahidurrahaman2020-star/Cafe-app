/**
 * DEMO / DEVELOPMENT seed — creates one clearly labelled demo account per role.
 * Refuses to run when APP_ENV=production, so demo credentials can never reach
 * the live café database.
 */
import { env } from '../config/env.js';
import { hashPassword } from '../lib/password.js';
import { prisma } from '../lib/prisma.js';
import { seedBase } from './seed.js';
import type { Role } from '@bitebrew/shared';

export const DEMO_PASSWORD = 'demo-pass-2027';
export const DEMO_USERS: { username: string; fullName: string; role: Role }[] = [
  { username: 'owner', fullName: 'Demo Owner', role: 'OWNER' },
  { username: 'manager', fullName: 'Demo Manager', role: 'MANAGER' },
  { username: 'cashier', fullName: 'Demo Cashier', role: 'CASHIER' },
  { username: 'barista', fullName: 'Demo Barista', role: 'BARISTA' },
  { username: 'kitchen', fullName: 'Demo Kitchen', role: 'KITCHEN' },
];

async function main() {
  if (env.APP_ENV === 'production') {
    console.error('Refusing to create demo accounts: APP_ENV=production.');
    process.exit(1);
  }
  await seedBase();
  const hash = await hashPassword(DEMO_PASSWORD);
  for (const u of DEMO_USERS) {
    await prisma.user.upsert({
      where: { username: u.username },
      update: {},
      create: { ...u, passwordHash: hash },
    });
  }
  console.log(`DEMO accounts ready (APP_ENV=${env.APP_ENV}). Password for all: ${DEMO_PASSWORD}`);
  for (const u of DEMO_USERS) console.log(`  ${u.role.padEnd(8)} ${u.username}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
