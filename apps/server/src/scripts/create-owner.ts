/**
 * Create the first (or an additional) owner account — the production way to
 * bootstrap the system. Usage:
 *   npm run create-owner                      (interactive prompts)
 *   OWNER_USERNAME=.. OWNER_NAME=.. OWNER_PASSWORD=.. npm run create-owner
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createUserSchema } from '@bitebrew/shared';
import { audit } from '../lib/audit.js';
import { hashPassword } from '../lib/password.js';
import { prisma } from '../lib/prisma.js';
import { seedBase } from './seed.js';

async function ask(rl: ReturnType<typeof createInterface>, q: string, fallback?: string) {
  if (fallback) return fallback;
  return (await rl.question(q)).trim();
}

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const username = await ask(rl, 'Owner username: ', process.env.OWNER_USERNAME);
    const fullName = await ask(rl, 'Full name: ', process.env.OWNER_NAME);
    const password = await ask(rl, 'Password (min 10 chars): ', process.env.OWNER_PASSWORD);
    const parsed = createUserSchema.safeParse({ username, fullName, password, role: 'OWNER' });
    if (!parsed.success) {
      console.error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
      process.exitCode = 1;
      return;
    }
    if (await prisma.user.findUnique({ where: { username: parsed.data.username } })) {
      console.error(`User "${parsed.data.username}" already exists.`);
      process.exitCode = 1;
      return;
    }
    await seedBase();
    const user = await prisma.user.create({
      data: {
        username: parsed.data.username,
        fullName: parsed.data.fullName,
        role: 'OWNER',
        passwordHash: await hashPassword(parsed.data.password),
      },
    });
    await audit(null, { action: 'user.create_owner_cli', entityType: 'User', entityId: user.id, after: { username: user.username, role: user.role } });
    console.log(`Owner account "${user.username}" created.`);
  } finally {
    rl.close();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
