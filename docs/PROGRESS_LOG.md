# Bite & Brew — Development Progress Log

Newest first. Each entry: what changed, why, and what was verified.

## 2026-11-11 — Complete system (owner: "build the final app, no more phases")

**Built**
- Migration `pos_printing_finance`: tax rates, payment methods, cash sessions, orders, order
  lines, payments, refunds, printers, print jobs, expense categories, expenses (+ CHECK
  constraints, append-only payments/refunds, single open cash drawer).
- POS: touch screen with category tabs and live "left" counts, options, notes, dine-in tables
  / takeaway, discounts (manager/owner), owner-configured VAT, hold/resume, send & pay,
  cash with change, card, bKash/Nagad with transaction ID, split payments, open/held/today
  lists, cancel (stock restored vs waste), refunds, reprints, cash drawer reconciliation.
- Kitchen and barista live screens (Start → Ready → Served, order age, late highlight).
- Printing: three destinations, automatic split, ESC/POS over TCP 9100, 58/80 mm, auto-cut,
  cash-drawer kick, idempotent jobs, no automatic duplicate printing, retries only before data
  is sent, status probing, test print, labelled reprints, failure log, exact text preview.
- Finance: expenses (voided, never deleted), reports with net sales, COGS from consumption,
  losses, expenses, net profit estimate, stock purchases separate, payment/category/top items,
  day/week/month series; PDF, Excel and CSV exports.
- Owner dashboard with live figures; settings for tables, VAT/BIN line, tax rates, payment
  methods, and per-device offline permission.
- Offline order queue on tills with automatic upload and server-side conflict review.
- Off-site backup copy script (rclone). Owner's guide.
- Online demo extended with POS, stations, printers (preview), expenses and reports.

**Problems found and fixed during verification**
- Two identical submissions arriving at the same instant returned an error to the second
  till → now both get the original result (orders, payments, refunds).
- A duplicate payment waiting on the order lock saw "already paid" before recognising itself
  → idempotency re-checked after acquiring the lock.
- `exceljs` pulled in a `uuid` version with an advisory → pinned the fixed release; audit clean.
- Cart dropped below the menu on landscape tablets → side-by-side down to 820 px.
- Online demo used non-UUID sample ids, which the real validation rejected → fixed ids.

**Verified:** TEST_RESULTS.md — 15 unit, 89 API, 28 browser tests; Docker; online demo.

## 2026-11-11 — Online demo for the owner

The owner could not open the in-session preview, so a browser-only **online demo** was
added: `apps/web/src/demo/` (stand-in API mirroring the server's validation, permissions and
stock maths on sample data in localStorage), `vite.demo.config.ts`, and
`scripts/snapshot-demo.mjs` + `scripts/build-online-demo.mjs`. Published as a private
claude.ai page. The normal app is unchanged apart from a shared `bootstrap.tsx` and the logo
now bundled with the code. Verified: phone (iPhone 13) and desktop — sign-in, availability
20 → 30 after a batch, delivery receipt, reload persistence, cashier restrictions, no console
errors, no horizontal scroll; the regular app's 24 browser tests still pass.

## 2026-11-11 — Phase 2: Menu items & inventory (complete, awaiting owner approval)

**Owner decisions recorded:** Phase 1 approved. "Run offline & keep data stored online"
approved as: café computer (works without internet) + automatic online copy (Phase 6) +
offline order queue on tills, moved forward to Phase 3. ADR 0005 accepted; roadmap and
OFFLINE.md updated. Number of order-taking tablets not yet given (does not affect Phase 2).

**Built**
- Migration `phase2_products_inventory`: suppliers, ingredients, append-only ingredient
  ledger, products, photos, recipes, customisation options, append-only portion ledger,
  production batches; CHECK constraints and append-only triggers.
- Stock engine (`modules/inventory/stock.ts`): row-locked, deadlock-free, never negative,
  weighted-average costing, exact unit conversion, idempotent by client request id.
  Batch production consumes ingredients once and creates portions; the sale function for
  the Phase 3 POS deducts portions (batch/ready-made) or recipe ingredients (made-to-order).
- Screens: **Availability** board (all roles, live), **Menu items** (details, price,
  stock type, station override, recipe with yield & wastage and live cost/margin,
  customisation options, photo, portion stock), **Inventory** (ingredients, receive
  deliveries with cost, waste/spoilage/correction/count, portions & ready-made, suppliers,
  stock history), **Production** (choose item, portions stepper, requirements & shortages
  preview, actual-amount overrides, recent batches). Dashboard stock KPIs are now live.
- Costs/values hidden from roles without `reports.view`.
- Demo seed (dev/demo only): 14 sample items, 21 ingredients with opening stock, 3 batches.

**Problems found and fixed during the build**
- Batch rows are append-only, so the first draft (create batch, then fill in cost) could not
  work → batch id generated first, movements recorded, batch written once with final cost.
- Accounting wording corrected in DATABASE.md: batch preparation moves value from raw to
  finished stock; it becomes COGS only when portions are sold (verified: stock value is
  unchanged by production).
- Sidebar grew by two links → compacted further on short desktop screens.
- `crypto.randomUUID` is unavailable on plain-HTTP LAN tablets → request ids fall back to
  `crypto.getRandomValues`.

**Verified:** see TEST_RESULTS.md (11 unit, 67 API, 24 browser tests; fresh clone; production build).

**Next:** Phase 3 (POS, payments, VAT, offline order queue) after owner approval.

## 2026-11-11 — Phase 1: Foundation (complete, awaiting owner approval)

**Environment inspected:** empty repository; Node 22.23, npm 10.9, PostgreSQL 16.15, Docker 29.9,
Chromium + Playwright 1.63 available.

**Built**
- Monorepo (npm workspaces): `packages/shared`, `apps/server`, `apps/web`.
- PostgreSQL schema via Prisma 7 with two migrations: foundation tables, and DB integrity
  guards (CHECK constraints, settings singleton, append-only audit-log trigger).
- Auth: argon2id passwords, opaque session tokens (SHA-256 stored), httpOnly SameSite=Strict
  cookie, CSRF header, login rate limit, 5-attempt lockout, server-side logout, other sessions
  revoked on password change / role change / deactivation.
- RBAC: five roles, 25 permissions (8 active in Phase 1), rank-based staff management,
  last-owner protection. Shared matrix → server enforcement + UI + generated docs.
- Business settings (BDT ৳, 2 decimals, lakh grouping, Asia/Dhaka, business-day start hour,
  dine-in/takeaway, receipt footer) with optimistic concurrency.
- Menu categories: the nine agreed starting categories, full CRUD, case-insensitive unique
  names, group (Food/Drinks/Desserts), preparation station (Kitchen/Barista → future printer
  routing), visibility toggle, optimistic concurrency.
- Staff management screen, audit-log viewer, change-password screen.
- Owner dashboard layout: real system figures; business KPIs shown as "Available in Phase N"
  (no invented numbers); day/week/month switch.
- Live updates over authenticated WebSocket; ONLINE / RECONNECTING / OFFLINE indicator and
  banner; health polling (network, server, database).
- PWA: manifest, icons, app-shell service worker (no API caching).
- Brand UI (espresso / cream / antique gold), responsive desktop + tablet drawer, 48 px touch targets.
- Ops: Dockerfile + compose (db, app, daily backup), backup/restore scripts (bash + PowerShell),
  create-owner CLI, guarded demo seed with on-screen "demo data" banner.
- Documentation: architecture, ERD & schema plan, API plan, permission matrix, printing,
  offline, deployment, roadmap, ADRs, test results.

**Problems found and fixed during verification**
- Login succeeded but UI stayed on the login page: clearing the query cache detached the
  session observer → now clears everything except the session query.
- Desktop sidebar hid "Business settings" below 768 px height → compacted desktop nav.
- CSP `upgrade-insecure-requests` broke HTTP-only demo deployments → only sent when HTTPS is configured.
- Docker: app crashed in non-development mode because the pretty logger is a dev dependency →
  JSON logs everywhere except development. Backup sidecar raced the database and waited 24 h
  after a failure → waits for a healthy DB, retries after 5 min.
- Fresh-clone setup failed at the seed step (Prisma 7 no longer generates its client on
  migrate) → server scripts now run `prisma generate` first. Re-verified by cloning into an
  empty folder, following the README with a new database, and running every test suite.
- Initial dependency pins had known advisories → upgraded; production audit now clean.
  Remaining advisories are in dev-only test tooling (vitest 3.2); vitest 4.1 currently
  crashes npm 10's installer (npm bug), revisit when fixed.

**Verified:** see `docs/TEST_RESULTS.md` (8 unit, 43 API, 18 browser tests; Docker; backup/restore).

**Next:** Phase 2 (products & inventory) after owner approval.
