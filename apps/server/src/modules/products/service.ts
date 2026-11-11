import type { CategoryAvailabilityDTO, ModifierGroupDTO, ProductDTO, RecipeLineDTO, UnitCode } from '@bitebrew/shared';
import { prisma, type Tx } from '../../lib/prisma.js';
import { D, lineRequirement, toMinor } from '../inventory/stock.js';

export const productInclude = {
  category: true,
  recipeLines: { include: { ingredient: true }, orderBy: { sortOrder: 'asc' } },
  modifierGroups: { include: { modifiers: { include: { ingredient: true }, orderBy: { sortOrder: 'asc' } } }, orderBy: { sortOrder: 'asc' } },
  image: { select: { etag: true } },
} as const;

type Loaded = NonNullable<Awaited<ReturnType<typeof loadProduct>>>;

export function loadProduct(id: string, tx: Tx | typeof prisma = prisma) {
  return tx.product.findUnique({ where: { id }, include: productInclude });
}

export function toProductDTO(p: Loaded, opts: { showCost: boolean }): ProductDTO {
  const recipe: RecipeLineDTO[] = p.recipeLines.map((l) => {
    const needed = lineRequirement(l, 1, 1); // per recipe incl. wastage
    return {
      ingredientId: l.ingredientId,
      ingredientName: l.ingredient.name,
      dimension: l.ingredient.dimension,
      displayUnit: l.ingredient.displayUnit as UnitCode,
      quantity: l.quantity.toNumber(),
      wastagePct: l.wastagePct.toNumber(),
      costMinor: opts.showCost ? Number(toMinor(needed.mul(l.ingredient.avgCostMinor))) : 0,
    };
  });

  // ---- availability ----
  let available: number | null = null;
  let limitingIngredient: string | null = null;
  if (p.stockMode === 'BATCH' || p.stockMode === 'RESALE') {
    available = p.portionsOnHand;
  } else if (p.stockMode === 'MADE_TO_ORDER' && p.recipeLines.length) {
    for (const l of p.recipeLines) {
      const perPortion = lineRequirement(l, p.recipeYield, 1);
      if (perPortion.lte(0)) continue;
      const n = Math.floor(l.ingredient.onHand.div(perPortion).toNumber());
      if (available === null || n < available) {
        available = n;
        limitingIngredient = l.ingredient.name;
      }
    }
  }
  if (!p.isAvailable && available !== null) available = 0;
  const soldOut = available !== null && available <= 0 && p.isAvailable;

  // ---- cost per portion ----
  let costMinor: number | null = null;
  let costSource: ProductDTO['costSource'] = null;
  const recipeCost = p.recipeLines.length
    ? p.recipeLines.reduce((sum, l) => sum.plus(lineRequirement(l, p.recipeYield, 1).mul(l.ingredient.avgCostMinor)), D(0))
    : null;
  if ((p.stockMode === 'BATCH' || p.stockMode === 'RESALE') && p.portionsOnHand > 0 && p.portionCostMinor.gt(0)) {
    costMinor = Number(toMinor(p.portionCostMinor));
    costSource = p.stockMode === 'BATCH' ? 'BATCH_AVERAGE' : 'PURCHASE_AVERAGE';
  } else if ((p.stockMode === 'BATCH' || p.stockMode === 'MADE_TO_ORDER') && recipeCost && recipeCost.gt(0)) {
    costMinor = Number(toMinor(recipeCost));
    costSource = 'RECIPE';
  } else if (p.stockMode === 'RESALE' && p.portionCostMinor.gt(0)) {
    costMinor = Number(toMinor(p.portionCostMinor));
    costSource = 'PURCHASE_AVERAGE';
  } else if (p.manualCostMinor !== null) {
    costMinor = p.manualCostMinor;
    costSource = 'MANUAL';
  }

  const modifierGroups: ModifierGroupDTO[] = p.modifierGroups.map((g) => ({
    id: g.id,
    name: g.name,
    minSelect: g.minSelect,
    maxSelect: g.maxSelect,
    options: g.modifiers.map((m) => ({
      id: m.id,
      name: m.name,
      priceDeltaMinor: m.priceDeltaMinor,
      ingredientId: m.ingredientId,
      ingredientName: m.ingredient?.name ?? null,
      quantity: m.quantity?.toNumber() ?? null,
      displayUnit: (m.ingredient?.displayUnit as UnitCode | undefined) ?? null,
      isAvailable: m.isAvailable,
    })),
  }));

  return {
    id: p.id,
    categoryId: p.categoryId,
    categoryName: p.category.name,
    group: p.category.group,
    name: p.name,
    description: p.description,
    priceMinor: p.priceMinor,
    stationOverride: p.stationOverride,
    station: p.stationOverride ?? p.category.station,
    stockMode: p.stockMode,
    isAvailable: p.isAvailable,
    isActive: p.isActive,
    sortOrder: p.sortOrder,
    recipeYield: p.recipeYield,
    manualCostMinor: opts.showCost ? p.manualCostMinor : null,
    portionsOnHand: p.portionsOnHand,
    costMinor: opts.showCost ? costMinor : null,
    costSource: opts.showCost ? costSource : null,
    available,
    limitingIngredient,
    soldOut,
    hasImage: p.hasImage,
    imageVersion: p.image?.etag ?? null,
    recipe,
    modifierGroups,
    version: p.version,
  };
}

export async function listProducts(opts: { showCost: boolean; includeInactive?: boolean }) {
  const rows = await prisma.product.findMany({
    where: opts.includeInactive ? {} : { isActive: true },
    include: productInclude,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  const groupOrder = { FOOD: 0, DRINKS: 1, DESSERTS: 2 } as const;
  rows.sort(
    (a, b) =>
      groupOrder[a.category.group] - groupOrder[b.category.group] ||
      a.category.sortOrder - b.category.sortOrder ||
      a.category.name.localeCompare(b.category.name) ||
      a.sortOrder - b.sortOrder ||
      a.name.localeCompare(b.name),
  );
  return rows.map((r) => toProductDTO(r, opts));
}

export async function availabilityByCategory(): Promise<CategoryAvailabilityDTO[]> {
  const [categories, products] = await Promise.all([
    prisma.menuCategory.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    listProducts({ showCost: false }),
  ]);
  const groupOrder = { FOOD: 0, DRINKS: 1, DESSERTS: 2 } as const;
  categories.sort((a, b) => groupOrder[a.group] - groupOrder[b.group] || a.sortOrder - b.sortOrder);
  return categories.map((c) => {
    const items = products.filter((p) => p.categoryId === c.id);
    return {
      categoryId: c.id,
      name: c.name,
      group: c.group,
      station: c.station,
      itemsAvailable: items.filter((p) => p.isAvailable && (p.available === null || p.available > 0)).length,
      itemsSoldOut: items.filter((p) => p.soldOut).length,
      portionsReady: items
        .filter((p) => (p.stockMode === 'BATCH' || p.stockMode === 'RESALE') && p.isAvailable)
        .reduce((s, p) => s + (p.available ?? 0), 0),
      products: items.map((p) => ({
        id: p.id,
        name: p.name,
        priceMinor: p.priceMinor,
        stockMode: p.stockMode,
        available: p.available,
        soldOut: p.soldOut,
        isAvailable: p.isAvailable,
        limitingIngredient: p.limitingIngredient,
      })),
    };
  });
}
