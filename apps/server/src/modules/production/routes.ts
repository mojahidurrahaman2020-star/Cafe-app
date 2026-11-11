import { Router, type Request } from 'express';
import { z } from 'zod';
import { hasPermission, productionSchema, toBase, type ProductionBatchDTO, type ProductionPreviewDTO, type UnitCode } from '@bitebrew/shared';
import { audit } from '../../lib/audit.js';
import { badRequest } from '../../lib/errors.js';
import { idempotent } from '../../lib/idempotency.js';
import { prisma } from '../../lib/prisma.js';
import { parseBody } from '../../lib/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { broadcast } from '../../realtime/hub.js';
import { D, type Dec, lineRequirement, planProduction, produceBatch, toMinor } from '../inventory/stock.js';

const showCost = (req: Request) => hasPermission(req.user!.role, 'reports.view');

export const productionRouter = Router();

const previewQuery = z.object({ productId: z.string().uuid(), portions: z.coerce.number().int().positive().max(10_000) });

/** What a batch of N portions needs, what is short, and the most that can be made now. */
productionRouter.get('/production/preview', requirePermission('production.manage'), async (req, res) => {
  const q = parseBody(previewQuery, req.query);
  const { product, lines } = await planProduction(prisma, q.productId, q.portions);
  const withCost = showCost(req);
  let total = 0n;
  let maxPortions = Number.MAX_SAFE_INTEGER;
  const requirements = lines.map((l) => {
    const cost = toMinor(l.required.mul(l.ingredient.avgCostMinor));
    total += cost;
    const perPortion = lineRequirement(l.line, product.recipeYield, 1);
    if (perPortion.gt(0)) maxPortions = Math.min(maxPortions, Math.floor(l.ingredient.onHand.div(perPortion).toNumber()));
    const short = l.required.minus(l.ingredient.onHand);
    return {
      ingredientId: l.ingredient.id,
      ingredientName: l.ingredient.name,
      displayUnit: l.ingredient.displayUnit as UnitCode,
      required: l.required.toNumber(),
      onHand: l.ingredient.onHand.toNumber(),
      shortBy: short.gt(0) ? short.toNumber() : 0,
      costMinor: withCost ? Number(cost) : 0,
    };
  });
  const preview: ProductionPreviewDTO = {
    productId: product.id,
    portions: q.portions,
    requirements,
    totalCostMinor: withCost ? Number(total) : 0,
    unitCostMinor: withCost ? Math.round(Number(total) / q.portions) : 0,
    canProduce: requirements.every((r) => r.shortBy === 0),
    maxPortions: maxPortions === Number.MAX_SAFE_INTEGER ? 0 : maxPortions,
  };
  res.json({ preview });
});

productionRouter.post('/production/batches', requirePermission('production.manage'), async (req, res) => {
  const input = parseBody(productionSchema, req.body);
  let overrides: { ingredientId: string; quantityBase: Dec }[] = [];
  if (input.overrides?.length) {
    const ings = new Map((await prisma.ingredient.findMany({ where: { id: { in: input.overrides.map((o) => o.ingredientId) } } })).map((i) => [i.id, i]));
    overrides = input.overrides.map((o) => {
      const ing = ings.get(o.ingredientId);
      if (!ing) throw badRequest('Unknown ingredient in overrides');
      return { ingredientId: ing.id, quantityBase: D(toBase(o.quantity, o.unit, ing.dimension)) };
    });
  }
  const { result, replayed } = await idempotent(
    () =>
      prisma.$transaction(async (tx) => {
        const r = await produceBatch(tx, { productId: input.productId, portions: input.portions, overrides, notes: input.notes, requestId: input.requestId, actorId: req.user!.id });
        await audit(req, { action: 'production.batch', entityType: 'Product', entityId: input.productId, after: { batchId: r.batchId, portions: input.portions, totalCostMinor: Number(r.totalCostMinor), overrides: input.overrides ?? [] } }, tx);
        return r.batchId;
      }),
    async () => (await prisma.productionBatch.findUnique({ where: { requestId: input.requestId } }))?.id ?? null,
  );
  if (!replayed) {
    broadcast({ type: 'inventory.changed' });
    broadcast({ type: 'products.changed' });
  }
  const batch = await prisma.productionBatch.findUniqueOrThrow({ where: { id: result }, include: { product: true } });
  res.status(replayed ? 200 : 201).json({ batch: await toBatchDTO(batch, showCost(req)), replayed });
});

type BatchRow = Awaited<ReturnType<typeof prisma.productionBatch.findUniqueOrThrow>> & { product: { name: string } };

async function toBatchDTO(b: BatchRow, withCost: boolean, names?: Map<string, string>): Promise<ProductionBatchDTO> {
  let preparedBy: string | null = null;
  if (b.preparedById) preparedBy = names?.get(b.preparedById) ?? (await prisma.user.findUnique({ where: { id: b.preparedById } }))?.fullName ?? null;
  const consumption = (b.consumption as ProductionBatchDTO['consumption']).map((c) => ({ ...c, valueMinor: withCost ? c.valueMinor : 0 }));
  return {
    id: b.id,
    batchNo: b.batchNo,
    productId: b.productId,
    productName: b.product.name,
    portions: b.portions,
    totalCostMinor: withCost ? Number(b.totalCostMinor) : 0,
    unitCostMinor: withCost ? Math.round(b.unitCostMinor.toNumber()) : 0,
    notes: b.notes,
    preparedBy,
    preparedAt: b.preparedAt.toISOString(),
    consumption,
  };
}

productionRouter.get('/production/batches', requirePermission('production.manage'), async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  const rows = await prisma.productionBatch.findMany({ orderBy: { batchNo: 'desc' }, take: limit, include: { product: true } });
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.preparedById).filter((x): x is string => !!x) } } });
  const names = new Map(users.map((u) => [u.id, u.fullName]));
  res.json({ batches: await Promise.all(rows.map((r) => toBatchDTO(r, showCost(req), names))) });
});
