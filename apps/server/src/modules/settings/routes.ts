import { Router } from 'express';
import { settingsUpdateSchema } from '@bitebrew/shared';
import { audit } from '../../lib/audit.js';
import { badRequest, staleVersion } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { parseBody } from '../../lib/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { broadcast } from '../../realtime/hub.js';
import { getSettings, toSettingsDTO } from './service.js';

export const settingsRouter = Router();

settingsRouter.get('/', requirePermission('settings.view'), async (_req, res) => {
  res.json({ settings: toSettingsDTO(await getSettings()) });
});

settingsRouter.patch('/', requirePermission('settings.manage'), async (req, res) => {
  const { version, ...changes } = parseBody(settingsUpdateSchema, req.body);

  const updated = await prisma.$transaction(async (tx) => {
    const before = await getSettings(tx);
    const merged = { ...before, ...changes };
    if (!merged.dineInEnabled && !merged.takeawayEnabled) {
      throw badRequest('At least one service type (dine-in or takeaway) must stay enabled');
    }
    // Optimistic concurrency: only update if nobody else saved in the meantime.
    const result = await tx.businessSettings.updateMany({
      where: { id: 1, version },
      data: { ...changes, version: { increment: 1 }, updatedById: req.user!.id },
    });
    if (result.count === 0) throw staleVersion(toSettingsDTO(before));
    const after = await tx.businessSettings.findUniqueOrThrow({ where: { id: 1 } });
    await audit(req, { action: 'settings.update', entityType: 'BusinessSettings', entityId: '1', before: toSettingsDTO(before), after: toSettingsDTO(after) }, tx);
    return after;
  });

  broadcast({ type: 'settings.changed', version: updated.version });
  res.json({ settings: toSettingsDTO(updated) });
});
