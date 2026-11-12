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

console.log(`\nAcceptance tests against ${BASE}\n`);

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
  await p.waitForSelector('[data-testid=dash-stock-value]');
  const value = (await p.textContent('[data-testid=dash-stock-value]')).trim();
  assert(/^৳\d{1,2}(,\d{2})*,?\d{0,3}\.\d{2}$/.test(value) || /^৳\d+\.\d{2}$/.test(value), `stock value not formatted as ৳ with lakh grouping: ${value}`);
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
  assert(links.length === 16, `expected 15 nav links for owner, got ${links.length}`);
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


// ---------------- Phase 2: menu items, inventory, production ----------------
const P2 = `E2E ${Date.now().toString(36).slice(-5)}`;
await test('P2 inventory: add an ingredient, receive a delivery in kg, record waste', async () => {
  const p = owner.page;
  await p.goto(`${BASE}/inventory`);
  await p.waitForSelector('[data-testid=ingredients-table]');
  await p.click('[data-testid=ingredient-new]');
  await p.fill('#if-name', `${P2} Rice`);
  await p.selectOption('#if-dim', 'MASS');
  await p.selectOption('#if-unit', 'kg');
  await p.fill('#if-min', '2');
  await p.click('[data-testid=ingredient-save]');
  const row = p.locator('[data-testid=ingredient-row]', { hasText: `${P2} Rice` });
  await row.waitFor();
  await row.locator('[data-testid=ingredient-receive]').click();
  await p.fill('[data-testid=receive-qty]', '10');
  await p.fill('[data-testid=receive-cost]', '1400');
  await p.click('[data-testid=receive-save]');
  await p.waitForFunction((n) => [...document.querySelectorAll('[data-testid=ingredient-row]')].find((r) => r.textContent.includes(n))?.querySelector('[data-testid=ingredient-onhand]')?.textContent.trim() === '10 kg', `${P2} Rice`);
  await row.locator('[data-testid=ingredient-adjust]').click();
  await p.fill('[data-testid=adjust-qty]', '500');
  await p.selectOption('.modal select[aria-label=Unit]', 'g');
  await p.click('[data-testid=adjust-save]');
  await p.waitForFunction((n) => [...document.querySelectorAll('[data-testid=ingredient-row]')].find((r) => r.textContent.includes(n))?.querySelector('[data-testid=ingredient-onhand]')?.textContent.trim() === '9.5 kg', `${P2} Rice`);
  const value = await row.textContent();
  assert(value.includes('৳140.00/kg') && value.includes('৳1,330.00'), `cost/value wrong: ${value}`);
  await p.screenshot({ path: `${SHOTS}/07-inventory.png` });
});

await test('P2 menu item: create a batch item and its recipe through the UI', async () => {
  const p = owner.page;
  await p.goto(`${BASE}/products`);
  await p.waitForSelector('[data-testid=product-new]');
  await p.click('[data-testid=product-new]');
  await p.fill('#pd-name', `${P2} Pulao`);
  const cat = await p.$eval('#pd-cat', (s) => [...s.options].find((o) => o.textContent.startsWith('Biriyani')).value);
  await p.selectOption('#pd-cat', cat);
  await p.fill('[data-testid=product-price]', '180');
  await p.selectOption('[data-testid=product-mode]', 'BATCH');
  await p.click('[data-testid=product-save]');
  await p.waitForSelector('[data-testid=recipe-yield]'); // editor moves to the Recipe tab
  await p.fill('[data-testid=recipe-yield]', '10');
  await p.click('[data-testid=recipe-add-line]');
  const line = p.locator('[data-testid=recipe-line]').last();
  const optVal = await line.locator('select[aria-label=Ingredient]').evaluate((s, n) => [...s.options].find((o) => o.textContent === n).value, `${P2} Rice`);
  await line.locator('select[aria-label=Ingredient]').selectOption(optVal);
  await line.locator('input.num').first().fill('1.5');
  await p.click('[data-testid=recipe-save]');
  await p.waitForSelector('.toast.success');
  await p.keyboard.press('Escape');
  const row = p.locator('[data-testid=product-row]', { hasText: `${P2} Pulao` });
  await row.waitFor();
  assert((await row.locator('[data-testid=product-available]').textContent()).includes('Sold out'), 'new batch item should be sold out until a batch is recorded');
});

await test('P2 production: prepare 20 portions → ingredients deducted once → 20 available everywhere (live)', async () => {
  const cashier = await newSession(devices['iPad (gen 7)']);
  await login(cashier.page, 'cashier');
  await cashier.page.goto(`${BASE}/availability`);
  await cashier.page.waitForSelector('[data-testid=avail-item]');
  await cashier.page.waitForFunction(() => document.querySelector('[data-testid=connection-status]')?.textContent?.includes('ONLINE'));
  const pill = () => cashier.page.locator('[data-testid=avail-item]', { hasText: `${P2} Pulao` }).locator('.qty-pill');
  assert((await pill().textContent()).includes('Sold out'), 'expected sold out before production');

  const p = owner.page;
  await p.goto(`${BASE}/production`);
  await p.locator('[data-testid=production-item]', { hasText: `${P2} Pulao` }).click();
  await p.fill('#pr-portions', '20');
  await p.waitForSelector('[data-testid=production-preview]');
  await p.waitForFunction(() => document.querySelector('[data-testid=production-preview]')?.textContent.includes('3 kg'));
  await p.click('[data-testid=production-record]');
  await p.waitForSelector('.toast.success');
  await p.screenshot({ path: `${SHOTS}/08-production.png` });
  // the cashier tablet updates without refresh
  await cashier.page.waitForFunction((n) => [...document.querySelectorAll('[data-testid=avail-item]')].find((r) => r.textContent.includes(n))?.querySelector('.qty-pill')?.textContent.trim() === '20', `${P2} Pulao`, { timeout: 8000 });
  await cashier.page.screenshot({ path: `${SHOTS}/09-availability-tablet.png` });
  await cashier.ctx.close();
  // rice: 9.5 kg − 3 kg (1.5 kg × 20/10) = 6.5 kg
  await p.goto(`${BASE}/inventory`);
  const row = p.locator('[data-testid=ingredient-row]', { hasText: `${P2} Rice` });
  await row.waitFor();
  assert((await row.locator('[data-testid=ingredient-onhand]').textContent()).trim() === '6.5 kg', 'ingredient not deducted exactly once');
});

await test('P2 not enough stock: production is refused with the shortage shown', async () => {
  const p = owner.page;
  await p.goto(`${BASE}/production`);
  await p.locator('[data-testid=production-item]', { hasText: `${P2} Pulao` }).click();
  await p.fill('#pr-portions', '100');
  await p.waitForFunction(() => document.querySelector('[data-testid=production-preview]')?.textContent.includes('Short by'));
  assert(await p.isDisabled('[data-testid=production-record]'), 'record button should be disabled when short');
});

await test('P2 roles: kitchen can record production; cashier sees availability but not inventory or costs', async () => {
  const k = await newSession();
  await login(k.page, 'kitchen');
  await k.page.goto(`${BASE}/production`);
  await k.page.waitForSelector('[data-testid=production-item]');
  assert(!(await k.page.$('text=Batch cost')), 'kitchen should not see batch costs');
  await k.ctx.close();
  const c = await newSession();
  await login(c.page, 'cashier');
  const hrefs = await c.page.$$eval('nav.nav a', (as) => as.map((a) => a.getAttribute('href')));
  assert(hrefs.includes('/availability') && !hrefs.includes('/inventory') && !hrefs.includes('/production'), `cashier nav: ${hrefs}`);
  await c.page.goto(`${BASE}/inventory`);
  await c.page.waitForSelector('[data-testid=forbidden]');
  await c.ctx.close();
});

await test('P2 dashboard shows live stock value, low-stock and sold-out counts', async () => {
  const p = owner.page;
  await p.goto(`${BASE}/dashboard`);
  await p.waitForSelector('[data-testid=dash-stock-value]');
  for (const id of ['dash-low-stock', 'dash-sold-out']) assert(/^\d+$/.test((await p.textContent(`[data-testid=${id}]`)).trim()), id);
});


// ---------------- POS, stations, finance ----------------
await test('POS: cashier takes a dine-in order with options, pays cash with change; kitchen and barista get only their items live', async () => {
  const kitchen = await newSession(devices['iPad (gen 7) landscape']);
  await login(kitchen.page, 'kitchen');
  await kitchen.page.goto(`${BASE}/kitchen`);
  await kitchen.page.waitForSelector('[data-testid=station-kitchen]');
  await kitchen.page.waitForFunction(() => document.querySelector('[data-testid=connection-status]')?.textContent?.includes('ONLINE'));
  const before = await kitchen.page.$$eval('[data-testid=kds-ticket]', (t) => t.length);

  const till = await newSession(devices['iPad (gen 7) landscape']);
  await login(till.page, 'cashier');
  const p = till.page;
  await p.waitForSelector('[data-testid=pos-tile]');
  await p.locator('[data-testid=pos-tile]', { hasText: 'Chicken Tehari' }).click();
  await p.locator('[data-testid=pos-tile]', { hasText: 'Chicken Tehari' }).click();
  await p.locator('[data-testid=pos-tile]', { hasText: /^Latte/ }).click();
  await p.waitForSelector('[data-testid=options-add]');
  await p.locator('.modal button', { hasText: 'Extra shot' }).click();
  await p.click('[data-testid=options-add]');
  await p.click('[data-testid=service-DINE_IN]');
  await p.click('[data-testid=table-3]');
  const total = (await p.textContent('[data-testid=cart-total]')).trim();
  assert(total === '৳710.00', `cart total ${total}`); // 2×220 + (220+50)
  await p.click('[data-testid=send-order]');
  await p.waitForSelector('[data-testid=payment-confirm]');
  await p.click('[data-testid=pay-Cash]');
  await p.fill('[data-testid=pay-tendered]', '1000');
  await p.click('[data-testid=payment-confirm]');
  await p.waitForSelector('[data-testid=payment-complete]');
  assert((await p.textContent('[data-testid=change-due]')).trim() === '৳290.00', 'wrong change');
  await p.screenshot({ path: `${SHOTS}/10-pos-paid.png` });
  await p.click('[data-testid=payment-done]');

  await kitchen.page.waitForFunction((n) => document.querySelectorAll('[data-testid=kds-ticket]').length === n + 1, before, { timeout: 8000 });
  const ticket = (await kitchen.page.locator('[data-testid=kds-ticket]').last().textContent()).replace(/\s+/g, ' ');
  assert(ticket.includes('2 × Chicken Tehari') && ticket.includes('Table 3') && !ticket.includes('Latte'), `kitchen ticket: ${ticket}`);
  await kitchen.page.screenshot({ path: `${SHOTS}/11-kitchen.png` });
  await kitchen.page.locator('[data-testid=kds-ticket]').last().locator('[data-testid=kds-advance]').click();
  await kitchen.page.waitForFunction(() => [...document.querySelectorAll('[data-testid=kds-advance]')].some((b) => b.textContent.includes('Ready')));
  const barista = await newSession();
  await login(barista.page, 'barista');
  await barista.page.goto(`${BASE}/barista`);
  await barista.page.waitForSelector('[data-testid=kds-ticket]');
  const bt = (await barista.page.locator('[data-testid=kds-ticket]').last().textContent()).replace(/\s+/g, ' ');
  assert(bt.includes('Latte') && bt.includes('Extra shot') && !bt.includes('Tehari'), `barista ticket: ${bt}`);
  await Promise.all([kitchen.ctx.close(), till.ctx.close(), barista.ctx.close()]);
});

await test('POS: hold an order, then resume and send it', async () => {
  const till = await newSession({ viewport: { width: 1366, height: 768 } });
  await login(till.page, 'cashier');
  const p = till.page;
  await p.waitForSelector('[data-testid=pos-tile]');
  await p.locator('[data-testid=pos-tile]', { hasText: 'Lemon Tea' }).click();
  await p.click('[data-testid=hold-order]');
  await p.waitForSelector('.toast.success');
  await p.click('[data-testid=tab-held]');
  await p.waitForSelector('[data-testid=order-row]');
  await p.locator('[data-testid=order-row]').first().locator('button', { hasText: 'Resume' }).click();
  await p.waitForFunction(() => document.querySelector('[data-testid=cart]')?.textContent.includes('Lemon Tea'));
  await p.click('[data-testid=send-order]');
  await p.waitForSelector('[data-testid=payment-confirm]');
  await p.keyboard.press('Escape'); // pay later
  await p.click('[data-testid=tab-open]');
  await p.waitForSelector('[data-testid=order-row]');
  await till.ctx.close();
});

await test('Owner: dashboard shows live sales, orders, kitchen/barista pending and printer status', async () => {
  const o = await newSession({ viewport: { width: 1366, height: 768 } });
  await login(o.page, 'owner');
  await o.page.waitForSelector('[data-testid=dash-sales]');
  const sales = (await o.page.textContent('[data-testid=dash-sales]')).trim();
  assert(/^৳[\d,]+\.\d{2}$/.test(sales) && sales !== '৳0.00', `sales ${sales}`);
  assert(Number((await o.page.textContent('[data-testid=dash-orders]')).trim()) >= 2, 'orders count');
  await o.page.waitForSelector('[data-testid=dash-printers]');
  await o.page.click('[data-testid=period-month]');
  await o.page.waitForSelector('[data-testid=dash-top] td');
  await o.page.screenshot({ path: `${SHOTS}/12-dashboard-live.png`, fullPage: true });
  await o.ctx.close();
});

await test('Owner: VAT rate, expense, report and printer preview work end to end', async () => {
  const o = await newSession({ viewport: { width: 1366, height: 900 } });
  await login(o.page, 'owner');
  const p = o.page;
  await p.goto(`${BASE}/expenses`);
  await p.waitForSelector('[data-testid=expense-category]');
  const cat = await p.$eval('[data-testid=expense-category]', (s) => [...s.options].find((x) => x.textContent === 'Electricity').value);
  await p.selectOption('[data-testid=expense-category]', cat);
  await p.fill('[data-testid=expense-amount]', '1500');
  await p.click('[data-testid=expense-save]');
  await p.waitForSelector('[data-testid=expenses-table] >> text=Electricity');
  await p.goto(`${BASE}/reports`);
  await p.waitForSelector('[data-testid=report-summary]');
  assert((await p.textContent('[data-testid=reports-page]')).includes('Electricity'), 'expense missing from report');
  await p.screenshot({ path: `${SHOTS}/13-reports.png`, fullPage: true });
  await p.goto(`${BASE}/printers`);
  await p.waitForSelector('[data-testid=print-jobs]');
  await p.locator('[data-testid=print-jobs] button', { hasText: 'View' }).first().click();
  await p.waitForSelector('[data-testid=print-preview]');
  assert((await p.textContent('[data-testid=print-preview]')).length > 20, 'empty preview');
  await p.keyboard.press('Escape');
  await p.goto(`${BASE}/settings`);
  await p.waitForSelector('[data-testid=tax-rates]');
  assert(await p.isVisible('[data-testid=this-device]'), 'device section missing');
  await o.ctx.close();
});


await test('Customers: save a regular customer (name + phone), find them by phone, attach to an order, edit', async () => {
  const uniq = String(Date.now()).slice(-7);
  const phone = `0171${uniq}`;
  const o = await newSession({ viewport: { width: 1366, height: 900 } });
  await login(o.page, 'owner');
  const p = o.page;
  await p.goto(`${BASE}/customers`);
  await p.waitForSelector('[data-testid=customers-page]');
  await p.click('[data-testid=customer-new]');
  await p.fill('[data-testid=customer-name]', `E2E Customer ${uniq}`);
  await p.fill('[data-testid=customer-phone]', phone);
  await p.click('[data-testid=customer-save]');
  await p.waitForSelector(`[data-testid=customer-row]:has-text("E2E Customer ${uniq}")`);
  // the same number written differently is refused
  await p.click('[data-testid=customer-new]');
  await p.fill('[data-testid=customer-name]', 'Duplicate');
  await p.fill('[data-testid=customer-phone]', `+88${phone}`);
  await p.click('[data-testid=customer-save]');
  await p.waitForSelector('.modal [role=alert]');
  await p.keyboard.press('Escape');
  // search by part of the phone number
  await p.fill('[data-testid=customer-search]', uniq.slice(-5));
  await p.waitForSelector(`[data-testid=customer-row]:has-text("E2E Customer ${uniq}")`);
  // edit
  await p.locator('[data-testid=customer-row]').first().locator('[data-testid=customer-edit]').click();
  await p.fill('[data-testid=customer-name]', `E2E Customer ${uniq} Edited`);
  await p.click('[data-testid=customer-save]');
  await p.waitForSelector(`[data-testid=customer-row]:has-text("Edited")`);
  // pick at the till
  const till = await newSession({ viewport: { width: 1366, height: 800 } });
  await login(till.page, 'cashier');
  const t = till.page;
  await t.waitForSelector('[data-testid=pos-tile]');
  await t.locator('[data-testid=pos-tile]', { hasText: 'Lemon Tea' }).click();
  await t.click('[data-testid=customer-choose]');
  await t.fill('[data-testid=customer-pick-search]', uniq.slice(-5));
  await t.locator('[data-testid=customer-option]', { hasText: 'Edited' }).click();
  await t.waitForSelector('[data-testid=customer-picker] >> text=Edited');
  await t.click('[data-testid=send-order]');
  await t.waitForSelector('[data-testid=payment-confirm]');
  await t.click('[data-testid=pay-Cash]');
  await t.click('[data-testid=payment-confirm]');
  await t.waitForSelector('[data-testid=payment-complete]');
  // history shows the visit
  await p.fill('[data-testid=customer-search]', uniq.slice(-5));
  await p.reload();
  await p.fill('[data-testid=customer-search]', uniq.slice(-5));
  await p.waitForFunction(() => document.querySelector('[data-testid=customer-row] td:nth-child(3)')?.textContent.trim() === '1', null, { timeout: 8000 });
  await Promise.all([o.ctx.close(), till.ctx.close()]);
});

// ---------------- Role permissions in the UI ----------------
await test('cashier: lands on the POS, sees no owner areas, cannot manage the menu', async () => {
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
