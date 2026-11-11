import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { consumeForSale } from '../src/modules/inventory/stock.js';
import { H, prisma, resetData, signIn } from './helpers.js';

type Agent = Awaited<ReturnType<typeof signIn>>;
let owner: Agent;
const rid = () => randomUUID();

beforeEach(async () => {
  await resetData();
  owner = await signIn('owner');
});
afterAll(() => prisma.$disconnect());

async function categoryId(name: string) {
  return (await prisma.menuCategory.findUniqueOrThrow({ where: { normalizedName: name.toLowerCase() } })).id;
}
async function ingredient(name: string, dimension: string, displayUnit: string, minLevel = 0) {
  const r = await owner.post('/api/ingredients').set(H).send({ name, dimension, displayUnit, minLevel });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.ingredient as { id: string; onHand: number; avgCostMinor: number; version: number };
}
async function receive(id: string, quantity: number, unit: string, totalCostMinor: number) {
  const r = await owner.post(`/api/ingredients/${id}/receive`).set(H).send({ quantity, unit, totalCostMinor, requestId: rid() });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.ingredient;
}
async function product(body: Record<string, unknown>) {
  const r = await owner.post('/api/products').set(H).send(body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.product as { id: string; version: number };
}
const ingRow = (id: string) => prisma.ingredient.findUniqueOrThrow({ where: { id } });
const prodRow = (id: string) => prisma.product.findUniqueOrThrow({ where: { id } });

/** Rice, chicken, oil, spices in stock + Chicken Biriyani (batch, recipe for 10 portions). */
async function biriyaniSetup() {
  const rice = await ingredient('Basmati rice', 'MASS', 'kg', 5);
  const chicken = await ingredient('Chicken', 'MASS', 'kg', 3);
  const oil = await ingredient('Cooking oil', 'VOLUME', 'l', 1);
  const spice = await ingredient('Biriyani masala', 'MASS', 'g', 100);
  await receive(rice.id, 25, 'kg', 225_000_00 / 100); // ৳2,250 → 9 paisa/g
  await receive(chicken.id, 10, 'kg', 3_200_00); // ৳3,200 → 32 paisa/g
  await receive(oil.id, 5, 'l', 1_000_00); // ৳1,000 → 20 paisa/mL
  await receive(spice.id, 500, 'g', 300_00); // ৳300 → 60 paisa/g
  const p = await product({ categoryId: await categoryId('Biriyani'), name: 'Chicken Biriyani', priceMinor: 250_00, stockMode: 'BATCH' });
  const r = await owner.put(`/api/products/${p.id}/recipe`).set(H).send({
    recipeYield: 10,
    version: p.version,
    lines: [
      { ingredientId: rice.id, quantity: 1.5, unit: 'kg', wastagePct: 5 },
      { ingredientId: chicken.id, quantity: 2, unit: 'kg' },
      { ingredientId: oil.id, quantity: 200, unit: 'ml' },
      { ingredientId: spice.id, quantity: 50, unit: 'g' },
    ],
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return { rice, chicken, oil, spice, biriyani: r.body.product };
}

describe('units & receiving stock', () => {
  it('stores in base units and converts kg→g, L→mL', async () => {
    const rice = await ingredient('Rice', 'MASS', 'kg', 5);
    expect((await ingRow(rice.id)).minLevel.toNumber()).toBe(5000);
    const after = await receive(rice.id, 2.5, 'kg', 225_00);
    expect(after.onHand).toBe(2500);
    const milk = await ingredient('Milk', 'VOLUME', 'l');
    expect((await receive(milk.id, 750, 'ml', 90_00)).onHand).toBe(750);
  });

  it('rejects a unit from the wrong dimension', async () => {
    const rice = await ingredient('Rice', 'MASS', 'kg');
    const r = await owner.post(`/api/ingredients/${rice.id}/receive`).set(H).send({ quantity: 1, unit: 'l', totalCostMinor: 100, requestId: rid() });
    expect(r.status).toBe(400);
    expect((await owner.post('/api/ingredients').set(H).send({ name: 'Bad', dimension: 'MASS', displayUnit: 'ml' })).status).toBe(400);
  });

  it('keeps a weighted-average cost across deliveries', async () => {
    const rice = await ingredient('Rice', 'MASS', 'kg');
    await receive(rice.id, 25, 'kg', 2_250_00); // 9 paisa/g
    const after = await receive(rice.id, 10, 'kg', 1_000_00); // 10 paisa/g
    expect(after.onHand).toBe(35000);
    expect(after.avgCostMinor).toBeCloseTo((225000 + 100000) / 35000, 4);
    expect(after.stockValueMinor).toBe(325000);
  });

  it('a double-tapped delivery is recorded once', async () => {
    const rice = await ingredient('Rice', 'MASS', 'kg');
    const body = { quantity: 5, unit: 'kg', totalCostMinor: 500_00, requestId: rid() };
    const [a, b] = await Promise.all([
      owner.post(`/api/ingredients/${rice.id}/receive`).set(H).send(body),
      owner.post(`/api/ingredients/${rice.id}/receive`).set(H).send(body),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect((await ingRow(rice.id)).onHand.toNumber()).toBe(5000);
    expect(await prisma.stockMovement.count({ where: { ingredientId: rice.id } })).toBe(1);
  });
});

describe('batch production — the Chicken Biriyani workflow', () => {
  it('prepare 20 → deduct recipe once → 20 available → sell 3 → 17, raw stock untouched by the sale', async () => {
    const { rice, chicken, oil, spice, biriyani } = await biriyaniSetup();

    // Preview
    const pv = await owner.get(`/api/production/preview?productId=${biriyani.id}&portions=20`);
    expect(pv.status).toBe(200);
    expect(pv.body.preview.canProduce).toBe(true);
    const riceReq = pv.body.preview.requirements.find((r: { ingredientId: string }) => r.ingredientId === rice.id);
    expect(riceReq.required).toBe(3150); // 1.5 kg × 2 batches × 1.05 wastage

    // 1–3. Prepare 20 portions
    const made = await owner.post('/api/production/batches').set(H).send({ productId: biriyani.id, portions: 20, requestId: rid() });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect((await ingRow(rice.id)).onHand.toNumber()).toBe(25000 - 3150);
    expect((await ingRow(chicken.id)).onHand.toNumber()).toBe(10000 - 4000);
    expect((await ingRow(oil.id)).onHand.toNumber()).toBe(5000 - 400);
    expect((await ingRow(spice.id)).onHand.toNumber()).toBe(500 - 100);
    // cost = 3150×9 + 4000×32 + 400×20 + 100×60 = 28350 + 128000 + 8000 + 6000 = 170350 paisa
    expect(made.body.batch.totalCostMinor).toBe(170350);
    expect(made.body.batch.unitCostMinor).toBe(Math.round(170350 / 20));

    // 4. POS availability shows 20
    const avail = await owner.get('/api/availability');
    const cat = avail.body.categories.find((c: { name: string }) => c.name === 'Biriyani');
    expect(cat.products[0]).toMatchObject({ name: 'Chicken Biriyani', available: 20, soldOut: false });
    expect(cat.portionsReady).toBe(20);

    // 5. A customer buys 3 (POS sale function, used by the Phase 3 POS)
    const rawBefore = await prisma.ingredient.findMany({ orderBy: { id: 'asc' } });
    const cogs = await prisma.$transaction((tx) => consumeForSale(tx, [{ productId: biriyani.id, quantity: 3 }], { refType: 'TEST_SALE', refId: 'sale-1', actorId: null }));
    // 6. Finished stock 17, raw ingredients NOT deducted again
    expect((await prodRow(biriyani.id)).portionsOnHand).toBe(17);
    const rawAfter = await prisma.ingredient.findMany({ orderBy: { id: 'asc' } });
    expect(rawAfter.map((i) => i.onHand.toNumber())).toEqual(rawBefore.map((i) => i.onHand.toNumber()));
    expect(Number(cogs[0]!.costMinor)).toBe(Math.round((170350 / 20) * 3));

    const ledger = await prisma.finishedMovement.findMany({ where: { productId: biriyani.id }, orderBy: { seq: 'asc' } });
    expect(ledger.map((m) => [m.type, m.qtyDelta, m.balanceAfter])).toEqual([['PRODUCED', 20, 20], ['SOLD', -3, 17]]);
    expect((await owner.get(`/api/products/${biriyani.id}`)).body.product.available).toBe(17);
  });

  it('refuses a batch when ingredients are short, lists every shortage, and changes nothing', async () => {
    const { rice, biriyani } = await biriyaniSetup();
    const before = await prisma.ingredient.findMany({ orderBy: { id: 'asc' } });
    const r = await owner.post('/api/production/batches').set(H).send({ productId: biriyani.id, portions: 60, requestId: rid() });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('INSUFFICIENT_STOCK');
    const names = r.body.error.details.shortages.map((s: { name: string }) => s.name);
    expect(names).toContain('Chicken'); // needs 12 kg, has 10
    expect(names).not.toContain('Basmati rice'); // needs 9.45 kg, has 25
    expect((await prisma.ingredient.findMany({ orderBy: { id: 'asc' } })).map((i) => i.onHand.toNumber())).toEqual(before.map((i) => i.onHand.toNumber()));
    expect(await prisma.productionBatch.count()).toBe(0);
    expect((await prodRow(biriyani.id)).portionsOnHand).toBe(0);
    const pv = await owner.get(`/api/production/preview?productId=${biriyani.id}&portions=60`);
    expect(pv.body.preview.canProduce).toBe(false);
    expect(pv.body.preview.maxPortions).toBe(50); // chicken 10 kg ÷ 0.2 kg per portion
    void rice;
  });

  it('records actual amounts when they differ from the recipe', async () => {
    const { chicken, biriyani } = await biriyaniSetup();
    const r = await owner.post('/api/production/batches').set(H).send({
      productId: biriyani.id, portions: 10, requestId: rid(), notes: 'Extra chicken today',
      overrides: [{ ingredientId: chicken.id, quantity: 2.4, unit: 'kg' }],
    });
    expect(r.status).toBe(201);
    expect((await ingRow(chicken.id)).onHand.toNumber()).toBe(10000 - 2400);
  });

  it('a double-tapped batch is recorded once', async () => {
    const { biriyani } = await biriyaniSetup();
    const body = { productId: biriyani.id, portions: 10, requestId: rid() };
    const [a, b] = await Promise.all([
      owner.post('/api/production/batches').set(H).send(body),
      owner.post('/api/production/batches').set(H).send(body),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(await prisma.productionBatch.count()).toBe(1);
    expect((await prodRow(biriyani.id)).portionsOnHand).toBe(10);
  });

  it('two kitchens preparing at once cannot overdraw the same ingredient', async () => {
    const { biriyani } = await biriyaniSetup();
    const kitchen = await signIn('kitchen');
    // Each batch of 30 needs 6 kg chicken; only 10 kg exist → exactly one can succeed
    const [a, b] = await Promise.all([
      owner.post('/api/production/batches').set(H).send({ productId: biriyani.id, portions: 30, requestId: rid() }),
      kitchen.post('/api/production/batches').set(H).send({ productId: biriyani.id, portions: 30, requestId: rid() }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((await prisma.ingredient.findUniqueOrThrow({ where: { normalizedName: 'chicken' } })).onHand.toNumber()).toBe(4000);
  });
});

describe('selling — atomic stock (groundwork for the Phase 3 POS)', () => {
  it('two tills selling the last portion at the same moment: exactly one succeeds', async () => {
    const { biriyani } = await biriyaniSetup();
    await owner.post('/api/production/batches').set(H).send({ productId: biriyani.id, portions: 1, requestId: rid() });
    const sell = (ref: string) =>
      prisma.$transaction((tx) => consumeForSale(tx, [{ productId: biriyani.id, quantity: 1 }], { refType: 'TEST_SALE', refId: ref, actorId: null }));
    const results = await Promise.allSettled([sell('till-1'), sell('till-2')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((await prodRow(biriyani.id)).portionsOnHand).toBe(0);
    const avail = await owner.get(`/api/products/${biriyani.id}`);
    expect(avail.body.product).toMatchObject({ available: 0, soldOut: true });
  });

  it('made-to-order items deduct recipe ingredients at sale, including chosen options', async () => {
    const milk = await ingredient('Milk', 'VOLUME', 'l', 2);
    const oat = await ingredient('Oat milk', 'VOLUME', 'l');
    const beans = await ingredient('Coffee beans', 'MASS', 'kg');
    const cup = await ingredient('Takeaway cup', 'COUNT', 'pcs');
    await receive(milk.id, 1, 'l', 120_00);
    await receive(oat.id, 1, 'l', 400_00);
    await receive(beans.id, 1, 'kg', 2_000_00);
    await receive(cup.id, 3, 'pcs', 30_00);
    const latte = await product({ categoryId: await categoryId('Coffee'), name: 'Latte', priceMinor: 220_00, stockMode: 'MADE_TO_ORDER' });
    let r = await owner.put(`/api/products/${latte.id}/recipe`).set(H).send({
      recipeYield: 1, version: latte.version,
      lines: [
        { ingredientId: milk.id, quantity: 200, unit: 'ml' },
        { ingredientId: beans.id, quantity: 18, unit: 'g' },
        { ingredientId: cup.id, quantity: 1, unit: 'pcs' },
      ],
    });
    expect(r.status).toBe(200);
    // availability = min(1000/200=5, 1000/18=55, 3/1=3) = 3, limited by cups
    expect(r.body.product).toMatchObject({ available: 3, limitingIngredient: 'Takeaway cup' });
    r = await owner.put(`/api/products/${latte.id}/modifiers`).set(H).send({
      version: r.body.product.version,
      groups: [{ name: 'Extras', minSelect: 0, maxSelect: 2, options: [
        { name: 'Oat milk shot', priceDeltaMinor: 40_00, ingredientId: oat.id, quantity: 50, unit: 'ml' },
        { name: 'Extra sugar', priceDeltaMinor: 0 },
      ] }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const oatOption = r.body.product.modifierGroups[0].options[0];
    expect(oatOption).toMatchObject({ name: 'Oat milk shot', priceDeltaMinor: 4000, quantity: 50 });

    await prisma.$transaction((tx) => consumeForSale(tx, [{ productId: latte.id, quantity: 2, modifierIds: [oatOption.id] }], { refType: 'TEST_SALE', refId: 's', actorId: null }));
    expect((await ingRow(milk.id)).onHand.toNumber()).toBe(600);
    expect((await ingRow(beans.id)).onHand.toNumber()).toBe(964);
    expect((await ingRow(cup.id)).onHand.toNumber()).toBe(1);
    expect((await ingRow(oat.id)).onHand.toNumber()).toBe(900);
    const types = (await prisma.stockMovement.findMany({ where: { refId: 's' } })).map((m) => m.type);
    expect(new Set(types)).toEqual(new Set(['SALE_CONSUME']));
    // selling 2 more fails (only 1 cup left) and changes nothing
    await expect(prisma.$transaction((tx) => consumeForSale(tx, [{ productId: latte.id, quantity: 2 }], { refType: 'TEST_SALE', refId: 's2', actorId: null }))).rejects.toThrow(/Not enough stock/);
    expect((await ingRow(milk.id)).onHand.toNumber()).toBe(600);
  });

  it('ready-made items are received in units with cost, then sold', async () => {
    const water = await product({ categoryId: await categoryId('Beverages'), name: 'Mineral water 500ml', priceMinor: 30_00, stockMode: 'RESALE' });
    const r = await owner.post(`/api/products/${water.id}/stock/receive`).set(H).send({ quantity: 24, totalCostMinor: 480_00, requestId: rid() });
    expect(r.status).toBe(201);
    expect(r.body.product).toMatchObject({ portionsOnHand: 24, available: 24, costMinor: 2000, costSource: 'PURCHASE_AVERAGE' });
    const cogs = await prisma.$transaction((tx) => consumeForSale(tx, [{ productId: water.id, quantity: 2 }], { refType: 'TEST_SALE', refId: 'w', actorId: null }));
    expect(Number(cogs[0]!.costMinor)).toBe(4000);
    expect((await prodRow(water.id)).portionsOnHand).toBe(22);
  });
});

describe('waste, spoilage, corrections and counts', () => {
  it('records each kind of adjustment with value and reason', async () => {
    const rice = await ingredient('Rice', 'MASS', 'kg');
    await receive(rice.id, 10, 'kg', 1_000_00); // 10 paisa/g
    const adj = (body: object) => owner.post(`/api/ingredients/${rice.id}/adjust`).set(H).send({ requestId: rid(), ...body });
    expect((await adj({ type: 'WASTE', quantity: 500, unit: 'g', reason: 'Spilled' })).body.ingredient.onHand).toBe(9500);
    expect((await adj({ type: 'SPOILAGE', quantity: 1, unit: 'kg' })).body.ingredient.onHand).toBe(8500);
    expect((await adj({ type: 'ADJUSTMENT', quantity: -0.5, unit: 'kg', reason: 'Recount error' })).body.ingredient.onHand).toBe(8000);
    expect((await adj({ type: 'COUNT', quantity: 7.8, unit: 'kg' })).body.ingredient.onHand).toBe(7800);
    expect((await adj({ type: 'ADJUSTMENT', quantity: 1, unit: 'kg' })).status).toBe(400); // reason required
    const tooMuch = await adj({ type: 'WASTE', quantity: 50, unit: 'kg' });
    expect(tooMuch.status).toBe(409);
    const moves = await prisma.stockMovement.findMany({ where: { ingredientId: rice.id }, orderBy: { seq: 'asc' } });
    expect(moves.map((m) => [m.type, m.qtyDelta.toNumber(), Number(m.valueMinor)])).toEqual([
      ['RECEIVE', 10000, 100000], ['WASTE', -500, -5000], ['SPOILAGE', -1000, -10000], ['ADJUSTMENT', -500, -5000], ['COUNT', -200, -2000],
    ]);
  });

  it('finished portions can be wasted or counted', async () => {
    const { biriyani } = await biriyaniSetup();
    await owner.post('/api/production/batches').set(H).send({ productId: biriyani.id, portions: 10, requestId: rid() });
    const w = await owner.post(`/api/products/${biriyani.id}/stock/adjust`).set(H).send({ type: 'SPOILAGE', quantity: 2, reason: 'End of day', requestId: rid() });
    expect(w.body.product.portionsOnHand).toBe(8);
    const c = await owner.post(`/api/products/${biriyani.id}/stock/adjust`).set(H).send({ type: 'COUNT', quantity: 7, requestId: rid() });
    expect(c.body.product.portionsOnHand).toBe(7);
  });

  it('stock ledgers are append-only in the database', async () => {
    const rice = await ingredient('Rice', 'MASS', 'kg');
    await receive(rice.id, 1, 'kg', 100);
    await expect(prisma.$executeRawUnsafe('UPDATE stock_movements SET qty_delta = 999')).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe('DELETE FROM stock_movements')).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`UPDATE ingredients SET on_hand = -1`)).rejects.toThrow();
  });
});

describe('menu items', () => {
  it('create, edit price (audited), hide, and refuse deletion once there is stock history', async () => {
    const p = await product({ categoryId: await categoryId('Burgers'), name: 'Beef Burger', priceMinor: 350_00, stockMode: 'UNTRACKED', manualCostMinor: 180_00 });
    const e = await owner.patch(`/api/products/${p.id}`).set(H).send({ priceMinor: 380_00, version: p.version });
    expect(e.status).toBe(200);
    expect(e.body.product).toMatchObject({ priceMinor: 38000, costMinor: 18000, costSource: 'MANUAL', available: null, station: 'KITCHEN' });
    expect(await prisma.auditLog.count({ where: { action: 'product.update_price', entityId: p.id } })).toBe(1);
    expect((await owner.delete(`/api/products/${p.id}`).set(H)).status).toBe(204);

    const { biriyani } = await biriyaniSetup();
    await owner.post('/api/production/batches').set(H).send({ productId: biriyani.id, portions: 10, requestId: rid() });
    expect((await owner.delete(`/api/products/${biriyani.id}`).set(H)).status).toBe(409);
  });

  it('refuses to change stock mode while portions are on hand', async () => {
    const { biriyani } = await biriyaniSetup();
    await owner.post('/api/production/batches').set(H).send({ productId: biriyani.id, portions: 10, requestId: rid() });
    const cur = await prodRow(biriyani.id);
    const r = await owner.patch(`/api/products/${biriyani.id}`).set(H).send({ stockMode: 'UNTRACKED', version: cur.version });
    expect(r.status).toBe(409);
  });

  it('a category with menu items cannot be deleted', async () => {
    await product({ categoryId: await categoryId('Tea'), name: 'Masala Chai', priceMinor: 60_00, stockMode: 'UNTRACKED' });
    const tea = await prisma.menuCategory.findUniqueOrThrow({ where: { normalizedName: 'tea' } });
    const r = await owner.delete(`/api/categories/${tea.id}?version=${tea.version}`).set(H);
    expect(r.status).toBe(409);
  });

  it('drinks route to the barista station; a product can override its category', async () => {
    const t = await product({ categoryId: await categoryId('Tea'), name: 'Lemon Tea', priceMinor: 50_00, stockMode: 'UNTRACKED' });
    expect((await owner.get(`/api/products/${t.id}`)).body.product.station).toBe('BARISTA');
    const d = await product({ categoryId: await categoryId('Desserts & Sweets'), name: 'Firni', priceMinor: 90_00, stockMode: 'RESALE', stationOverride: 'BARISTA' });
    expect((await owner.get(`/api/products/${d.id}`)).body.product.station).toBe('BARISTA');
  });

  it('stores and serves a product photo', async () => {
    const p = await product({ categoryId: await categoryId('Wraps'), name: 'Chicken Wrap', priceMinor: 220_00, stockMode: 'UNTRACKED' });
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const up = await owner.put(`/api/products/${p.id}/image`).set(H).send({ dataUrl: png });
    expect(up.status).toBe(200);
    expect(up.body.product.hasImage).toBe(true);
    const img = await owner.get(`/api/products/${p.id}/image`);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toMatch(/image\/png/);
  });

  it('recipe units must match the ingredient', async () => {
    const rice = await ingredient('Rice', 'MASS', 'kg');
    const p = await product({ categoryId: await categoryId('Khichuri'), name: 'Khichuri', priceMinor: 150_00, stockMode: 'BATCH' });
    const r = await owner.put(`/api/products/${p.id}/recipe`).set(H).send({ recipeYield: 10, version: p.version, lines: [{ ingredientId: rice.id, quantity: 1, unit: 'l' }] });
    expect(r.status).toBe(400);
  });
});

describe('permissions & dashboard', () => {
  it('cashier sees availability but not costs, and cannot change menu or stock', async () => {
    const { biriyani } = await biriyaniSetup();
    const cashier = await signIn('cashier');
    expect((await cashier.get('/api/availability')).status).toBe(200);
    const p = await cashier.get(`/api/products/${biriyani.id}`);
    expect(p.body.product.costMinor).toBeNull();
    expect(p.body.product.recipe[0].costMinor).toBe(0);
    expect((await cashier.post('/api/products').set(H).send({})).status).toBe(403);
    expect((await cashier.get('/api/ingredients')).status).toBe(403);
    expect((await cashier.post('/api/production/batches').set(H).send({})).status).toBe(403);
  });

  it('kitchen can prepare batches and view stock, but cannot receive deliveries or see values', async () => {
    const { rice, biriyani } = await biriyaniSetup();
    const kitchen = await signIn('kitchen');
    const b = await kitchen.post('/api/production/batches').set(H).send({ productId: biriyani.id, portions: 10, requestId: rid() });
    expect(b.status).toBe(201);
    expect(b.body.batch.totalCostMinor).toBe(0); // value hidden
    const list = await kitchen.get('/api/ingredients');
    expect(list.status).toBe(200);
    expect(list.body.ingredients.every((i: { stockValueMinor: number }) => i.stockValueMinor === 0)).toBe(true);
    expect((await kitchen.post(`/api/ingredients/${rice.id}/receive`).set(H).send({ quantity: 1, unit: 'kg', totalCostMinor: 1, requestId: rid() })).status).toBe(403);
    expect((await kitchen.post(`/api/ingredients/${rice.id}/adjust`).set(H).send({ type: 'WASTE', quantity: 1, unit: 'kg', requestId: rid() })).status).toBe(403);
  });

  it('dashboard shows real stock value, low-stock alerts and sold-out items', async () => {
    const { rice, biriyani } = await biriyaniSetup();
    // Biriyani has 0 portions → sold out. Bring rice below its 5 kg minimum.
    await owner.post(`/api/ingredients/${rice.id}/adjust`).set(H).send({ type: 'COUNT', quantity: 4, unit: 'kg', requestId: rid() });
    const d = await owner.get('/api/dashboard/summary');
    expect(d.status).toBe(200);
    const s = d.body.stock;
    expect(s.lowStock.map((l: { name: string }) => l.name)).toContain('Basmati rice');
    expect(s.soldOut.map((x: { name: string }) => x.name)).toContain('Chicken Biriyani');
    // value = 4000 g × 9 + chicken 10000×32 + oil 5000×20 + spice 500×60
    expect(s.ingredientValueMinor).toBe(36000 + 320000 + 100000 + 30000);
    await owner.post('/api/production/batches').set(H).send({ productId: biriyani.id, portions: 10, requestId: rid() });
    const d2 = (await owner.get('/api/dashboard/summary')).body.stock;
    expect(d2.soldOut).toHaveLength(0);
    // producing moves value from raw to finished stock; total value unchanged
    expect(d2.totalValueMinor).toBe(s.totalValueMinor);
  });
});
