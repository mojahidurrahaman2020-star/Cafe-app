/**
 * Stock engine — the ONLY code allowed to change stock levels.
 *
 * Rules
 *  1. Every change runs inside the caller's transaction and first row-locks the affected
 *     products / ingredients (`SELECT … FOR UPDATE`, always products then ingredients, each
 *     ordered by id, so concurrent transactions cannot deadlock).
 *  2. Every change writes exactly one append-only movement row carrying the new balance.
 *  3. Balances can never go negative (checked here, and by CHECK constraints in the DB).
 *  4. Values are whole paisa; unit costs are paisa per base unit / per portion.
 */
import { randomUUID } from 'node:crypto';
import type { IngredientMovementType, FinishedMovementType } from '../../generated/prisma/enums.js';
import { HttpError } from '../../lib/errors.js';
import { Prisma, type Tx } from '../../lib/prisma.js';

export const Dec = Prisma.Decimal;
export type Dec = Prisma.Decimal;
export const D = (v: number | string | Dec) => new Prisma.Decimal(v);
const ZERO = D(0);

/** Round a Decimal to whole paisa, half away from zero. */
export const toMinor = (v: Dec): bigint => BigInt(v.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toFixed(0));
export const q3 = (v: Dec) => v.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
export const c4 = (v: Dec) => v.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);

export interface Shortage {
  id: string;
  name: string;
  required: number;
  onHand: number;
  shortBy: number;
}

export class InsufficientStockError extends HttpError {
  constructor(message: string, shortages: Shortage[]) {
    super(409, 'INSUFFICIENT_STOCK', message, { shortages });
  }
}

export async function lockProducts(tx: Tx, ids: string[]) {
  const unique = [...new Set(ids)].sort();
  if (unique.length) await tx.$queryRaw`SELECT id FROM products WHERE id = ANY(${unique}::uuid[]) ORDER BY id FOR UPDATE`;
}

export async function lockIngredients(tx: Tx, ids: string[]) {
  const unique = [...new Set(ids)].sort();
  if (unique.length) await tx.$queryRaw`SELECT id FROM ingredients WHERE id = ANY(${unique}::uuid[]) ORDER BY id FOR UPDATE`;
}

interface MovementMeta {
  refType?: string | null;
  refId?: string | null;
  reason?: string | null;
  requestId?: string | null;
  actorId?: string | null;
  supplierId?: string | null;
}

/**
 * Apply one raw-ingredient movement. Caller must hold the row lock.
 * `unitCost` defaults to the current average cost (all outgoing movements).
 * For RECEIVE pass `receiveValueMinor` (the total paid); the average cost is re-weighted.
 */
export async function moveIngredient(
  tx: Tx,
  ingredientId: string,
  type: IngredientMovementType,
  qtyDelta: Dec,
  meta: MovementMeta & { receiveValueMinor?: bigint } = {},
) {
  const ing = await tx.ingredient.findUniqueOrThrow({ where: { id: ingredientId } });
  const delta = q3(qtyDelta);
  const balance = q3(ing.onHand.plus(delta));
  if (balance.lt(0)) {
    throw new InsufficientStockError(`Not enough ${ing.name} in stock`, [
      { id: ing.id, name: ing.name, required: delta.neg().toNumber(), onHand: ing.onHand.toNumber(), shortBy: balance.neg().toNumber() },
    ]);
  }

  let unitCost = ing.avgCostMinor;
  let value: bigint;
  let newAvg = ing.avgCostMinor;
  if (type === 'RECEIVE' || (type === 'OPENING' && meta.receiveValueMinor !== undefined)) {
    const paid = meta.receiveValueMinor ?? 0n;
    value = paid;
    unitCost = delta.gt(0) ? c4(D(paid.toString()).div(delta)) : ZERO;
    const oldValue = ing.onHand.mul(ing.avgCostMinor);
    newAvg = balance.gt(0) ? c4(oldValue.plus(D(paid.toString())).div(balance)) : ing.avgCostMinor;
  } else {
    value = toMinor(delta.mul(unitCost));
  }

  await tx.ingredient.update({ where: { id: ingredientId }, data: { onHand: balance, avgCostMinor: newAvg } });
  return tx.stockMovement.create({
    data: {
      ingredientId,
      type,
      qtyDelta: delta,
      unitCostMinor: unitCost,
      valueMinor: value,
      balanceAfter: balance,
      refType: meta.refType ?? null,
      refId: meta.refId ?? null,
      reason: meta.reason ?? null,
      requestId: meta.requestId ?? null,
      actorId: meta.actorId ?? null,
      supplierId: meta.supplierId ?? null,
    },
  });
}

/** Apply one finished-portion movement. Caller must hold the product row lock. */
export async function moveFinished(
  tx: Tx,
  productId: string,
  type: FinishedMovementType,
  qtyDelta: number,
  meta: MovementMeta & { incomingValueMinor?: bigint } = {},
) {
  const p = await tx.product.findUniqueOrThrow({ where: { id: productId } });
  const balance = p.portionsOnHand + qtyDelta;
  if (balance < 0) {
    throw new InsufficientStockError(`${p.name} is sold out`, [
      { id: p.id, name: p.name, required: -qtyDelta, onHand: p.portionsOnHand, shortBy: -balance },
    ]);
  }
  let unitCost = p.portionCostMinor;
  let value: bigint;
  let newAvg = p.portionCostMinor;
  if (meta.incomingValueMinor !== undefined && qtyDelta > 0) {
    value = meta.incomingValueMinor;
    unitCost = c4(D(value.toString()).div(qtyDelta));
    const oldValue = p.portionCostMinor.mul(p.portionsOnHand);
    newAvg = c4(oldValue.plus(D(value.toString())).div(balance));
  } else {
    value = toMinor(D(qtyDelta).mul(unitCost));
  }
  await tx.product.update({ where: { id: productId }, data: { portionsOnHand: balance, portionCostMinor: newAvg } });
  return tx.finishedMovement.create({
    data: {
      productId,
      type,
      qtyDelta,
      unitCostMinor: unitCost,
      valueMinor: value,
      balanceAfter: balance,
      refType: meta.refType ?? null,
      refId: meta.refId ?? null,
      reason: meta.reason ?? null,
      requestId: meta.requestId ?? null,
      actorId: meta.actorId ?? null,
    },
  });
}

/** Ingredient quantity consumed for `portions` portions of a recipe line (base units). */
export function lineRequirement(line: { quantity: Dec; wastagePct: Dec }, recipeYield: number, portions: number): Dec {
  return q3(line.quantity.mul(D(1).plus(line.wastagePct.div(100))).mul(portions).div(recipeYield));
}

// ─────────────────────────── batch production ───────────────────────────

export interface ProductionInput {
  productId: string;
  portions: number;
  overrides?: { ingredientId: string; quantityBase: Dec }[];
  notes?: string;
  requestId: string;
  actorId: string | null;
}

/** Work out what a batch needs (no locking — for previews). */
export async function planProduction(tx: Tx, productId: string, portions: number, overrides: ProductionInput['overrides'] = []) {
  const product = await tx.product.findUnique({
    where: { id: productId },
    include: { recipeLines: { include: { ingredient: true }, orderBy: { sortOrder: 'asc' } } },
  });
  if (!product || !product.isActive) throw new HttpError(404, 'NOT_FOUND', 'Product not found');
  if (product.stockMode !== 'BATCH') {
    throw new HttpError(400, 'NOT_BATCH_PRODUCT', `${product.name} is not a batch-cooked item`);
  }
  if (product.recipeLines.length === 0) {
    throw new HttpError(400, 'NO_RECIPE', `Add a recipe for ${product.name} before recording a batch`);
  }
  const overrideMap = new Map(overrides.map((o) => [o.ingredientId, q3(o.quantityBase)]));
  for (const id of overrideMap.keys()) {
    if (!product.recipeLines.some((l) => l.ingredientId === id)) {
      throw new HttpError(400, 'BAD_OVERRIDE', 'Overrides may only change ingredients that are in the recipe');
    }
  }
  const lines = product.recipeLines.map((l) => {
    const required = overrideMap.get(l.ingredientId) ?? lineRequirement(l, product.recipeYield, portions);
    return { line: l, ingredient: l.ingredient, required };
  });
  return { product, lines };
}

export async function produceBatch(tx: Tx, input: ProductionInput) {
  await lockProducts(tx, [input.productId]);
  const { product, lines } = await planProduction(tx, input.productId, input.portions, input.overrides);
  await lockIngredients(tx, lines.map((l) => l.ingredient.id));

  // Re-read balances under the lock and report every shortage at once.
  const fresh = await tx.ingredient.findMany({ where: { id: { in: lines.map((l) => l.ingredient.id) } } });
  const byId = new Map(fresh.map((i) => [i.id, i]));
  const shortages: Shortage[] = [];
  for (const l of lines) {
    const ing = byId.get(l.ingredient.id)!;
    if (ing.onHand.lt(l.required)) {
      shortages.push({ id: ing.id, name: ing.name, required: l.required.toNumber(), onHand: ing.onHand.toNumber(), shortBy: l.required.minus(ing.onHand).toNumber() });
    }
  }
  if (shortages.length) {
    throw new InsufficientStockError(`Not enough ingredients to prepare ${input.portions} × ${product.name}`, shortages);
  }

  // The batch row is append-only, so its id is generated first, the movements reference
  // it, and the row is written once at the end with the final cost figures.
  const batchId = randomUUID();
  let total = 0n;
  const consumption: { ingredientId: string; ingredientName: string; quantity: number; displayUnit: string; valueMinor: number }[] = [];
  for (const l of lines) {
    if (l.required.isZero()) continue;
    const mv = await moveIngredient(tx, l.ingredient.id, 'PRODUCTION_CONSUME', l.required.neg(), {
      refType: 'PRODUCTION_BATCH',
      refId: batchId,
      actorId: input.actorId,
    });
    total += -mv.valueMinor;
    consumption.push({ ingredientId: l.ingredient.id, ingredientName: l.ingredient.name, quantity: l.required.toNumber(), displayUnit: l.ingredient.displayUnit, valueMinor: Number(-mv.valueMinor) });
  }
  await moveFinished(tx, product.id, 'PRODUCED', input.portions, {
    refType: 'PRODUCTION_BATCH',
    refId: batchId,
    actorId: input.actorId,
    incomingValueMinor: total,
  });
  const unitCost = c4(D(total.toString()).div(input.portions));
  await tx.productionBatch.create({
    data: {
      id: batchId,
      productId: product.id,
      portions: input.portions,
      consumption,
      totalCostMinor: total,
      unitCostMinor: unitCost,
      notes: input.notes ?? '',
      requestId: input.requestId,
      preparedById: input.actorId,
    },
  });
  return { batchId, totalCostMinor: total, unitCostMinor: unitCost, consumption };
}

// ─────────────────────────── sales (used by the POS in Phase 3) ───────────────────────────

export interface SaleLineInput {
  productId: string;
  quantity: number;
  modifierIds?: string[];
}

/**
 * Deduct stock for sold items, atomically. BATCH / RESALE items consume finished portions
 * only (their ingredients were consumed when the batch was prepared). MADE_TO_ORDER items
 * consume their recipe ingredients (plus modifier ingredients). Returns COGS per line.
 * Throws InsufficientStockError (nothing is changed) if any line cannot be fulfilled.
 */
export async function consumeForSale(tx: Tx, lines: SaleLineInput[], meta: { refType: string; refId: string; actorId: string | null }) {
  const productIds = lines.map((l) => l.productId);
  await lockProducts(tx, productIds);
  const products = await tx.product.findMany({
    where: { id: { in: productIds } },
    include: { recipeLines: true, modifierGroups: { include: { modifiers: true } } },
  });
  const pMap = new Map(products.map((p) => [p.id, p]));

  // Gather ingredient needs for made-to-order lines, then lock those ingredients.
  const needs = new Map<string, Dec>();
  for (const l of lines) {
    const p = pMap.get(l.productId);
    if (!p || !p.isActive) throw new HttpError(404, 'NOT_FOUND', 'Product not found');
    if (!p.isAvailable) throw new HttpError(409, 'UNAVAILABLE', `${p.name} is switched off`);
    if (p.stockMode !== 'MADE_TO_ORDER') continue;
    for (const r of p.recipeLines) needs.set(r.ingredientId, (needs.get(r.ingredientId) ?? ZERO).plus(lineRequirement(r, p.recipeYield, l.quantity)));
    const mods = p.modifierGroups.flatMap((g) => g.modifiers).filter((m) => l.modifierIds?.includes(m.id) && m.ingredientId && m.quantity);
    for (const m of mods) needs.set(m.ingredientId!, (needs.get(m.ingredientId!) ?? ZERO).plus(m.quantity!.mul(l.quantity)));
  }
  await lockIngredients(tx, [...needs.keys()]);

  const shortages: Shortage[] = [];
  const portionNeeds = new Map<string, number>();
  for (const l of lines) {
    const p = pMap.get(l.productId)!;
    if (p.stockMode === 'BATCH' || p.stockMode === 'RESALE') portionNeeds.set(p.id, (portionNeeds.get(p.id) ?? 0) + l.quantity);
  }
  for (const [id, n] of portionNeeds) {
    const p = await tx.product.findUniqueOrThrow({ where: { id } });
    if (p.portionsOnHand < n) shortages.push({ id, name: p.name, required: n, onHand: p.portionsOnHand, shortBy: n - p.portionsOnHand });
  }
  if (needs.size) {
    const ings = await tx.ingredient.findMany({ where: { id: { in: [...needs.keys()] } } });
    for (const i of ings) {
      const req = q3(needs.get(i.id)!);
      if (i.onHand.lt(req)) shortages.push({ id: i.id, name: i.name, required: req.toNumber(), onHand: i.onHand.toNumber(), shortBy: req.minus(i.onHand).toNumber() });
    }
  }
  if (shortages.length) throw new InsufficientStockError('Not enough stock for this order', shortages);

  const costs: { productId: string; costMinor: bigint }[] = [];
  for (const l of lines) {
    const p = pMap.get(l.productId)!;
    let cost = 0n;
    if (p.stockMode === 'BATCH' || p.stockMode === 'RESALE') {
      const mv = await moveFinished(tx, p.id, 'SOLD', -l.quantity, meta);
      cost = -mv.valueMinor;
    } else if (p.stockMode === 'MADE_TO_ORDER') {
      for (const r of p.recipeLines) {
        const mv = await moveIngredient(tx, r.ingredientId, 'SALE_CONSUME', lineRequirement(r, p.recipeYield, l.quantity).neg(), meta);
        cost += -mv.valueMinor;
      }
      const mods = p.modifierGroups.flatMap((g) => g.modifiers).filter((m) => l.modifierIds?.includes(m.id) && m.ingredientId && m.quantity);
      for (const m of mods) {
        const mv = await moveIngredient(tx, m.ingredientId!, 'SALE_CONSUME', m.quantity!.mul(l.quantity).neg(), meta);
        cost += -mv.valueMinor;
      }
    } else {
      cost = BigInt((p.manualCostMinor ?? 0) * l.quantity);
    }
    costs.push({ productId: p.id, costMinor: cost });
  }
  return costs;
}
