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

export async function seedBase() {
  await getSettings();
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
