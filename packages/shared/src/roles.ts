/**
 * Staff roles and the permission matrix.
 *
 * This file is the single source of truth for authorisation. The server
 * enforces it on every request; the web client only uses it to hide controls
 * a user cannot use (hiding is a convenience, never a security boundary).
 */

export const ROLES = ['OWNER', 'MANAGER', 'CASHIER', 'BARISTA', 'KITCHEN'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Owner',
  MANAGER: 'Manager',
  CASHIER: 'Cashier',
  BARISTA: 'Barista',
  KITCHEN: 'Kitchen staff',
};

/** Higher rank may manage accounts of strictly lower rank. */
export const ROLE_RANK: Record<Role, number> = {
  OWNER: 100,
  MANAGER: 50,
  CASHIER: 10,
  BARISTA: 10,
  KITCHEN: 10,
};

export const PERMISSIONS = [
  // Phase 1
  'dashboard.view',
  'settings.view',
  'settings.manage',
  'menu.view',
  'menu.manage',
  'users.view',
  'users.manage',
  'audit.view',
  // Planned (Phase 2+) — declared now so the matrix is reviewable end to end
  'pos.use',
  'orders.view',
  'orders.discount',
  'orders.cancel',
  'orders.refund',
  'orders.reprint',
  'cash.reconcile',
  'kitchen.view',
  'barista.view',
  'inventory.view',
  'inventory.adjust',
  'production.manage',
  'purchases.manage',
  'expenses.manage',
  'reports.view',
  'reports.export',
  'printers.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: ALL,
  MANAGER: [
    'dashboard.view',
    'settings.view',
    'menu.view',
    'menu.manage',
    'users.view',
    'users.manage',
    'audit.view',
    'pos.use',
    'orders.view',
    'orders.discount',
    'orders.cancel',
    'orders.refund',
    'orders.reprint',
    'cash.reconcile',
    'kitchen.view',
    'barista.view',
    'inventory.view',
    'inventory.adjust',
    'production.manage',
    'purchases.manage',
    'expenses.manage',
    'reports.view',
    'reports.export',
    'printers.manage',
  ],
  CASHIER: ['menu.view', 'settings.view', 'pos.use', 'orders.view', 'orders.reprint'],
  BARISTA: ['menu.view', 'settings.view', 'barista.view', 'orders.view', 'inventory.view'],
  KITCHEN: [
    'menu.view',
    'settings.view',
    'kitchen.view',
    'orders.view',
    'inventory.view',
    'production.manage',
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

/** An actor may create/edit/deactivate an account only if they outrank the
 *  target role. The owner is the exception: an owner may manage other owners. */
export function canManageRole(actor: Role, target: Role): boolean {
  if (actor === 'OWNER') return true;
  return ROLE_RANK[actor] > ROLE_RANK[target];
}

/** The landing page each role sees after login. */
export const ROLE_HOME: Record<Role, string> = {
  OWNER: '/dashboard',
  MANAGER: '/dashboard',
  CASHIER: '/pos',
  BARISTA: '/barista',
  KITCHEN: '/kitchen',
};
