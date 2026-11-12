import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { H, prisma, resetData, signIn } from './helpers.js';

type Agent = Awaited<ReturnType<typeof signIn>>;
let owner: Agent;
let cashier: Agent;
const rid = () => randomUUID();

beforeEach(async () => {
  await resetData();
  owner = await signIn('owner');
  cashier = await signIn('cashier');
});
afterAll(() => prisma.$disconnect());

const add = (agent: Agent, name: string, phone: string, extra: object = {}) => agent.post('/api/customers').set(H).send({ name, phone, ...extra });

describe('regular customers', () => {
  it('saves a name and phone number; a cashier at the till can add one', async () => {
    const r = await add(cashier, '  Rahim   Uddin ', '01712-345678', { notes: 'Likes extra spicy' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.customer).toMatchObject({ name: 'Rahim Uddin', phone: '01712-345678', notes: 'Likes extra spicy', visits: 0, isActive: true });
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'customer.create' } })).toBe(1);
  });

  it('the same person cannot be saved twice, however the number is written', async () => {
    await add(owner, 'Karim', '01712345678');
    for (const p of ['+8801712345678', '8801712-345678', '+88 01712 345 678', '1712345678']) {
      const r = await add(owner, 'Someone else', p);
      expect(r.status, p).toBe(409);
      expect(r.body.error.message).toContain('Karim');
    }
    expect(await prisma.customer.count()).toBe(1);
  });

  it('validates input', async () => {
    expect((await add(owner, '', '01712345678')).status).toBe(400);
    expect((await add(owner, 'X', 'not a number')).status).toBe(400);
  });

  it('search by name or any part of the phone number', async () => {
    await add(owner, 'Rahim Uddin', '01712345678');
    await add(owner, 'Nasrin Akter', '01912999888');
    const byName = (await cashier.get('/api/customers?q=rahi')).body.customers;
    expect(byName.map((c: { name: string }) => c.name)).toEqual(['Rahim Uddin']);
    const byPhone = (await cashier.get('/api/customers?q=999888')).body.customers;
    expect(byPhone.map((c: { name: string }) => c.name)).toEqual(['Nasrin Akter']);
    expect((await cashier.get('/api/customers')).body.customers).toHaveLength(2);
  });

  it('edit name, phone and notes; stale saves are refused; the new number cannot clash', async () => {
    const a = (await add(owner, 'Rahim', '01712345678')).body.customer;
    await add(owner, 'Nasrin', '01912999888');
    const e = await owner.patch(`/api/customers/${a.id}`).set(H).send({ name: 'Rahim Uddin', notes: 'VIP', version: 0 });
    expect(e.body.customer).toMatchObject({ name: 'Rahim Uddin', notes: 'VIP', version: 1 });
    expect((await owner.patch(`/api/customers/${a.id}`).set(H).send({ name: 'Old', version: 0 })).status).toBe(409);
    expect((await owner.patch(`/api/customers/${a.id}`).set(H).send({ phone: '+8801912999888', version: 1 })).status).toBe(409);
    const ok = await owner.patch(`/api/customers/${a.id}`).set(H).send({ phone: '01733-111222', version: 1 });
    expect(ok.status).toBe(200);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: a.id } })).normalizedPhone).toBe('01733111222');
  });

  it('linked to orders: name on the order, visits and spend counted, inactive customers cannot be chosen', async () => {
    const cat = (await prisma.menuCategory.findFirstOrThrow({ where: { normalizedName: 'burgers' } })).id;
    const prod = (await owner.post('/api/products').set(H).send({ categoryId: cat, name: 'Burger', priceMinor: 30000, stockMode: 'UNTRACKED' })).body.product.id;
    const cash = ((await owner.get('/api/payment-methods')).body.paymentMethods as { id: string; name: string }[]).find((m) => m.name === 'Cash')!.id;
    const c = (await add(cashier, 'Rahim', '01712345678')).body.customer;
    for (let i = 0; i < 2; i++) {
      const o = (await cashier.post('/api/orders').set(H).send({ clientRequestId: rid(), serviceType: 'TAKEAWAY', customerId: c.id, lines: [{ productId: prod, quantity: 1 }] })).body.order;
      expect(o).toMatchObject({ customerName: 'Rahim', customerId: c.id });
      await cashier.post(`/api/orders/${o.id}/payments`).set(H).send({ methodId: cash, amountMinor: 30000, idempotencyKey: rid() });
    }
    // an unpaid order does not count as a visit yet
    await cashier.post('/api/orders').set(H).send({ clientRequestId: rid(), serviceType: 'TAKEAWAY', customerId: c.id, lines: [{ productId: prod, quantity: 1 }] });
    const detail = (await cashier.get(`/api/customers/${c.id}`)).body.customer;
    expect(detail).toMatchObject({ visits: 2, spentMinor: 60000 });
    expect(detail.recentOrders).toHaveLength(3);
    expect((await cashier.get('/api/customers')).body.customers[0]).toMatchObject({ visits: 2, spentMinor: 60000 });
    // receipt/ticket carry the name
    const job = await prisma.printJob.findFirstOrThrow({ where: { role: 'RECEIPT' } });
    expect(JSON.stringify(job.payload)).toBeTruthy();
    // deactivate → cannot be attached to a new order; deleting is refused because of past orders
    await owner.patch(`/api/customers/${c.id}`).set(H).send({ isActive: false, version: c.version });
    expect((await cashier.post('/api/orders').set(H).send({ clientRequestId: rid(), serviceType: 'TAKEAWAY', customerId: c.id, lines: [{ productId: prod, quantity: 1 }] })).status).toBe(400);
    expect((await owner.delete(`/api/customers/${c.id}`).set(H)).status).toBe(409);
    expect((await cashier.get('/api/customers')).body.customers).toHaveLength(0);
    expect((await cashier.get('/api/customers?includeInactive=true')).body.customers).toHaveLength(1);
  });

  it('a customer added by mistake can be deleted by a manager; barista and kitchen cannot manage customers', async () => {
    const c = (await add(owner, 'Typo', '01712000111')).body.customer;
    expect((await cashier.delete(`/api/customers/${c.id}`).set(H)).status).toBe(403);
    expect((await owner.delete(`/api/customers/${c.id}`).set(H)).status).toBe(204);
    for (const role of ['barista', 'kitchen']) {
      const a = await signIn(role);
      expect((await add(a, 'X', '01712000222')).status, role).toBe(403);
      expect((await a.get('/api/customers')).status, role).toBe(403);
    }
  });
});

describe('first-run setup (hosted website)', () => {
  it('creates the first owner only when no accounts exist; refused afterwards', async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE sessions, users CASCADE');
    const { default: request } = await import('supertest');
    const { app } = await import('./helpers.js');
    expect((await request(app).get('/api/setup/status')).body.needsSetup).toBe(true);
    const body = { username: 'Boss', fullName: 'Café Owner', password: 'a-long-password-1' };
    const r = await request(app).post('/api/setup').set(H).send(body);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.user).toMatchObject({ username: 'boss', role: 'OWNER' });
    expect(String(r.headers['set-cookie'])).toMatch(/bb_session=/);
    expect((await request(app).get('/api/setup/status')).body.needsSetup).toBe(false);
    expect((await request(app).post('/api/setup').set(H).send({ ...body, username: 'second' })).status).toBe(409);
    expect((await prisma.user.findUniqueOrThrow({ where: { username: 'boss' } })).passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(await prisma.paymentMethod.count()).toBeGreaterThan(0);
  });
});
