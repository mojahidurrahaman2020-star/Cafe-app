import { createHash } from 'node:crypto';
import express, { Router, type Request } from 'express';
import {
  finishedAdjustSchema,
  finishedReceiveSchema,
  hasPermission,
  modifiersSchema,
  productCreateSchema,
  productImageSchema,
  productUpdateSchema,
  recipeSchema,
  toBase,
  isUnitOf,
} from '@bitebrew/shared';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound, staleVersion } from '../../lib/errors.js';
import { idempotent } from '../../lib/idempotency.js';
import { prisma, type Tx } from '../../lib/prisma.js';
import { parseBody } from '../../lib/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { broadcast } from '../../realtime/hub.js';
import { normalizeName } from '../categories/routes.js';
import { D, lockProducts, moveFinished } from '../inventory/stock.js';
import { availabilityByCategory, listProducts, loadProduct, toProductDTO } from './service.js';

const showCost = (req: Request) => hasPermission(req.user!.role, 'reports.view');

async function respondProduct(req: Request, id: string) {
  const p = await loadProduct(id);
  if (!p) throw notFound('Product not found');
  return toProductDTO(p, { showCost: showCost(req) });
}

/** Bump the product version (used when recipe/options change) with optimistic concurrency. */
async function bumpVersion(tx: Tx, id: string, version: number) {
  const r = await tx.product.updateMany({ where: { id, version }, data: { version: { increment: 1 } } });
  if (!r.count) {
    const cur = await tx.product.findUnique({ where: { id } });
    if (!cur) throw notFound('Product not found');
    throw staleVersion({ id, version: cur.version });
  }
}

export const productsRouter = Router();

productsRouter.get('/products', requirePermission('menu.view'), async (req, res) => {
  res.json({ products: await listProducts({ showCost: showCost(req), includeInactive: req.query.includeInactive === 'true' }) });
});

productsRouter.get('/products/:id', requirePermission('menu.view'), async (req, res) => {
  res.json({ product: await respondProduct(req, String(req.params.id)) });
});

productsRouter.get('/availability', requirePermission('menu.view'), async (_req, res) => {
  res.json({ categories: await availabilityByCategory() });
});

productsRouter.post('/products', requirePermission('menu.manage'), async (req, res) => {
  const input = parseBody(productCreateSchema, req.body);
  const id = await prisma.$transaction(async (tx) => {
    if (!(await tx.menuCategory.findUnique({ where: { id: input.categoryId } }))) throw badRequest('Choose a valid category');
    if (await tx.product.findUnique({ where: { normalizedName: normalizeName(input.name) } })) throw conflict('A menu item with this name already exists');
    const sortOrder =
      input.sortOrder ?? ((await tx.product.aggregate({ where: { categoryId: input.categoryId }, _max: { sortOrder: true } }))._max.sortOrder ?? -10) + 10;
    const p = await tx.product.create({
      data: {
        categoryId: input.categoryId,
        name: input.name.replace(/\s+/g, ' '),
        normalizedName: normalizeName(input.name),
        description: input.description ?? '',
        priceMinor: input.priceMinor,
        stationOverride: input.stationOverride ?? null,
        stockMode: input.stockMode,
        isAvailable: input.isAvailable ?? true,
        isActive: input.isActive ?? true,
        sortOrder,
        recipeYield: 1,
        manualCostMinor: input.manualCostMinor ?? null,
      },
    });
    await audit(req, { action: 'product.create', entityType: 'Product', entityId: p.id, after: { name: p.name, priceMinor: p.priceMinor, stockMode: p.stockMode, categoryId: p.categoryId } }, tx);
    return p.id;
  });
  broadcast({ type: 'products.changed' });
  res.status(201).json({ product: await respondProduct(req, id) });
});

productsRouter.patch('/products/:id', requirePermission('menu.manage'), async (req, res) => {
  const { version, ...changes } = parseBody(productUpdateSchema, req.body);
  const id = String(req.params.id);
  await prisma.$transaction(async (tx) => {
    const before = await tx.product.findUnique({ where: { id } });
    if (!before) throw notFound('Product not found');
    const data: Record<string, unknown> = { ...changes };
    if (changes.name !== undefined) {
      const clash = await tx.product.findUnique({ where: { normalizedName: normalizeName(changes.name) } });
      if (clash && clash.id !== id) throw conflict('A menu item with this name already exists');
      data.name = changes.name.replace(/\s+/g, ' ');
      data.normalizedName = normalizeName(changes.name);
    }
    if (changes.categoryId && !(await tx.menuCategory.findUnique({ where: { id: changes.categoryId } }))) throw badRequest('Choose a valid category');
    if (changes.stockMode && changes.stockMode !== before.stockMode) {
      if (before.portionsOnHand > 0) {
        throw conflict(`${before.name} still has ${before.portionsOnHand} portion(s) in stock. Sell, waste or count them to 0 before changing how its stock works.`);
      }
      if (changes.stockMode !== 'BATCH') data.recipeYield = 1;
    }
    const r = await tx.product.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
    if (!r.count) throw staleVersion({ id, version: before.version });
    const after = await tx.product.findUniqueOrThrow({ where: { id } });
    const snap = (p: typeof before) => ({ name: p.name, categoryId: p.categoryId, priceMinor: p.priceMinor, stockMode: p.stockMode, stationOverride: p.stationOverride, isAvailable: p.isAvailable, isActive: p.isActive, manualCostMinor: p.manualCostMinor, description: p.description });
    await audit(req, { action: before.priceMinor !== after.priceMinor ? 'product.update_price' : 'product.update', entityType: 'Product', entityId: id, before: snap(before), after: snap(after) }, tx);
  });
  broadcast({ type: 'products.changed' });
  res.json({ product: await respondProduct(req, id) });
});

productsRouter.delete('/products/:id', requirePermission('menu.manage'), async (req, res) => {
  const id = String(req.params.id);
  await prisma.$transaction(async (tx) => {
    const p = await tx.product.findUnique({ where: { id }, include: { _count: { select: { finishedMovements: true, batches: true } } } });
    if (!p) throw notFound('Product not found');
    if (p._count.finishedMovements || p._count.batches) {
      throw conflict(`${p.name} has stock history and cannot be deleted. Hide it instead (untick "Active").`);
    }
    await tx.product.delete({ where: { id } });
    await audit(req, { action: 'product.delete', entityType: 'Product', entityId: id, before: { name: p.name, priceMinor: p.priceMinor } }, tx);
  });
  broadcast({ type: 'products.changed' });
  res.status(204).end();
});

// ───────────── recipe ─────────────
productsRouter.put('/products/:id/recipe', requirePermission('menu.manage'), async (req, res) => {
  const input = parseBody(recipeSchema, req.body);
  const id = String(req.params.id);
  await prisma.$transaction(async (tx) => {
    const p = await tx.product.findUnique({ where: { id }, include: { recipeLines: true } });
    if (!p) throw notFound('Product not found');
    if (p.stockMode !== 'BATCH' && p.stockMode !== 'MADE_TO_ORDER') throw badRequest('Only batch-cooked and made-to-order items have recipes');
    if (p.stockMode === 'MADE_TO_ORDER' && input.recipeYield !== 1) throw badRequest('Made-to-order recipes are for one portion (yield 1)');
    const ids = input.lines.map((l) => l.ingredientId);
    if (new Set(ids).size !== ids.length) throw badRequest('Each ingredient can appear only once in a recipe');
    const ings = await tx.ingredient.findMany({ where: { id: { in: ids } } });
    const byId = new Map(ings.map((i) => [i.id, i]));
    const lines = input.lines.map((l, idx) => {
      const ing = byId.get(l.ingredientId);
      if (!ing) throw badRequest('Unknown ingredient in recipe');
      if (!isUnitOf(l.unit, ing.dimension)) {
        throw badRequest('Please check the highlighted fields', [{ path: `lines.${idx}.unit`, message: `${ing.name} is measured by ${ing.dimension.toLowerCase()}` }]);
      }
      return { productId: id, ingredientId: ing.id, quantity: D(toBase(l.quantity, l.unit, ing.dimension)), wastagePct: D(l.wastagePct ?? 0), sortOrder: idx };
    });
    await bumpVersion(tx, id, input.version);
    await tx.recipeLine.deleteMany({ where: { productId: id } });
    if (lines.length) await tx.recipeLine.createMany({ data: lines });
    await tx.product.update({ where: { id }, data: { recipeYield: input.recipeYield } });
    await audit(req, {
      action: 'product.recipe_update', entityType: 'Product', entityId: id,
      before: { recipeYield: p.recipeYield, lines: p.recipeLines.map((l) => ({ ingredientId: l.ingredientId, quantity: l.quantity.toNumber(), wastagePct: l.wastagePct.toNumber() })) },
      after: { recipeYield: input.recipeYield, lines: lines.map((l) => ({ ingredientId: l.ingredientId, quantity: l.quantity.toNumber(), wastagePct: l.wastagePct.toNumber() })) },
    }, tx);
  });
  broadcast({ type: 'products.changed' });
  res.json({ product: await respondProduct(req, id) });
});

// ───────────── customisation options ─────────────
productsRouter.put('/products/:id/modifiers', requirePermission('menu.manage'), async (req, res) => {
  const input = parseBody(modifiersSchema, req.body);
  const id = String(req.params.id);
  await prisma.$transaction(async (tx) => {
    if (!(await tx.product.findUnique({ where: { id } }))) throw notFound('Product not found');
    const ingIds = input.groups.flatMap((g) => g.options.map((o) => o.ingredientId).filter((x): x is string => !!x));
    const ings = new Map((await tx.ingredient.findMany({ where: { id: { in: ingIds } } })).map((i) => [i.id, i]));
    await bumpVersion(tx, id, input.version);
    await tx.modifierGroup.deleteMany({ where: { productId: id } });
    for (const [gi, g] of input.groups.entries()) {
      if (g.maxSelect < g.minSelect) throw badRequest('Minimum choices cannot exceed maximum');
      await tx.modifierGroup.create({
        data: {
          productId: id, name: g.name, minSelect: g.minSelect, maxSelect: Math.min(g.maxSelect, g.options.length), sortOrder: gi,
          modifiers: {
            create: g.options.map((o, oi) => {
              let quantity = null;
              if (o.ingredientId) {
                const ing = ings.get(o.ingredientId);
                if (!ing || !o.unit || !o.quantity || !isUnitOf(o.unit, ing.dimension)) throw badRequest(`Check the ingredient amount for option "${o.name}"`);
                quantity = D(toBase(o.quantity, o.unit, ing.dimension));
              }
              return { name: o.name, priceDeltaMinor: o.priceDeltaMinor, ingredientId: o.ingredientId ?? null, quantity, isAvailable: o.isAvailable ?? true, sortOrder: oi };
            }),
          },
        },
      });
    }
    await audit(req, { action: 'product.options_update', entityType: 'Product', entityId: id, after: input.groups }, tx);
  });
  broadcast({ type: 'products.changed' });
  res.json({ product: await respondProduct(req, id) });
});

// ───────────── image ─────────────
productsRouter.put('/products/:id/image', requirePermission('menu.manage'), express.json({ limit: '2mb' }), async (req, res) => {
  const { dataUrl } = parseBody(productImageSchema, req.body);
  const id = String(req.params.id);
  const [, mimeType, b64] = dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/)!;
  const data = Buffer.from(b64!, 'base64');
  if (data.length > 1_000_000) throw badRequest('Image is too large (max 1 MB after resizing)');
  const etag = createHash('sha256').update(data).digest('hex').slice(0, 32);
  await prisma.$transaction(async (tx) => {
    if (!(await tx.product.findUnique({ where: { id } }))) throw notFound('Product not found');
    await tx.productImage.upsert({ where: { productId: id }, update: { mimeType: mimeType!, data, etag }, create: { productId: id, mimeType: mimeType!, data, etag } });
    await tx.product.update({ where: { id }, data: { hasImage: true } });
    await audit(req, { action: 'product.image_update', entityType: 'Product', entityId: id, after: { bytes: data.length, mimeType } }, tx);
  });
  broadcast({ type: 'products.changed' });
  res.json({ product: await respondProduct(req, id) });
});

productsRouter.delete('/products/:id/image', requirePermission('menu.manage'), async (req, res) => {
  const id = String(req.params.id);
  await prisma.$transaction(async (tx) => {
    await tx.productImage.deleteMany({ where: { productId: id } });
    await tx.product.update({ where: { id }, data: { hasImage: false } });
    await audit(req, { action: 'product.image_remove', entityType: 'Product', entityId: id }, tx);
  });
  broadcast({ type: 'products.changed' });
  res.json({ product: await respondProduct(req, id) });
});

productsRouter.get('/products/:id/image', requirePermission('menu.view'), async (req, res) => {
  const img = await prisma.productImage.findUnique({ where: { productId: String(req.params.id) } });
  if (!img) throw notFound('No image');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('ETag', `"${img.etag}"`);
  if (req.get('if-none-match') === `"${img.etag}"`) return void res.status(304).end();
  res.type(img.mimeType).send(Buffer.from(img.data));
});

// ───────────── finished portions ─────────────
productsRouter.post('/products/:id/stock/adjust', requirePermission('inventory.adjust'), async (req, res) => {
  const input = parseBody(finishedAdjustSchema, req.body);
  const id = String(req.params.id);
  const { replayed } = await idempotent(
    () =>
      prisma.$transaction(async (tx) => {
        await lockProducts(tx, [id]);
        const p = await tx.product.findUnique({ where: { id } });
        if (!p) throw notFound('Product not found');
        if (p.stockMode !== 'BATCH' && p.stockMode !== 'RESALE') throw badRequest('This item does not keep portion stock');
        const delta = input.type === 'COUNT' ? input.quantity - p.portionsOnHand : input.type === 'ADJUSTMENT' ? input.quantity : -input.quantity;
        const mv = await moveFinished(tx, id, input.type, delta, { reason: input.reason || null, requestId: input.requestId, actorId: req.user!.id });
        await audit(req, { action: `portions.${input.type.toLowerCase()}`, entityType: 'Product', entityId: id, before: { portionsOnHand: p.portionsOnHand }, after: { portionsOnHand: mv.balanceAfter, reason: input.reason } }, tx);
        return mv.id;
      }),
    async () => (await prisma.finishedMovement.findUnique({ where: { requestId: input.requestId } }))?.id ?? null,
  );
  if (!replayed) broadcast({ type: 'inventory.changed' });
  res.status(replayed ? 200 : 201).json({ product: await respondProduct(req, id), replayed });
});

productsRouter.post('/products/:id/stock/receive', requirePermission('purchases.manage'), async (req, res) => {
  const input = parseBody(finishedReceiveSchema, req.body);
  const id = String(req.params.id);
  const { replayed } = await idempotent(
    () =>
      prisma.$transaction(async (tx) => {
        await lockProducts(tx, [id]);
        const p = await tx.product.findUnique({ where: { id } });
        if (!p) throw notFound('Product not found');
        if (p.stockMode !== 'RESALE') throw badRequest('Only ready-made items are received as units. Batch items are added by recording a production batch.');
        const mv = await moveFinished(tx, id, 'RECEIVE', input.quantity, {
          incomingValueMinor: BigInt(input.totalCostMinor),
          reason: input.reference || null,
          requestId: input.requestId,
          actorId: req.user!.id,
          refType: 'RECEIPT',
        });
        await audit(req, { action: 'portions.receive', entityType: 'Product', entityId: id, after: { quantity: input.quantity, totalCostMinor: input.totalCostMinor } }, tx);
        return mv.id;
      }),
    async () => (await prisma.finishedMovement.findUnique({ where: { requestId: input.requestId } }))?.id ?? null,
  );
  if (!replayed) broadcast({ type: 'inventory.changed' });
  res.status(replayed ? 200 : 201).json({ product: await respondProduct(req, id), replayed });
});
