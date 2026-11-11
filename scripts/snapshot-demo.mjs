// Captures the demo data from a running DEMO server (owner view) into a fixture for the
// browser-only online demo build. Usage: node scripts/snapshot-demo.mjs [baseUrl]
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:4000';
const H = { 'content-type': 'application/json', 'x-bitebrew-client': 'web' };
const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: H, body: JSON.stringify({ username: 'owner', password: 'demo-pass-2027' }) });
if (!login.ok) throw new Error('login failed');
const info = await (await fetch(`${BASE}/api/info`)).json();
if (info.appEnv === 'production') throw new Error('Refusing to snapshot a production server');
const cookie = login.headers.get('set-cookie').split(';')[0];
const get = async (p) => (await fetch(`${BASE}/api${p}`, { headers: { cookie } })).json();
const isTest = (n) => /^E2E/.test(n);

const [settings, categories, users, suppliers, ingredients, products, movements, batches] = await Promise.all([
  get('/settings'), get('/categories?includeInactive=true'), get('/users'), get('/suppliers'),
  get('/ingredients?includeInactive=true'), get('/products?includeInactive=true'), get('/stock/movements?limit=200'), get('/production/batches?limit=100'),
]);
const fixture = {
  settings: settings.settings,
  categories: categories.categories.filter((c) => !isTest(c.name)),
  users: users.users.filter((u) => ['owner', 'manager', 'cashier', 'barista', 'kitchen'].includes(u.username)),
  suppliers: suppliers.suppliers,
  ingredients: ingredients.ingredients.filter((i) => !isTest(i.name)),
  products: products.products.filter((p) => !isTest(p.name)),
  movements: movements.movements.filter((m) => !isTest(m.itemName)),
  batches: batches.batches.filter((b) => !isTest(b.productName)),
};
writeFileSync(new URL('../apps/web/src/demo/fixture.json', import.meta.url), JSON.stringify(fixture));
console.log(Object.fromEntries(Object.entries(fixture).map(([k, v]) => [k, Array.isArray(v) ? v.length : 1])));
