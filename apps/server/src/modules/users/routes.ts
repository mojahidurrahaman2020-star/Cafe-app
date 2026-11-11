import { Router } from 'express';
import type { UserDTO } from '@bitebrew/shared';
import { canManageRole, createUserSchema, updateUserSchema } from '@bitebrew/shared';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, notFound, staleVersion } from '../../lib/errors.js';
import { hashPassword } from '../../lib/password.js';
import { prisma } from '../../lib/prisma.js';
import { parseBody } from '../../lib/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { broadcast } from '../../realtime/hub.js';
import { revokeUserSessions } from '../auth/session.js';

type Row = Awaited<ReturnType<typeof prisma.user.findUniqueOrThrow>>;

export function toUserDTO(u: Row): UserDTO {
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    role: u.role,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    version: u.version,
    createdAt: u.createdAt.toISOString(),
  };
}

export const usersRouter = Router();

usersRouter.get('/', requirePermission('users.view'), async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: [{ isActive: 'desc' }, { role: 'asc' }, { fullName: 'asc' }] });
  res.json({ users: users.map(toUserDTO) });
});

usersRouter.post('/', requirePermission('users.manage'), async (req, res) => {
  const input = parseBody(createUserSchema, req.body);
  if (!canManageRole(req.user!.role, input.role)) throw forbidden('You cannot create an account with this role');
  if (await prisma.user.findUnique({ where: { username: input.username } })) {
    throw conflict('That username is already taken');
  }
  const passwordHash = await hashPassword(input.password);
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: { username: input.username, fullName: input.fullName, role: input.role, passwordHash },
    });
    await audit(req, { action: 'user.create', entityType: 'User', entityId: u.id, after: toUserDTO(u) }, tx);
    return u;
  });
  broadcast({ type: 'users.changed' });
  res.status(201).json({ user: toUserDTO(user) });
});

usersRouter.patch('/:id', requirePermission('users.manage'), async (req, res) => {
  const { version, password, ...changes } = parseBody(updateUserSchema, req.body);
  const id = String(req.params.id);
  const actor = req.user!;
  const passwordHash = password ? await hashPassword(password) : undefined;

  const updated = await prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id } });
    if (!before) throw notFound('User not found');
    const isSelf = before.id === actor.id;
    if (!isSelf && !canManageRole(actor.role, before.role)) throw forbidden('You cannot manage this account');
    if (changes.role && !canManageRole(actor.role, changes.role)) throw forbidden('You cannot assign this role');
    if (isSelf && (changes.role !== undefined && changes.role !== before.role)) throw badRequest('You cannot change your own role');
    if (isSelf && changes.isActive === false) throw badRequest('You cannot deactivate your own account');

    // Never allow the café to end up without an active owner.
    const losingOwner =
      before.role === 'OWNER' && before.isActive &&
      ((changes.role && changes.role !== 'OWNER') || changes.isActive === false);
    if (losingOwner) {
      const owners = await tx.user.count({ where: { role: 'OWNER', isActive: true } });
      if (owners <= 1) throw badRequest('There must always be at least one active owner account');
    }

    const result = await tx.user.updateMany({
      where: { id, version },
      data: {
        ...changes,
        ...(passwordHash ? { passwordHash, failedLoginCount: 0, lockedUntil: null } : {}),
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw staleVersion(toUserDTO(before));
    const after = await tx.user.findUniqueOrThrow({ where: { id } });
    await audit(
      req,
      {
        action: passwordHash ? 'user.update_with_password_reset' : 'user.update',
        entityType: 'User',
        entityId: id,
        before: toUserDTO(before),
        after: toUserDTO(after),
      },
      tx,
    );
    return { before, after };
  });

  // Role change, deactivation or password reset ends that person's other sessions.
  const { before, after } = updated;
  if (passwordHash || before.role !== after.role || (before.isActive && !after.isActive)) {
    await revokeUserSessions(id, id === actor.id ? req.sessionId : undefined);
  }
  broadcast({ type: 'users.changed' });
  res.json({ user: toUserDTO(after) });
});
