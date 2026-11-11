import { Router } from 'express';
import type { MenuCategoryDTO } from '@bitebrew/shared';
import { categoryCreateSchema, categoryUpdateSchema, MENU_GROUPS } from '@bitebrew/shared';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound, staleVersion } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { parseBody } from '../../lib/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { broadcast } from '../../realtime/hub.js';

type Row = Awaited<ReturnType<typeof prisma.menuCategory.findUniqueOrThrow>>;

export const normalizeName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

export function toCategoryDTO(c: Row): MenuCategoryDTO {
  const { normalizedName: _n, createdAt, updatedAt, ...rest } = c;
  return { ...rest, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() };
}

const groupOrder = (g: string) => MENU_GROUPS.indexOf(g as never);

export const categoriesRouter = Router();

categoriesRouter.get('/', requirePermission('menu.view'), async (req, res) => {
  const includeInactive = req.query.includeInactive === 'true';
  const rows = await prisma.menuCategory.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  rows.sort((a, b) => groupOrder(a.group) - groupOrder(b.group) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  res.json({ categories: rows.map(toCategoryDTO) });
});

categoriesRouter.post('/', requirePermission('menu.manage'), async (req, res) => {
  const input = parseBody(categoryCreateSchema, req.body);
  const name = input.name.replace(/\s+/g, ' ');
  const created = await prisma.$transaction(async (tx) => {
    const exists = await tx.menuCategory.findUnique({ where: { normalizedName: normalizeName(name) } });
    if (exists) throw conflict(`A category named "${exists.name}" already exists`);
    const sortOrder =
      input.sortOrder ??
      ((await tx.menuCategory.aggregate({ where: { group: input.group }, _max: { sortOrder: true } }))._max.sortOrder ?? -10) + 10;
    const row = await tx.menuCategory.create({
      data: {
        name,
        normalizedName: normalizeName(name),
        group: input.group,
        station: input.station,
        description: input.description || null,
        sortOrder,
        isActive: input.isActive ?? true,
      },
    });
    await audit(req, { action: 'category.create', entityType: 'MenuCategory', entityId: row.id, after: toCategoryDTO(row) }, tx);
    return row;
  });
  broadcast({ type: 'categories.changed' });
  res.status(201).json({ category: toCategoryDTO(created) });
});

categoriesRouter.patch('/:id', requirePermission('menu.manage'), async (req, res) => {
  const { version, ...changes } = parseBody(categoryUpdateSchema, req.body);
  const id = String(req.params.id);
  const updated = await prisma.$transaction(async (tx) => {
    const before = await tx.menuCategory.findUnique({ where: { id } });
    if (!before) throw notFound('Category not found');
    const data: Record<string, unknown> = { ...changes };
    if (changes.name !== undefined) {
      const name = changes.name.replace(/\s+/g, ' ');
      const clash = await tx.menuCategory.findUnique({ where: { normalizedName: normalizeName(name) } });
      if (clash && clash.id !== id) throw conflict(`A category named "${clash.name}" already exists`);
      data.name = name;
      data.normalizedName = normalizeName(name);
    }
    if (changes.description !== undefined) data.description = changes.description || null;
    const result = await tx.menuCategory.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
    if (result.count === 0) throw staleVersion(toCategoryDTO(before));
    const after = await tx.menuCategory.findUniqueOrThrow({ where: { id } });
    await audit(req, { action: 'category.update', entityType: 'MenuCategory', entityId: id, before: toCategoryDTO(before), after: toCategoryDTO(after) }, tx);
    return after;
  });
  broadcast({ type: 'categories.changed' });
  res.json({ category: toCategoryDTO(updated) });
});

categoriesRouter.delete('/:id', requirePermission('menu.manage'), async (req, res) => {
  const id = String(req.params.id);
  const version = Number(req.query.version);
  if (!Number.isInteger(version)) throw badRequest('version query parameter is required');
  await prisma.$transaction(async (tx) => {
    const before = await tx.menuCategory.findUnique({ where: { id } });
    if (!before) throw notFound('Category not found');
    if (before.version !== version) throw staleVersion(toCategoryDTO(before));
    const productCount = await tx.product.count({ where: { categoryId: id } });
    if (productCount > 0) {
      throw conflict(`"${before.name}" still has ${productCount} menu item(s). Move or delete them first, or hide the category instead.`);
    }
    await tx.menuCategory.delete({ where: { id } });
    await audit(req, { action: 'category.delete', entityType: 'MenuCategory', entityId: id, before: toCategoryDTO(before) }, tx);
  });
  broadcast({ type: 'categories.changed' });
  res.status(204).end();
});
