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
  adjustStockSchema, recipeSchema, round3, settingsUpdateSchema, supplierCreateSchema, supplierUpdateSchema, toBase, updateUserSchema,
  utcOffset, MENU_GROUPS,
  type BusinessSettingsDTO, type CategoryAvailabilityDTO, type Dimension, type IngredientDTO, type MenuCategoryDTO, type Permission,
  type ProductDTO, type ProductionBatchDTO, type Role, type SessionUser, type StockMode, type StockMovementDTO, type StockSummaryDTO,
  type SupplierDTO, type UnitCode, type UserDTO, type PrepStation,
} from '@bitebrew/shared';
import type { z } from 'zod';
import fixture from './fixture.json';

export const DEMO_PASSWORD = 'demo-pass-2027';
const KEY = 'bitebrew-online-demo-v1';

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
const uid = () => (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`);
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

r('GET', '/dashboard/summary', () => {
  const u = need('dashboard.view'); const t = new Date();
  const byGroup: Record<string, number> = {}; for (const c of S.categories.filter((c) => c.isActive)) byGroup[c.group] = (byGroup[c.group] ?? 0) + 1;
  const byRole: Record<string, number> = {}; for (const x of S.users.filter((x) => x.isActive)) byRole[x.role] = (byRole[x.role] ?? 0) + 1;
  return {
    businessDate: businessDate(t, S.settings.timezone, S.settings.businessDayStartHour), timezone: S.settings.timezone, utcOffset: utcOffset(S.settings.timezone, t),
    serverTime: t.toISOString(), database: { ok: true, latencyMs: 1 }, realtimeClients: 1, staffSignedIn: 1,
    categories: { byGroup, inactive: S.categories.filter((c) => !c.isActive).length }, activeUsersByRole: byRole, stock: stockSummary(showCost(u)),
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
