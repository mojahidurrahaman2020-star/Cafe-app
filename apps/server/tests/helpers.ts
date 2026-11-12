import request from 'supertest';
import type { Role } from '@bitebrew/shared';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/lib/password.js';
import { prisma } from '../src/lib/prisma.js';
import { seedBase } from '../src/scripts/seed.js';

export const app = createApp();
export const PASSWORD = 'test-password-123';

export async function resetData() {
  // Audit log is append-only by trigger; TRUNCATE is a deliberate DBA-level
  // operation that row triggers do not fire on, which is what a test reset needs.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE customers, print_jobs, payments, refunds, order_lines, orders, cash_sessions, expenses, expense_categories, tax_rates, payment_methods, printers, stock_movements, finished_movements, production_batches, recipe_lines, modifiers, modifier_groups, product_images, products, ingredients, suppliers, audit_logs, sessions, menu_categories, users, business_settings RESTART IDENTITY CASCADE',
  );
  await seedBase();
  const hash = await hashPassword(PASSWORD);
  const roles: Role[] = ['OWNER', 'MANAGER', 'CASHIER', 'BARISTA', 'KITCHEN'];
  for (const role of roles) {
    await prisma.user.create({
      data: { username: role.toLowerCase(), fullName: `Test ${role}`, role, passwordHash: hash },
    });
  }
}

/** Returns a supertest agent that is signed in as the given user (keeps cookies). */
export async function signIn(username: string, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/login')
    .set('x-bitebrew-client', 'web')
    .send({ username, password });
  if (res.status !== 200) throw new Error(`login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

export const H = { 'x-bitebrew-client': 'web' };
export { prisma, request };
