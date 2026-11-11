// Phase 1 browser acceptance tests.
//
// Prerequisites: the app is running (npm run dev) against a database seeded
// with the DEMO accounts (npm run db:seed:demo). Never run against production.
//
//   E2E_BASE_URL=http://localhost:5173 npm run test:e2e
//
// Uses Playwright. If it is not installed locally, the globally installed
// package is used (NODE_PATH is honoured).
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  const globalRoot = execSync('npm root -g').toString().trim();
  playwright = require(path.join(globalRoot, 'playwright'));
}
const { chromium, devices } = playwright;

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const PASSWORD = process.env.E2E_DEMO_PASSWORD ?? 'demo-pass-2027';
const SHOTS = path.resolve('e2e/screenshots');
mkdirSync(SHOTS, { recursive: true });

const results = [];
async function test(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - started, err });
    console.log(`  ✗ ${name}\n      ${String(err?.message ?? err).split('\n')[0]}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const browser = await chromium.launch();

async function newSession(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { ctx, page, errors };
}

async function login(page, username) {
  await page.goto(`${BASE}/login`);
  await page.fill('#username', username);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

async function noHorizontalOverflow(page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert(sw <= cw + 1, `page scrolls horizontally (${sw} > ${cw})`);
}

const unique = `E2E ${Date.now().toString(36)}`;

console.log(`\nPhase 1 acceptance tests against ${BASE}\n`);

await test('application starts: login page loads and health endpoint reports database up', async () => {
  const { page, ctx } = await newSession();
  const res = await page.goto(`${BASE}/api/health`);
  const body = await res.json();
  assert(body.database === 'up', `database ${body.database}`);
  await page.goto(BASE);
  await page.waitForSelector('#username');
  assert((await page.textContent('h1')).includes('Bite & Brew'), 'brand missing');
  await page.screenshot({ path: `${SHOTS}/01-login-desktop.png` });
  await ctx.close();
});

await test('wrong password is rejected with a clear message', async () => {
  const { page, ctx } = await newSession();
  await page.goto(`${BASE}/login`);
  await page.fill('#username', 'manager');
  await page.fill('#password', 'definitely-wrong');
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-testid=login-error]');
  assert(page.url().includes('/login'), 'should stay on login');
  await ctx.close();
});

// ---------------- Owner on desktop ----------------
const owner = await newSession();
await test('owner can log in and lands on the owner dashboard', async () => {
  await login(owner.page, 'owner');
  await owner.page.waitForSelector('[data-testid=dashboard]');
  assert(owner.page.url().endsWith('/dashboard'), owner.page.url());
});

await test('currency displays BDT / ৳ correctly (lakh grouping)', async () => {
  const p = owner.page;
  await p.waitForSelector('[data-testid=currency-display]');
  const cur = await p.textContent('[data-testid=currency-display]');
  assert(cur.includes('BDT') && cur.includes('৳'), `currency display: ${cur}`);
  const body = await p.textContent('[data-testid=dashboard]');
  assert(body.includes('৳1,250.50') && body.includes('৳1,25,000.00'), 'money examples not formatted as ৳ with lakh grouping');
});

await test('timezone is Asia/Dhaka (UTC+06:00) and the clock shows Dhaka time', async () => {
  const p = owner.page;
  const text = await p.textContent('[data-testid=dashboard]');
  assert(text.includes('Asia/Dhaka') && text.includes('UTC+06:00'), 'timezone not shown');
  const expectedDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
  await p.waitForFunction(() => /\d{4}-\d{2}-\d{2}/.test(document.querySelector('[data-testid=business-date]')?.textContent ?? ''));
  const bd = await p.textContent('[data-testid=business-date]');
  assert(bd.trim() === expectedDate, `business date ${bd} != ${expectedDate}`);
  await p.waitForFunction(() => document.querySelector('[data-testid=connection-status]')?.textContent?.includes('ONLINE'));
  await p.screenshot({ path: `${SHOTS}/02-dashboard-desktop.png`, fullPage: true });
});

await test('every navigation link opens a working page (no blank/404/crash)', async () => {
  const p = owner.page;
  const links = await p.$$eval('nav.nav a', (as) => as.map((a) => ({ href: a.getAttribute('href'), label: a.textContent.trim() })));
  assert(links.length === 13, `expected 13 nav links for owner, got ${links.length}`);
  for (const l of links) {
    await p.click(`nav.nav a[href="${l.href}"]`);
    await p.waitForURL((u) => u.pathname === l.href);
    await p.waitForSelector('main h1');
    assert(!(await p.$('[data-testid=not-found]')), `${l.href} shows not found`);
    assert(!(await p.$('[data-testid=forbidden]')), `${l.href} shows forbidden for owner`);
    const h1 = (await p.textContent('main h1')).trim();
    assert(h1.length > 0, `${l.href} has empty heading`);
  }
  // header controls
  await p.click('[data-testid=user-menu]');
  await p.waitForSelector('[role=menu]');
  await p.click('[role=menu] a[href="/account"]');
  await p.waitForURL((u) => u.pathname === '/account');
  const errs = owner.errors.filter((e) => !/favicon/i.test(e));
  assert(errs.length === 0, `console errors: ${errs.join(' | ')}`);
});

await test('menu categories: create, edit and delete through the UI', async () => {
  const p = owner.page;
  await p.goto(`${BASE}/menu`);
  await p.waitForSelector('[data-testid=category-table]');
  const before = await p.$$eval('[data-testid=category-row]', (r) => r.length);

  await p.click('[data-testid=category-new]');
  await p.fill('#cat-name', unique);
  await p.selectOption('#cat-group', 'DRINKS');
  assert((await p.inputValue('#cat-station')) === 'BARISTA', 'drinks should default to barista station');
  await p.fill('#cat-desc', 'Created by the acceptance test');
  await p.click('[data-testid=category-save]');
  await p.waitForSelector(`[data-testid=category-row]:has-text("${unique}")`);
  assert((await p.$$eval('[data-testid=category-row]', (r) => r.length)) === before + 1, 'row count did not increase');
  await p.screenshot({ path: `${SHOTS}/03-categories-created.png` });

  const row = p.locator('[data-testid=category-row]', { hasText: unique });
  await row.locator('[data-testid=category-edit]').click();
  await p.fill('#cat-name', `${unique} edited`);
  await p.click('[data-testid=category-save]');
  await p.waitForSelector(`[data-testid=category-row]:has-text("${unique} edited")`);

  await p.locator('[data-testid=category-row]', { hasText: `${unique} edited` }).locator('[data-testid=category-delete]').click();
  await p.click('.modal-foot .btn.danger');
  await p.waitForSelector(`[data-testid=category-row]:has-text("${unique}")`, { state: 'detached' });
  assert((await p.$$eval('[data-testid=category-row]', (r) => r.length)) === before, 'row count not restored');
});

await test('duplicate category name is refused with a message', async () => {
  const p = owner.page;
  await p.click('[data-testid=category-new]');
  await p.fill('#cat-name', 'COFFEE');
  await p.click('[data-testid=category-save]');
  await p.waitForSelector('.modal [role=alert]');
  assert((await p.textContent('.modal [role=alert]')).toLowerCase().includes('already exists'), 'no duplicate message');
  await p.keyboard.press('Escape');
});

await test('settings persist after refreshing the application', async () => {
  const p = owner.page;
  const address = `House ${Date.now() % 1000}, Road 7, Dhanmondi, Dhaka`;
  await p.goto(`${BASE}/settings`);
  await p.waitForSelector('[data-testid=settings-address]');
  const original = await p.inputValue('[data-testid=settings-address]');
  await p.fill('[data-testid=settings-address]', address);
  await p.click('[data-testid=settings-save]');
  await p.waitForSelector('.toast.success');
  await p.reload();
  await p.waitForSelector('[data-testid=settings-address]');
  assert((await p.inputValue('[data-testid=settings-address]')) === address, 'address not persisted');
  assert((await p.inputValue('[data-testid=settings-timezone]')) === 'Asia/Dhaka', 'timezone changed');
  assert((await p.inputValue('[data-testid=settings-currency-code]')) === 'BDT', 'currency changed');
  assert((await p.textContent('[data-testid=currency-preview]')) === '৳1,23,456.78', 'currency preview wrong');
  assert((await p.textContent('[data-testid=tz-preview]')).includes('UTC+06:00'), 'tz preview wrong');
  await p.screenshot({ path: `${SHOTS}/04-settings-persisted.png`, fullPage: true });
  // restore
  await p.fill('[data-testid=settings-address]', original);
  await p.click('[data-testid=settings-save]');
  await p.waitForSelector('.toast.success');
});

// ---------------- Role permissions in the UI ----------------
await test('cashier: lands on POS, sees no owner areas, cannot manage the menu', async () => {
  const { page, ctx } = await newSession();
  await login(page, 'cashier');
  assert(page.url().endsWith('/pos'), `cashier landed on ${page.url()}`);
  const hrefs = await page.$$eval('nav.nav a', (as) => as.map((a) => a.getAttribute('href')));
  for (const hidden of ['/dashboard', '/settings', '/users', '/audit', '/printers', '/reports']) {
    assert(!hrefs.includes(hidden), `cashier can see ${hidden}`);
  }
  await page.goto(`${BASE}/dashboard`);
  await page.waitForSelector('[data-testid=forbidden]');
  await page.goto(`${BASE}/menu`);
  await page.waitForSelector('[data-testid=category-table]');
  assert(!(await page.$('[data-testid=category-new]')), 'cashier sees New category');
  assert(!(await page.$('[data-testid=category-edit]')), 'cashier sees edit buttons');
  // Server-side enforcement, independent of the UI
  const status = await page.evaluate(async () => (await fetch('/api/categories', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bitebrew-client': 'web' }, body: JSON.stringify({ name: 'x', group: 'FOOD', station: 'KITCHEN' }) })).status);
  assert(status === 403, `API allowed cashier write: ${status}`);
  await ctx.close();
});

await test('kitchen and barista land on their own stations', async () => {
  for (const [user, home] of [['kitchen', '/kitchen'], ['barista', '/barista']]) {
    const { page, ctx } = await newSession();
    await login(page, user);
    assert(page.url().endsWith(home), `${user} landed on ${page.url()}`);
    await ctx.close();
  }
});

await test('manager sees settings read-only', async () => {
  const { page, ctx } = await newSession();
  await login(page, 'manager');
  await page.goto(`${BASE}/settings`);
  await page.waitForSelector('[data-testid=settings-form]');
  assert(!(await page.$('[data-testid=settings-save]')), 'manager has a save button');
  assert(await page.isDisabled('[data-testid=settings-address]'), 'manager can edit settings fields');
  await ctx.close();
});

// ---------------- Tablet layouts ----------------
for (const [label, device] of [
  ['iPad portrait', devices['iPad (gen 7)']],
  ['iPad landscape', devices['iPad (gen 7) landscape']],
  ['Android tablet', { viewport: { width: 800, height: 1280 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
]) {
  await test(`tablet layout works: ${label}`, async () => {
    const { page, ctx, errors } = await newSession(device);
    await login(page, 'owner');
    await page.waitForSelector('[data-testid=dashboard]');
    await noHorizontalOverflow(page);
    const drawer = await page.isVisible('[data-testid=menu-toggle]');
    if (drawer) {
      await page.tap('[data-testid=menu-toggle]');
      await page.waitForTimeout(300);
    }
    await page.click('[data-testid=nav-menu]');
    await page.waitForSelector('[data-testid=category-table]');
    await noHorizontalOverflow(page);
    // touch targets: primary buttons at least 44px tall
    const small = await page.$$eval('.btn', (bs) => bs.filter((b) => b.offsetParent && b.getBoundingClientRect().height < 40).length);
    assert(small === 0, `${small} buttons smaller than 40px`);
    await page.screenshot({ path: `${SHOTS}/05-${label.replace(/\s+/g, '-').toLowerCase()}.png` });
    assert(errors.length === 0, errors.join(' | '));
    await ctx.close();
  });
}

// ---------------- Multi-device live updates & offline ----------------
await test('live update: a category created on one device appears on another without refresh', async () => {
  const tablet = await newSession(devices['iPad (gen 7)']);
  await login(tablet.page, 'manager');
  await tablet.page.goto(`${BASE}/menu`);
  await tablet.page.waitForSelector('[data-testid=category-table]');
  await tablet.page.waitForFunction(() => document.querySelector('[data-testid=connection-status]')?.textContent?.includes('ONLINE'));
  const name = `${unique} live`;
  const status = await owner.page.evaluate(async (n) => (await fetch('/api/categories', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bitebrew-client': 'web' }, body: JSON.stringify({ name: n, group: 'FOOD', station: 'KITCHEN' }) })).status, name);
  assert(status === 201, `create failed ${status}`);
  await tablet.page.waitForSelector(`[data-testid=category-row]:has-text("${name}")`, { timeout: 5000 });
  // clean up
  const id = await owner.page.evaluate(async (n) => {
    const r = await (await fetch('/api/categories?includeInactive=true')).json();
    const c = r.categories.find((x) => x.name === n);
    await fetch(`/api/categories/${c.id}?version=${c.version}`, { method: 'DELETE', headers: { 'x-bitebrew-client': 'web' } });
    return c.id;
  }, name);
  assert(id, 'cleanup failed');
  await tablet.page.waitForSelector(`[data-testid=category-row]:has-text("${name}")`, { state: 'detached', timeout: 5000 });
  await tablet.ctx.close();
});

await test('OFFLINE status is clearly displayed when the connection drops, and clears when it returns', async () => {
  const p = owner.page;
  await p.goto(`${BASE}/dashboard`);
  await p.waitForSelector('[data-testid=dashboard]');
  await owner.ctx.setOffline(true);
  await p.waitForSelector('[data-testid=offline-banner]', { timeout: 5000 });
  assert((await p.textContent('[data-testid=connection-status]')).includes('OFFLINE'), 'pill not OFFLINE');
  await p.screenshot({ path: `${SHOTS}/06-offline.png` });
  await owner.ctx.setOffline(false);
  await p.waitForSelector('[data-testid=offline-banner]', { state: 'detached', timeout: 20000 });
});

await test('logout ends the session', async () => {
  const p = owner.page;
  await p.click('[data-testid=user-menu]');
  await p.click('[data-testid=logout]');
  await p.waitForURL((u) => u.pathname === '/login');
  await p.goto(`${BASE}/dashboard`);
  await p.waitForURL((u) => u.pathname === '/login');
});

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed. Screenshots: ${SHOTS}\n`);
process.exit(failed.length ? 1 : 0);
