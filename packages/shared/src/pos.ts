import { z } from 'zod';
import type { PrepStation } from './schemas.js';

export const SERVICE_TYPES = ['DINE_IN', 'TAKEAWAY'] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];
export const SERVICE_LABELS: Record<ServiceType, string> = { DINE_IN: 'Dine-in', TAKEAWAY: 'Takeaway' };

export type OrderStatus = 'HELD' | 'OPEN' | 'COMPLETED' | 'CANCELLED';
export type PaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED';
export type PrepStatus = 'PENDING' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED';
export const PREP_FLOW: PrepStatus[] = ['PENDING', 'PREPARING', 'READY', 'SERVED'];
export const PAYMENT_KINDS = ['CASH', 'CARD', 'MOBILE', 'OTHER'] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];
export const PRINTER_ROLES = ['RECEIPT', 'BARISTA', 'KITCHEN'] as const;
export type PrinterRole = (typeof PRINTER_ROLES)[number];
export const PRINTER_ROLE_LABELS: Record<PrinterRole, string> = {
  RECEIPT: 'Printer 1 — Customer receipt',
  BARISTA: 'Printer 2 — Barista (drinks)',
  KITCHEN: 'Printer 3 — Kitchen (food)',
};

const rid = z.string().trim().min(8).max(64);
const money = z.number().int().min(0).max(1_000_000_000);

// ─────────── pricing (shared by POS and server so both always agree) ───────────
export interface TaxRateInput { id: string; name: string; rateBp: number; inclusive: boolean }
export interface PricedTotals {
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  taxes: { id: string; name: string; rateBp: number; inclusive: boolean; amountMinor: number }[];
}

/**
 * Totals for an order. Prices are in paisa. Discount applies before tax.
 * Inclusive taxes are extracted from the (discounted) amount; exclusive taxes are added.
 * All rounding is to whole paisa, half up, per tax.
 */
export function priceOrder(lineTotals: number[], discountMinor: number, taxRates: TaxRateInput[]): PricedTotals {
  const subtotal = lineTotals.reduce((a, b) => a + b, 0);
  const discount = Math.min(Math.max(0, Math.round(discountMinor)), subtotal);
  const base = subtotal - discount;
  const inclusive = taxRates.filter((t) => t.inclusive);
  const exclusive = taxRates.filter((t) => !t.inclusive);
  const inclusiveRateSum = inclusive.reduce((s, t) => s + t.rateBp, 0);
  // Net (pre-tax) value of the inclusive part
  const net = inclusiveRateSum > 0 ? base / (1 + inclusiveRateSum / 10_000) : base;
  const taxes = [
    ...inclusive.map((t) => ({ ...t, amountMinor: Math.round((net * t.rateBp) / 10_000) })),
    ...exclusive.map((t) => ({ ...t, amountMinor: Math.round((net * t.rateBp) / 10_000) })),
  ];
  const added = taxes.filter((t) => !t.inclusive).reduce((s, t) => s + t.amountMinor, 0);
  return {
    subtotalMinor: subtotal,
    discountMinor: discount,
    taxMinor: taxes.reduce((s, t) => s + t.amountMinor, 0),
    totalMinor: base + added,
    taxes: taxes.map(({ id, name, rateBp, inclusive: inc, amountMinor }) => ({ id, name, rateBp, inclusive: inc, amountMinor })),
  };
}

export function discountFrom(input: { type: 'PERCENT' | 'AMOUNT'; value: number } | null | undefined, subtotalMinor: number): number {
  if (!input) return 0;
  if (input.type === 'PERCENT') return Math.round((subtotalMinor * Math.min(100, Math.max(0, input.value))) / 100);
  return Math.min(subtotalMinor, Math.max(0, Math.round(input.value)));
}

// ─────────── schemas ───────────
export const orderLineInputSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(500),
  modifierIds: z.array(z.string().uuid()).max(30).default([]),
  notes: z.string().trim().max(200).optional(),
});

export const discountSchema = z.object({
  type: z.enum(['PERCENT', 'AMOUNT']),
  value: z.number().min(0).max(1_000_000_000),
  reason: z.string().trim().min(1, 'Give a reason for the discount').max(120),
});

export const orderCreateSchema = z
  .object({
    clientRequestId: rid,
    serviceType: z.enum(SERVICE_TYPES),
    tableNo: z.string().trim().max(10).optional().nullable(),
    customerName: z.string().trim().max(60).optional(),
    /** A saved regular customer; the server stores their name on the order. */
    customerId: z.string().uuid().optional().nullable(),
    notes: z.string().trim().max(300).optional(),
    lines: z.array(orderLineInputSchema).min(1, 'Add at least one item').max(100),
    discount: discountSchema.nullable().optional(),
    /** Park the order without sending it to the kitchen or using stock. */
    hold: z.boolean().optional(),
    /** Replace a held order (resumed into the cart). */
    replacesHeldOrderId: z.string().uuid().optional(),
    /** Offline-queued orders: when the cashier pressed the button. */
    offlinePlacedAt: z.string().datetime().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.serviceType === 'DINE_IN' && !v.tableNo) ctx.addIssue({ code: 'custom', path: ['tableNo'], message: 'Choose a table for dine-in' });
  });
export type OrderCreateInput = z.infer<typeof orderCreateSchema>;

export const paymentSchema = z.object({
  methodId: z.string().uuid(),
  amountMinor: z.number().int().positive().max(1_000_000_000),
  tenderedMinor: money.optional().nullable(),
  reference: z.string().trim().max(60).optional().nullable(),
  idempotencyKey: rid,
});

export const refundSchema = z.object({
  methodId: z.string().uuid(),
  amountMinor: z.number().int().positive().max(1_000_000_000),
  reason: z.string().trim().min(1, 'A reason is required').max(200),
  idempotencyKey: rid,
});

export const cancelOrderSchema = z.object({
  reason: z.string().trim().min(1, 'A reason is required').max(200),
});

export const prepStatusSchema = z.object({ status: z.enum(['PENDING', 'PREPARING', 'READY', 'SERVED']) });

export const taxRateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  ratePercent: z.number().min(0).max(100),
  inclusive: z.boolean(),
  isActive: z.boolean().optional(),
});
export const taxRateUpdateSchema = taxRateSchema.partial().extend({ version: z.number().int().nonnegative() });

export const paymentMethodSchema = z.object({
  name: z.string().trim().min(1).max(40),
  kind: z.enum(PAYMENT_KINDS),
  requiresReference: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});
export const paymentMethodUpdateSchema = paymentMethodSchema.partial().extend({ version: z.number().int().nonnegative() });

export const cashOpenSchema = z.object({ openingFloatMinor: money });
export const cashCloseSchema = z.object({ countedCashMinor: money, notes: z.string().trim().max(300).optional() });

export const printerSchema = z.object({
  name: z.string().trim().min(1).max(60),
  host: z.string().trim().max(100).regex(/^[A-Za-z0-9.\-:]*$/, 'Use an IP address or host name'),
  port: z.number().int().min(1).max(65535),
  paperWidthMm: z.union([z.literal(58), z.literal(80)]),
  isActive: z.boolean(),
  cutPaper: z.boolean(),
  openDrawer: z.boolean(),
  version: z.number().int().nonnegative(),
});
export const reprintSchema = z.object({
  role: z.enum(PRINTER_ROLES),
  reason: z.string().trim().min(1, 'A reason is required').max(200),
});

export const expenseCreateSchema = z.object({
  categoryId: z.string().uuid(),
  amountMinor: z.number().int().positive().max(1_000_000_000),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paidWith: z.string().trim().max(40).optional(),
  note: z.string().trim().max(300).optional(),
  requestId: rid,
});
export const expenseVoidSchema = z.object({ reason: z.string().trim().min(1, 'A reason is required').max(200) });
export const expenseCategorySchema = z.object({ name: z.string().trim().min(1).max(60), isActive: z.boolean().optional() });

export const syncOrdersSchema = z.object({ orders: z.array(z.any()).min(1).max(200) });

// ─────────── DTOs ───────────
export interface OrderLineDTO {
  id: string;
  productId: string;
  name: string;
  categoryName: string;
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
  modifiers: { id: string; name: string; priceDeltaMinor: number }[];
  notes: string;
  station: PrepStation;
  prepStatus: PrepStatus;
  stockState: 'NOT_TRACKED' | 'CONSUMED' | 'RESTORED' | 'WASTED' | 'CONFLICT';
}

export interface PaymentDTO {
  id: string;
  methodId: string;
  methodName: string;
  kind: PaymentKind;
  amountMinor: number;
  tenderedMinor: number | null;
  changeMinor: number;
  reference: string | null;
  receivedBy: string | null;
  createdAt: string;
}

export interface RefundDTO {
  id: string;
  methodName: string;
  amountMinor: number;
  reason: string;
  approvedBy: string | null;
  createdAt: string;
}

export interface OrderDTO {
  id: string;
  orderNo: number;
  businessDate: string;
  serviceType: ServiceType;
  tableNo: string | null;
  customerName: string;
  customerId: string | null;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  subtotalMinor: number;
  discountMinor: number;
  discountReason: string | null;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  refundedMinor: number;
  dueMinor: number;
  taxes: PricedTotals['taxes'];
  notes: string;
  placedOffline: boolean;
  needsReview: boolean;
  reviewNote: string | null;
  createdBy: string | null;
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  lines: OrderLineDTO[];
  payments: PaymentDTO[];
  refunds: RefundDTO[];
  version: number;
}

export interface TaxRateDTO { id: string; name: string; rateBp: number; inclusive: boolean; isActive: boolean; version: number }
export interface PaymentMethodDTO { id: string; name: string; kind: PaymentKind; requiresReference: boolean; isActive: boolean; sortOrder: number; version: number }

export interface CashSessionDTO {
  id: string;
  openedBy: string | null;
  openedAt: string;
  openingFloatMinor: number;
  cashSalesMinor: number;
  cashRefundsMinor: number;
  expectedCashMinor: number;
  closedBy: string | null;
  closedAt: string | null;
  countedCashMinor: number | null;
  varianceMinor: number | null;
  notes: string;
}

export interface StationTicketDTO {
  orderId: string;
  orderNo: number;
  serviceType: ServiceType;
  tableNo: string | null;
  customerName: string;
  notes: string;
  createdAt: string;
  lines: Pick<OrderLineDTO, 'id' | 'name' | 'quantity' | 'modifiers' | 'notes' | 'prepStatus'>[];
}

export interface PrinterDTO {
  id: string;
  name: string;
  role: PrinterRole;
  host: string;
  port: number;
  paperWidthMm: 58 | 80;
  isActive: boolean;
  cutPaper: boolean;
  openDrawer: boolean;
  status: string;
  lastSeenAt: string | null;
  lastError: string | null;
  pendingJobs: number;
  failedJobs: number;
  version: number;
}

export interface PrintJobDTO {
  id: string;
  role: PrinterRole;
  kind: 'RECEIPT' | 'TICKET' | 'TEST';
  orderNo: number | null;
  status: 'PENDING' | 'PRINTING' | 'PRINTED' | 'FAILED' | 'CANCELLED';
  attempts: number;
  lastError: string | null;
  reprintNo: number;
  reprintReason: string | null;
  createdAt: string;
  printedAt: string | null;
}

export interface ExpenseCategoryDTO { id: string; name: string; isActive: boolean }
export interface ExpenseDTO {
  id: string;
  categoryId: string;
  categoryName: string;
  amountMinor: number;
  businessDate: string;
  paidWith: string;
  note: string;
  createdBy: string | null;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface ReportDTO {
  from: string;
  to: string;
  orders: number;
  itemsSold: number;
  grossSalesMinor: number; // before discounts, as charged incl. inclusive tax
  discountsMinor: number;
  taxMinor: number;
  refundsMinor: number;
  netSalesMinor: number; // revenue excl. tax, after discounts and refunds
  cogsMinor: number;
  grossProfitMinor: number;
  inventoryLossesMinor: number;
  expensesMinor: number;
  netProfitMinor: number;
  inventoryPurchasesMinor: number;
  averageOrderMinor: number;
  cancelledOrders: number;
  paymentMethods: { name: string; kind: PaymentKind; receivedMinor: number; refundedMinor: number; netMinor: number }[];
  categories: { name: string; quantity: number; revenueMinor: number }[];
  topItems: { name: string; quantity: number; revenueMinor: number }[];
  expensesByCategory: { name: string; amountMinor: number }[];
  series: { period: string; salesMinor: number; orders: number; expensesMinor: number; cogsMinor: number }[];
}
