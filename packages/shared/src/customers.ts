import { z } from 'zod';

/**
 * Normalise a phone number for comparison: digits only; Bangladesh country code
 * (+880 / 880 / 00880) becomes the local leading 0. "+88 01712-345678" → "01712345678".
 */
export function normalizePhone(input: string): string {
  let d = input.replace(/\D/g, '');
  if (d.startsWith('00880')) d = d.slice(4);
  if (d.startsWith('880') && d.length >= 12) d = d.slice(2);
  if (/^1[3-9]\d{8}$/.test(d)) d = `0${d}`; // typed without the leading 0
  return d;
}

export const isValidPhone = (input: string) => /^[0-9]{6,15}$/.test(normalizePhone(input));

/** Display form: 01712345678 → 01712-345678 (Bangladeshi mobile), otherwise as typed. */
export function formatPhone(phone: string): string {
  const n = normalizePhone(phone);
  return /^01[3-9]\d{8}$/.test(n) ? `${n.slice(0, 5)}-${n.slice(5)}` : phone;
}

const phone = z
  .string()
  .trim()
  .min(1, 'Enter a phone number')
  .max(20)
  .refine(isValidPhone, 'Enter a valid phone number (e.g. 01712-345678)');

export const customerCreateSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(80),
  phone,
  notes: z.string().trim().max(300).optional(),
});
export const customerUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  phone: phone.optional(),
  notes: z.string().trim().max(300).optional(),
  isActive: z.boolean().optional(),
  version: z.number().int().nonnegative(),
});

export interface CustomerDTO {
  id: string;
  name: string;
  phone: string;
  notes: string;
  isActive: boolean;
  /** Completed orders. */
  visits: number;
  /** Total spent on completed orders, paisa. */
  spentMinor: number;
  lastVisitAt: string | null;
  version: number;
  createdAt: string;
}

export interface CustomerDetailDTO extends CustomerDTO {
  recentOrders: { id: string; orderNo: number; businessDate: string; totalMinor: number; status: string; items: string }[];
}
