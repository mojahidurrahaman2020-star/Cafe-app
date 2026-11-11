import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app, H, PASSWORD, prisma, request, resetData, signIn } from './helpers.js';

beforeEach(resetData);
afterAll(() => prisma.$disconnect());

describe('health & database', () => {
  it('reports the database as up', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
  });
  it('all migrations are applied', async () => {
    const rows = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`
      SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY migration_name`;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.finished_at !== null)).toBe(true);
  });
});

describe('authentication', () => {
  it('owner can log in and receives an httpOnly, SameSite=Strict session cookie', async () => {
    const res = await request(app).post('/api/auth/login').set(H).send({ username: 'owner', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ username: 'owner', role: 'OWNER' });
    expect(res.body.user.permissions).toContain('settings.manage');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/bb_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);
  });

  it('usernames are case-insensitive', async () => {
    const res = await request(app).post('/api/auth/login').set(H).send({ username: 'OWNER', password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it('rejects a wrong password and an unknown user with the same message', async () => {
    const a = await request(app).post('/api/auth/login').set(H).send({ username: 'owner', password: 'wrong-password' });
    const b = await request(app).post('/api/auth/login').set(H).send({ username: 'nobody', password: 'wrong-password' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('stores passwords as argon2id hashes, never plain text', async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { username: 'owner' } });
    expect(u.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(u.passwordHash).not.toContain(PASSWORD);
  });

  it('stores only a hash of the session token', async () => {
    const res = await request(app).post('/api/auth/login').set(H).send({ username: 'owner', password: PASSWORD });
    const token = String(res.headers['set-cookie']).match(/bb_session=([^;]+)/)![1]!;
    const sessions = await prisma.session.findMany();
    expect(sessions.some((s) => s.tokenHash === token)).toBe(false);
    expect(sessions[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('locks the account after 5 failed attempts', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login').set(H).send({ username: 'cashier', password: 'nope-nope-nope' });
    }
    const res = await request(app).post('/api/auth/login').set(H).send({ username: 'cashier', password: PASSWORD });
    expect(res.status).toBe(423);
    expect(await prisma.auditLog.count({ where: { action: 'auth.lockout' } })).toBe(1);
  });

  it('deactivated users cannot log in', async () => {
    await prisma.user.update({ where: { username: 'barista' }, data: { isActive: false } });
    const res = await request(app).post('/api/auth/login').set(H).send({ username: 'barista', password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it('/me requires a session; logout revokes it server-side', async () => {
    expect((await request(app).get('/api/auth/me')).body.user).toBeNull();
    expect((await request(app).get('/api/categories')).status).toBe(401);
    const agent = await signIn('owner');
    expect((await agent.get('/api/auth/me')).body.user.username).toBe('owner');
    expect((await agent.post('/api/auth/logout').set(H)).status).toBe(200);
    expect((await agent.get('/api/auth/me')).body.user).toBeNull();
    expect((await agent.get('/api/settings')).status).toBe(401);
    expect(await prisma.session.count({ where: { revokedAt: null } })).toBe(0);
  });

  it('blocks state-changing requests without the client header (CSRF defence)', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'owner', password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF');
  });

  it('changing password signs out other devices', async () => {
    const tablet = await signIn('manager');
    const desktop = await signIn('manager');
    const res = await desktop
      .post('/api/auth/change-password')
      .set(H)
      .send({ currentPassword: PASSWORD, newPassword: 'a-brand-new-password' });
    expect(res.status).toBe(200);
    expect((await desktop.get('/api/auth/me')).body.user.username).toBe('manager');
    expect((await tablet.get('/api/auth/me')).body.user).toBeNull();
    await signIn('manager', 'a-brand-new-password');
  });
});

describe('role-based access control', () => {
  const cases: [string, string, string, number][] = [
    // [role, method, path, expected status]
    ['owner', 'get', '/api/dashboard/summary', 200],
    ['manager', 'get', '/api/dashboard/summary', 200],
    ['cashier', 'get', '/api/dashboard/summary', 403],
    ['barista', 'get', '/api/dashboard/summary', 403],
    ['kitchen', 'get', '/api/dashboard/summary', 403],
    ['cashier', 'get', '/api/categories', 200],
    ['kitchen', 'get', '/api/settings', 200],
    ['cashier', 'get', '/api/users', 403],
    ['manager', 'get', '/api/users', 200],
    ['barista', 'get', '/api/audit', 403],
    ['manager', 'get', '/api/audit', 200],
  ];
  it.each(cases)('%s %s %s → %i', async (role, method, path, status) => {
    const agent = await signIn(role);
    const res = await (agent as unknown as Record<string, (p: string) => Promise<{ status: number }>>)[method]!(path);
    expect(res.status).toBe(status);
  });

  it('only the owner may change business settings', async () => {
    for (const role of ['manager', 'cashier', 'barista', 'kitchen']) {
      const agent = await signIn(role);
      const res = await agent.patch('/api/settings').set(H).send({ tagline: 'x', version: 0 });
      expect(res.status, role).toBe(403);
    }
  });

  it('cashier, barista and kitchen cannot manage menu categories', async () => {
    for (const role of ['cashier', 'barista', 'kitchen']) {
      const agent = await signIn(role);
      const res = await agent.post('/api/categories').set(H).send({ name: 'Hack', group: 'FOOD', station: 'KITCHEN' });
      expect(res.status, role).toBe(403);
    }
  });

  it('a manager can create cashiers but not managers or owners', async () => {
    const m = await signIn('manager');
    const ok = await m.post('/api/users').set(H).send({ username: 'rahim', fullName: 'Rahim', role: 'CASHIER', password: 'long-enough-pw' });
    expect(ok.status).toBe(201);
    const no1 = await m.post('/api/users').set(H).send({ username: 'boss2', fullName: 'X', role: 'OWNER', password: 'long-enough-pw' });
    const no2 = await m.post('/api/users').set(H).send({ username: 'mgr2', fullName: 'X', role: 'MANAGER', password: 'long-enough-pw' });
    expect(no1.status).toBe(403);
    expect(no2.status).toBe(403);
  });

  it('the last active owner cannot be demoted or deactivated', async () => {
    const o = await signIn('owner');
    await prisma.user.create({ data: { username: 'owner2', fullName: 'Owner Two', role: 'OWNER', passwordHash: 'x' } });
    const owner2 = await prisma.user.findUniqueOrThrow({ where: { username: 'owner2' } });
    expect((await o.patch(`/api/users/${owner2.id}`).set(H).send({ isActive: false, version: 0 })).status).toBe(200);
    const me = await prisma.user.findUniqueOrThrow({ where: { username: 'owner' } });
    const res = await o.patch(`/api/users/${me.id}`).set(H).send({ isActive: false, version: me.version });
    expect(res.status).toBe(400);
  });

  it('a role change immediately revokes that user’s sessions', async () => {
    const cashier = await signIn('cashier');
    const o = await signIn('owner');
    const u = await prisma.user.findUniqueOrThrow({ where: { username: 'cashier' } });
    expect((await o.patch(`/api/users/${u.id}`).set(H).send({ role: 'BARISTA', version: u.version })).status).toBe(200);
    expect((await cashier.get('/api/auth/me')).body.user).toBeNull();
  });
});

describe('menu categories', () => {
  it('lists the nine starting categories grouped Food → Drinks → Desserts', async () => {
    const agent = await signIn('cashier');
    const res = await agent.get('/api/categories');
    expect(res.status).toBe(200);
    expect(res.body.categories.map((c: { name: string }) => c.name)).toEqual([
      'Tehari', 'Biriyani', 'Khichuri', 'Burgers', 'Wraps', 'Coffee', 'Tea', 'Beverages', 'Desserts & Sweets',
    ]);
    const coffee = res.body.categories.find((c: { name: string }) => c.name === 'Coffee');
    expect(coffee).toMatchObject({ group: 'DRINKS', station: 'BARISTA' });
  });

  it('create → edit → delete, each audited', async () => {
    const agent = await signIn('owner');
    const created = await agent.post('/api/categories').set(H).send({ name: '  Fresh   Juice ', group: 'DRINKS', station: 'BARISTA' });
    expect(created.status).toBe(201);
    expect(created.body.category).toMatchObject({ name: 'Fresh Juice', version: 0, isActive: true });
    const id = created.body.category.id;

    const edited = await agent.patch(`/api/categories/${id}`).set(H).send({ name: 'Fresh Juices', description: 'Seasonal', version: 0 });
    expect(edited.status).toBe(200);
    expect(edited.body.category).toMatchObject({ name: 'Fresh Juices', description: 'Seasonal', version: 1 });

    const deactivated = await agent.patch(`/api/categories/${id}`).set(H).send({ isActive: false, version: 1 });
    expect(deactivated.body.category.isActive).toBe(false);
    const visible = await agent.get('/api/categories');
    expect(visible.body.categories.some((c: { id: string }) => c.id === id)).toBe(false);
    const all = await agent.get('/api/categories?includeInactive=true');
    expect(all.body.categories.some((c: { id: string }) => c.id === id)).toBe(true);

    expect((await agent.delete(`/api/categories/${id}?version=2`).set(H)).status).toBe(204);
    expect(await prisma.menuCategory.findUnique({ where: { id } })).toBeNull();

    const actions = (await prisma.auditLog.findMany({ where: { entityId: id }, orderBy: { id: 'asc' } })).map((a) => a.action);
    expect(actions).toEqual(['category.create', 'category.update', 'category.update', 'category.delete']);
  });

  it('rejects duplicate names case-insensitively', async () => {
    const agent = await signIn('manager');
    const res = await agent.post('/api/categories').set(H).send({ name: 'coffee', group: 'DRINKS', station: 'BARISTA' });
    expect(res.status).toBe(409);
  });

  it('validates input', async () => {
    const agent = await signIn('owner');
    const res = await agent.post('/api/categories').set(H).send({ name: '', group: 'SNACKS', station: 'KITCHEN' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['name', 'group']));
  });

  it('two staff editing the same category: the second save gets 409 instead of overwriting', async () => {
    const a = await signIn('owner');
    const b = await signIn('manager');
    const tea = await prisma.menuCategory.findUniqueOrThrow({ where: { normalizedName: 'tea' } });
    const first = await a.patch(`/api/categories/${tea.id}`).set(H).send({ name: 'Tea & Chai', version: tea.version });
    const second = await b.patch(`/api/categories/${tea.id}`).set(H).send({ name: 'Teas', version: tea.version });
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('STALE_VERSION');
    expect((await prisma.menuCategory.findUniqueOrThrow({ where: { id: tea.id } })).name).toBe('Tea & Chai');
  });

  it('concurrent creates of the same name produce exactly one category', async () => {
    const a = await signIn('owner');
    const b = await signIn('manager');
    const body = { name: 'Smoothies', group: 'DRINKS', station: 'BARISTA' };
    const [r1, r2] = await Promise.all([a.post('/api/categories').set(H).send(body), b.post('/api/categories').set(H).send(body)]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expect(await prisma.menuCategory.count({ where: { normalizedName: 'smoothies' } })).toBe(1);
  });
});

describe('business settings', () => {
  it('defaults to Bite & Brew, BDT ৳ and Asia/Dhaka', async () => {
    const agent = await signIn('kitchen');
    const { settings } = (await agent.get('/api/settings')).body;
    expect(settings).toMatchObject({
      businessName: 'Bite & Brew',
      tagline: 'Café & Hangout',
      establishedYear: 2027,
      currencyCode: 'BDT',
      currencySymbol: '৳',
      currencyDecimals: 2,
      timezone: 'Asia/Dhaka',
      dineInEnabled: true,
      takeawayEnabled: true,
    });
  });

  it('owner updates persist (new request, new session) and are audited', async () => {
    const o = await signIn('owner');
    const res = await o.patch('/api/settings').set(H).send({ address: 'House 12, Road 5, Dhanmondi, Dhaka', phone: '+880 1700-000000', version: 0 });
    expect(res.status).toBe(200);
    expect(res.body.settings.version).toBe(1);
    const fresh = await signIn('cashier');
    expect((await fresh.get('/api/settings')).body.settings.address).toBe('House 12, Road 5, Dhanmondi, Dhaka');
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'settings.update' } });
    expect((log.before as { address: string }).address).toBe('');
    expect((log.after as { address: string }).address).toBe('House 12, Road 5, Dhanmondi, Dhaka');
  });

  it('rejects an invalid timezone or currency code', async () => {
    const o = await signIn('owner');
    expect((await o.patch('/api/settings').set(H).send({ timezone: 'Asia/Atlantis', version: 0 })).status).toBe(400);
    expect((await o.patch('/api/settings').set(H).send({ currencyCode: 'taka', version: 0 })).status).toBe(400);
  });

  it('refuses to disable both dine-in and takeaway', async () => {
    const o = await signIn('owner');
    const res = await o.patch('/api/settings').set(H).send({ dineInEnabled: false, takeawayEnabled: false, version: 0 });
    expect(res.status).toBe(400);
  });

  it('stale settings saves are rejected', async () => {
    const o = await signIn('owner');
    expect((await o.patch('/api/settings').set(H).send({ tagline: 'One', version: 0 })).status).toBe(200);
    expect((await o.patch('/api/settings').set(H).send({ tagline: 'Two', version: 0 })).status).toBe(409);
  });
});

describe('audit log & database guards', () => {
  it('audit rows cannot be updated or deleted (DB trigger)', async () => {
    const o = await signIn('owner');
    await o.patch('/api/settings').set(H).send({ tagline: 'Audit me', version: 0 });
    await expect(prisma.$executeRawUnsafe(`UPDATE audit_logs SET action = 'tampered'`)).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe('DELETE FROM audit_logs')).rejects.toThrow(/append-only/);
  });

  it('settings table enforces a single row', async () => {
    await expect(prisma.$executeRawUnsafe(`INSERT INTO business_settings (id, updated_at) VALUES (2, now())`)).rejects.toThrow();
  });

  it('audit log never contains password hashes', async () => {
    const o = await signIn('owner');
    await o.post('/api/users').set(H).send({ username: 'karim', fullName: 'Karim', role: 'KITCHEN', password: 'long-enough-pw' });
    const all = JSON.stringify(await prisma.auditLog.findMany(), (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    expect(all).not.toMatch(/argon2|long-enough-pw/);
  });
});

describe('dashboard summary', () => {
  it('returns real Phase 1 figures in the configured timezone', async () => {
    const o = await signIn('owner');
    const res = await o.get('/api/dashboard/summary');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      timezone: 'Asia/Dhaka',
      utcOffset: '+06:00',
      database: { ok: true },
      categories: { byGroup: { FOOD: 5, DRINKS: 3, DESSERTS: 1 }, inactive: 0 },
    });
    expect(res.body.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
