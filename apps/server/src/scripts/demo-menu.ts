/**
 * DEMO menu & stock — development/demo databases only (called from seed-demo.ts, which
 * refuses to run in production). Prices and costs are realistic examples for Dhaka,
 * not Bite & Brew's real figures; the owner enters the real menu in the app.
 */
import { randomUUID } from 'node:crypto';
import { toBase, type Dimension, type UnitCode } from '@bitebrew/shared';
import type { StockMode } from '../generated/prisma/enums.js';
import { prisma } from '../lib/prisma.js';
import { normalizeName } from '../modules/categories/routes.js';
import { D, lockIngredients, lockProducts, moveFinished, moveIngredient, produceBatch } from '../modules/inventory/stock.js';

const SUPPLIERS = [
  { name: 'DEMO Karwan Bazar Wholesale', phone: '+880 1700-000001' },
  { name: 'DEMO Dairy & Coffee Supply', phone: '+880 1700-000002' },
  { name: 'DEMO Packaging House', phone: '+880 1700-000003' },
];

// name, dimension, display unit, min level (display unit), opening qty (display unit), cost per display unit (taka), supplier index
const INGREDIENTS: [string, Dimension, UnitCode, number, number, number, number][] = [
  ['Basmati rice', 'MASS', 'kg', 5, 25, 140, 0],
  ['Kalijira rice', 'MASS', 'kg', 3, 10, 160, 0],
  ['Chicken', 'MASS', 'kg', 4, 12, 320, 0],
  ['Beef', 'MASS', 'kg', 3, 8, 780, 0],
  ['Moong dal', 'MASS', 'kg', 2, 5, 150, 0],
  ['Potato', 'MASS', 'kg', 3, 10, 40, 0],
  ['Onion', 'MASS', 'kg', 3, 10, 90, 0],
  ['Mustard oil', 'VOLUME', 'l', 2, 6, 280, 0],
  ['Ghee', 'MASS', 'kg', 0.5, 2, 1400, 0],
  ['Biriyani masala', 'MASS', 'g', 200, 800, 0.9, 0],
  ['Burger bun', 'COUNT', 'pcs', 12, 40, 18, 0],
  ['Tortilla wrap', 'COUNT', 'pcs', 12, 30, 22, 0],
  ['Lettuce', 'MASS', 'kg', 0.5, 2, 180, 0],
  ['Milk', 'VOLUME', 'l', 5, 20, 95, 1],
  ['Coffee beans', 'MASS', 'kg', 1, 3, 2400, 1],
  ['Tea leaves', 'MASS', 'g', 200, 1000, 0.6, 1],
  ['Sugar', 'MASS', 'kg', 2, 8, 135, 0],
  ['Lemon', 'COUNT', 'pcs', 10, 40, 6, 0],
  ['Caramel syrup', 'VOLUME', 'ml', 300, 1000, 1.2, 1],
  ['Takeaway cup', 'COUNT', 'pcs', 50, 300, 7, 2],
  ['Food box', 'COUNT', 'pcs', 50, 200, 12, 2],
];

type Line = [string, number, UnitCode, number?];
// category, name, price (taka), mode, recipe yield, recipe lines
const PRODUCTS: [string, string, number, StockMode, number, Line[]][] = [
  ['Biriyani', 'Chicken Biriyani', 280, 'BATCH', 10, [['Basmati rice', 1.5, 'kg', 3], ['Chicken', 2, 'kg'], ['Ghee', 150, 'g'], ['Biriyani masala', 60, 'g'], ['Onion', 0.5, 'kg'], ['Potato', 0.8, 'kg']]],
  ['Biriyani', 'Beef Biriyani', 350, 'BATCH', 10, [['Basmati rice', 1.5, 'kg', 3], ['Beef', 2, 'kg'], ['Ghee', 150, 'g'], ['Biriyani masala', 70, 'g'], ['Onion', 0.5, 'kg']]],
  ['Tehari', 'Chicken Tehari', 220, 'BATCH', 10, [['Kalijira rice', 1.4, 'kg', 2], ['Chicken', 1.5, 'kg'], ['Mustard oil', 200, 'ml'], ['Onion', 0.4, 'kg']]],
  ['Khichuri', 'Bhuna Khichuri', 160, 'BATCH', 12, [['Kalijira rice', 1, 'kg'], ['Moong dal', 0.6, 'kg'], ['Mustard oil', 150, 'ml'], ['Onion', 0.3, 'kg']]],
  ['Burgers', 'Classic Beef Burger', 320, 'MADE_TO_ORDER', 1, [['Burger bun', 1, 'pcs'], ['Beef', 120, 'g', 5], ['Lettuce', 20, 'g'], ['Food box', 1, 'pcs']]],
  ['Wraps', 'Chicken Wrap', 240, 'MADE_TO_ORDER', 1, [['Tortilla wrap', 1, 'pcs'], ['Chicken', 100, 'g', 5], ['Lettuce', 25, 'g']]],
  ['Coffee', 'Latte', 220, 'MADE_TO_ORDER', 1, [['Milk', 200, 'ml'], ['Coffee beans', 18, 'g'], ['Takeaway cup', 1, 'pcs']]],
  ['Coffee', 'Cappuccino', 210, 'MADE_TO_ORDER', 1, [['Milk', 150, 'ml'], ['Coffee beans', 18, 'g'], ['Takeaway cup', 1, 'pcs']]],
  ['Coffee', 'Americano', 160, 'MADE_TO_ORDER', 1, [['Coffee beans', 18, 'g'], ['Takeaway cup', 1, 'pcs']]],
  ['Tea', 'Milk Tea', 50, 'MADE_TO_ORDER', 1, [['Milk', 80, 'ml'], ['Tea leaves', 4, 'g'], ['Sugar', 12, 'g']]],
  ['Tea', 'Lemon Tea', 40, 'MADE_TO_ORDER', 1, [['Tea leaves', 3, 'g'], ['Lemon', 1, 'pcs'], ['Sugar', 10, 'g']]],
  ['Beverages', 'Mineral Water 500 ml', 30, 'RESALE', 1, []],
  ['Beverages', 'Soft Drink Can', 70, 'RESALE', 1, []],
  ['Desserts & Sweets', 'Firni', 90, 'RESALE', 1, []],
];

export async function seedDemoMenu(actorId: string | null) {
  if ((await prisma.product.count()) > 0) return { skipped: true };
  const supplierIds: string[] = [];
  for (const s of SUPPLIERS) {
    const row = await prisma.supplier.create({ data: { ...s, normalizedName: normalizeName(s.name), notes: 'Demo data' } });
    supplierIds.push(row.id);
  }
  const ing = new Map<string, { id: string; dimension: Dimension }>();
  for (const [name, dimension, unit, min, opening, costPerUnit, sup] of INGREDIENTS) {
    const row = await prisma.ingredient.create({
      data: { name, normalizedName: normalizeName(name), dimension, displayUnit: unit, minLevel: D(toBase(min, unit, dimension)), supplierId: supplierIds[sup] ?? null, isPackaging: name.includes('cup') || name.includes('box') },
    });
    ing.set(name, { id: row.id, dimension });
    await prisma.$transaction(async (tx) => {
      await lockIngredients(tx, [row.id]);
      await moveIngredient(tx, row.id, 'RECEIVE', D(toBase(opening, unit, dimension)), {
        receiveValueMinor: BigInt(Math.round(opening * costPerUnit * 100)), reason: 'DEMO opening stock', requestId: randomUUID(), actorId, supplierId: supplierIds[sup] ?? null, refType: 'RECEIPT',
      });
    });
  }
  const cats = new Map((await prisma.menuCategory.findMany()).map((c) => [c.name, c.id]));
  const prods = new Map<string, string>();
  for (const [cat, name, price, mode, yieldN, lines] of PRODUCTS) {
    const p = await prisma.product.create({
      data: {
        categoryId: cats.get(cat)!, name, normalizedName: normalizeName(name), priceMinor: price * 100, stockMode: mode, recipeYield: yieldN,
        recipeLines: { create: lines.map(([iname, q, u, w], idx) => ({ ingredientId: ing.get(iname)!.id, quantity: D(toBase(q, u, ing.get(iname)!.dimension)), wastagePct: D(w ?? 0), sortOrder: idx })) },
      },
    });
    prods.set(name, p.id);
  }
  // Customisation example
  await prisma.modifierGroup.create({
    data: {
      productId: prods.get('Latte')!, name: 'Extras', minSelect: 0, maxSelect: 2,
      modifiers: { create: [
        { name: 'Caramel syrup', priceDeltaMinor: 4000, ingredientId: ing.get('Caramel syrup')!.id, quantity: D(15), sortOrder: 0 },
        { name: 'Extra shot', priceDeltaMinor: 5000, ingredientId: ing.get('Coffee beans')!.id, quantity: D(9), sortOrder: 1 },
      ] },
    },
  });
  await prisma.modifierGroup.create({
    data: { productId: prods.get('Classic Beef Burger')!, name: 'Spice level', minSelect: 1, maxSelect: 1, modifiers: { create: [{ name: 'Mild', sortOrder: 0 }, { name: 'Medium', sortOrder: 1 }, { name: 'Hot', sortOrder: 2 }] } },
  });
  // Ready-made stock
  for (const [name, qty, total] of [['Mineral Water 500 ml', 48, 48 * 20], ['Soft Drink Can', 24, 24 * 50], ['Firni', 3, 3 * 45]] as const) {
    await prisma.$transaction(async (tx) => {
      await lockProducts(tx, [prods.get(name)!]);
      await moveFinished(tx, prods.get(name)!, 'RECEIVE', qty, { incomingValueMinor: BigInt(total * 100), reason: 'DEMO opening stock', requestId: randomUUID(), actorId, refType: 'RECEIPT' });
    });
  }
  // Morning batches
  for (const [name, portions] of [['Chicken Biriyani', 20], ['Chicken Tehari', 15], ['Bhuna Khichuri', 12]] as const) {
    await prisma.$transaction((tx) => produceBatch(tx, { productId: prods.get(name)!, portions, requestId: randomUUID(), actorId, notes: 'DEMO morning batch' }));
  }
  return { skipped: false, products: PRODUCTS.length, ingredients: INGREDIENTS.length };
}
