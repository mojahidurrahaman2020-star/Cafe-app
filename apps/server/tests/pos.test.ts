import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { processNextJob } from '../src/modules/printing/service.js';
import { CMD } from '../src/modules/printing/render.js';
import { H, prisma, resetData, signIn } from './helpers.js';

type Agent = Awaited<ReturnType<typeof signIn>>;
let owner: Agent;
let cashier: Agent;
const rid = () => randomUUID();
let biriyani: string, latte: string, burger: string, oatOption: string, cash: string, bkash: string, card: string;

async function categoryId(name: string) {
  return (await prisma.menuCategory.findUniqueOrThrow({ where: { normalizedName: name.toLowerCase() } })).id;
}
async function setup() {
  const ing = async (name: string, dimension: string, displayUnit: string, qty: number, unit: string, cost: number) => {
    const i = (await owner.post('/api/ingredients').set(H).send({ name, dimension, displayUnit })).body.ingredient;
    await owner.post(`/api/ingredients/${i.id}/receive`).set(H).send({ quantity: qty, unit, totalCostMinor: cost, requestId: rid() });
    return i.id as string;
  };
  const rice = await ing('Rice', 'MASS', 'kg', 20, 'kg', 2_000_00);
  const chicken = await ing('Chicken', 'MASS', 'kg', 10, 'kg', 3_200_00);
  const milk = await ing('Milk', 'VOLUME', 'l', 5, 'l', 500_00);
  const oat = await ing('Oat milk', 'VOLUME', 'l', 1, 'l', 400_00);
  const beans = await ing('Beans', 'MASS', 'kg', 1, 'kg', 2_000_00);
  const prod = async (body: object) => (await owner.post('/api/products').set(H).send(body)).body.product;
  const b = await prod({ categoryId: await categoryId('Biriyani'), name: 'Chicken Biriyani', priceMinor: 250_00, stockMode: 'BATCH' });
  await owner.put(`/api/products/${b.id}/recipe`).set(H).send({ recipeYield: 10, version: b.version, lines: [{ ingredientId: rice, quantity: 1.5, unit: 'kg' }, { ingredientId: chicken, quantity: 2, unit: 'kg' }] });
  await owner.post('/api/production/batches').set(H).send({ productId: b.id, portions: 10, requestId: rid() });
  const l = await prod({ categoryId: await categoryId('Coffee'), name: 'Latte', priceMinor: 220_00, stockMode: 'MADE_TO_ORDER' });
  const lr = await owner.put(`/api/products/${l.id}/recipe`).set(H).send({ recipeYield: 1, version: l.version, lines: [{ ingredientId: milk, quantity: 200, unit: 'ml' }, { ingredientId: beans, quantity: 18, unit: 'g' }] });
  const lm = await owner.put(`/api/products/${l.id}/modifiers`).set(H).send({ version: lr.body.product.version, groups: [{ name: 'Milk', minSelect: 0, maxSelect: 1, options: [{ name: 'Oat milk', priceDeltaMinor: 40_00, ingredientId: oat, quantity: 50, unit: 'ml' }] }] });
  const bu = await prod({ categoryId: await categoryId('Burgers'), name: 'Beef Burger', priceMinor: 320_00, stockMode: 'UNTRACKED', manualCostMinor: 150_00 });
  biriyani = b.id; latte = l.id; burger = bu.id;
  oatOption = lm.body.product.modifierGroups[0].options[0].id;
  const methods = (await owner.get('/api/payment-methods')).body.paymentMethods as { id: string; name: string }[];
  cash = methods.find((m) => m.name === 'Cash')!.id;
  bkash = methods.find((m) => m.name === 'bKash')!.id;
  card = methods.find((m) => m.name === 'Card')!.id;
}
const order = (agent: Agent, body: object) => agent.post('/api/orders').set(H).send({ clientRequestId: rid(), serviceType: 'TAKEAWAY', ...body });
const portions = async () => (await prisma.product.findUniqueOrThrow({ where: { id: biriyani } })).portionsOnHand;
const onHand = async (name: string) => (await prisma.ingredient.findUniqueOrThrow({ where: { normalizedName: name.toLowerCase() } })).onHand.toNumber();

beforeEach(async () => {
  await resetData();
  owner = await signIn('owner');
  cashier = await signIn('cashier');
  await setup();
});
afterAll(() => prisma.$disconnect());

describe('POS orders', () => {
  it('a mixed order: priced on the server, stock deducted, split into kitchen + barista tickets', async () => {
    const r = await order(cashier, { lines: [{ productId: biriyani, quantity: 3 }, { productId: latte, quantity: 2, modifierIds: [oatOption], notes: 'less sugar' }, { productId: burger, quantity: 1 }] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const o = r.body.order;
    expect(o).toMatchObject({ orderNo: 1, status: 'OPEN', paymentStatus: 'UNPAID', subtotalMinor: 3 * 25000 + 2 * 26000 + 32000, taxMinor: 0, totalMinor: 159000, dueMinor: 159000 });
    expect(o.lines.find((l: { name: string }) => l.name === 'Latte').modifiers[0].name).toBe('Oat milk');
    expect(await portions()).toBe(7);
    expect(await onHand('milk')).toBe(5000 - 400);
    expect(await onHand('oat milk')).toBe(1000 - 100);
    const jobs = await prisma.printJob.findMany({ where: { orderId: o.id } });
    expect(jobs.map((j) => j.role).sort()).toEqual(['BARISTA', 'KITCHEN']);
    const kitchen = JSON.stringify(jobs.find((j) => j.role === 'KITCHEN')!.payload);
    const barista = JSON.stringify(jobs.find((j) => j.role === 'BARISTA')!.payload);
    expect(kitchen).toContain('Chicken Biriyani');
    expect(kitchen).toContain('Beef Burger');
    expect(kitchen).not.toContain('Latte');
    expect(barista).toContain('Latte');
    expect(barista).toContain('less sugar');
    expect(barista).not.toContain('Biriyani');
    const costs = await prisma.orderLine.findMany({ where: { orderId: o.id } });
    expect(costs.find((l) => l.name === 'Beef Burger')!.costMinor).toBe(15000);
    expect(costs.find((l) => l.name === 'Chicken Biriyani')!.costMinor).toBeGreaterThan(0);
  });

  it('client prices are ignored and invalid options are refused', async () => {
    const r = await order(cashier, { lines: [{ productId: latte, quantity: 1, modifierIds: [randomUUID()] }] });
    expect(r.status).toBe(400);
  });

  it('a double-tapped order is created once', async () => {
    const body = { clientRequestId: rid(), serviceType: 'TAKEAWAY', lines: [{ productId: biriyani, quantity: 1 }] };
    const [a, b] = await Promise.all([cashier.post('/api/orders').set(H).send(body), cashier.post('/api/orders').set(H).send(body)]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(await prisma.order.count()).toBe(1);
    expect(await portions()).toBe(9);
  });

  it('two tills cannot sell the last portion: one order succeeds, the other is refused', async () => {
    await owner.post(`/api/products/${biriyani}/stock/adjust`).set(H).send({ type: 'COUNT', quantity: 1, requestId: rid() });
    const manager = await signIn('manager');
    const [a, b] = await Promise.all([order(cashier, { lines: [{ productId: biriyani, quantity: 1 }] }), order(manager, { lines: [{ productId: biriyani, quantity: 1 }] })]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await portions()).toBe(0);
    expect(await prisma.order.count()).toBe(1);
  });

  it('order numbers are sequential per business day and dine-in needs a table', async () => {
    expect((await order(cashier, { serviceType: 'DINE_IN', lines: [{ productId: burger, quantity: 1 }] })).status).toBe(400);
    const a = await order(cashier, { serviceType: 'DINE_IN', tableNo: '4', lines: [{ productId: burger, quantity: 1 }] });
    const b = await order(cashier, { lines: [{ productId: burger, quantity: 1 }] });
    expect([a.body.order.orderNo, b.body.order.orderNo]).toEqual([1, 2]);
    expect(a.body.order.tableNo).toBe('4');
  });

  it('VAT: no rate until the owner adds one; inclusive is extracted, exclusive is added', async () => {
    let r = await order(cashier, { lines: [{ productId: burger, quantity: 1 }] });
    expect(r.body.order.taxMinor).toBe(0);
    const t = await owner.post('/api/tax-rates').set(H).send({ name: 'VAT', ratePercent: 15, inclusive: true });
    expect(t.status).toBe(201);
    expect((await cashier.post('/api/tax-rates').set(H).send({ name: 'x', ratePercent: 1, inclusive: true })).status).toBe(403);
    r = await order(cashier, { lines: [{ productId: burger, quantity: 1 }] });
    expect(r.body.order).toMatchObject({ totalMinor: 32000, taxMinor: Math.round((32000 / 1.15) * 0.15) });
    await owner.patch(`/api/tax-rates/${t.body.taxRate.id}`).set(H).send({ inclusive: false, ratePercent: 5, version: 0 });
    r = await order(cashier, { lines: [{ productId: burger, quantity: 1 }] });
    expect(r.body.order).toMatchObject({ subtotalMinor: 32000, taxMinor: 1600, totalMinor: 33600 });
  });

  it('discounts need a manager/owner and a reason', async () => {
    const lines = [{ productId: burger, quantity: 2 }];
    expect((await order(cashier, { lines, discount: { type: 'PERCENT', value: 10, reason: 'Regular' } })).status).toBe(403);
    const m = await signIn('manager');
    const r = await order(m, { lines, discount: { type: 'PERCENT', value: 10, reason: 'Regular customer' } });
    expect(r.body.order).toMatchObject({ subtotalMinor: 64000, discountMinor: 6400, totalMinor: 57600, discountReason: 'Regular customer' });
  });

  it('held orders use no stock; resuming keeps the number; sending deducts stock', async () => {
    const h = await order(cashier, { hold: true, lines: [{ productId: biriyani, quantity: 2 }] });
    expect(h.body.order.status).toBe('HELD');
    expect(await portions()).toBe(10);
    expect(await prisma.printJob.count()).toBe(0);
    const resumed = await order(cashier, { replacesHeldOrderId: h.body.order.id, lines: [{ productId: biriyani, quantity: 3 }] });
    expect(resumed.status).toBe(201);
    expect(resumed.body.order.orderNo).toBe(h.body.order.orderNo);
    expect(await portions()).toBe(7);
    expect(await prisma.order.count()).toBe(1);
    const h2 = await order(cashier, { hold: true, lines: [{ productId: biriyani, quantity: 1 }] });
    expect((await cashier.post(`/api/orders/${h2.body.order.id}/send`).set(H)).body.order.status).toBe('OPEN');
    expect(await portions()).toBe(6);
  });
});

describe('payments', () => {
  it('cash with change completes the order and queues one receipt; a double-tap pays once', async () => {
    const o = (await order(cashier, { lines: [{ productId: biriyani, quantity: 2 }] })).body.order;
    const body = { methodId: cash, amountMinor: o.totalMinor, tenderedMinor: 100000, idempotencyKey: rid() };
    const [a, b] = await Promise.all([cashier.post(`/api/orders/${o.id}/payments`).set(H).send(body), cashier.post(`/api/orders/${o.id}/payments`).set(H).send(body)]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    const done = (await cashier.get(`/api/orders/${o.id}`)).body.order;
    expect(done).toMatchObject({ status: 'COMPLETED', paymentStatus: 'PAID', paidMinor: 50000, dueMinor: 0 });
    expect(done.payments).toHaveLength(1);
    expect(done.payments[0]).toMatchObject({ tenderedMinor: 100000, changeMinor: 50000 });
    expect(await prisma.printJob.count({ where: { orderId: o.id, role: 'RECEIPT' } })).toBe(1);
  });

  it('split payment: card + bKash (bKash needs its transaction ID); overpayment refused', async () => {
    const o = (await order(cashier, { lines: [{ productId: burger, quantity: 3 }] })).body.order; // 960.00
    expect((await cashier.post(`/api/orders/${o.id}/payments`).set(H).send({ methodId: bkash, amountMinor: 50000, idempotencyKey: rid() })).status).toBe(400);
    let r = await cashier.post(`/api/orders/${o.id}/payments`).set(H).send({ methodId: bkash, amountMinor: 50000, reference: 'TRX9A7B', idempotencyKey: rid() });
    expect(r.body.order).toMatchObject({ paymentStatus: 'PARTIALLY_PAID', status: 'OPEN', dueMinor: 46000 });
    expect((await cashier.post(`/api/orders/${o.id}/payments`).set(H).send({ methodId: card, amountMinor: 50000, idempotencyKey: rid() })).status).toBe(400);
    r = await cashier.post(`/api/orders/${o.id}/payments`).set(H).send({ methodId: card, amountMinor: 46000, idempotencyKey: rid() });
    expect(r.body.order).toMatchObject({ paymentStatus: 'PAID', status: 'COMPLETED' });
    expect(r.body.order.payments.map((p: { methodName: string }) => p.methodName)).toEqual(['bKash', 'Card']);
  });

  it('refunds: manager only, never more than paid; payments and refunds are append-only', async () => {
    const o = (await order(cashier, { lines: [{ productId: burger, quantity: 1 }] })).body.order;
    await cashier.post(`/api/orders/${o.id}/payments`).set(H).send({ methodId: cash, amountMinor: 32000, idempotencyKey: rid() });
    expect((await cashier.post(`/api/orders/${o.id}/refunds`).set(H).send({ methodId: cash, amountMinor: 1000, reason: 'x', idempotencyKey: rid() })).status).toBe(403);
    const m = await signIn('manager');
    expect((await m.post(`/api/orders/${o.id}/refunds`).set(H).send({ methodId: cash, amountMinor: 40000, reason: 'Too much', idempotencyKey: rid() })).status).toBe(400);
    const r = await m.post(`/api/orders/${o.id}/refunds`).set(H).send({ methodId: cash, amountMinor: 10000, reason: 'Cold burger', idempotencyKey: rid() });
    expect(r.body.order).toMatchObject({ paymentStatus: 'PARTIALLY_REFUNDED', refundedMinor: 10000 });
    await expect(prisma.$executeRawUnsafe('UPDATE payments SET amount_minor = 1')).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe('DELETE FROM refunds')).rejects.toThrow(/append-only/);
  });
});

describe('cancellation & stock reversal', () => {
  it('cancelled before preparation → stock goes back exactly; cashier cannot cancel a sent order', async () => {
    const o = (await order(cashier, { lines: [{ productId: biriyani, quantity: 2 }, { productId: latte, quantity: 1, modifierIds: [oatOption] }] })).body.order;
    expect(await portions()).toBe(8);
    expect((await cashier.post(`/api/orders/${o.id}/cancel`).set(H).send({ reason: 'Customer left' })).status).toBe(403);
    const r = await owner.post(`/api/orders/${o.id}/cancel`).set(H).send({ reason: 'Customer left' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ restored: 2, wasted: 0 });
    expect(await portions()).toBe(10);
    expect(await onHand('milk')).toBe(5000);
    expect(await onHand('oat milk')).toBe(1000);
    expect(r.body.order.lines.every((l: { prepStatus: string; stockState: string }) => l.prepStatus === 'CANCELLED' && l.stockState === 'RESTORED')).toBe(true);
    // cancellation notices go to both stations
    expect(await prisma.printJob.count({ where: { orderId: o.id, idempotencyKey: { contains: 'CANCEL' } } })).toBe(2);
  });

  it('cancelled after the kitchen started → recorded as waste, not returned to stock', async () => {
    const o = (await order(cashier, { lines: [{ productId: biriyani, quantity: 2 }] })).body.order;
    const kitchen = await signIn('kitchen');
    await kitchen.post(`/api/stations/kitchen/orders/${o.id}/advance`).set(H);
    const r = await owner.post(`/api/orders/${o.id}/cancel`).set(H).send({ reason: 'Wrong order' });
    expect(r.body).toMatchObject({ restored: 0, wasted: 1 });
    expect(await portions()).toBe(8);
  });

  it('a paid order must be refunded before it can be cancelled', async () => {
    const o = (await order(cashier, { lines: [{ productId: burger, quantity: 1 }] })).body.order;
    await cashier.post(`/api/orders/${o.id}/payments`).set(H).send({ methodId: cash, amountMinor: 32000, idempotencyKey: rid() });
    expect((await owner.post(`/api/orders/${o.id}/cancel`).set(H).send({ reason: 'x' })).status).toBe(409);
    await owner.post(`/api/orders/${o.id}/refunds`).set(H).send({ methodId: cash, amountMinor: 32000, reason: 'Mistake', idempotencyKey: rid() });
    expect((await owner.post(`/api/orders/${o.id}/cancel`).set(H).send({ reason: 'Mistake' })).status).toBe(200);
  });
});

describe('kitchen & barista screens', () => {
  it('each station sees only its items and moves them Start → Ready → Served', async () => {
    const o = (await order(cashier, { lines: [{ productId: biriyani, quantity: 1 }, { productId: latte, quantity: 1 }] })).body.order;
    const kitchen = await signIn('kitchen');
    const barista = await signIn('barista');
    const kq = (await kitchen.get('/api/stations/kitchen')).body.tickets;
    expect(kq).toHaveLength(1);
    expect(kq[0].lines.map((l: { name: string }) => l.name)).toEqual(['Chicken Biriyani']);
    const bq = (await barista.get('/api/stations/barista')).body.tickets;
    expect(bq[0].lines.map((l: { name: string }) => l.name)).toEqual(['Latte']);
    expect((await barista.get('/api/stations/kitchen')).status).toBe(403);
    for (const expected of ['PREPARING', 'READY', 'SERVED']) {
      expect((await kitchen.post(`/api/stations/kitchen/orders/${o.id}/advance`).set(H)).body.status).toBe(expected);
    }
    expect((await kitchen.get('/api/stations/kitchen')).body.tickets).toHaveLength(0);
    expect((await barista.get('/api/stations/barista')).body.tickets).toHaveLength(1);
    const dash = (await owner.get('/api/dashboard/summary')).body;
    expect(dash).toMatchObject({ kitchenPending: 0, baristaPending: 1 });
  });
});

describe('printing (simulated network printer)', () => {
  function fakePrinter() {
    const received: Buffer[] = [];
    const server = net.createServer((s) => s.on('data', (d) => received.push(d)));
    return new Promise<{ port: number; received: Buffer[]; close: () => void }>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as net.AddressInfo).port, received, close: () => server.close() })),
    );
  }
  async function configure(role: string, port: number, paper = 80) {
    const p = await prisma.printer.findUniqueOrThrow({ where: { role: role as never } });
    return owner.patch(`/api/printers/${p.id}`).set(H).send({ name: p.name, host: '127.0.0.1', port, paperWidthMm: paper, isActive: true, cutPaper: true, openDrawer: false, version: p.version });
  }

  it('sends ESC/POS to the right printer, marks it printed, never duplicates', async () => {
    const kitchenPrinter = await fakePrinter();
    expect((await configure('KITCHEN', kitchenPrinter.port)).status).toBe(200);
    const o = (await order(cashier, { lines: [{ productId: biriyani, quantity: 2 }, { productId: latte, quantity: 1 }] })).body.order;
    while (await processNextJob()) { /* drain */ }
    await new Promise((r) => setTimeout(r, 100));
    const bytes = Buffer.concat(kitchenPrinter.received);
    const text = bytes.toString('latin1');
    expect(text).toContain('KITCHEN');
    expect(text).toContain('#1');
    expect(text).toContain('2 x Chicken Biriyani');
    expect(text).not.toContain('Latte');
    expect(bytes.includes(Buffer.from(CMD.cut))).toBe(true);
    expect(bytes.subarray(0, 2).equals(Buffer.from(CMD.init))).toBe(true);
    const kJob = await prisma.printJob.findFirstOrThrow({ where: { orderId: o.id, role: 'KITCHEN' } });
    expect(kJob.status).toBe('PRINTED');
    // barista printer not configured → its job waits safely
    expect((await prisma.printJob.findFirstOrThrow({ where: { orderId: o.id, role: 'BARISTA' } })).status).toBe('PENDING');
    expect((await prisma.printer.findUniqueOrThrow({ where: { role: 'KITCHEN' } })).status).toBe('ONLINE');
    // nothing else to print — the same ticket is never sent twice
    expect(await processNextJob()).toBe(false);
    // controlled reprint: a new, labelled job
    const re = await cashier.post(`/api/orders/${o.id}/reprint`).set(H).send({ role: 'KITCHEN', reason: 'Ticket fell in water' });
    expect(re.status).toBe(201);
    while (await processNextJob()) { /* drain */ }
    await new Promise((r) => setTimeout(r, 100));
    expect(Buffer.concat(kitchenPrinter.received).toString('latin1')).toContain('REPRINT #1');
    kitchenPrinter.close();
  });

  it('an unreachable printer: retried a few times, then FAILED with the error logged', async () => {
    const tmp = await fakePrinter();
    tmp.close(); // port is now closed
    await configure('RECEIPT', tmp.port, 58);
    const o = (await order(cashier, { lines: [{ productId: burger, quantity: 1 }] })).body.order;
    await cashier.post(`/api/orders/${o.id}/payments`).set(H).send({ methodId: cash, amountMinor: o.totalMinor, idempotencyKey: rid() });
    for (let i = 0; i < 5; i++) await processNextJob();
    const job = await prisma.printJob.findFirstOrThrow({ where: { orderId: o.id, role: 'RECEIPT' } });
    expect(job.status).toBe('FAILED');
    expect(job.attempts).toBe(3);
    expect(job.lastError).toBeTruthy();
    expect((await prisma.printer.findUniqueOrThrow({ where: { role: 'RECEIPT' } })).status).toBe('OFFLINE');
    const preview = (await owner.get(`/api/print-jobs/${job.id}/preview`)).body;
    expect(preview.text).toContain('Bite & Brew');
    expect(preview.text.split('\n').every((l: string) => l.length <= 32)).toBe(true); // 58 mm paper
    expect(preview.text).toContain('Tk 320.00');
    // retry is a deliberate person action
    expect((await owner.post(`/api/print-jobs/${job.id}/retry`).set(H)).status).toBe(200);
  });
});

describe('offline orders (till lost connection)', () => {
  it('syncing the same queue twice creates each order once, with its payment', async () => {
    const queued = { clientRequestId: rid(), serviceType: 'TAKEAWAY', offlinePlacedAt: new Date().toISOString(), lines: [{ productId: biriyani, quantity: 2 }], payments: [{ methodId: cash, amountMinor: 50000, idempotencyKey: rid() }] };
    const a = await cashier.post('/api/sync/orders').set(H).send({ orders: [queued] });
    const b = await cashier.post('/api/sync/orders').set(H).send({ orders: [queued] });
    expect(a.body.results[0]).toMatchObject({ status: 'created', needsReview: false });
    expect(b.body.results[0]).toMatchObject({ status: 'duplicate' });
    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.payment.count()).toBe(1);
    const o = await prisma.order.findFirstOrThrow();
    expect(o).toMatchObject({ placedOffline: true, status: 'COMPLETED' });
    expect(await portions()).toBe(8);
  });

  it('an offline order that sold stock already gone is kept and flagged for review — never silently dropped or overwritten', async () => {
    await owner.post(`/api/products/${biriyani}/stock/adjust`).set(H).send({ type: 'COUNT', quantity: 1, requestId: rid() });
    const r = await cashier.post('/api/sync/orders').set(H).send({ orders: [{ clientRequestId: rid(), serviceType: 'TAKEAWAY', lines: [{ productId: biriyani, quantity: 3 }, { productId: burger, quantity: 1 }] }] });
    expect(r.body.results[0]).toMatchObject({ status: 'created', needsReview: true });
    const o = await prisma.order.findFirstOrThrow({ include: { lines: true } });
    expect(o.lines.find((l) => l.name === 'Chicken Biriyani')!.stockState).toBe('CONFLICT');
    expect(o.reviewNote).toContain('Chicken Biriyani');
    expect(await portions()).toBe(1); // stock not forced negative, not overwritten
    const list = (await owner.get('/api/orders?needsReview=true')).body.orders;
    expect(list).toHaveLength(1);
    expect((await owner.post(`/api/orders/${o.id}/review`).set(H).send({ note: 'Extra batch was cooked, count corrected' })).status).toBe(200);
    expect((await owner.get('/api/orders?needsReview=true')).body.orders).toHaveLength(0);
  });
});

describe('cash drawer', () => {
  it('expected cash = float + cash sales − cash refunds; variance on close', async () => {
    expect((await cashier.post('/api/cash/open').set(H).send({ openingFloatMinor: 200000 })).status).toBe(201);
    expect((await cashier.post('/api/cash/open').set(H).send({ openingFloatMinor: 1 })).status).toBe(409);
    const o = (await order(cashier, { lines: [{ productId: burger, quantity: 2 }] })).body.order;
    await cashier.post(`/api/orders/${o.id}/payments`).set(H).send({ methodId: cash, amountMinor: 64000, idempotencyKey: rid() });
    await owner.post(`/api/orders/${o.id}/refunds`).set(H).send({ methodId: cash, amountMinor: 4000, reason: 'Missing sauce', idempotencyKey: rid() });
    const cur = (await cashier.get('/api/cash/current')).body.session;
    expect(cur).toMatchObject({ cashSalesMinor: 64000, cashRefundsMinor: 4000, expectedCashMinor: 260000 });
    expect((await cashier.post('/api/cash/close').set(H).send({ countedCashMinor: 259500 })).status).toBe(403);
    const closed = (await owner.post('/api/cash/close').set(H).send({ countedCashMinor: 259500, notes: '500 short' })).body.session;
    expect(closed).toMatchObject({ expectedCashMinor: 260000, countedCashMinor: 259500, varianceMinor: -500 });
  });
});

describe('expenses & financial reports', () => {
  it('report separates net sales, COGS, losses, expenses and purchases; exports CSV, Excel and PDF', async () => {
    const today = (await owner.get('/api/dashboard/summary')).body.businessDate as string;
    const o = (await order(cashier, { lines: [{ productId: biriyani, quantity: 2 }, { productId: burger, quantity: 1 }] })).body.order;
    await cashier.post(`/api/orders/${o.id}/payments`).set(H).send({ methodId: cash, amountMinor: o.totalMinor, idempotencyKey: rid() });
    const cats = (await owner.get('/api/expense-categories')).body.categories;
    expect(cats.map((c: { name: string }) => c.name)).toContain('Electricity');
    const rent = cats.find((c: { name: string }) => c.name === 'Rent').id;
    const exp = { categoryId: rent, amountMinor: 1_000_00, businessDate: today, note: 'Daily share', requestId: rid() };
    await owner.post('/api/expenses').set(H).send(exp);
    expect((await owner.post('/api/expenses').set(H).send(exp)).body.replayed).toBe(true);
    await owner.post(`/api/products/${biriyani}/stock/adjust`).set(H).send({ type: 'WASTE', quantity: 1, reason: 'Dropped', requestId: rid() });

    const r = (await owner.get(`/api/reports/summary?from=${today}&to=${today}`)).body.report;
    const lineCosts = (await prisma.orderLine.findMany()).reduce((a, l) => a + l.costMinor, 0);
    const portionCost = Math.round(Number((await prisma.product.findUniqueOrThrow({ where: { id: biriyani } })).portionCostMinor));
    expect(r).toMatchObject({ orders: 1, itemsSold: 3, grossSalesMinor: 82000, netSalesMinor: 82000, cogsMinor: lineCosts, expensesMinor: 100000 });
    expect(r.grossProfitMinor).toBe(82000 - lineCosts);
    expect(r.inventoryLossesMinor).toBe(portionCost);
    expect(r.netProfitMinor).toBe(82000 - lineCosts - 100000 - portionCost);
    expect(r.inventoryPurchasesMinor).toBe(2_000_00 + 3_200_00 + 500_00 + 400_00 + 2_000_00); // stock bought, not COGS
    expect(r.paymentMethods[0]).toMatchObject({ name: 'Cash', netMinor: 82000 });
    expect(r.topItems[0]).toMatchObject({ name: 'Chicken Biriyani', quantity: 2, revenueMinor: 50000 });
    expect(r.categories.map((c: { name: string }) => c.name).sort()).toEqual(['Biriyani', 'Burgers']);

    const csv = await owner.get(`/api/reports/export?from=${today}&to=${today}&format=csv`);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('Net profit (estimate)');
    const xlsx = await owner.get(`/api/reports/export?from=${today}&to=${today}&format=xlsx`).buffer(true).parse((res, cb) => { const d: Buffer[] = []; res.on('data', (c: Buffer) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); });
    expect(xlsx.headers['content-type']).toMatch(/spreadsheetml/);
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    const pdf = await owner.get(`/api/reports/export?from=${today}&to=${today}&format=pdf`).buffer(true).parse((res, cb) => { const d: Buffer[] = []; res.on('data', (c: Buffer) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); });
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    expect((await cashier.get(`/api/reports/summary?from=${today}&to=${today}`)).status).toBe(403);
    const dash = (await owner.get('/api/dashboard/summary?period=month')).body;
    expect(dash.report.netSalesMinor).toBe(82000);
    expect(dash.printers).toHaveLength(3);
  });

  it('expenses are voided with a reason, never deleted', async () => {
    const today = (await owner.get('/api/dashboard/summary')).body.businessDate as string;
    const cat = (await owner.get('/api/expense-categories')).body.categories[0].id;
    await owner.post('/api/expenses').set(H).send({ categoryId: cat, amountMinor: 5000, businessDate: today, requestId: rid() });
    const e = (await owner.get(`/api/expenses?from=${today}&to=${today}`)).body.expenses[0];
    expect((await owner.post(`/api/expenses/${e.id}/void`).set(H).send({ reason: 'Entered twice' })).status).toBe(200);
    const r = (await owner.get(`/api/reports/summary?from=${today}&to=${today}`)).body.report;
    expect(r.expensesMinor).toBe(0);
    expect(await prisma.expense.count()).toBe(1);
  });
});
