import { z } from 'zod';
import { ROLES } from './roles.js';
import { isValidTimeZone } from './time.js';

export const MENU_GROUPS = ['FOOD', 'DRINKS', 'DESSERTS'] as const;
export type MenuGroup = (typeof MENU_GROUPS)[number];
export const MENU_GROUP_LABELS: Record<MenuGroup, string> = {
  FOOD: 'Food',
  DRINKS: 'Drinks',
  DESSERTS: 'Desserts',
};

/** Where tickets for items in this category print by default. */
export const PREP_STATIONS = ['KITCHEN', 'BARISTA'] as const;
export type PrepStation = (typeof PREP_STATIONS)[number];
export const PREP_STATION_LABELS: Record<PrepStation, string> = {
  KITCHEN: 'Kitchen (food printer)',
  BARISTA: 'Barista (drinks printer)',
};

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);

export const loginSchema = z.object({
  username: trimmed(1, 50).toLowerCase(),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const PASSWORD_MIN_LENGTH = 10;
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(200);

export const usernameSchema = trimmed(3, 50)
  .toLowerCase()
  .regex(/^[a-z0-9._-]+$/, 'Use letters, numbers, dot, dash or underscore only');

export const createUserSchema = z.object({
  username: usernameSchema,
  fullName: trimmed(1, 100),
  role: z.enum(ROLES),
  password: passwordSchema,
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  fullName: trimmed(1, 100).optional(),
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
  password: passwordSchema.optional(),
  version: z.number().int().nonnegative(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export const categoryCreateSchema = z.object({
  name: trimmed(1, 60),
  group: z.enum(MENU_GROUPS),
  station: z.enum(PREP_STATIONS),
  description: z.string().trim().max(300).optional().nullable(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
});
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;

export const categoryUpdateSchema = categoryCreateSchema.partial().extend({
  version: z.number().int().nonnegative(),
});
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;

export const settingsUpdateSchema = z.object({
  businessName: trimmed(1, 100).optional(),
  tagline: z.string().trim().max(100).optional(),
  establishedYear: z.number().int().min(1900).max(2200).optional(),
  address: z.string().trim().max(300).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.union([z.literal(''), z.string().trim().email().max(120)]).optional(),
  currencyCode: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO 4217 code')
    .optional(),
  currencySymbol: trimmed(1, 5).optional(),
  currencyDecimals: z.number().int().min(0).max(3).optional(),
  numberGrouping: z.enum(['LAKH', 'INTERNATIONAL']).optional(),
  timezone: z
    .string()
    .trim()
    .refine(isValidTimeZone, 'Unknown IANA timezone')
    .optional(),
  businessDayStartHour: z.number().int().min(0).max(23).optional(),
  dineInEnabled: z.boolean().optional(),
  takeawayEnabled: z.boolean().optional(),
  receiptFooter: z.string().trim().max(300).optional(),
  tableCount: z.number().int().min(0).max(500).optional(),
  taxRegistration: z.string().trim().max(100).optional(),
  version: z.number().int().nonnegative(),
});
export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;
