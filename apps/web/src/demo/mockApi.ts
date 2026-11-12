/**
 * ONLINE DEMO ONLY — an in-browser stand-in for the Bite & Brew server.
 *
 * Used only by the `demo` build (vite.demo.config.ts), published as a web page so the owner
 * can try the app on any device without installing anything. It mirrors the real API's
 * rules (validation schemas, permissions, stock maths) on sample data kept in this browser's
 * localStorage. It is NOT the real system: the café runs the Node.js + PostgreSQL server.
 */
import {
  businessDate, canManageRole, categoryCreateSchema, categoryUpdateSchema, changePasswordSchema, createUserSchema,
  finishedAdjustSchema, finishedReceiveSchema, hasPermission, ingredientCreateSchema, ingredientUpdateSchema, isUnitOf,
  loginSchema, modifiersSchema, permissionsFor, productCreateSchema, productionSchema, productUpdateSchema, receiveStockSchema,
  adjustStockSchema, recipeSchema, orderCreateSchema, paymentSchema, refundSchema, cancelOrderSchema, reprintSchema, taxRateSchema, taxRateUpdateSchema,
  paymentMethodSchema, paymentMethodUpdateSchema, cashOpenSchema, cashCloseSchema, printerSchema, expenseCreateSchema, expenseVoidSchema, expenseCategorySchema,
  priceOrder, discountFrom, receiptPayload, ticketPayload, testPayload, renderText, PREP_FLOW, round3, settingsUpdateSchema, supplierCreateSchema, supplierUpdateSchema, toBase, updateUserSchema,
  utcOffset, MENU_GROUPS,
  type BusinessSettingsDTO, type CategoryAvailabilityDTO, type Dimension, type IngredientDTO, type MenuCategoryDTO, type Permission,
  type ProductDTO, type ProductionBatchDTO, type Role, type SessionUser, type StockMode, type StockMovementDTO, type StockSummaryDTO,
  type SupplierDTO, type UnitCode, type UserDTO, type PrepStation,
  type TaxRateDTO, type PaymentMethodDTO, type PaymentKind, type OrderDTO, type CashSessionDTO, type PrinterDTO, type PrintJobDTO, type PrintPayload,
  type ExpenseCategoryDTO, type ExpenseDTO, type CustomerDTO, type CustomerDetailDTO, customerCreateSchema, customerUpdateSchema, normalizePhone, type ReportDTO, type StationTicketDTO, type PrepStatus, type PrinterRole,
} from '@bitebrew/shared';
import type { z } from 'zod';
import fixture from './fixture.json';
import { requestId } from '../lib/ids';

export const DEMO_PASSWORD = 'demo-pass-2027';
const KEY = 'bitebrew-online-demo-v4';

// ─────────── state ───────────
interface Ing { id: string; name: string; dimension: Dimension; displayUnit: UnitCode; onHand: number; avgCost: number; minLevel: number; supplierId: string | null; isPackaging: boolean; isActive: boolean; notes: string; version: number }
interface Line { ingredientId: string; quantity: number; wastagePct: number }
interface Opt { id: string; name: string; priceDeltaMinor: number; ingredientId: string | null; quantity: number | null; isAvailable: boolean }
interface Group { id: string; name: string; minSelect: number; maxSelect: number; options: Opt[] }
interface Prod { id: string; categoryId: string; name: string; description: string; priceMinor: number; stationOverride: PrepStation | null; stockMode: StockMode; isAvailable: boolean; isActive: boolean; sortOrder: number; recipeYield: number; manualCostMinor: number | null; portionsOnHand: number; portionCost: number; version: number; recipe: Line[]; groups: Group[] }
type Move = StockMovementDTO & { seq: number };
interface Audit { id: number; occurredAt: string; actorId: string | null; action: string; entityType: string; entityId: string | null; before: unknown; after: unknown }
type User = UserDTO & { password: string };
interface State {
  settings: BusinessSettingsDTO; users: User[]; categories: MenuCategoryDTO[]; suppliers: SupplierDTO[];
  ingredients: Ing[]; products: Prod[]; movements: Move[]; batches: ProductionBatchDTO[]; audit: Audit[];
  sessionUserId: string | null; seq: number; requestIds: Record<string, true>;
  taxRates: TaxRateDTO[]; paymentMethods: PaymentMethodDTO[]; orders: OrderDTO[]; cash: (CashSessionDTO & { closed: boolean })[];
  printers: PrinterDTO[]; jobs: (PrintJobDTO & { payload: PrintPayload; orderId: string | null; key: string })[];
  expenseCategories: ExpenseCategoryDTO[]; expenses: ExpenseDTO[]; customers: CustomerDTO[];
}

function seed(): State {
  const f = fixture as unknown as {
    settings: BusinessSettingsDTO; categories: MenuCategoryDTO[]; users: UserDTO[]; suppliers: SupplierDTO[];
    ingredients: IngredientDTO[]; products: ProductDTO[]; movements: StockMovementDTO[]; batches: ProductionBatchDTO[];
  };
  const movements = [...f.movements].reverse().map((m, i) => ({ ...m, seq: i + 1 }));
  return {
    settings: f.settings,
    users: f.users.map((u) => ({ ...u, lastLoginAt: null, password: DEMO_PASSWORD })),
    categories: f.categories,
    suppliers: f.suppliers,
    ingredients: f.ingredients.map((i) => ({ id: i.id, name: i.name, dimension: i.dimension, displayUnit: i.displayUnit, onHand: i.onHand, avgCost: i.avgCostMinor, minLevel: i.minLevel, supplierId: i.supplier?.id ?? null, isPackaging: i.isPackaging, isActive: i.isActive, notes: i.notes, version: i.version })),
    products: f.products.map((p) => ({
      id: p.id, categoryId: p.categoryId, name: p.name, description: p.description, priceMinor: p.priceMinor, stationOverride: p.stationOverride,
      stockMode: p.stockMode, isAvailable: p.isAvailable, isActive: p.isActive, sortOrder: p.sortOrder, recipeYield: p.recipeYield,
      manualCostMinor: p.manualCostMinor, portionsOnHand: p.portionsOnHand,
      portionCost: p.costSource === 'BATCH_AVERAGE' || p.costSource === 'PURCHASE_AVERAGE' ? p.costMinor ?? 0 : 0, version: p.version,
      recipe: p.recipe.map((l) => ({ ingredientId: l.ingredientId, quantity: l.quantity, wastagePct: l.wastagePct })),
      groups: p.modifierGroups.map((g) => ({ id: g.id, name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect, options: g.options.map((o) => ({ id: o.id, name: o.name, priceDeltaMinor: o.priceDeltaMinor, ingredientId: o.ingredientId, quantity: o.quantity, isAvailable: o.isAvailable })) })),
    })),
    movements,
    batches: f.batches,
    audit: [],
    sessionUserId: null,
    seq: movements.length + 1,
    requestIds: {},
    taxRates: [],
    paymentMethods: [
      ['Cash', 'CASH', false], ['Card', 'CARD', false], ['bKash', 'MOBILE', true], ['Nagad', 'MOBILE', true],
    ].map(([name, kind, ref], i) => ({ id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`, name: name as string, kind: kind as PaymentKind, requiresReference: ref as boolean, isActive: true, sortOrder: i * 10, version: 0 })),
    orders: [],
    cash: [],
    printers: (['RECEIPT', 'BARISTA', 'KITCHEN'] as const).map((role) => ({
      id: `printer-${role}`, name: role === 'RECEIPT' ? 'Receipt printer' : role === 'BARISTA' ? 'Barista printer' : 'Kitchen printer', role, host: '', port: 9100,
      paperWidthMm: 80 as const, isActive: true, cutPaper: true, openDrawer: role === 'RECEIPT', status: 'NOT_CONFIGURED', lastSeenAt: null, lastError: null, pendingJobs: 0, failedJobs: 0, version: 0,
    })),
    jobs: [],
    expenseCategories: ['Rent', 'Electricity', 'Water', 'Internet', 'Salaries', 'Repairs', 'Transportation', 'Cleaning', 'Marketing', 'Other expenses'].map((name, i) => ({ id: `00000000-0000-4000-8000-0000000002${String(i).padStart(2, '0')}`, name, isActive: true })),
    expenses: [],
    customers: [
      { name: 'Rahim Uddin', phone: '01712-345678', notes: 'Likes extra spicy' },
      { name: 'Nasrin Akter', phone: '01912-999888', notes: '' },
    ].map((c, i) => ({ id: `00000000-0000-4000-8000-0000000003${String(i).padStart(2, '0')}`, ...c, isActive: true, visits: 0, spentMinor: 0, lastVisitAt: null, version: 0, createdAt: new Date().toISOString() })),
  };
}

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch { /* storage unavailable — start fresh */ }
  return seed();
}
let S = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* ignore — demo still works for this visit */ }
}
export function resetDemo() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  S = seed();
}

// ─────────── helpers ───────────
class ApiErr extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
const uid = () => requestId();
const now = () => new Date().toISOString();
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
const clean = (s: string) => s.trim().replace(/\s+/g, ' ');
const roundMinor = (v: number) => Math.round(v);

function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw new ApiErr(400, 'BAD_REQUEST', 'Please check the highlighted fields', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}
function me(): User {
  const u = S.users.find((x) => x.id === S.sessionUserId && x.isActive);
  if (!u) throw new ApiErr(401, 'UNAUTHORIZED', 'Please sign in');
  return u;
}
function need(p: Permission): User {
  const u = me();
  if (!hasPermission(u.role, p)) throw new ApiErr(403, 'FORBIDDEN', 'You do not have permission to do this');
  return u;
}
const showCost = (u: User) => hasPermission(u.role, 'reports.view');
function audit(action: string, entityType: string, entityId: string | null, before?: unknown, after?: unknown) {
  S.audit.push({ id: S.audit.length + 1, occurredAt: now(), actorId: S.sessionUserId, action, entityType, entityId, before: before ?? null, after: after ?? null });
}
function stale(current: unknown): never { throw new ApiErr(409, 'STALE_VERSION', 'This record was changed by someone else. Review the latest version and try again.', { current }); }
function conflict(msg: string): never { throw new ApiErr(409, 'CONFLICT', msg); }
function notFound(msg = 'Not found'): never { throw new ApiErr(404, 'NOT_FOUND', msg); }
function bad(msg: string, details?: unknown): never { throw new ApiErr(400, 'BAD_REQUEST', msg, details); }

const lineNeed = (l: Line, yieldN: number, portions: number) => round3((l.quantity * (1 + l.wastagePct / 100) * portions) / yieldN);
const ing = (id: string) => S.ingredients.find((i) => i.id === id) ?? notFound('Ingredient not found');
const prod = (id: string) => S.products.find((p) => p.id === id) ?? notFound('Product not found');
const cat = (id: string) => S.categories.find((c) => c.id === id);

function moveIng(i: Ing, type: string, delta: number, meta: { reason?: string | null; refType?: string; refId?: string; receiveValue?: number }) {
  delta = round3(delta);
  const balance = round3(i.onHand + delta);
  if (balance < 0) throw new ApiErr(409, 'INSUFFICIENT_STOCK', `Not enough ${i.name} in stock`, { shortages: [{ id: i.id, name: i.name, required: -delta, onHand: i.onHand, shortBy: -balance }] });
  let unitCost = i.avgCost;
  let value: number;
  if (type === 'RECEIVE') {
    value = meta.receiveValue ?? 0;
    unitCost = delta > 0 ? value / delta : 0;
    i.avgCost = balance > 0 ? (i.onHand * i.avgCost + value) / balance : i.avgCost;
  } else value = roundMinor(delta * unitCost);
  i.onHand = balance;
  S.movements.push({ id: uid(), seq: S.seq++, kind: 'INGREDIENT', itemId: i.id, itemName: i.name, type, qtyDelta: delta, balanceAfter: balance, unit: i.displayUnit, dimension: i.dimension, unitCostMinor: unitCost, valueMinor: value, reason: meta.reason ?? null, refType: meta.refType ?? null, refId: meta.refId ?? null, actor: me().fullName, occurredAt: now() });
  return value;
}
function moveFin(p: Prod, type: string, delta: number, meta: { reason?: string | null; refType?: string; refId?: string; incomingValue?: number }) {
  const balance = p.portionsOnHand + delta;
  if (balance < 0) throw new ApiErr(409, 'INSUFFICIENT_STOCK', `${p.name} is sold out`, { shortages: [{ id: p.id, name: p.name, required: -delta, onHand: p.portionsOnHand, shortBy: -balance }] });
  let unitCost = p.portionCost;
  let value: number;
  if (meta.incomingValue !== undefined && delta > 0) {
    value = meta.incomingValue;
    unitCost = value / delta;
    p.portionCost = (p.portionCost * p.portionsOnHand + value) / balance;
  } else value = roundMinor(delta * unitCost);
  p.portionsOnHand = balance;
  S.movements.push({ id: uid(), seq: S.seq++, kind: 'FINISHED', itemId: p.id, itemName: p.name, type, qtyDelta: delta, balanceAfter: balance, unit: 'portion', dimension: null, unitCostMinor: unitCost, valueMinor: value, reason: meta.reason ?? null, refType: meta.refType ?? null, refId: meta.refId ?? null, actor: me().fullName, occurredAt: now() });
}
function once(requestId: string, fn: () => void): boolean {
  if (S.requestIds[requestId]) return true;
  fn();
  S.requestIds[requestId] = true;
  return false;
}

// ─────────── DTO mapping (mirrors the server) ───────────
function ingDTO(i: Ing, cost: boolean): IngredientDTO {
  const sup = S.suppliers.find((s) => s.id === i.supplierId);
  return {
    id: i.id, name: i.name, dimension: i.dimension, displayUnit: i.displayUnit, onHand: i.onHand, minLevel: i.minLevel,
    avgCostMinor: cost ? i.avgCost : 0, stockValueMinor: cost ? roundMinor(i.onHand * i.avgCost) : 0,
    isLow: i.isActive && i.minLevel > 0 && i.onHand <= i.minLevel, supplier: sup ? { id: sup.id, name: sup.name } : null,
    isPackaging: i.isPackaging, isActive: i.isActive, notes: i.notes,
    usedInProducts: S.products.filter((p) => p.recipe.some((l) => l.ingredientId === i.id)).length, version: i.version,
  };
}
function prodDTO(p: Prod, cost: boolean): ProductDTO {
  const c = cat(p.categoryId)!;
  let available: number | null = null;
  let limiting: string | null = null;
  if (p.stockMode === 'BATCH' || p.stockMode === 'RESALE') available = p.portionsOnHand;
  else if (p.stockMode === 'MADE_TO_ORDER' && p.recipe.length) {
    for (const l of p.recipe) {
      const per = lineNeed(l, p.recipeYield, 1);
      if (per <= 0) continue;
      const i = S.ingredients.find((x) => x.id === l.ingredientId);
      const n = Math.floor((i?.onHand ?? 0) / per + 1e-9);
      if (available === null || n < available) { available = n; limiting = i?.name ?? null; }
    }
  }
  if (!p.isAvailable && available !== null) available = 0;
  const recipeCost = p.recipe.reduce((s, l) => s + lineNeed(l, p.recipeYield, 1) * (S.ingredients.find((x) => x.id === l.ingredientId)?.avgCost ?? 0), 0);
  let costMinor: number | null = null;
  let costSource: ProductDTO['costSource'] = null;
  if ((p.stockMode === 'BATCH' || p.stockMode === 'RESALE') && p.portionsOnHand > 0 && p.portionCost > 0) { costMinor = roundMinor(p.portionCost); costSource = p.stockMode === 'BATCH' ? 'BATCH_AVERAGE' : 'PURCHASE_AVERAGE'; }
  else if ((p.stockMode === 'BATCH' || p.stockMode === 'MADE_TO_ORDER') && recipeCost > 0) { costMinor = roundMinor(recipeCost); costSource = 'RECIPE'; }
  else if (p.stockMode === 'RESALE' && p.portionCost > 0) { costMinor = roundMinor(p.portionCost); costSource = 'PURCHASE_AVERAGE'; }
  else if (p.manualCostMinor !== null) { costMinor = p.manualCostMinor; costSource = 'MANUAL'; }
  return {
    id: p.id, categoryId: p.categoryId, categoryName: c.name, group: c.group, name: p.name, description: p.description, priceMinor: p.priceMinor,
    stationOverride: p.stationOverride, station: p.stationOverride ?? c.station, stockMode: p.stockMode, isAvailable: p.isAvailable, isActive: p.isActive,
    sortOrder: p.sortOrder, recipeYield: p.recipeYield, manualCostMinor: cost ? p.manualCostMinor : null, portionsOnHand: p.portionsOnHand,
    costMinor: cost ? costMinor : null, costSource: cost ? costSource : null, available, limitingIngredient: limiting,
    soldOut: available !== null && available <= 0 && p.isAvailable, hasImage: false, imageVersion: null,
    recipe: p.recipe.map((l) => {
      const i = S.ingredients.find((x) => x.id === l.ingredientId)!;
      return { ingredientId: l.ingredientId, ingredientName: i.name, dimension: i.dimension, displayUnit: i.displayUnit, quantity: l.quantity, wastagePct: l.wastagePct, costMinor: cost ? roundMinor(lineNeed(l, 1, 1) * i.avgCost) : 0 };
    }),
    modifierGroups: p.groups.map((g) => ({ ...g, options: g.options.map((o) => {
      const i = o.ingredientId ? S.ingredients.find((x) => x.id === o.ingredientId) : undefined;
      return { ...o, ingredientName: i?.name ?? null, displayUnit: i?.displayUnit ?? null };
    }) })),
    version: p.version,
  };
}
const groupOrder = (g: string) => MENU_GROUPS.indexOf(g as never);
function sortedProducts(includeInactive: boolean) {
  return S.products
    .filter((p) => includeInactive || p.isActive)
    .sort((a, b) => {
      const ca = cat(a.categoryId)!, cb = cat(b.categoryId)!;
      return groupOrder(ca.group) - groupOrder(cb.group) || ca.sortOrder - cb.sortOrder || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
    });
}
function stockSummary(cost: boolean): StockSummaryDTO {
  const iv = S.ingredients.filter((i) => i.isActive).reduce((s, i) => s + roundMinor(i.onHand * i.avgCost), 0);
  const fv = S.products.filter((p) => p.isActive).reduce((s, p) => s + roundMinor(p.portionCost * p.portionsOnHand), 0);
  return {
    ingredientValueMinor: cost ? iv : 0, finishedValueMinor: cost ? fv : 0, totalValueMinor: cost ? iv + fv : 0,
    lowStock: S.ingredients.filter((i) => i.isActive && i.minLevel > 0 && i.onHand <= i.minLevel).map((i) => ({ id: i.id, name: i.name, onHand: i.onHand, minLevel: i.minLevel, displayUnit: i.displayUnit })),
    soldOut: S.products.filter((p) => p.isActive && cat(p.categoryId)?.isActive).map((p) => prodDTO(p, false)).filter((p) => p.soldOut).map((p) => ({ id: p.id, name: p.name, categoryName: p.categoryName })),
  };
}
function sessionUser(u: User): SessionUser {
  return { id: u.id, username: u.username, fullName: u.fullName, role: u.role, permissions: permissionsFor(u.role) };
}
const publicUser = (u: User): UserDTO => { const { password: _p, ...rest } = u; return rest; };

// ─────────── routes ───────────
type Handler = (m: RegExpMatchArray, body: any, q: URLSearchParams) => unknown;
const routes: [string, RegExp, Handler][] = [];
const r = (method: string, pattern: string, h: Handler) => routes.push([method, new RegExp(`^${pattern.replace(/:id/g, '([^/]+)')}$`), h]);

r('GET', '/health', () => ({ status: 'ok', database: 'up', dbLatencyMs: 1, serverTime: now() }));
r('GET', '/info', () => ({ appEnv: 'demo', version: 'online-demo', serverTime: now() }));
r('GET', '/auth/me', () => { const u = S.users.find((x) => x.id === S.sessionUserId && x.isActive); return { user: u ? sessionUser(u) : null }; });
r('POST', '/auth/login', (_m, b) => {
  const { username, password } = parse(loginSchema, b);
  const u = S.users.find((x) => x.username === username);
  if (!u || u.password !== password) throw new ApiErr(401, 'INVALID_CREDENTIALS', 'Incorrect username or password');
  if (!u.isActive) throw new ApiErr(403, 'ACCOUNT_DISABLED', 'This account has been deactivated');
  S.sessionUserId = u.id; u.lastLoginAt = now(); audit('auth.login', 'User', u.id);
  return { user: sessionUser(u) };
});
r('POST', '/auth/logout', () => { if (S.sessionUserId) audit('auth.logout', 'User', S.sessionUserId); S.sessionUserId = null; return { ok: true }; });
r('POST', '/auth/change-password', (_m, b) => {
  const u = me(); const { currentPassword, newPassword } = parse(changePasswordSchema, b);
  if (u.password !== currentPassword) bad('Current password is incorrect');
  u.password = newPassword; u.version++; audit('auth.change_password', 'User', u.id); return { ok: true };
});

r('GET', '/settings', () => { need('settings.view'); return { settings: S.settings }; });
r('PATCH', '/settings', (_m, b) => {
  need('settings.manage'); const { version, ...ch } = parse(settingsUpdateSchema, b);
  if (version !== S.settings.version) stale(S.settings);
  const merged = { ...S.settings, ...ch };
  if (!merged.dineInEnabled && !merged.takeawayEnabled) bad('At least one service type (dine-in or takeaway) must stay enabled');
  const before = S.settings; S.settings = { ...merged, version: version + 1, updatedAt: now() } as BusinessSettingsDTO;
  audit('settings.update', 'BusinessSettings', '1', before, S.settings); return { settings: S.settings };
});

r('GET', '/categories', (_m, _b, q) => {
  need('menu.view');
  const rows = S.categories.filter((c) => q.get('includeInactive') === 'true' || c.isActive)
    .sort((a, b) => groupOrder(a.group) - groupOrder(b.group) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  return { categories: rows };
});
r('POST', '/categories', (_m, b) => {
  need('menu.manage'); const d = parse(categoryCreateSchema, b);
  const ex = S.categories.find((c) => norm(c.name) === norm(d.name)); if (ex) conflict(`A category named "${ex.name}" already exists`);
  const max = Math.max(-10, ...S.categories.filter((c) => c.group === d.group).map((c) => c.sortOrder));
  const c: MenuCategoryDTO = { id: uid(), name: clean(d.name), group: d.group, station: d.station, description: d.description || null, sortOrder: d.sortOrder ?? max + 10, isActive: d.isActive ?? true, version: 0, createdAt: now(), updatedAt: now() };
  S.categories.push(c); audit('category.create', 'MenuCategory', c.id, null, c); return [201, { category: c }];
});
r('PATCH', '/categories/:id', (m, b) => {
  need('menu.manage'); const { version, ...ch } = parse(categoryUpdateSchema, b);
  const c = S.categories.find((x) => x.id === m[1]) ?? notFound('Category not found');
  if (c.version !== version) stale(c);
  if (ch.name !== undefined) { const ex = S.categories.find((x) => norm(x.name) === norm(ch.name!) && x.id !== c.id); if (ex) conflict(`A category named "${ex.name}" already exists`); ch.name = clean(ch.name); }
  const before = { ...c }; Object.assign(c, ch, { description: ch.description !== undefined ? ch.description || null : c.description, version: c.version + 1, updatedAt: now() });
  audit('category.update', 'MenuCategory', c.id, before, c); return { category: c };
});
r('DELETE', '/categories/:id', (m, _b, q) => {
  need('menu.manage'); const c = S.categories.find((x) => x.id === m[1]) ?? notFound('Category not found');
  if (Number(q.get('version')) !== c.version) stale(c);
  const n = S.products.filter((p) => p.categoryId === c.id).length;
  if (n) conflict(`"${c.name}" still has ${n} menu item(s). Move or delete them first, or hide the category instead.`);
  S.categories = S.categories.filter((x) => x !== c); audit('category.delete', 'MenuCategory', c.id, c); return [204, null];
});

r('GET', '/users', () => { need('users.view'); return { users: S.users.map(publicUser) }; });
r('POST', '/users', (_m, b) => {
  const actor = need('users.manage'); const d = parse(createUserSchema, b);
  if (!canManageRole(actor.role, d.role)) throw new ApiErr(403, 'FORBIDDEN', 'You cannot create an account with this role');
  if (S.users.some((u) => u.username === d.username)) conflict('That username is already taken');
  const u: User = { id: uid(), username: d.username, fullName: d.fullName, role: d.role, isActive: true, lastLoginAt: null, version: 0, createdAt: now(), password: d.password };
  S.users.push(u); audit('user.create', 'User', u.id, null, publicUser(u)); return [201, { user: publicUser(u) }];
});
r('PATCH', '/users/:id', (m, b) => {
  const actor = need('users.manage'); const { version, password, ...ch } = parse(updateUserSchema, b);
  const u = S.users.find((x) => x.id === m[1]) ?? notFound('User not found');
  const self = u.id === actor.id;
  if (!self && !canManageRole(actor.role, u.role)) throw new ApiErr(403, 'FORBIDDEN', 'You cannot manage this account');
  if (ch.role && !canManageRole(actor.role, ch.role as Role)) throw new ApiErr(403, 'FORBIDDEN', 'You cannot assign this role');
  if (self && ch.role && ch.role !== u.role) bad('You cannot change your own role');
  if (self && ch.isActive === false) bad('You cannot deactivate your own account');
  if (u.role === 'OWNER' && u.isActive && ((ch.role && ch.role !== 'OWNER') || ch.isActive === false) && S.users.filter((x) => x.role === 'OWNER' && x.isActive).length <= 1) bad('There must always be at least one active owner account');
  if (u.version !== version) stale(publicUser(u));
  const before = publicUser(u); Object.assign(u, ch, password ? { password } : {}, { version: u.version + 1 });
  audit('user.update', 'User', u.id, before, publicUser(u)); return { user: publicUser(u) };
});

r('GET', '/audit', (_m, _b, q) => {
  need('audit.view'); const limit = Math.min(200, Number(q.get('limit')) || 50); const before = Number(q.get('before')) || Infinity;
  const rows = [...S.audit].reverse().filter((a) => a.id < before).slice(0, limit);
  return {
    entries: rows.map((a) => { const u = S.users.find((x) => x.id === a.actorId); return { id: String(a.id), occurredAt: a.occurredAt, actor: u ? { id: u.id, username: u.username, fullName: u.fullName } : null, action: a.action, entityType: a.entityType, entityId: a.entityId, before: a.before, after: a.after, ipAddress: null }; }),
    nextBefore: rows.length === limit ? String(rows.at(-1)!.id) : null,
  };
});

r('GET', '/dashboard/summary', (_m, _b, q) => {
  const u = need('dashboard.view'); const t = new Date();
  const byGroup: Record<string, number> = {}; for (const c of S.categories.filter((c) => c.isActive)) byGroup[c.group] = (byGroup[c.group] ?? 0) + 1;
  const byRole: Record<string, number> = {}; for (const x of S.users.filter((x) => x.isActive)) byRole[x.role] = (byRole[x.role] ?? 0) + 1;
  return {
    businessDate: businessDate(t, S.settings.timezone, S.settings.businessDayStartHour), timezone: S.settings.timezone, utcOffset: utcOffset(S.settings.timezone, t),
    serverTime: t.toISOString(), database: { ok: true, latencyMs: 1 }, realtimeClients: 1, staffSignedIn: 1,
    categories: { byGroup, inactive: S.categories.filter((c) => !c.isActive).length }, activeUsersByRole: byRole, stock: stockSummary(showCost(u)),
    ...demoDashboardExtras(q.get('period') ?? 'day', showCost(u)),
  };
});

// suppliers
r('GET', '/suppliers', () => { need('inventory.view'); return { suppliers: [...S.suppliers].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name)) }; });
r('POST', '/suppliers', (_m, b) => {
  need('purchases.manage'); const d = parse(supplierCreateSchema, b);
  if (S.suppliers.some((s) => norm(s.name) === norm(d.name))) conflict('A supplier with this name already exists');
  const s: SupplierDTO = { id: uid(), name: clean(d.name), phone: d.phone ?? '', address: d.address ?? '', notes: d.notes ?? '', isActive: d.isActive ?? true, version: 0 };
  S.suppliers.push(s); audit('supplier.create', 'Supplier', s.id, null, s); return [201, { supplier: s }];
});
r('PATCH', '/suppliers/:id', (m, b) => {
  need('purchases.manage'); const { version, ...ch } = parse(supplierUpdateSchema, b);
  const s = S.suppliers.find((x) => x.id === m[1]) ?? notFound('Supplier not found');
  if (s.version !== version) stale(s);
  if (ch.name && S.suppliers.some((x) => x.id !== s.id && norm(x.name) === norm(ch.name!))) conflict('A supplier with this name already exists');
  Object.assign(s, ch, { version: s.version + 1 }); audit('supplier.update', 'Supplier', s.id, null, s); return { supplier: s };
});

// ingredients
r('GET', '/ingredients', (_m, _b, q) => {
  const u = need('inventory.view');
  return { ingredients: S.ingredients.filter((i) => q.get('includeInactive') === 'true' || i.isActive).sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name)).map((i) => ingDTO(i, showCost(u))) };
});
r('POST', '/ingredients', (_m, b) => {
  const u = need('inventory.adjust'); const d = parse(ingredientCreateSchema, b);
  if (!isUnitOf(d.displayUnit, d.dimension)) bad('Please check the highlighted fields', [{ path: 'displayUnit', message: 'Unit does not match how it is measured' }]);
  if (S.ingredients.some((i) => norm(i.name) === norm(d.name))) conflict('An ingredient with this name already exists');
  const i: Ing = { id: uid(), name: clean(d.name), dimension: d.dimension, displayUnit: d.displayUnit, onHand: 0, avgCost: 0, minLevel: toBase(d.minLevel ?? 0, d.displayUnit, d.dimension), supplierId: d.supplierId ?? null, isPackaging: d.isPackaging ?? false, isActive: true, notes: d.notes ?? '', version: 0 };
  S.ingredients.push(i); audit('ingredient.create', 'Ingredient', i.id, null, { name: i.name }); return [201, { ingredient: ingDTO(i, showCost(u)) }];
});
r('PATCH', '/ingredients/:id', (m, b) => {
  const u = need('inventory.adjust'); const { version, ...ch } = parse(ingredientUpdateSchema, b); const i = ing(m[1]!);
  if (i.version !== version) stale({ id: i.id, version: i.version });
  const unit = ch.displayUnit ?? i.displayUnit;
  if (!isUnitOf(unit, i.dimension)) bad('Please check the highlighted fields', [{ path: 'displayUnit', message: 'Unit does not match how it is measured' }]);
  if (ch.name !== undefined) { if (S.ingredients.some((x) => x.id !== i.id && norm(x.name) === norm(ch.name!))) conflict('An ingredient with this name already exists'); i.name = clean(ch.name); }
  i.displayUnit = unit; if (ch.minLevel !== undefined) i.minLevel = toBase(ch.minLevel, unit, i.dimension);
  for (const k of ['supplierId', 'isPackaging', 'isActive', 'notes'] as const) if (ch[k] !== undefined) (i as any)[k] = ch[k];
  i.version++; audit('ingredient.update', 'Ingredient', i.id); return { ingredient: ingDTO(i, showCost(u)) };
});
r('DELETE', '/ingredients/:id', (m) => {
  need('inventory.adjust'); const i = ing(m[1]!);
  if (S.products.some((p) => p.recipe.some((l) => l.ingredientId === i.id) || p.groups.some((g) => g.options.some((o) => o.ingredientId === i.id)))) conflict('This ingredient is used in a recipe or option. Remove it there first, or deactivate it.');
  if (S.movements.some((x) => x.itemId === i.id)) conflict('This ingredient has stock history and cannot be deleted. Deactivate it instead.');
  S.ingredients = S.ingredients.filter((x) => x !== i); audit('ingredient.delete', 'Ingredient', i.id); return [204, null];
});
r('POST', '/ingredients/:id/receive', (m, b) => {
  const u = need('purchases.manage'); const d = parse(receiveStockSchema, b); const i = ing(m[1]!);
  if (!isUnitOf(d.unit, i.dimension)) bad('Please check the highlighted fields', [{ path: 'unit', message: `This item is measured by ${i.dimension.toLowerCase()}` }]);
  const replayed = once(d.requestId, () => { moveIng(i, 'RECEIVE', toBase(d.quantity, d.unit, i.dimension), { receiveValue: d.totalCostMinor, reason: d.reference || null, refType: 'RECEIPT' }); audit('stock.receive', 'Ingredient', i.id, null, { quantity: d.quantity, unit: d.unit, totalCostMinor: d.totalCostMinor }); });
  return [replayed ? 200 : 201, { ingredient: ingDTO(i, showCost(u)), replayed }];
});
r('POST', '/ingredients/:id/adjust', (m, b) => {
  const u = need('inventory.adjust'); const d = parse(adjustStockSchema, b); const i = ing(m[1]!);
  if (!isUnitOf(d.unit, i.dimension)) bad('Please check the highlighted fields', [{ path: 'unit', message: `This item is measured by ${i.dimension.toLowerCase()}` }]);
  const q = toBase(d.quantity, d.unit, i.dimension);
  const replayed = once(d.requestId, () => { const delta = d.type === 'COUNT' ? q - i.onHand : d.type === 'ADJUSTMENT' ? q : -q; moveIng(i, d.type, delta, { reason: d.reason || null }); audit(`stock.${d.type.toLowerCase()}`, 'Ingredient', i.id, null, { onHand: i.onHand, reason: d.reason }); });
  return [replayed ? 200 : 201, { ingredient: ingDTO(i, showCost(u)), replayed }];
});
r('GET', '/stock/movements', (_m, _b, q) => {
  const u = need('inventory.view'); const kind = q.get('kind'); const itemId = q.get('itemId'); const limit = Math.min(200, Number(q.get('limit')) || 50);
  const rows = [...S.movements].sort((a, b) => b.seq - a.seq).filter((x) => (!kind || x.kind === kind) && (!itemId || x.itemId === itemId)).slice(0, limit);
  return { movements: rows.map(({ seq: _s, ...x }) => ({ ...x, unitCostMinor: showCost(u) ? x.unitCostMinor : 0, valueMinor: showCost(u) ? x.valueMinor : 0 })) };
});
r('GET', '/stock/summary', () => { const u = need('inventory.view'); return { summary: stockSummary(showCost(u)) }; });

// products
r('GET', '/products', (_m, _b, q) => { const u = need('menu.view'); return { products: sortedProducts(q.get('includeInactive') === 'true').map((p) => prodDTO(p, showCost(u))) }; });
r('GET', '/products/:id', (m) => { const u = need('menu.view'); return { product: prodDTO(prod(m[1]!), showCost(u)) }; });
r('GET', '/availability', () => {
  need('menu.view');
  const products = sortedProducts(false).map((p) => prodDTO(p, false));
  const cats = S.categories.filter((c) => c.isActive).sort((a, b) => groupOrder(a.group) - groupOrder(b.group) || a.sortOrder - b.sortOrder);
  const out: CategoryAvailabilityDTO[] = cats.map((c) => {
    const items = products.filter((p) => p.categoryId === c.id);
    return {
      categoryId: c.id, name: c.name, group: c.group, station: c.station,
      itemsAvailable: items.filter((p) => p.isAvailable && (p.available === null || p.available > 0)).length,
      itemsSoldOut: items.filter((p) => p.soldOut).length,
      portionsReady: items.filter((p) => (p.stockMode === 'BATCH' || p.stockMode === 'RESALE') && p.isAvailable).reduce((s, p) => s + (p.available ?? 0), 0),
      products: items.map((p) => ({ id: p.id, name: p.name, priceMinor: p.priceMinor, stockMode: p.stockMode, available: p.available, soldOut: p.soldOut, isAvailable: p.isAvailable, limitingIngredient: p.limitingIngredient })),
    };
  });
  return { categories: out };
});
r('POST', '/products', (_m, b) => {
  const u = need('menu.manage'); const d = parse(productCreateSchema, b);
  if (!cat(d.categoryId)) bad('Choose a valid category');
  if (S.products.some((p) => norm(p.name) === norm(d.name))) conflict('A menu item with this name already exists');
  const max = Math.max(-10, ...S.products.filter((p) => p.categoryId === d.categoryId).map((p) => p.sortOrder));
  const p: Prod = { id: uid(), categoryId: d.categoryId, name: clean(d.name), description: d.description ?? '', priceMinor: d.priceMinor, stationOverride: d.stationOverride ?? null, stockMode: d.stockMode, isAvailable: d.isAvailable ?? true, isActive: d.isActive ?? true, sortOrder: d.sortOrder ?? max + 10, recipeYield: 1, manualCostMinor: d.manualCostMinor ?? null, portionsOnHand: 0, portionCost: 0, version: 0, recipe: [], groups: [] };
  S.products.push(p); audit('product.create', 'Product', p.id, null, { name: p.name, priceMinor: p.priceMinor }); return [201, { product: prodDTO(p, showCost(u)) }];
});
r('PATCH', '/products/:id', (m, b) => {
  const u = need('menu.manage'); const { version, ...ch } = parse(productUpdateSchema, b); const p = prod(m[1]!);
  if (p.version !== version) stale({ id: p.id, version: p.version });
  if (ch.name !== undefined) { if (S.products.some((x) => x.id !== p.id && norm(x.name) === norm(ch.name!))) conflict('A menu item with this name already exists'); ch.name = clean(ch.name); }
  if (ch.categoryId && !cat(ch.categoryId)) bad('Choose a valid category');
  if (ch.stockMode && ch.stockMode !== p.stockMode) {
    if (p.portionsOnHand > 0) conflict(`${p.name} still has ${p.portionsOnHand} portion(s) in stock. Sell, waste or count them to 0 before changing how its stock works.`);
    if (ch.stockMode !== 'BATCH') p.recipeYield = 1;
  }
  const before = { name: p.name, priceMinor: p.priceMinor };
  Object.assign(p, ch, { version: p.version + 1 });
  audit(before.priceMinor !== p.priceMinor ? 'product.update_price' : 'product.update', 'Product', p.id, before, { name: p.name, priceMinor: p.priceMinor });
  return { product: prodDTO(p, showCost(u)) };
});
r('DELETE', '/products/:id', (m) => {
  need('menu.manage'); const p = prod(m[1]!);
  if (S.movements.some((x) => x.itemId === p.id) || S.batches.some((x) => x.productId === p.id)) conflict(`${p.name} has stock history and cannot be deleted. Hide it instead (untick "Active").`);
  S.products = S.products.filter((x) => x !== p); audit('product.delete', 'Product', p.id, { name: p.name }); return [204, null];
});
r('PUT', '/products/:id/recipe', (m, b) => {
  const u = need('menu.manage'); const d = parse(recipeSchema, b); const p = prod(m[1]!);
  if (p.stockMode !== 'BATCH' && p.stockMode !== 'MADE_TO_ORDER') bad('Only batch-cooked and made-to-order items have recipes');
  if (p.stockMode === 'MADE_TO_ORDER' && d.recipeYield !== 1) bad('Made-to-order recipes are for one portion (yield 1)');
  if (new Set(d.lines.map((l) => l.ingredientId)).size !== d.lines.length) bad('Each ingredient can appear only once in a recipe');
  if (p.version !== d.version) stale({ id: p.id, version: p.version });
  const lines = d.lines.map((l, idx) => {
    const i = ing(l.ingredientId);
    if (!isUnitOf(l.unit, i.dimension)) bad('Please check the highlighted fields', [{ path: `lines.${idx}.unit`, message: `${i.name} is measured by ${i.dimension.toLowerCase()}` }]);
    return { ingredientId: i.id, quantity: toBase(l.quantity, l.unit, i.dimension), wastagePct: l.wastagePct ?? 0 };
  });
  p.recipe = lines; p.recipeYield = d.recipeYield; p.version++; audit('product.recipe_update', 'Product', p.id, null, { recipeYield: p.recipeYield, lines });
  return { product: prodDTO(p, showCost(u)) };
});
r('PUT', '/products/:id/modifiers', (m, b) => {
  const u = need('menu.manage'); const d = parse(modifiersSchema, b); const p = prod(m[1]!);
  if (p.version !== d.version) stale({ id: p.id, version: p.version });
  p.groups = d.groups.map((g) => ({
    id: uid(), name: g.name, minSelect: g.minSelect, maxSelect: Math.min(g.maxSelect, g.options.length),
    options: g.options.map((o) => {
      let quantity: number | null = null;
      if (o.ingredientId) { const i = ing(o.ingredientId); if (!o.unit || !o.quantity || !isUnitOf(o.unit, i.dimension)) bad(`Check the ingredient amount for option "${o.name}"`); quantity = toBase(o.quantity, o.unit, i.dimension); }
      return { id: uid(), name: o.name, priceDeltaMinor: o.priceDeltaMinor, ingredientId: o.ingredientId ?? null, quantity, isAvailable: o.isAvailable ?? true };
    }),
  }));
  p.version++; audit('product.options_update', 'Product', p.id, null, d.groups); return { product: prodDTO(p, showCost(u)) };
});
r('PUT', '/products/:id/image', () => { need('menu.manage'); bad('Photos can be added in the full app installed at the café. The online demo does not store photos.'); });
r('DELETE', '/products/:id/image', (m) => { const u = need('menu.manage'); return { product: prodDTO(prod(m[1]!), showCost(u)) }; });
r('POST', '/products/:id/stock/adjust', (m, b) => {
  const u = need('inventory.adjust'); const d = parse(finishedAdjustSchema, b); const p = prod(m[1]!);
  if (p.stockMode !== 'BATCH' && p.stockMode !== 'RESALE') bad('This item does not keep portion stock');
  const replayed = once(d.requestId, () => { const delta = d.type === 'COUNT' ? d.quantity - p.portionsOnHand : d.type === 'ADJUSTMENT' ? d.quantity : -d.quantity; moveFin(p, d.type, delta, { reason: d.reason || null }); audit(`portions.${d.type.toLowerCase()}`, 'Product', p.id, null, { portionsOnHand: p.portionsOnHand }); });
  return [replayed ? 200 : 201, { product: prodDTO(p, showCost(u)), replayed }];
});
r('POST', '/products/:id/stock/receive', (m, b) => {
  const u = need('purchases.manage'); const d = parse(finishedReceiveSchema, b); const p = prod(m[1]!);
  if (p.stockMode !== 'RESALE') bad('Only ready-made items are received as units. Batch items are added by recording a production batch.');
  const replayed = once(d.requestId, () => { moveFin(p, 'RECEIVE', d.quantity, { incomingValue: d.totalCostMinor, reason: d.reference || null, refType: 'RECEIPT' }); audit('portions.receive', 'Product', p.id, null, { quantity: d.quantity }); });
  return [replayed ? 200 : 201, { product: prodDTO(p, showCost(u)), replayed }];
});

// production
function plan(productId: string, portions: number, overrides: { ingredientId: string; quantity: number }[] = []) {
  const p = S.products.find((x) => x.id === productId && x.isActive) ?? notFound('Product not found');
  if (p.stockMode !== 'BATCH') bad(`${p.name} is not a batch-cooked item`);
  if (!p.recipe.length) bad(`Add a recipe for ${p.name} before recording a batch`);
  const ov = new Map(overrides.map((o) => [o.ingredientId, round3(o.quantity)]));
  return { p, lines: p.recipe.map((l) => ({ line: l, i: ing(l.ingredientId), required: ov.get(l.ingredientId) ?? lineNeed(l, p.recipeYield, portions) })) };
}
r('GET', '/production/preview', (_m, _b, q) => {
  const u = need('production.manage'); const portions = Math.max(1, Number(q.get('portions')) || 1);
  const { p, lines } = plan(q.get('productId') ?? '', portions);
  let total = 0; let max = Infinity;
  const requirements = lines.map(({ line, i, required }) => {
    const c = roundMinor(required * i.avgCost); total += c;
    const per = lineNeed(line, p.recipeYield, 1); if (per > 0) max = Math.min(max, Math.floor(i.onHand / per + 1e-9));
    return { ingredientId: i.id, ingredientName: i.name, displayUnit: i.displayUnit, required, onHand: i.onHand, shortBy: Math.max(0, round3(required - i.onHand)), costMinor: showCost(u) ? c : 0 };
  });
  return { preview: { productId: p.id, portions, requirements, totalCostMinor: showCost(u) ? total : 0, unitCostMinor: showCost(u) ? roundMinor(total / portions) : 0, canProduce: requirements.every((x) => x.shortBy === 0), maxPortions: max === Infinity ? 0 : max } };
});
r('POST', '/production/batches', (_m, b) => {
  const u = need('production.manage'); const d = parse(productionSchema, b);
  const existing = S.batches.find((x) => (x as any).requestId === d.requestId);
  if (existing) return { batch: existing, replayed: true };
  const overrides = (d.overrides ?? []).map((o) => ({ ingredientId: o.ingredientId, quantity: toBase(o.quantity, o.unit, ing(o.ingredientId).dimension) }));
  const { p, lines } = plan(d.productId, d.portions, overrides);
  const short = lines.filter((l) => l.i.onHand < l.required);
  if (short.length) throw new ApiErr(409, 'INSUFFICIENT_STOCK', `Not enough ingredients to prepare ${d.portions} × ${p.name}`, { shortages: short.map((l) => ({ id: l.i.id, name: l.i.name, required: l.required, onHand: l.i.onHand, shortBy: round3(l.required - l.i.onHand) })) });
  const id = uid(); let total = 0;
  const consumption = lines.filter((l) => l.required > 0).map((l) => { const v = -moveIng(l.i, 'PRODUCTION_CONSUME', -l.required, { refType: 'PRODUCTION_BATCH', refId: id }); total += v; return { ingredientId: l.i.id, ingredientName: l.i.name, quantity: l.required, displayUnit: l.i.displayUnit, valueMinor: v }; });
  moveFin(p, 'PRODUCED', d.portions, { refType: 'PRODUCTION_BATCH', refId: id, incomingValue: total });
  const batch = { id, batchNo: Math.max(0, ...S.batches.map((x) => x.batchNo)) + 1, productId: p.id, productName: p.name, portions: d.portions, totalCostMinor: total, unitCostMinor: roundMinor(total / d.portions), notes: d.notes ?? '', preparedBy: u.fullName, preparedAt: now(), consumption, requestId: d.requestId };
  S.batches.push(batch); audit('production.batch', 'Product', p.id, null, { portions: d.portions, totalCostMinor: total });
  const hide = (x: ProductionBatchDTO) => (showCost(u) ? x : { ...x, totalCostMinor: 0, unitCostMinor: 0, consumption: x.consumption.map((c) => ({ ...c, valueMinor: 0 })) });
  return [201, { batch: hide(batch), replayed: false }];
});
r('GET', '/production/batches', () => {
  const u = need('production.manage');
  return { batches: [...S.batches].sort((a, b) => b.batchNo - a.batchNo).slice(0, 30).map((x) => (showCost(u) ? x : { ...x, totalCostMinor: 0, unitCostMinor: 0 })) };
});


// ─────────── POS & orders (demo) ───────────
const today = () => businessDate(new Date(), S.settings.timezone, S.settings.businessDayStartHour);
const userName = (id: string | null) => S.users.find((u) => u.id === id)?.fullName ?? null;
function queueJob(key: string, role: PrinterRole, kind: 'RECEIPT' | 'TICKET' | 'TEST', orderId: string | null, payload: PrintPayload | null, reprintNo = 0, reason: string | null = null) {
  if (!payload || S.jobs.some((j) => j.key === key)) return;
  const o = orderId ? S.orders.find((x) => x.id === orderId) : null;
  S.jobs.push({ id: uid(), key, role, kind, orderId, orderNo: o?.orderNo ?? null, payload, status: 'PENDING', attempts: 0, lastError: null, reprintNo, reprintReason: reason, createdAt: now(), printedAt: null });
}
const printable = (o: OrderDTO) => ({ ...o, createdAt: new Date(o.createdAt), taxSnapshot: o.taxes });
function tickets(o: OrderDTO, opts: { cancelled?: boolean } = {}) {
  for (const st of ['KITCHEN', 'BARISTA'] as const) queueJob(`${o.id}:${st}:${opts.cancelled ? 'CANCEL' : 'TICKET'}:0`, st, 'TICKET', o.id, ticketPayload(printable(o), st, S.settings, opts));
}
const recalc = (o: OrderDTO) => { o.dueMinor = o.status === 'CANCELLED' ? 0 : o.totalMinor - o.paidMinor; };

/** Deduct stock for an order line; returns cost. Throws (before changing anything) on shortage. */
function consumeLine(p: Prod, qty: number, modifierIds: string[], lineId: string) {
  if (p.stockMode === 'BATCH' || p.stockMode === 'RESALE') {
    if (p.portionsOnHand < qty) throw new ApiErr(409, 'INSUFFICIENT_STOCK', 'Not enough stock for this order', { shortages: [{ id: p.id, name: p.name, required: qty, onHand: p.portionsOnHand, shortBy: qty - p.portionsOnHand }] });
    const cost = roundMinor(p.portionCost * qty);
    moveFin(p, 'SOLD', -qty, { refType: 'ORDER_LINE', refId: lineId });
    return { cost, tracked: true };
  }
  if (p.stockMode === 'MADE_TO_ORDER') {
    const needs = new Map<string, number>();
    for (const l of p.recipe) needs.set(l.ingredientId, (needs.get(l.ingredientId) ?? 0) + lineNeed(l, p.recipeYield, qty));
    for (const o of p.groups.flatMap((g) => g.options)) if (modifierIds.includes(o.id) && o.ingredientId && o.quantity) needs.set(o.ingredientId, (needs.get(o.ingredientId) ?? 0) + o.quantity * qty);
    const short = [...needs].map(([id, n]) => ({ i: ing(id), n })).filter((x) => x.i.onHand < x.n);
    if (short.length) throw new ApiErr(409, 'INSUFFICIENT_STOCK', 'Not enough stock for this order', { shortages: short.map((x) => ({ id: x.i.id, name: x.i.name, required: x.n, onHand: x.i.onHand, shortBy: x.n - x.i.onHand })) });
    let cost = 0;
    for (const [id, n] of needs) cost -= moveIng(ing(id), 'SALE_CONSUME', -n, { refType: 'ORDER_LINE', refId: lineId });
    return { cost, tracked: true };
  }
  return { cost: (p.manualCostMinor ?? 0) * qty, tracked: false };
}

r('GET', '/tax-rates', () => { me(); return { taxRates: S.taxRates }; });
r('POST', '/tax-rates', (_m, b) => { need('settings.manage'); const d = parse(taxRateSchema, b); const t = { id: uid(), name: d.name, rateBp: Math.round(d.ratePercent * 100), inclusive: d.inclusive, isActive: d.isActive ?? true, version: 0 }; S.taxRates.push(t); audit('tax.create', 'TaxRate', t.id, null, t); return [201, { taxRate: t }]; });
r('PATCH', '/tax-rates/:id', (m, b) => { need('settings.manage'); const { version, ratePercent, ...d } = parse(taxRateUpdateSchema, b); const t = S.taxRates.find((x) => x.id === m[1]) ?? notFound(); if (t.version !== version) stale(t); Object.assign(t, d, ratePercent !== undefined ? { rateBp: Math.round(ratePercent * 100) } : {}, { version: t.version + 1 }); return { taxRate: t }; });
r('GET', '/payment-methods', () => { me(); return { paymentMethods: [...S.paymentMethods].sort((a, b) => a.sortOrder - b.sortOrder) }; });
r('POST', '/payment-methods', (_m, b) => { need('settings.manage'); const d = parse(paymentMethodSchema, b); if (S.paymentMethods.some((x) => norm(x.name) === norm(d.name))) conflict('A payment method with this name exists'); const pm = { id: uid(), name: d.name, kind: d.kind, requiresReference: d.requiresReference ?? false, isActive: d.isActive ?? true, sortOrder: d.sortOrder ?? 100, version: 0 }; S.paymentMethods.push(pm); return [201, { paymentMethod: pm }]; });
r('PATCH', '/payment-methods/:id', (m, b) => { need('settings.manage'); const { version, ...d } = parse(paymentMethodUpdateSchema, b); const pm = S.paymentMethods.find((x) => x.id === m[1]) ?? notFound(); if (pm.version !== version) stale(pm); Object.assign(pm, d, { version: pm.version + 1 }); return { paymentMethod: pm }; });

r('POST', '/orders', (_m, b) => {
  const u = need('pos.use'); const d = parse(orderCreateSchema, b);
  const ex = S.orders.find((o) => (o as any).clientRequestId === d.clientRequestId); if (ex) return { order: ex, replayed: true };
  if (d.discount && !hasPermission(u.role, 'orders.discount')) throw new ApiErr(403, 'FORBIDDEN', 'Only a manager or the owner can give discounts');
  let reuse: number | null = null;
  if (d.replacesHeldOrderId) { const h = S.orders.find((o) => o.id === d.replacesHeldOrderId && o.status === 'HELD'); if (!h) conflict('That held order was already resumed or cancelled'); reuse = h.orderNo; S.orders = S.orders.filter((o) => o !== h); }
  const lines = d.lines.map((l, idx) => {
    const p = prod(l.productId); const c = cat(p.categoryId)!;
    if (!p.isAvailable) throw new ApiErr(409, 'UNAVAILABLE', `${p.name} is switched off`);
    const opts = p.groups.flatMap((g) => g.options).filter((o) => l.modifierIds.includes(o.id));
    for (const g of p.groups) { const n = g.options.filter((o) => l.modifierIds.includes(o.id)).length; if (n < g.minSelect || n > g.maxSelect) bad(`${p.name}: check the choices for "${g.name}"`); }
    const unit = p.priceMinor + opts.reduce((a, o) => a + o.priceDeltaMinor, 0);
    return { id: uid(), productId: p.id, name: p.name, categoryName: c.name, unitPriceMinor: unit, quantity: l.quantity, lineTotalMinor: unit * l.quantity, modifiers: opts.map((o) => ({ id: o.id, name: o.name, priceDeltaMinor: o.priceDeltaMinor })), notes: l.notes ?? '', station: p.stationOverride ?? c.station, prepStatus: 'PENDING' as PrepStatus, stockState: 'NOT_TRACKED' as const, costMinor: 0 };
  });
  const t = priceOrder(lines.map((l) => l.lineTotalMinor), discountFrom(d.discount ?? null, lines.reduce((a, l) => a + l.lineTotalMinor, 0)), S.taxRates.filter((x) => x.isActive));
  const date = today();
  const o: OrderDTO & { clientRequestId: string } = {
    id: uid(), clientRequestId: d.clientRequestId, orderNo: reuse ?? Math.max(0, ...S.orders.filter((x) => x.businessDate === date).map((x) => x.orderNo)) + 1, businessDate: date,
    serviceType: d.serviceType, tableNo: d.serviceType === 'DINE_IN' ? d.tableNo ?? null : null, customerName: S.customers.find((c) => c.id === d.customerId)?.name ?? d.customerName ?? '', customerId: d.customerId ?? null, status: d.hold ? 'HELD' : 'OPEN', paymentStatus: 'UNPAID',
    subtotalMinor: t.subtotalMinor, discountMinor: t.discountMinor, discountReason: d.discount?.reason ?? null, taxMinor: t.taxMinor, totalMinor: t.totalMinor, paidMinor: 0, refundedMinor: 0, dueMinor: t.totalMinor,
    taxes: t.taxes, notes: d.notes ?? '', placedOffline: false, needsReview: false, reviewNote: null, createdBy: u.fullName, createdAt: now(), completedAt: null, cancelledAt: null, cancelReason: null,
    lines, payments: [], refunds: [], version: 0,
  };
  if (!d.hold) for (const l of o.lines) { const c = consumeLine(prod(l.productId), l.quantity, l.modifiers.map((x) => x.id), l.id); (l as any).costMinor = c.cost; l.stockState = c.tracked ? 'CONSUMED' : 'NOT_TRACKED'; }
  S.orders.push(o);
  if (!d.hold) tickets(o);
  audit(d.hold ? 'order.hold' : 'order.create', 'Order', o.id);
  return [201, { order: o, replayed: false }];
});
r('GET', '/orders', (_m, _b, q) => {
  need('orders.view'); const st = q.get('status'); const date = q.get('date') ?? today();
  let rows = S.orders.filter((o) => (q.get('needsReview') ? o.needsReview : o.businessDate === date));
  if (st === 'ACTIVE') rows = rows.filter((o) => o.status === 'HELD' || o.status === 'OPEN'); else if (st) rows = rows.filter((o) => o.status === st);
  return { orders: [...rows].sort((a, b) => b.orderNo - a.orderNo), businessDate: date };
});
const order = (id: string) => S.orders.find((o) => o.id === id) ?? notFound('Order not found');
r('GET', '/orders/:id', (m) => { need('orders.view'); return { order: order(m[1]!) }; });
r('POST', '/orders/:id/send', (m) => {
  need('pos.use'); const o = order(m[1]!); if (o.status !== 'HELD') conflict('This order has already been sent');
  for (const l of o.lines) { const c = consumeLine(prod(l.productId), l.quantity, l.modifiers.map((x) => x.id), l.id); (l as any).costMinor = c.cost; l.stockState = c.tracked ? 'CONSUMED' : 'NOT_TRACKED'; }
  o.status = 'OPEN'; tickets(o); return { order: o };
});
r('POST', '/orders/:id/payments', (m, b) => {
  const u = need('pos.use'); const d = parse(paymentSchema, b); const o = order(m[1]!);
  if (S.requestIds[d.idempotencyKey]) return { order: o, replayed: true, changeMinor: 0 };
  if (o.status === 'HELD') conflict('Send the order before taking payment'); if (o.status === 'CANCELLED') conflict('This order was cancelled');
  const due = o.totalMinor - o.paidMinor; if (due <= 0) conflict('This order is already fully paid'); if (d.amountMinor > due) bad(`Only ${due / 100} is still due`);
  const pm = S.paymentMethods.find((x) => x.id === d.methodId && x.isActive) ?? bad('Choose an active payment method');
  if (pm.requiresReference && !d.reference) bad(`Enter the ${pm.name} transaction ID`);
  let tendered: number | null = null; let change = 0;
  if (pm.kind === 'CASH' && d.tenderedMinor) { if (d.tenderedMinor < d.amountMinor) bad('Cash given is less than the amount'); tendered = d.tenderedMinor; change = d.tenderedMinor - d.amountMinor; }
  S.requestIds[d.idempotencyKey] = true;
  o.payments.push({ id: uid(), methodId: pm.id, methodName: pm.name, kind: pm.kind, amountMinor: d.amountMinor, tenderedMinor: tendered, changeMinor: change, reference: d.reference || null, receivedBy: u.fullName, createdAt: now() });
  const session = S.cash.find((c) => !c.closed);
  if (session && pm.kind === 'CASH') { session.cashSalesMinor += d.amountMinor; session.expectedCashMinor += d.amountMinor; }
  o.paidMinor += d.amountMinor;
  if (o.paidMinor >= o.totalMinor) { o.paymentStatus = 'PAID'; o.status = 'COMPLETED'; o.completedAt = now(); queueJob(`${o.id}:RECEIPT:RECEIPT:0`, 'RECEIPT', 'RECEIPT', o.id, receiptPayload(printable(o), S.settings)); }
  else o.paymentStatus = 'PARTIALLY_PAID';
  recalc(o); audit('order.payment', 'Order', o.id); return [201, { order: o, replayed: false, changeMinor: change }];
});
r('POST', '/orders/:id/cancel', (m, b) => {
  const u = need('pos.use'); const { reason } = parse(cancelOrderSchema, b); const o = order(m[1]!);
  if (o.status === 'CANCELLED') conflict('This order is already cancelled');
  if (o.status !== 'HELD' && !hasPermission(u.role, 'orders.cancel')) throw new ApiErr(403, 'FORBIDDEN', 'Only a manager or the owner can cancel a sent order');
  if (o.paidMinor - o.refundedMinor > 0) conflict('Refund the payment before cancelling this order');
  let restored = 0; let wasted = 0;
  for (const l of o.lines) {
    if (l.stockState === 'CONSUMED' && l.prepStatus === 'PENDING') {
      for (const mv of S.movements.filter((x) => x.refId === l.id && (x.type === 'SOLD' || x.type === 'SALE_CONSUME'))) {
        if (mv.kind === 'FINISHED') moveFin(prod(mv.itemId), 'SALE_REVERSAL', -mv.qtyDelta, { refType: 'ORDER_LINE', refId: l.id, incomingValue: -mv.valueMinor });
        else moveIng(ing(mv.itemId), 'RECEIVE', -mv.qtyDelta, { refType: 'ORDER_LINE', refId: l.id, receiveValue: -mv.valueMinor, reason: 'Order cancelled' });
      }
      l.stockState = 'RESTORED'; restored++;
    } else if (l.stockState === 'CONSUMED') { l.stockState = 'WASTED'; wasted++; }
    l.prepStatus = 'CANCELLED';
  }
  const wasHeld = o.status === 'HELD';
  o.status = 'CANCELLED'; o.cancelledAt = now(); o.cancelReason = reason; recalc(o);
  if (!wasHeld) tickets(o, { cancelled: true });
  audit('order.cancel', 'Order', o.id, null, { reason }); return { order: o, restored, wasted, wasHeld };
});
r('POST', '/orders/:id/refunds', (m, b) => {
  const u = need('orders.refund'); const d = parse(refundSchema, b); const o = order(m[1]!);
  if (S.requestIds[d.idempotencyKey]) return { order: o, replayed: true };
  const max = o.paidMinor - o.refundedMinor; if (max <= 0) conflict('Nothing has been paid that can be refunded'); if (d.amountMinor > max) bad(`At most ${max / 100} can be refunded`);
  const pm = S.paymentMethods.find((x) => x.id === d.methodId) ?? bad('Choose a payment method');
  S.requestIds[d.idempotencyKey] = true;
  o.refunds.push({ id: uid(), methodName: pm.name, amountMinor: d.amountMinor, reason: d.reason, approvedBy: u.fullName, createdAt: now() });
  const session = S.cash.find((c) => !c.closed);
  if (session && pm.kind === 'CASH') { session.cashRefundsMinor += d.amountMinor; session.expectedCashMinor -= d.amountMinor; }
  o.refundedMinor += d.amountMinor; o.paymentStatus = o.refundedMinor >= o.paidMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  audit('order.refund', 'Order', o.id, null, { amount: d.amountMinor, reason: d.reason }); return [201, { order: o, replayed: false }];
});
r('POST', '/orders/:id/reprint', (m, b) => {
  need('orders.reprint'); const { role, reason } = parse(reprintSchema, b); const o = order(m[1]!);
  const n = Math.max(0, ...S.jobs.filter((j) => j.orderId === o.id && j.role === role).map((j) => j.reprintNo)) + 1;
  const payload = role === 'RECEIPT' ? receiptPayload(printable(o), S.settings, { reprint: n }) : ticketPayload(printable(o), role, S.settings, { reprint: n });
  if (!payload) bad('This order has no items for that printer');
  queueJob(`${o.id}:${role}:R:${n}`, role, role === 'RECEIPT' ? 'RECEIPT' : 'TICKET', o.id, payload, n, reason); return [201, { ok: true }];
});
r('POST', '/orders/:id/review', (m, b) => { need('orders.cancel'); const o = order(m[1]!); o.needsReview = false; o.reviewNote = `Reviewed: ${(b as { note?: string })?.note ?? ''}`; return { order: o }; });

// stations
const stationOf = (s: string) => (s === 'kitchen' ? 'KITCHEN' : s === 'barista' ? 'BARISTA' : notFound());
r('GET', '/stations/:id', (m) => {
  const st = stationOf(m[1]!); need(st === 'KITCHEN' ? 'kitchen.view' : 'barista.view');
  const out: StationTicketDTO[] = S.orders.filter((o) => (o.status === 'OPEN' || o.status === 'COMPLETED') && o.lines.some((l) => l.station === st && ['PENDING', 'PREPARING', 'READY'].includes(l.prepStatus)))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((o) => ({ orderId: o.id, orderNo: o.orderNo, serviceType: o.serviceType, tableNo: o.tableNo, customerName: o.customerName, notes: o.notes, createdAt: o.createdAt, lines: o.lines.filter((l) => l.station === st && l.prepStatus !== 'CANCELLED').map((l) => ({ id: l.id, name: l.name, quantity: l.quantity, modifiers: l.modifiers, notes: l.notes, prepStatus: l.prepStatus })) }));
  return { tickets: out };
});
r('POST', '/stations/:id/orders/([^/]+)/advance', (m) => {
  const st = stationOf(m[1]!); need(st === 'KITCHEN' ? 'kitchen.view' : 'barista.view');
  const o = order(m[2]!); const lines = o.lines.filter((l) => l.station === st && ['PENDING', 'PREPARING', 'READY'].includes(l.prepStatus));
  if (!lines.length) conflict('Nothing left to prepare on this order');
  const low = Math.min(...lines.map((l) => PREP_FLOW.indexOf(l.prepStatus))); const next = PREP_FLOW[low + 1]!;
  for (const l of lines) if (PREP_FLOW.indexOf(l.prepStatus) === low) l.prepStatus = next;
  return { status: next };
});

// cash drawer
r('GET', '/cash/current', () => { need('pos.use'); return { session: S.cash.find((c) => !c.closed) ?? null }; });
r('GET', '/cash/sessions', () => { need('cash.reconcile'); return { sessions: [...S.cash].reverse() }; });
r('POST', '/cash/open', (_m, b) => {
  const u = need('pos.use'); const { openingFloatMinor } = parse(cashOpenSchema, b); if (S.cash.some((c) => !c.closed)) conflict('The cash drawer is already open');
  const c = { id: uid(), openedBy: u.fullName, openedAt: now(), openingFloatMinor, cashSalesMinor: 0, cashRefundsMinor: 0, expectedCashMinor: openingFloatMinor, closedBy: null, closedAt: null, countedCashMinor: null, varianceMinor: null, notes: '', closed: false };
  S.cash.push(c); return [201, { session: c }];
});
r('POST', '/cash/close', (_m, b) => {
  const u = need('cash.reconcile'); const { countedCashMinor, notes } = parse(cashCloseSchema, b); const c = S.cash.find((x) => !x.closed) ?? bad('No cash drawer session is open');
  Object.assign(c, { closed: true, closedBy: u.fullName, closedAt: now(), countedCashMinor, varianceMinor: countedCashMinor - c.expectedCashMinor, notes: notes ?? '' }); return { session: c };
});

// printers (the online demo has no printers on its network: jobs wait, previews show the exact printout)
const printerList = () => S.printers.map((p) => ({ ...p, status: p.host ? 'OFFLINE' : 'NOT_CONFIGURED', lastError: p.host ? 'The online demo cannot reach printers — install the app at the café to print.' : null, pendingJobs: S.jobs.filter((j) => j.role === p.role && j.status === 'PENDING').length, failedJobs: 0 }));
r('GET', '/printers', () => { me(); return { printers: printerList() }; });
r('PATCH', '/printers/:id', (m, b) => { need('printers.manage'); const { version, ...d } = parse(printerSchema, b); const p = S.printers.find((x) => x.id === m[1]) ?? notFound(); if (p.version !== version) stale(p); Object.assign(p, d, { version: p.version + 1 }); return { printers: printerList() }; });
r('POST', '/printers/:id/test', (m) => { need('printers.manage'); const p = S.printers.find((x) => x.id === m[1]) ?? notFound(); if (!p.host) bad('Enter the printer’s IP address first'); queueJob(`test:${uid()}`, p.role, 'TEST', null, testPayload(p.role, p.name, p.paperWidthMm, S.settings)); return [201, { ok: true }]; });
r('GET', '/print-jobs', (_m, _b, q) => { me(); const oid = q.get('orderId'); return { jobs: [...S.jobs].reverse().filter((j) => !oid || j.orderId === oid).slice(0, Number(q.get('limit')) || 50).map(({ payload: _p, key: _k, orderId: _o, ...j }) => j) }; });
r('GET', '/print-jobs/:id/preview', (m) => { me(); const j = S.jobs.find((x) => x.id === m[1]) ?? notFound(); const p = S.printers.find((x) => x.role === j.role)!; return { text: renderText(j.payload, p.paperWidthMm), paperWidthMm: p.paperWidthMm }; });
r('POST', '/print-jobs/:id/retry', () => conflict('Only failed print jobs can be retried'));
r('POST', '/print-jobs/:id/cancel', (m) => { need('orders.reprint'); const j = S.jobs.find((x) => x.id === m[1]) ?? notFound(); j.status = 'CANCELLED'; return { ok: true }; });

// expenses
r('GET', '/expense-categories', () => { need('expenses.manage'); return { categories: S.expenseCategories }; });
r('POST', '/expense-categories', (_m, b) => { need('expenses.manage'); const d = parse(expenseCategorySchema, b); if (S.expenseCategories.some((c) => norm(c.name) === norm(d.name))) conflict('This category already exists'); const c = { id: uid(), name: d.name, isActive: true }; S.expenseCategories.push(c); return [201, { category: c }]; });
r('GET', '/expenses', (_m, _b, q) => { need('expenses.manage'); const f = q.get('from') ?? today(); const t = q.get('to') ?? today(); return { expenses: S.expenses.filter((e) => e.businessDate >= f && e.businessDate <= t).sort((a, b) => b.businessDate.localeCompare(a.businessDate)) }; });
r('POST', '/expenses', (_m, b) => {
  const u = need('expenses.manage'); const d = parse(expenseCreateSchema, b); if (S.requestIds[d.requestId]) return { ok: true, replayed: true };
  const c = S.expenseCategories.find((x) => x.id === d.categoryId) ?? bad('Choose an expense category'); S.requestIds[d.requestId] = true;
  S.expenses.push({ id: uid(), categoryId: c.id, categoryName: c.name, amountMinor: d.amountMinor, businessDate: d.businessDate, paidWith: d.paidWith ?? '', note: d.note ?? '', createdBy: u.fullName, createdAt: now(), voidedAt: null, voidReason: null });
  return [201, { ok: true, replayed: false }];
});
r('POST', '/expenses/:id/void', (m, b) => { need('expenses.manage'); const { reason } = parse(expenseVoidSchema, b); const e = S.expenses.find((x) => x.id === m[1]) ?? notFound(); e.voidedAt = now(); e.voidReason = reason; return { ok: true }; });

// reports
const addDays = (d: string, n: number) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
function report(from: string, to: string): ReportDTO {
  const orders = S.orders.filter((o) => o.businessDate >= from && o.businessDate <= to && (o.status === 'OPEN' || o.status === 'COMPLETED'));
  const lines = orders.flatMap((o) => o.lines.filter((l) => l.prepStatus !== 'CANCELLED'));
  const inRange = (iso: string) => { const d = businessDate(new Date(iso), S.settings.timezone, S.settings.businessDayStartHour); return d >= from && d <= to; };
  const pays = S.orders.flatMap((o) => o.payments).filter((p) => inRange(p.createdAt));
  const refunds = S.orders.flatMap((o) => o.refunds).filter((p) => inRange(p.createdAt));
  const exps = S.expenses.filter((e) => !e.voidedAt && e.businessDate >= from && e.businessDate <= to);
  const moves = S.movements.filter((mv) => inRange(mv.occurredAt));
  const refundsTotal = refunds.reduce((a, x) => a + x.amountMinor, 0);
  const net = orders.reduce((a, o) => a + o.totalMinor - o.taxMinor, 0) - refundsTotal;
  const cogs = lines.reduce((a, l) => a + ((l as any).costMinor ?? 0), 0);
  const losses = -moves.filter((mv) => ['WASTE', 'SPOILAGE', 'ADJUSTMENT', 'COUNT'].includes(mv.type)).reduce((a, mv) => a + mv.valueMinor, 0)
    + S.orders.filter((o) => o.cancelledAt && inRange(o.cancelledAt)).flatMap((o) => o.lines).filter((l) => l.stockState === 'WASTED').reduce((a, l) => a + ((l as any).costMinor ?? 0), 0);
  const expTotal = exps.reduce((a, e) => a + e.amountMinor, 0);
  const group = (items: { k: string; q: number; v: number }[]) => [...items.reduce((m2, i) => { const c = m2.get(i.k) ?? { quantity: 0, revenueMinor: 0 }; c.quantity += i.q; c.revenueMinor += i.v; return m2.set(i.k, c); }, new Map<string, { quantity: number; revenueMinor: number }>())].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenueMinor - a.revenueMinor);
  const methods = new Map<string, { name: string; kind: PaymentKind; receivedMinor: number; refundedMinor: number }>();
  for (const p of pays) { const x = methods.get(p.methodName) ?? { name: p.methodName, kind: p.kind, receivedMinor: 0, refundedMinor: 0 }; x.receivedMinor += p.amountMinor; methods.set(p.methodName, x); }
  for (const rf of refunds) { const x = methods.get(rf.methodName) ?? { name: rf.methodName, kind: 'OTHER' as PaymentKind, receivedMinor: 0, refundedMinor: 0 }; x.refundedMinor += rf.amountMinor; methods.set(rf.methodName, x); }
  const series: ReportDTO['series'] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const os = orders.filter((o) => o.businessDate === d);
    series.push({ period: d, salesMinor: os.reduce((a, o) => a + o.totalMinor - o.taxMinor, 0), orders: os.length, expensesMinor: exps.filter((e) => e.businessDate === d).reduce((a, e) => a + e.amountMinor, 0), cogsMinor: os.flatMap((o) => o.lines).reduce((a, l) => a + ((l as any).costMinor ?? 0), 0) });
  }
  const em = new Map<string, number>(); for (const e of exps) em.set(e.categoryName, (em.get(e.categoryName) ?? 0) + e.amountMinor);
  return {
    from, to, orders: orders.length, itemsSold: lines.reduce((a, l) => a + l.quantity, 0), grossSalesMinor: orders.reduce((a, o) => a + o.subtotalMinor, 0),
    discountsMinor: orders.reduce((a, o) => a + o.discountMinor, 0), taxMinor: orders.reduce((a, o) => a + o.taxMinor, 0), refundsMinor: refundsTotal, netSalesMinor: net,
    cogsMinor: cogs, grossProfitMinor: net - cogs, inventoryLossesMinor: losses, expensesMinor: expTotal, netProfitMinor: net - cogs - expTotal - losses,
    inventoryPurchasesMinor: moves.filter((mv) => mv.type === 'RECEIVE' && mv.refType === 'RECEIPT').reduce((a, mv) => a + mv.valueMinor, 0),
    averageOrderMinor: orders.length ? Math.round(orders.reduce((a, o) => a + o.totalMinor, 0) / orders.length) : 0,
    cancelledOrders: S.orders.filter((o) => o.status === 'CANCELLED' && o.businessDate >= from && o.businessDate <= to).length,
    paymentMethods: [...methods.values()].map((x) => ({ ...x, netMinor: x.receivedMinor - x.refundedMinor })),
    categories: group(lines.map((l) => ({ k: l.categoryName, q: l.quantity, v: l.lineTotalMinor }))), topItems: group(lines.map((l) => ({ k: l.name, q: l.quantity, v: l.lineTotalMinor }))).slice(0, 10),
    expensesByCategory: [...em].map(([name, amountMinor]) => ({ name, amountMinor })), series: series.length > 62 ? series.slice(-62) : series,
  };
}
r('GET', '/reports/summary', (_m, _b, q) => { need('reports.view'); const f = q.get('from') ?? today(); const t = q.get('to') ?? today(); if (f > t) bad('"From" must be before "to"'); return { report: report(f, t) }; });
r('GET', '/reports/export', () => bad('Downloading PDF, Excel and CSV works in the full app installed at the café. The online demo cannot create files.'));
r('POST', '/sync/orders', () => bad('Offline sync is not available in the online demo.'));

export function demoDashboardExtras(period: string, canMoney: boolean) {
  const t = today();
  const from = period === 'month' ? `${t.slice(0, 8)}01` : period === 'week' ? addDays(t, -((new Date(`${t}T00:00:00Z`).getUTCDay() + 6) % 7)) : t;
  const pending = (st: string) => S.orders.filter((o) => o.status === 'OPEN' || o.status === 'COMPLETED').flatMap((o) => o.lines).filter((l) => l.station === st && ['PENDING', 'PREPARING', 'READY'].includes(l.prepStatus)).length;
  return {
    period, periodFrom: from, periodTo: t, report: canMoney ? report(from, t) : null,
    kitchenPending: pending('KITCHEN'), baristaPending: pending('BARISTA'),
    openOrders: S.orders.filter((o) => o.status === 'OPEN').length, heldOrders: S.orders.filter((o) => o.status === 'HELD').length, needsReview: 0,
    printers: printerList().map((p) => ({ role: p.role, name: p.name, status: p.status, pendingJobs: p.pendingJobs, failedJobs: 0 })),
  };
}


// customers
const custStats = (c: CustomerDTO): CustomerDTO => {
  const os = S.orders.filter((o) => o.customerId === c.id && o.status === 'COMPLETED');
  return { ...c, visits: os.length, spentMinor: os.reduce((a, o) => a + o.totalMinor - o.refundedMinor, 0), lastVisitAt: os.map((o) => o.createdAt).sort().at(-1) ?? null };
};
r('GET', '/customers', (_m, _b, q) => {
  need('pos.use'); const term = (q.get('q') ?? '').toLowerCase(); const digits = term.replace(/\D/g, '');
  return { customers: S.customers.filter((c) => (q.get('includeInactive') === 'true' || c.isActive) && (!term || c.name.toLowerCase().includes(term) || (digits.length >= 3 && normalizePhone(c.phone).includes(normalizePhone(digits).replace(/^0/, '')))))
    .sort((a, b) => a.name.localeCompare(b.name)).map(custStats) };
});
r('GET', '/customers/:id', (m) => {
  need('customers.manage'); const c = S.customers.find((x) => x.id === m[1]) ?? notFound('Customer not found');
  const d: CustomerDetailDTO = { ...custStats(c), recentOrders: S.orders.filter((o) => o.customerId === c.id && o.status !== 'HELD').slice(-15).reverse().map((o) => ({ id: o.id, orderNo: o.orderNo, businessDate: o.businessDate, totalMinor: o.totalMinor, status: o.status, items: o.lines.map((l) => `${l.quantity}× ${l.name}`).join(', ') })) };
  return { customer: d };
});
r('POST', '/customers', (_m, b) => {
  need('customers.manage'); const d = parse(customerCreateSchema, b);
  const ex = S.customers.find((c) => normalizePhone(c.phone) === normalizePhone(d.phone)); if (ex) conflict(`${ex.name} already has this phone number`);
  const c: CustomerDTO = { id: uid(), name: clean(d.name), phone: d.phone.trim(), notes: d.notes ?? '', isActive: true, visits: 0, spentMinor: 0, lastVisitAt: null, version: 0, createdAt: now() };
  S.customers.push(c); audit('customer.create', 'Customer', c.id, null, { name: c.name }); return [201, { customer: c }];
});
r('PATCH', '/customers/:id', (m, b) => {
  need('customers.manage'); const { version, ...ch } = parse(customerUpdateSchema, b); const c = S.customers.find((x) => x.id === m[1]) ?? notFound('Customer not found');
  if (c.version !== version) stale(c);
  if (ch.phone && S.customers.some((x) => x.id !== c.id && normalizePhone(x.phone) === normalizePhone(ch.phone!))) conflict('Another customer already has this phone number');
  Object.assign(c, ch.name ? { name: clean(ch.name) } : {}, ch.phone ? { phone: ch.phone.trim() } : {}, ch.notes !== undefined ? { notes: ch.notes } : {}, ch.isActive !== undefined ? { isActive: ch.isActive } : {}, { version: c.version + 1 });
  return { customer: custStats(c) };
});
r('DELETE', '/customers/:id', (m) => {
  need('orders.cancel'); const c = S.customers.find((x) => x.id === m[1]) ?? notFound('Customer not found');
  if (S.orders.some((o) => o.customerId === c.id)) conflict('This customer has past orders, so they cannot be deleted. Mark them inactive instead.');
  S.customers = S.customers.filter((x) => x !== c); return [204, null];
});
r('GET', '/setup/status', () => ({ needsSetup: false, tokenRequired: false }));

// ─────────── fetch interceptor ───────────
export function handleDemoRequest(method: string, url: string, body: unknown): { status: number; body: unknown } {
  const u = new URL(url, 'http://demo.local');
  const path = u.pathname.replace(/^\/api/, '');
  for (const [m, re, h] of routes) {
    if (m !== method) continue;
    const match = path.match(re);
    if (!match) continue;
    const snapshot = JSON.stringify(S);
    try {
      const out = h(match, body, u.searchParams);
      save();
      if (Array.isArray(out) && typeof out[0] === 'number') return { status: out[0], body: out[1] };
      return { status: 200, body: out };
    } catch (e) {
      S = JSON.parse(snapshot) as State; // roll back partial changes, like a database transaction
      if (e instanceof ApiErr) return { status: e.status, body: { error: { code: e.code, message: e.message, details: e.details } } };
      console.error(e);
      return { status: 500, body: { error: { code: 'INTERNAL', message: 'Something went wrong in the demo.' } } };
    }
  }
  return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not available in the online demo' } } };
}

export function installDemoApi() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('/api/') && !url.includes('/api/')) return realFetch(input, init);
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown;
    try { body = init?.body ? JSON.parse(String(init.body)) : undefined; } catch { body = undefined; }
    await new Promise((res) => setTimeout(res, 60)); // feel like a network round-trip
    const r = handleDemoRequest(method, url, body);
    return r.status === 204 ? new Response(null, { status: 204 }) : new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  };
}
