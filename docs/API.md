# Bite & Brew — API Endpoint Plan

Base path `/api`. JSON in/out. Authentication: `bb_session` httpOnly cookie.
Every non-GET request must send `x-bitebrew-client: web` (CSRF defence).
Errors: `{ "error": { "code", "message", "details?" } }`.

| Status | Meaning |
|---|---|
| 400 `BAD_REQUEST` | Validation failed — `details` = `[{ path, message }]` |
| 401 `UNAUTHORIZED` / `INVALID_CREDENTIALS` | Not signed in / wrong credentials |
| 403 `FORBIDDEN` / `CSRF` / `ACCOUNT_DISABLED` | Role lacks permission / missing client header / deactivated |
| 409 `CONFLICT` / `DUPLICATE` | Uniqueness clash |
| 409 `STALE_VERSION` | Someone else saved first — `details.current` holds the latest record |
| 423 `ACCOUNT_LOCKED` | Too many failed sign-ins |
| 429 `RATE_LIMITED` | Too many sign-in attempts from this address |

## Implemented (Phase 1)

| Method & path | Permission | Purpose |
|---|---|---|
| `GET /health` | public | `{ status, database, dbLatencyMs, serverTime }` — 503 when DB is down |
| `GET /info` | public | `{ appEnv, version, serverTime }` |
| `POST /auth/login` | public (rate-limited) | `{ username, password }` → sets cookie, returns user + permissions |
| `POST /auth/logout` | signed in | Revokes the session server-side |
| `GET /auth/me` | public | `{ user }` or `{ user: null }` |
| `POST /auth/change-password` | signed in | Revokes the user's other sessions |
| `GET /settings` | `settings.view` | Business settings |
| `PATCH /settings` | `settings.manage` | Partial update + `version` |
| `GET /categories[?includeInactive=true]` | `menu.view` | Ordered Food → Drinks → Desserts |
| `POST /categories` | `menu.manage` | Create |
| `PATCH /categories/:id` | `menu.manage` | Partial update + `version` |
| `DELETE /categories/:id?version=n` | `menu.manage` | Delete (Phase 2: refused while products use it) |
| `GET /users` | `users.view` | Staff list (no hashes) |
| `POST /users` | `users.manage` + rank | Create (only roles below your own; owner may create owners) |
| `PATCH /users/:id` | `users.manage` + rank | Name / role / active / password reset + `version`; last active owner protected |
| `GET /audit?limit&before&entityType` | `audit.view` | Newest first, keyset pagination |
| `GET /dashboard/summary` | `dashboard.view` | Business date (Dhaka), DB status, connected devices, staff signed in, category counts |
| `WS /ws` | signed in (cookie, origin-checked) | Server push: `settings.changed`, `categories.changed`, `users.changed` |

## Planned

All state-changing POS endpoints accept an **`Idempotency-Key`** header (UUID generated on
the device when the cashier presses the button). Re-sending the same key returns the
original result instead of creating a second order/payment.

### Phase 2 — Menu items & inventory
| Endpoint | Permission |
|---|---|
| `GET/POST/PATCH/DELETE /products` (+ image upload `POST /products/:id/image`) | `menu.view` / `menu.manage` |
| `GET /products/availability` — portions/orders that can still be taken, per product & category | `menu.view` |
| `GET/POST/PATCH /units`, `/suppliers`, `/ingredients` | `inventory.view` / `inventory.adjust` |
| `GET /ingredients/:id/movements` | `inventory.view` |
| `POST /stock/adjustments` (waste, spoilage, correction, count) | `inventory.adjust` |
| `GET/PUT /products/:id/recipe` | `menu.manage` |
| `POST /production-batches` (prepare N portions), `GET /production-batches` | `production.manage` |
| `GET /stock/low`, `GET /stock/valuation` | `inventory.view` |

### Phase 3 — POS & payments
| Endpoint | Permission |
|---|---|
| `POST /orders` (idempotent; reserves/deducts stock atomically) | `pos.use` |
| `POST /orders/:id/hold`, `/resume`, `/cancel` (stock restore or waste by line state) | `pos.use` / `orders.cancel` |
| `POST /orders/:id/discounts` | `orders.discount` |
| `POST /orders/:id/payments` (idempotent; split payments) | `pos.use` |
| `POST /orders/:id/refunds` | `orders.refund` |
| `GET /orders?date&status` | `orders.view` |
| `GET/POST/PATCH /tax-rates`, `/payment-methods` | `settings.manage` |
| `POST /cash-sessions/open`, `/close`, `GET /cash-sessions/:id/reconciliation` | `cash.reconcile` |
| `POST /sync/batch` — offline queue upload (see OFFLINE.md) | `pos.use` |

### Phase 4 — Stations & printing
| Endpoint | Permission |
|---|---|
| `GET /stations/kitchen/queue`, `/stations/barista/queue`, `POST /order-lines/:id/status` | `kitchen.view` / `barista.view` |
| `GET/POST/PATCH /printers`, `POST /printers/:id/test` | `printers.manage` |
| `POST /orders/:id/reprint` (reason required, audited) | `orders.reprint` |
| Agent-only (device token): `POST /print-agent/claim`, `POST /print-agent/jobs/:id/result`, `POST /print-agent/heartbeat` | print-agent credential |

### Phase 5 — Finance & reports
| Endpoint | Permission |
|---|---|
| `GET/POST /purchases` | `purchases.manage` |
| `GET/POST/PATCH /expenses`, `/expense-categories` | `expenses.manage` |
| `GET /reports/sales|cogs|expenses|profit|payments|categories?from&to&granularity=day|week|month` | `reports.view` |
| `GET /reports/:name/export?format=csv|xlsx|pdf` | `reports.export` |
| `GET /dashboard/summary?period=day|week|month` (extended KPIs) | `dashboard.view` |
