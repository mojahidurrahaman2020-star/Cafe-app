import type { Permission, Role } from './roles.js';
import type { MenuGroup, PrepStation } from './schemas.js';
import type { NumberGrouping } from './money.js';

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  permissions: Permission[];
}

export interface BusinessSettingsDTO {
  businessName: string;
  tagline: string;
  establishedYear: number;
  address: string;
  phone: string;
  email: string;
  currencyCode: string;
  currencySymbol: string;
  currencyDecimals: number;
  numberGrouping: NumberGrouping;
  timezone: string;
  businessDayStartHour: number;
  dineInEnabled: boolean;
  takeawayEnabled: boolean;
  receiptFooter: string;
  version: number;
  updatedAt: string;
}

export interface MenuCategoryDTO {
  id: string;
  name: string;
  group: MenuGroup;
  station: PrepStation;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserDTO {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  version: number;
  createdAt: string;
}

export interface AuditLogDTO {
  id: string;
  occurredAt: string;
  actor: { id: string; username: string; fullName: string } | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
}

export interface AppInfoDTO {
  appEnv: 'development' | 'demo' | 'test' | 'production';
  version: string;
  serverTime: string;
}

export type RealtimeEvent =
  | { type: 'hello'; serverTime: string }
  | { type: 'settings.changed'; version: number }
  | { type: 'categories.changed' }
  | { type: 'users.changed' }
  | { type: 'products.changed' }
  | { type: 'inventory.changed' };

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
