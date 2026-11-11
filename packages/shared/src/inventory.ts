import { z } from 'zod';
import { DIMENSIONS, UNIT_CODES, type Dimension, type UnitCode } from './units.js';
import type { MenuGroup, PrepStation } from './schemas.js';
import { PREP_STATIONS } from './schemas.js';

export const STOCK_MODES = ['BATCH', 'MADE_TO_ORDER', 'RESALE', 'UNTRACKED'] as const;
export type StockMode = (typeof STOCK_MODES)[number];
export const STOCK_MODE_LABELS: Record<StockMode, string> = {
  BATCH: 'Batch cooked (sold as prepared portions)',
  MADE_TO_ORDER: 'Made to order (ingredients used at sale)',
  RESALE: 'Bought ready to sell (counted units)',
  UNTRACKED: 'Not stock-controlled',
};
export const STOCK_MODE_SHORT: Record<StockMode, string> = {
  BATCH: 'Batch',
  MADE_TO_ORDER: 'Made to order',
  RESALE: 'Ready-made',
  UNTRACKED: 'Untracked',
};

export const INGREDIENT_ADJUST_TYPES = ['WASTE', 'SPOILAGE', 'ADJUSTMENT', 'COUNT'] as const;
export type IngredientAdjustType = (typeof INGREDIENT_ADJUST_TYPES)[number];
export const ADJUST_LABELS: Record<IngredientAdjustType, string> = {
  WASTE: 'Waste (dropped, burnt, mistakes)',
  SPOILAGE: 'Spoilage (expired, gone bad)',
  ADJUSTMENT: 'Correction (+ or −, with reason)',
  COUNT: 'Stock count (enter what is physically there)',
};

const name = (max: number) => z.string().trim().min(1).max(max);
const requestId = z.string().trim().min(8).max(64);
const qty = z.number().finite().min(0).max(1e9);
const money = z.number().int().min(0).max(1_000_000_000);

// ---------- suppliers ----------
export const supplierCreateSchema = z.object({
  name: name(100),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(500).optional(),
  isActive: z.boolean().optional(),
});
export const supplierUpdateSchema = supplierCreateSchema.partial().extend({ version: z.number().int().nonnegative() });

// ---------- ingredients ----------
export const ingredientCreateSchema = z.object({
  name: name(100),
  dimension: z.enum(DIMENSIONS),
  displayUnit: z.enum(UNIT_CODES as [UnitCode, ...UnitCode[]]),
  minLevel: qty.optional(), // in displayUnit
  supplierId: z.string().uuid().nullable().optional(),
  isPackaging: z.boolean().optional(),
  notes: z.string().trim().max(500).optional(),
});
export const ingredientUpdateSchema = z.object({
  name: name(100).optional(),
  displayUnit: z.enum(UNIT_CODES as [UnitCode, ...UnitCode[]]).optional(),
  minLevel: qty.optional(), // in displayUnit (new one if changed)
  supplierId: z.string().uuid().nullable().optional(),
  isPackaging: z.boolean().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().trim().max(500).optional(),
  version: z.number().int().nonnegative(),
});

export const receiveStockSchema = z.object({
  quantity: z.number().finite().positive().max(1e9),
  unit: z.enum(UNIT_CODES as [UnitCode, ...UnitCode[]]),
  totalCostMinor: money,
  supplierId: z.string().uuid().nullable().optional(),
  reference: z.string().trim().max(100).optional(),
  requestId,
});

export const adjustStockSchema = z
  .object({
    type: z.enum(INGREDIENT_ADJUST_TYPES),
    /** WASTE/SPOILAGE: amount lost (positive). ADJUSTMENT: signed change. COUNT: counted total. */
    quantity: z.number().finite().min(-1e9).max(1e9),
    unit: z.enum(UNIT_CODES as [UnitCode, ...UnitCode[]]),
    reason: z.string().trim().max(300).optional(),
    requestId,
  })
  .superRefine((v, ctx) => {
    if ((v.type === 'WASTE' || v.type === 'SPOILAGE') && v.quantity <= 0)
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Enter the amount lost (more than 0)' });
    if (v.type === 'COUNT' && v.quantity < 0)
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'A count cannot be negative' });
    if (v.type === 'ADJUSTMENT' && v.quantity === 0)
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Enter a positive or negative change' });
    if (v.type === 'ADJUSTMENT' && !v.reason)
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'A reason is required for corrections' });
  });

// ---------- products ----------
export const productCreateSchema = z.object({
  categoryId: z.string().uuid(),
  name: name(100),
  description: z.string().trim().max(300).optional(),
  priceMinor: money,
  stationOverride: z.enum(PREP_STATIONS).nullable().optional(),
  stockMode: z.enum(STOCK_MODES),
  isAvailable: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
  manualCostMinor: money.nullable().optional(),
});
export const productUpdateSchema = productCreateSchema.partial().extend({ version: z.number().int().nonnegative() });

export const recipeSchema = z.object({
  recipeYield: z.number().int().min(1).max(10_000),
  lines: z
    .array(
      z.object({
        ingredientId: z.string().uuid(),
        quantity: z.number().finite().positive().max(1e9), // in `unit`
        unit: z.enum(UNIT_CODES as [UnitCode, ...UnitCode[]]),
        wastagePct: z.number().min(0).max(99.99).optional(),
      }),
    )
    .max(60),
  version: z.number().int().nonnegative(),
});

export const modifiersSchema = z.object({
  groups: z
    .array(
      z
        .object({
          name: name(60),
          minSelect: z.number().int().min(0).max(20),
          maxSelect: z.number().int().min(1).max(20),
          options: z
            .array(
              z
                .object({
                  name: name(60),
                  priceDeltaMinor: z.number().int().min(-100_000_000).max(100_000_000),
                  ingredientId: z.string().uuid().nullable().optional(),
                  quantity: z.number().finite().positive().max(1e9).nullable().optional(),
                  unit: z.enum(UNIT_CODES as [UnitCode, ...UnitCode[]]).nullable().optional(),
                  isAvailable: z.boolean().optional(),
                })
                .refine((o) => !o.ingredientId || (o.quantity && o.unit), {
                  message: 'Give a quantity and unit for the ingredient',
                  path: ['quantity'],
                }),
            )
            .min(1)
            .max(30),
        })
        .refine((g) => g.minSelect <= g.maxSelect, { message: 'Minimum cannot exceed maximum', path: ['minSelect'] }),
    )
    .max(15),
  version: z.number().int().nonnegative(),
});

export const productImageSchema = z.object({
  /** data:image/jpeg;base64,… or data:image/webp;base64,… (client resizes before upload) */
  dataUrl: z.string().max(1_500_000).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, 'Unsupported image'),
});

export const finishedAdjustSchema = z
  .object({
    type: z.enum(INGREDIENT_ADJUST_TYPES),
    quantity: z.number().int().min(-100_000).max(100_000),
    reason: z.string().trim().max(300).optional(),
    requestId,
  })
  .superRefine((v, ctx) => {
    if ((v.type === 'WASTE' || v.type === 'SPOILAGE') && v.quantity <= 0)
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Enter the portions lost (more than 0)' });
    if (v.type === 'COUNT' && v.quantity < 0)
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'A count cannot be negative' });
    if (v.type === 'ADJUSTMENT' && (v.quantity === 0 || !v.reason))
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Corrections need a non-zero change and a reason' });
  });

export const finishedReceiveSchema = z.object({
  quantity: z.number().int().positive().max(100_000),
  totalCostMinor: money,
  supplierId: z.string().uuid().nullable().optional(),
  reference: z.string().trim().max(100).optional(),
  requestId,
});

export const productionSchema = z.object({
  productId: z.string().uuid(),
  portions: z.number().int().positive().max(10_000),
  /** Optional: actual amounts used when they differ from the recipe (base units). */
  overrides: z
    .array(z.object({ ingredientId: z.string().uuid(), quantity: z.number().finite().min(0).max(1e9), unit: z.enum(UNIT_CODES as [UnitCode, ...UnitCode[]]) }))
    .max(60)
    .optional(),
  notes: z.string().trim().max(300).optional(),
  requestId,
});

// ---------- DTOs ----------
export interface SupplierDTO {
  id: string;
  name: string;
  phone: string;
  address: string;
  notes: string;
  isActive: boolean;
  version: number;
}

export interface IngredientDTO {
  id: string;
  name: string;
  dimension: Dimension;
  displayUnit: UnitCode;
  /** base units */
  onHand: number;
  minLevel: number;
  /** paisa per base unit */
  avgCostMinor: number;
  /** paisa, whole */
  stockValueMinor: number;
  isLow: boolean;
  supplier: { id: string; name: string } | null;
  isPackaging: boolean;
  isActive: boolean;
  notes: string;
  usedInProducts: number;
  version: number;
}

export interface StockMovementDTO {
  id: string;
  kind: 'INGREDIENT' | 'FINISHED';
  itemId: string;
  itemName: string;
  type: string;
  /** base units (ingredient) or portions (finished) */
  qtyDelta: number;
  balanceAfter: number;
  unit: UnitCode | 'portion';
  dimension: Dimension | null;
  unitCostMinor: number;
  valueMinor: number;
  reason: string | null;
  refType: string | null;
  refId: string | null;
  actor: string | null;
  occurredAt: string;
}

export interface RecipeLineDTO {
  ingredientId: string;
  ingredientName: string;
  dimension: Dimension;
  displayUnit: UnitCode;
  quantity: number; // base units per recipe
  wastagePct: number;
  /** paisa, at current average cost, incl. wastage */
  costMinor: number;
}

export interface ModifierGroupDTO {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: {
    id: string;
    name: string;
    priceDeltaMinor: number;
    ingredientId: string | null;
    ingredientName: string | null;
    quantity: number | null;
    displayUnit: UnitCode | null;
    isAvailable: boolean;
  }[];
}

export interface ProductDTO {
  id: string;
  categoryId: string;
  categoryName: string;
  group: MenuGroup;
  name: string;
  description: string;
  priceMinor: number;
  stationOverride: PrepStation | null;
  station: PrepStation;
  stockMode: StockMode;
  isAvailable: boolean;
  isActive: boolean;
  sortOrder: number;
  recipeYield: number;
  manualCostMinor: number | null;
  portionsOnHand: number;
  /** Estimated cost per portion in paisa (null if unknown). */
  costMinor: number | null;
  costSource: 'BATCH_AVERAGE' | 'RECIPE' | 'PURCHASE_AVERAGE' | 'MANUAL' | null;
  /** How many more can be sold now; null = not stock-limited. */
  available: number | null;
  /** Why availability is limited (ingredient name for made-to-order). */
  limitingIngredient: string | null;
  soldOut: boolean;
  hasImage: boolean;
  imageVersion: string | null;
  recipe: RecipeLineDTO[];
  modifierGroups: ModifierGroupDTO[];
  version: number;
}

export interface CategoryAvailabilityDTO {
  categoryId: string;
  name: string;
  group: MenuGroup;
  station: PrepStation;
  itemsAvailable: number;
  itemsSoldOut: number;
  /** Sum of portions for batch/ready-made items (made-to-order items share ingredients, so they are listed per item). */
  portionsReady: number;
  products: Pick<ProductDTO, 'id' | 'name' | 'priceMinor' | 'stockMode' | 'available' | 'soldOut' | 'isAvailable' | 'limitingIngredient'>[];
}

export interface ProductionRequirementDTO {
  ingredientId: string;
  ingredientName: string;
  displayUnit: UnitCode;
  required: number; // base units
  onHand: number;
  shortBy: number;
  costMinor: number;
}

export interface ProductionPreviewDTO {
  productId: string;
  portions: number;
  requirements: ProductionRequirementDTO[];
  totalCostMinor: number;
  unitCostMinor: number;
  canProduce: boolean;
  maxPortions: number;
}

export interface ProductionBatchDTO {
  id: string;
  batchNo: number;
  productId: string;
  productName: string;
  portions: number;
  totalCostMinor: number;
  unitCostMinor: number;
  notes: string;
  preparedBy: string | null;
  preparedAt: string;
  consumption: { ingredientId: string; ingredientName: string; quantity: number; displayUnit: UnitCode; valueMinor: number }[];
}

export interface StockSummaryDTO {
  ingredientValueMinor: number;
  finishedValueMinor: number;
  totalValueMinor: number;
  lowStock: { id: string; name: string; onHand: number; minLevel: number; displayUnit: UnitCode }[];
  soldOut: { id: string; name: string; categoryName: string }[];
}
