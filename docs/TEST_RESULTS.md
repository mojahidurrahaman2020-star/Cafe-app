# Bite & Brew — Test Results

## Phase 2 — Menu items & inventory (2026-11-11)

Run on a **fresh clone** with a brand-new database, following the README (install →
migrate → demo seed → `npm run dev`), then again against the **production build**.

| Check | Result |
|---|---|
| Migrations on an empty database (3 migrations) | ✅ applied |
| TypeScript (shared, server, web) | ✅ 0 errors |
| Shared unit tests (now incl. unit conversions) | ✅ 11 / 11 |
| API integration tests (Phase 1 + Phase 2) | ✅ 67 / 67 (43 + 24 new) |
| Browser acceptance tests — dev server | ✅ 24 / 24 (18 + 6 new) |
| Browser acceptance tests — production build | ✅ 24 / 24 |
| Production dependency audit | ✅ 0 vulnerabilities |

### Phase 2 acceptance criteria

| Criterion | Evidence | Result |
|---|---|---|
| Prepare 20 Chicken Biriyani → recipe ingredients deducted | API "prepare 20 → … → 17": rice −3.15 kg (incl. 5 % wastage), chicken −4 kg, oil −400 mL, masala −100 g | ✅ |
| System creates 20 finished portions; POS shows 20 | `/availability` returns 20; browser test shows 20 on a cashier tablet **live, without refresh** | ✅ |
| Customer buys 3 → finished stock 17 | Sale function (used by the Phase 3 POS) → 17; ledger PRODUCED +20, SOLD −3 | ✅ |
| Ingredients **not** deducted again at sale | Every ingredient balance identical before/after the sale | ✅ |
| Made-to-order items deduct recipe at sale | Latte: milk, beans, cup (+ chosen oat-milk option) deducted; availability limited by the scarcest ingredient | ✅ |
| Unit conversion (kg↔g, L↔mL, dozen↔pcs) | Shared unit tests + API receive in kg / mL; wrong-dimension units refused | ✅ |
| Recipe yields, wastage | Yield-10 recipe scaled to 20/60 portions; wastage % applied | ✅ |
| Wastage, spoilage, adjustments, counts | All four recorded with signed quantity, value and reason; correction requires a reason; cannot go below zero | ✅ |
| Never sell the last portion twice | Two simultaneous sales of the last portion → exactly one succeeds | ✅ |
| Two staff preparing at once cannot overdraw stock | Two simultaneous 30-portion batches (each needs 6 of 10 kg chicken) → one succeeds, one refused | ✅ |
| No duplicate submissions | Double-tapped delivery and double-tapped batch each recorded once | ✅ |
| Complete audit trail | Append-only ledgers (DB triggers block UPDATE/DELETE); audit log for receipts, adjustments, batches, price/recipe/option changes | ✅ |
| Owner manages menu without a developer | Browser test creates a batch item, sets price and recipe, records production — all through the UI | ✅ |
| Stock per category (“how many orders we can take”) | Availability board per category: portions ready, items available / sold out, per-item counts | ✅ |
| Dashboard stock KPIs | Current stock value, low-stock alerts, sold-out products — live (value unchanged by production: raw → finished) | ✅ |
| Role rules | Cashier: availability only, no costs; kitchen: can record batches, cannot receive or adjust, sees no costs | ✅ |

### Phase 2 browser tests

| | Test |
|---|---|
| ✓ | P2 inventory: add an ingredient, receive a delivery in kg, record waste |
| ✓ | P2 menu item: create a batch item and its recipe through the UI |
| ✓ | P2 production: prepare 20 portions → ingredients deducted once → 20 available everywhere (live) |
| ✓ | P2 not enough stock: production is refused with the shortage shown |
| ✓ | P2 roles: kitchen can record production; cashier sees availability but not inventory or costs |
| ✓ | P2 dashboard shows live stock value, low-stock and sold-out counts |

### Phase 2 API tests

| | Test |
|---|---|
| ✓ | units & receiving stock — stores in base units and converts kg→g, L→mL |
| ✓ | units & receiving stock — rejects a unit from the wrong dimension |
| ✓ | units & receiving stock — keeps a weighted-average cost across deliveries |
| ✓ | units & receiving stock — a double-tapped delivery is recorded once |
| ✓ | batch production — the Chicken Biriyani workflow — prepare 20 → deduct recipe once → 20 available → sell 3 → 17, raw stock untouched by the sale |
| ✓ | batch production — the Chicken Biriyani workflow — refuses a batch when ingredients are short, lists every shortage, and changes nothing |
| ✓ | batch production — the Chicken Biriyani workflow — records actual amounts when they differ from the recipe |
| ✓ | batch production — the Chicken Biriyani workflow — a double-tapped batch is recorded once |
| ✓ | batch production — the Chicken Biriyani workflow — two kitchens preparing at once cannot overdraw the same ingredient |
| ✓ | selling — atomic stock (groundwork for the Phase 3 POS) — two tills selling the last portion at the same moment: exactly one succeeds |
| ✓ | selling — atomic stock (groundwork for the Phase 3 POS) — made-to-order items deduct recipe ingredients at sale, including chosen options |
| ✓ | selling — atomic stock (groundwork for the Phase 3 POS) — ready-made items are received in units with cost, then sold |
| ✓ | waste, spoilage, corrections and counts — records each kind of adjustment with value and reason |
| ✓ | waste, spoilage, corrections and counts — finished portions can be wasted or counted |
| ✓ | waste, spoilage, corrections and counts — stock ledgers are append-only in the database |
| ✓ | menu items — create, edit price (audited), hide, and refuse deletion once there is stock history |
| ✓ | menu items — refuses to change stock mode while portions are on hand |
| ✓ | menu items — a category with menu items cannot be deleted |
| ✓ | menu items — drinks route to the barista station; a product can override its category |
| ✓ | menu items — stores and serves a product photo |
| ✓ | menu items — recipe units must match the ingredient |
| ✓ | permissions & dashboard — cashier sees availability but not costs, and cannot change menu or stock |
| ✓ | permissions & dashboard — kitchen can prepare batches and view stock, but cannot receive deliveries or see values |
| ✓ | permissions & dashboard — dashboard shows real stock value, low-stock alerts and sold-out items |

### Not tested in Phase 2
- Selling through a real POS screen (the POS is Phase 3; the sale function it will use is tested directly).
- Very large menus/ingredient lists for performance (functional tests only).
- Image upload from a physical tablet camera (tested with generated images in the browser).

---

## Phase 1 — Foundation (2026-11-11)

All results below come from real runs in the development container on **2026-11-11**
(Node 22.23, PostgreSQL 16.15, Chromium via Playwright 1.63). Nothing is assumed.
Re-run them with the commands shown.

## Summary — Phase 1

| Check | Command | Result |
|---|---|---|
| TypeScript (shared, server, web) | `npm run typecheck` | ✅ 0 errors |
| Shared unit tests (money, time, roles) | `npm test` (part 1) | ✅ 8 / 8 passed |
| API integration tests on a fresh database | `npm test` (part 2) | ✅ 43 / 43 passed |
| Migrations apply to an empty database | part of `npm test` | ✅ 2 / 2 applied |
| Production build (server + PWA) | `npm run build` | ✅ |
| Browser acceptance tests — dev server | `npm run test:e2e` | ✅ 18 / 18 passed |
| Browser acceptance tests — **production build** (single origin, CSP, service worker) | `E2E_BASE_URL=http://localhost:4100 npm run test:e2e` | ✅ 18 / 18 passed |
| Docker Compose stack (db + app + backup) | see DEPLOYMENT.md | ✅ healthy; migrations + seed on start; owner created via documented command; login + settings via API |
| Backup → restore into new database | `scripts/backup.sh`, `scripts/restore.sh` | ✅ dump verified; restored 5 users / 9 categories / 41 audit rows / 2 migrations; audit trigger active after restore |
| Demo seed refuses production | `APP_ENV=production npm run db:seed:demo` | ✅ exit 1, "Refusing to create demo accounts" |
| `create-owner` validation | short password rejected; valid owner created with argon2id hash and audit entry | ✅ |
| Fresh clone following README (new DB) | install → migrate → demo seed → `npm run dev` → typecheck, 51 unit/API, 18 browser tests | ✅ all passed |
| Production dependency audit | `npm audit --omit=dev` | ✅ 0 vulnerabilities |

## Phase 1 acceptance criteria

| Criterion | Evidence | Result |
|---|---|---|
| Application starts successfully | dev (`npm run dev`), production build (`npm start`) and Docker all started; e2e "application starts" | ✅ |
| Database connection works | `/api/health` → `database: up`; API test "reports the database as up" | ✅ |
| Database migrations run successfully | fresh DB per test run, `migrate deploy` applied both migrations; Docker start applied them | ✅ |
| Owner can log in | API + e2e "owner can log in and lands on the owner dashboard" | ✅ |
| Role permissions work | 11 route×role checks, settings owner-only, menu writes blocked for cashier/barista/kitchen (API **and** UI), rank rules, last-owner protection, sessions revoked on role change | ✅ |
| Menu categories can be created, edited and deleted | API CRUD test with audit trail; e2e through the UI; duplicates refused; concurrent edits → 409 | ✅ |
| Settings persist after refreshing | API (new session sees change) + e2e (save → browser reload → value still there) | ✅ |
| Currency displays BDT correctly | `৳1,250.50`, `৳1,25,000.00`, settings preview `৳1,23,456.78`, code `BDT` | ✅ |
| Timezone configured to Asia/Dhaka | settings default; UTC+06:00 shown; business date equals Dhaka date; business-day unit tests | ✅ |
| Works on desktop and tablet layouts | 1366×768 desktop, iPad portrait, iPad landscape, 800×1280 Android tablet: no horizontal scroll, drawer navigation, no button < 40 px, no console errors | ✅ |
| No major navigation buttons are non-functional | e2e clicks all 13 owner nav links + account menu + sign-out; future modules open a labelled "Planned · Phase N" page | ✅ |

## Browser acceptance tests (latest run)

| | Test |
|---|---|
| ✓ | application starts: login page loads and health endpoint reports database up |
| ✓ | wrong password is rejected with a clear message |
| ✓ | owner can log in and lands on the owner dashboard |
| ✓ | currency displays BDT / ৳ correctly (lakh grouping) |
| ✓ | timezone is Asia/Dhaka (UTC+06:00) and the clock shows Dhaka time |
| ✓ | every navigation link opens a working page (no blank/404/crash) |
| ✓ | menu categories: create, edit and delete through the UI |
| ✓ | duplicate category name is refused with a message |
| ✓ | settings persist after refreshing the application |
| ✓ | cashier: lands on POS, sees no owner areas, cannot manage the menu |
| ✓ | kitchen and barista land on their own stations |
| ✓ | manager sees settings read-only |
| ✓ | tablet layout works: iPad portrait |
| ✓ | tablet layout works: iPad landscape |
| ✓ | tablet layout works: Android tablet |
| ✓ | live update: a category created on one device appears on another without refresh |
| ✓ | OFFLINE status is clearly displayed when the connection drops, and clears when it returns |
| ✓ | logout ends the session |

Screenshots from the run are written to `e2e/screenshots/` (not committed).

## API integration tests (latest run)

| | Test |
|---|---|
| ✓ | health & database — reports the database as up |
| ✓ | health & database — all migrations are applied |
| ✓ | authentication — owner can log in and receives an httpOnly, SameSite=Strict session cookie |
| ✓ | authentication — usernames are case-insensitive |
| ✓ | authentication — rejects a wrong password and an unknown user with the same message |
| ✓ | authentication — stores passwords as argon2id hashes, never plain text |
| ✓ | authentication — stores only a hash of the session token |
| ✓ | authentication — locks the account after 5 failed attempts |
| ✓ | authentication — deactivated users cannot log in |
| ✓ | authentication — /me requires a session; logout revokes it server-side |
| ✓ | authentication — blocks state-changing requests without the client header (CSRF defence) |
| ✓ | authentication — changing password signs out other devices |
| ✓ | role-based access control — owner get /api/dashboard/summary → 200 |
| ✓ | role-based access control — manager get /api/dashboard/summary → 200 |
| ✓ | role-based access control — cashier get /api/dashboard/summary → 403 |
| ✓ | role-based access control — barista get /api/dashboard/summary → 403 |
| ✓ | role-based access control — kitchen get /api/dashboard/summary → 403 |
| ✓ | role-based access control — cashier get /api/categories → 200 |
| ✓ | role-based access control — kitchen get /api/settings → 200 |
| ✓ | role-based access control — cashier get /api/users → 403 |
| ✓ | role-based access control — manager get /api/users → 200 |
| ✓ | role-based access control — barista get /api/audit → 403 |
| ✓ | role-based access control — manager get /api/audit → 200 |
| ✓ | role-based access control — only the owner may change business settings |
| ✓ | role-based access control — cashier, barista and kitchen cannot manage menu categories |
| ✓ | role-based access control — a manager can create cashiers but not managers or owners |
| ✓ | role-based access control — the last active owner cannot be demoted or deactivated |
| ✓ | role-based access control — a role change immediately revokes that user’s sessions |
| ✓ | menu categories — lists the nine starting categories grouped Food → Drinks → Desserts |
| ✓ | menu categories — create → edit → delete, each audited |
| ✓ | menu categories — rejects duplicate names case-insensitively |
| ✓ | menu categories — validates input |
| ✓ | menu categories — two staff editing the same category: the second save gets 409 instead of overwriting |
| ✓ | menu categories — concurrent creates of the same name produce exactly one category |
| ✓ | business settings — defaults to Bite & Brew, BDT ৳ and Asia/Dhaka |
| ✓ | business settings — owner updates persist (new request, new session) and are audited |
| ✓ | business settings — rejects an invalid timezone or currency code |
| ✓ | business settings — refuses to disable both dine-in and takeaway |
| ✓ | business settings — stale settings saves are rejected |
| ✓ | audit log & database guards — audit rows cannot be updated or deleted (DB trigger) |
| ✓ | audit log & database guards — settings table enforces a single row |
| ✓ | audit log & database guards — audit log never contains password hashes |
| ✓ | dashboard summary — returns real Phase 1 figures in the configured timezone |

## Not tested / not testable yet

- **Physical printing** — no printers exist yet; nothing prints in Phase 1.
- Real tablets and Windows touchscreens — layouts were tested with Chromium device emulation
  (iPad, Android tablet sizes, touch enabled), not on physical hardware.
- Real Wi-Fi drop on a physical device — simulated with the browser's offline mode.
- HTTPS deployment with a real certificate — production mode requires it; tested in `demo`
  mode over HTTP.
- Load with many simultaneous devices — functional concurrency (races) tested; load testing is Phase 6.
