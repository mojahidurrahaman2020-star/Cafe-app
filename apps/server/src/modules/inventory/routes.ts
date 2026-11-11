import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  adjustStockSchema,
  hasPermission,
  ingredientCreateSchema,
  ingredientUpdateSchema,
  isUnitOf,
  receiveStockSchema,
  supplierCreateSchema,
  supplierUpdateSchema,
  toBase,
  type IngredientDTO,
  type StockMovementDTO,
  type StockSummaryDTO,
  type SupplierDTO,
  type UnitCode,
} from '@bitebrew/shared';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound, staleVersion } from '../../lib/errors.js';
import { idempotent } from '../../lib/idempotency.js';
import { prisma } from '../../lib/prisma.js';
import { parseBody } from '../../lib/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { broadcast } from '../../realtime/hub.js';
import { normalizeName } from '../categories/routes.js';
import { D, lockIngredients, moveIngredient, toMinor } from './stock.js';

const showCost = (req: Request) => hasPermission(req.user!.role, 'reports.view');

// ───────────── mappers ─────────────
type SupplierRow = Awaited<ReturnType<typeof prisma.supplier.findUniqueOrThrow>>;
const toSupplierDTO = (s: SupplierRow): SupplierDTO => ({
  id: s.id, name: s.name, phone: s.phone, address: s.address, notes: s.notes, isActive: s.isActive, version: s.version,
});

const ingredientInclude = { supplier: { select: { id: true, name: true } }, _count: { select: { recipeLines: true } } } as const;
type IngredientRow = NonNullable<Awaited<ReturnType<typeof findIngredient>>>;
const findIngredient = (id: string) => prisma.ingredient.findUnique({ where: { id }, include: ingredientInclude });

function toIngredientDTO(i: IngredientRow, withCost: boolean): IngredientDTO {
  return {
    id: i.id,
    name: i.name,
    dimension: i.dimension,
    displayUnit: i.displayUnit as UnitCode,
    onHand: i.onHand.toNumber(),
    minLevel: i.minLevel.toNumber(),
    avgCostMinor: withCost ? i.avgCostMinor.toNumber() : 0,
    stockValueMinor: withCost ? Number(toMinor(i.onHand.mul(i.avgCostMinor))) : 0,
    isLow: i.isActive && i.minLevel.gt(0) && i.onHand.lte(i.minLevel),
    supplier: i.supplier,
    isPackaging: i.isPackaging,
    isActive: i.isActive,
    notes: i.notes,
    usedInProducts: i._count.recipeLines,
    version: i.version,
  };
}

function unitFor(unit: UnitCode, dimension: IngredientRow['dimension'], field = 'unit') {
  if (!isUnitOf(unit, dimension)) {
    throw badRequest('Please check the highlighted fields', [{ path: field, message: `This item is measured by ${dimension.toLowerCase()}; ${unit} cannot be used` }]);
  }
  return unit;
}

export const inventoryRouter = Router();

// ───────────── suppliers ─────────────
inventoryRouter.get('/suppliers', requirePermission('inventory.view'), async (_req, res) => {
  const rows = await prisma.supplier.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
  res.json({ suppliers: rows.map(toSupplierDTO) });
});

inventoryRouter.post('/suppliers', requirePermission('purchases.manage'), async (req, res) => {
  const input = parseBody(supplierCreateSchema, req.body);
  const created = await prisma.$transaction(async (tx) => {
    if (await tx.supplier.findUnique({ where: { normalizedName: normalizeName(input.name) } })) throw conflict('A supplier with this name already exists');
    const s = await tx.supplier.create({ data: { ...input, name: input.name.replace(/\s+/g, ' '), normalizedName: normalizeName(input.name) } });
    await audit(req, { action: 'supplier.create', entityType: 'Supplier', entityId: s.id, after: toSupplierDTO(s) }, tx);
    return s;
  });
  broadcast({ type: 'inventory.changed' });
  res.status(201).json({ supplier: toSupplierDTO(created) });
});

inventoryRouter.patch('/suppliers/:id', requirePermission('purchases.manage'), async (req, res) => {
  const { version, ...changes } = parseBody(supplierUpdateSchema, req.body);
  const id = String(req.params.id);
  const after = await prisma.$transaction(async (tx) => {
    const before = await tx.supplier.findUnique({ where: { id } });
    if (!before) throw notFound('Supplier not found');
    const data: Record<string, unknown> = { ...changes };
    if (changes.name) {
      const clash = await tx.supplier.findUnique({ where: { normalizedName: normalizeName(changes.name) } });
      if (clash && clash.id !== id) throw conflict('A supplier with this name already exists');
      data.name = changes.name.replace(/\s+/g, ' ');
      data.normalizedName = normalizeName(changes.name);
    }
    const r = await tx.supplier.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
    if (!r.count) throw staleVersion(toSupplierDTO(before));
    const a = await tx.supplier.findUniqueOrThrow({ where: { id } });
    await audit(req, { action: 'supplier.update', entityType: 'Supplier', entityId: id, before: toSupplierDTO(before), after: toSupplierDTO(a) }, tx);
    return a;
  });
  broadcast({ type: 'inventory.changed' });
  res.json({ supplier: toSupplierDTO(after) });
});

// ───────────── ingredients ─────────────
inventoryRouter.get('/ingredients', requirePermission('inventory.view'), async (req, res) => {
  const rows = await prisma.ingredient.findMany({
    where: req.query.includeInactive === 'true' ? {} : { isActive: true },
    include: ingredientInclude,
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  });
  res.json({ ingredients: rows.map((r) => toIngredientDTO(r, showCost(req))) });
});

inventoryRouter.post('/ingredients', requirePermission('inventory.adjust'), async (req, res) => {
  const input = parseBody(ingredientCreateSchema, req.body);
  const displayUnit = unitFor(input.displayUnit, input.dimension, 'displayUnit');
  const created = await prisma.$transaction(async (tx) => {
    if (await tx.ingredient.findUnique({ where: { normalizedName: normalizeName(input.name) } })) throw conflict('An ingredient with this name already exists');
    const i = await tx.ingredient.create({
      data: {
        name: input.name.replace(/\s+/g, ' '),
        normalizedName: normalizeName(input.name),
        dimension: input.dimension,
        displayUnit,
        minLevel: D(toBase(input.minLevel ?? 0, displayUnit, input.dimension)),
        supplierId: input.supplierId ?? null,
        isPackaging: input.isPackaging ?? false,
        notes: input.notes ?? '',
      },
    });
    await audit(req, { action: 'ingredient.create', entityType: 'Ingredient', entityId: i.id, after: { name: i.name, dimension: i.dimension, displayUnit, minLevel: i.minLevel.toNumber() } }, tx);
    return i;
  });
  broadcast({ type: 'inventory.changed' });
  res.status(201).json({ ingredient: toIngredientDTO((await findIngredient(created.id))!, showCost(req)) });
});

inventoryRouter.patch('/ingredients/:id', requirePermission('inventory.adjust'), async (req, res) => {
  const { version, ...changes } = parseBody(ingredientUpdateSchema, req.body);
  const id = String(req.params.id);
  await prisma.$transaction(async (tx) => {
    const before = await tx.ingredient.findUnique({ where: { id } });
    if (!before) throw notFound('Ingredient not found');
    const unit = changes.displayUnit ? unitFor(changes.displayUnit, before.dimension, 'displayUnit') : (before.displayUnit as UnitCode);
    const data: Record<string, unknown> = {};
    if (changes.name !== undefined) {
      const clash = await tx.ingredient.findUnique({ where: { normalizedName: normalizeName(changes.name) } });
      if (clash && clash.id !== id) throw conflict('An ingredient with this name already exists');
      data.name = changes.name.replace(/\s+/g, ' ');
      data.normalizedName = normalizeName(changes.name);
    }
    if (changes.displayUnit) data.displayUnit = unit;
    if (changes.minLevel !== undefined) data.minLevel = D(toBase(changes.minLevel, unit, before.dimension));
    for (const k of ['supplierId', 'isPackaging', 'isActive', 'notes'] as const) if (changes[k] !== undefined) data[k] = changes[k];
    const r = await tx.ingredient.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
    if (!r.count) throw staleVersion({ id, version: before.version });
    const after = await tx.ingredient.findUniqueOrThrow({ where: { id } });
    const snap = (x: typeof before) => ({ name: x.name, displayUnit: x.displayUnit, minLevel: x.minLevel.toNumber(), supplierId: x.supplierId, isPackaging: x.isPackaging, isActive: x.isActive, notes: x.notes });
    await audit(req, { action: 'ingredient.update', entityType: 'Ingredient', entityId: id, before: snap(before), after: snap(after) }, tx);
  });
  broadcast({ type: 'inventory.changed' });
  res.json({ ingredient: toIngredientDTO((await findIngredient(id))!, showCost(req)) });
});

inventoryRouter.delete('/ingredients/:id', requirePermission('inventory.adjust'), async (req, res) => {
  const id = String(req.params.id);
  await prisma.$transaction(async (tx) => {
    const ing = await tx.ingredient.findUnique({ where: { id }, include: { _count: { select: { movements: true, recipeLines: true, modifiers: true } } } });
    if (!ing) throw notFound('Ingredient not found');
    if (ing._count.recipeLines || ing._count.modifiers) throw conflict('This ingredient is used in a recipe or option. Remove it there first, or deactivate it.');
    if (ing._count.movements) throw conflict('This ingredient has stock history and cannot be deleted. Deactivate it instead.');
    await tx.ingredient.delete({ where: { id } });
    await audit(req, { action: 'ingredient.delete', entityType: 'Ingredient', entityId: id, before: { name: ing.name } }, tx);
  });
  broadcast({ type: 'inventory.changed' });
  res.status(204).end();
});

/** Receive stock (a delivery or an opening balance) with its cost. */
inventoryRouter.post('/ingredients/:id/receive', requirePermission('purchases.manage'), async (req, res) => {
  const input = parseBody(receiveStockSchema, req.body);
  const id = String(req.params.id);
  const { replayed } = await idempotent(
    () =>
      prisma.$transaction(async (tx) => {
        await lockIngredients(tx, [id]);
        const ing = await tx.ingredient.findUnique({ where: { id } });
        if (!ing || !ing.isActive) throw notFound('Ingredient not found');
        const qty = toBase(input.quantity, unitFor(input.unit, ing.dimension), ing.dimension);
        const mv = await moveIngredient(tx, id, 'RECEIVE', D(qty), {
          receiveValueMinor: BigInt(input.totalCostMinor),
          supplierId: input.supplierId ?? ing.supplierId,
          reason: input.reference || null,
          requestId: input.requestId,
          actorId: req.user!.id,
          refType: 'RECEIPT',
        });
        await audit(req, { action: 'stock.receive', entityType: 'Ingredient', entityId: id, after: { quantity: qty, totalCostMinor: input.totalCostMinor, reference: input.reference } }, tx);
        return mv.id;
      }),
    async () => (await prisma.stockMovement.findUnique({ where: { requestId: input.requestId } }))?.id ?? null,
  );
  if (!replayed) broadcast({ type: 'inventory.changed' });
  res.status(replayed ? 200 : 201).json({ ingredient: toIngredientDTO((await findIngredient(id))!, showCost(req)), replayed });
});

/** Waste, spoilage, corrections and physical counts. */
inventoryRouter.post('/ingredients/:id/adjust', requirePermission('inventory.adjust'), async (req, res) => {
  const input = parseBody(adjustStockSchema, req.body);
  const id = String(req.params.id);
  const { replayed } = await idempotent(
    () =>
      prisma.$transaction(async (tx) => {
        await lockIngredients(tx, [id]);
        const ing = await tx.ingredient.findUnique({ where: { id } });
        if (!ing) throw notFound('Ingredient not found');
        const q = D(toBase(input.quantity, unitFor(input.unit, ing.dimension), ing.dimension));
        const delta = input.type === 'COUNT' ? q.minus(ing.onHand) : input.type === 'ADJUSTMENT' ? q : q.neg();
        const mv = await moveIngredient(tx, id, input.type, delta, {
          reason: input.reason || null,
          requestId: input.requestId,
          actorId: req.user!.id,
        });
        await audit(req, { action: `stock.${input.type.toLowerCase()}`, entityType: 'Ingredient', entityId: id, before: { onHand: ing.onHand.toNumber() }, after: { onHand: mv.balanceAfter.toNumber(), reason: input.reason } }, tx);
        return mv.id;
      }),
    async () => (await prisma.stockMovement.findUnique({ where: { requestId: input.requestId } }))?.id ?? null,
  );
  if (!replayed) broadcast({ type: 'inventory.changed' });
  res.status(replayed ? 200 : 201).json({ ingredient: toIngredientDTO((await findIngredient(id))!, showCost(req)), replayed });
});

// ───────────── ledger & summary ─────────────
const movementQuery = z.object({
  kind: z.enum(['INGREDIENT', 'FINISHED']).optional(),
  itemId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

inventoryRouter.get('/stock/movements', requirePermission('inventory.view'), async (req, res) => {
  const q = parseBody(movementQuery, req.query);
  const withCost = showCost(req);
  const actorIds = new Set<string>();
  const out: StockMovementDTO[] = [];
  if (q.kind !== 'FINISHED') {
    const rows = await prisma.stockMovement.findMany({
      where: q.itemId ? { ingredientId: q.itemId } : {},
      include: { ingredient: true },
      orderBy: { seq: 'desc' },
      take: q.limit,
    });
    for (const m of rows) {
      if (m.actorId) actorIds.add(m.actorId);
      out.push({
        id: m.id, kind: 'INGREDIENT', itemId: m.ingredientId, itemName: m.ingredient.name, type: m.type,
        qtyDelta: m.qtyDelta.toNumber(), balanceAfter: m.balanceAfter.toNumber(),
        unit: m.ingredient.displayUnit as UnitCode, dimension: m.ingredient.dimension,
        unitCostMinor: withCost ? m.unitCostMinor.toNumber() : 0, valueMinor: withCost ? Number(m.valueMinor) : 0,
        reason: m.reason, refType: m.refType, refId: m.refId, actor: m.actorId, occurredAt: m.occurredAt.toISOString(),
      });
    }
  }
  if (q.kind !== 'INGREDIENT') {
    const rows = await prisma.finishedMovement.findMany({
      where: q.itemId ? { productId: q.itemId } : {},
      include: { product: true },
      orderBy: { seq: 'desc' },
      take: q.limit,
    });
    for (const m of rows) {
      if (m.actorId) actorIds.add(m.actorId);
      out.push({
        id: m.id, kind: 'FINISHED', itemId: m.productId, itemName: m.product.name, type: m.type,
        qtyDelta: m.qtyDelta, balanceAfter: m.balanceAfter, unit: 'portion', dimension: null,
        unitCostMinor: withCost ? m.unitCostMinor.toNumber() : 0, valueMinor: withCost ? Number(m.valueMinor) : 0,
        reason: m.reason, refType: m.refType, refId: m.refId, actor: m.actorId, occurredAt: m.occurredAt.toISOString(),
      });
    }
  }
  const users = await prisma.user.findMany({ where: { id: { in: [...actorIds] } }, select: { id: true, fullName: true } });
  const names = new Map(users.map((u) => [u.id, u.fullName]));
  out.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  res.json({ movements: out.slice(0, q.limit).map((m) => ({ ...m, actor: m.actor ? names.get(m.actor) ?? null : null })) });
});

export async function stockSummary(withCost: boolean): Promise<StockSummaryDTO> {
  const [ingredients, products] = await Promise.all([
    prisma.ingredient.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
    prisma.product.findMany({ where: { isActive: true }, include: { category: true, recipeLines: { include: { ingredient: true } } } }),
  ]);
  const ingredientValue = ingredients.reduce((s, i) => s + toMinor(i.onHand.mul(i.avgCostMinor)), 0n);
  const finishedValue = products.reduce((s, p) => s + toMinor(p.portionCostMinor.mul(p.portionsOnHand)), 0n);
  const soldOut = products
    .filter((p) => {
      if (!p.isAvailable || !p.category.isActive) return false;
      if (p.stockMode === 'BATCH' || p.stockMode === 'RESALE') return p.portionsOnHand <= 0;
      if (p.stockMode === 'MADE_TO_ORDER' && p.recipeLines.length) {
        return p.recipeLines.some((l) => l.ingredient.onHand.lt(l.quantity.mul(D(1).plus(l.wastagePct.div(100))).div(p.recipeYield)));
      }
      return false;
    })
    .map((p) => ({ id: p.id, name: p.name, categoryName: p.category.name }));
  return {
    ingredientValueMinor: withCost ? Number(ingredientValue) : 0,
    finishedValueMinor: withCost ? Number(finishedValue) : 0,
    totalValueMinor: withCost ? Number(ingredientValue + finishedValue) : 0,
    lowStock: ingredients
      .filter((i) => i.minLevel.gt(0) && i.onHand.lte(i.minLevel))
      .map((i) => ({ id: i.id, name: i.name, onHand: i.onHand.toNumber(), minLevel: i.minLevel.toNumber(), displayUnit: i.displayUnit as UnitCode })),
    soldOut,
  };
}

inventoryRouter.get('/stock/summary', requirePermission('inventory.view'), async (req, res) => {
  res.json({ summary: await stockSummary(showCost(req)) });
});
