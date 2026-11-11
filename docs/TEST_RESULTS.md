# Bite & Brew — Test Results

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
