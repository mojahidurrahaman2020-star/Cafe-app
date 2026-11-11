/**
 * Base seed — safe for every environment, including production.
 * Creates the business settings singleton and the café's agreed starting menu
 * categories (these are business requirements, not sample data). Idempotent:
 * existing rows are never modified, so re-running it cannot undo owner edits.
 */
import type { MenuGroup, PrepStation } from '@bitebrew/shared';
import { prisma } from '../lib/prisma.js';
import { normalizeName } from '../modules/categories/routes.js';
import { getSettings } from '../modules/settings/service.js';

export const STARTING_CATEGORIES: { name: string; group: MenuGroup; station: PrepStation }[] = [
  { name: 'Tehari', group: 'FOOD', station: 'KITCHEN' },
  { name: 'Biriyani', group: 'FOOD', station: 'KITCHEN' },
  { name: 'Khichuri', group: 'FOOD', station: 'KITCHEN' },
  { name: 'Burgers', group: 'FOOD', station: 'KITCHEN' },
  { name: 'Wraps', group: 'FOOD', station: 'KITCHEN' },
  { name: 'Coffee', group: 'DRINKS', station: 'BARISTA' },
  { name: 'Tea', group: 'DRINKS', station: 'BARISTA' },
  { name: 'Beverages', group: 'DRINKS', station: 'BARISTA' },
  { name: 'Desserts & Sweets', group: 'DESSERTS', station: 'KITCHEN' },
];

export const DEFAULT_PAYMENT_METHODS = [
  { name: 'Cash', kind: 'CASH', requiresReference: false },
  { name: 'Card', kind: 'CARD', requiresReference: false },
  { name: 'bKash', kind: 'MOBILE', requiresReference: true },
  { name: 'Nagad', kind: 'MOBILE', requiresReference: true },
] as const;

export const DEFAULT_EXPENSE_CATEGORIES = ['Rent', 'Electricity', 'Water', 'Internet', 'Salaries', 'Repairs', 'Transportation', 'Cleaning', 'Marketing', 'Other expenses'];

export async function seedBase() {
  await getSettings();
  if ((await prisma.paymentMethod.count()) === 0) {
    for (const [i, m] of DEFAULT_PAYMENT_METHODS.entries()) {
      await prisma.paymentMethod.create({ data: { ...m, normalizedName: normalizeName(m.name), sortOrder: i * 10 } });
    }
  }
  if ((await prisma.expenseCategory.count()) === 0) {
    for (const [i, name] of DEFAULT_EXPENSE_CATEGORIES.entries()) {
      await prisma.expenseCategory.create({ data: { name, normalizedName: normalizeName(name), sortOrder: i * 10 } });
    }
  }
  const printers = [
    { role: 'RECEIPT', name: 'Receipt printer', paperWidthMm: 80, openDrawer: true },
    { role: 'BARISTA', name: 'Barista printer', paperWidthMm: 80, openDrawer: false },
    { role: 'KITCHEN', name: 'Kitchen printer', paperWidthMm: 80, openDrawer: false },
  ] as const;
  for (const p of printers) {
    if (!(await prisma.printer.findUnique({ where: { role: p.role } }))) await prisma.printer.create({ data: p });
  }
  const already = await prisma.menuCategory.count();
  let created = 0;
  if (already === 0) {
    for (const [i, c] of STARTING_CATEGORIES.entries()) {
      await prisma.menuCategory.create({
        data: { ...c, normalizedName: normalizeName(c.name), sortOrder: i * 10 },
      });
      created++;
    }
  }
  return { created, skipped: already > 0 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedBase()
    .then((r) => {
      console.log(
        r.skipped
          ? 'Base seed: categories already exist — left untouched.'
          : `Base seed: created ${r.created} starting categories.`,
      );
      console.log('Business settings ready (BDT ৳, Asia/Dhaka).');
    })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
