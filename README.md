# Bite & Brew — Café & Hangout

Café management platform for **Bite & Brew** (est. 2027, Dhaka): POS, kitchen & barista
stations, raw & finished-goods inventory, three-printer ticket routing, and finance reporting.
Currency BDT (৳), timezone Asia/Dhaka. Runs in the browser on Windows PCs and touchscreen
tablets, all connected to one central PostgreSQL database.

**Current status: Phase 1 (Foundation) complete** — see [docs/ROADMAP.md](docs/ROADMAP.md)
and [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md).

| Area | Status |
|---|---|
| Secure login, 5 roles, permissions, audit log | ✅ Phase 1 |
| Business settings (BDT, Asia/Dhaka), menu categories | ✅ Phase 1 |
| Owner dashboard layout, live updates, OFFLINE indicator, PWA | ✅ Phase 1 |
| Products, inventory, recipes, batch production | Phase 2 |
| POS, payments (cash/card/bKash/Nagad), VAT, refunds | Phase 3 |
| Kitchen/barista screens, three thermal printers | Phase 4 |
| Purchases, expenses, profit reports, exports | Phase 5 |
| Offline order queue & sync | Phase 6 |

## Quick start (development)

Requirements: **Node.js 22+**, **PostgreSQL 16** (local install or Docker).

```bash
# 1. Database (example using a local PostgreSQL superuser)
psql -U postgres -c "CREATE ROLE bitebrew LOGIN PASSWORD 'bitebrew_dev' CREATEDB;"
psql -U postgres -c "CREATE DATABASE bitebrew_dev OWNER bitebrew;"
#    …or: docker run -d --name bb-pg -p 5432:5432 -e POSTGRES_USER=bitebrew \
#           -e POSTGRES_PASSWORD=bitebrew_dev -e POSTGRES_DB=bitebrew_dev postgres:16

# 2. Install and configure
npm install
cp apps/server/.env.example apps/server/.env      # edit DATABASE_URL if needed

# 3. Create the schema and data
npm run build:shared
npm run db:deploy          # apply migrations
npm run db:seed:demo       # DEMO ONLY: settings, 9 categories, one demo account per role

# 4. Run API (port 4000) + web app (port 5173)
npm run dev
```

Open **http://localhost:5173** — tablets on the same Wi-Fi can use `http://<this-PC's-IP>:5173`.

### Demo accounts (development/demo databases only)

| Role | Username | Password |
|---|---|---|
| Owner | `owner` | `demo-pass-2027` |
| Manager | `manager` | `demo-pass-2027` |
| Cashier | `cashier` | `demo-pass-2027` |
| Barista | `barista` | `demo-pass-2027` |
| Kitchen staff | `kitchen` | `demo-pass-2027` |

A striped **"development environment — demo/sample data only"** banner appears on every
screen whenever `APP_ENV` is not `production`. The demo seed refuses to run in production.

### Owner dashboard

Sign in as an Owner (or Manager) → you land on **/dashboard**. The sidebar gives access to
Menu categories, Staff & roles, Audit log and Business settings (owner can edit; manager read-only).

### Real (production) owner account

```bash
npm run create-owner          # prompts for username, full name, password (min 10 chars)
```

## Tests

```bash
npm run typecheck   # TypeScript across all packages
npm test            # unit tests + API tests on a throwaway database (needs a role with CREATEDB)
npm run test:e2e    # browser acceptance tests — app must be running with the demo seed
```

## Production

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): Docker Compose (PostgreSQL + app + daily
backups) on an always-on PC in the café, HTTPS via Caddy, restore procedure.

## Documentation

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System diagram, stack choices & trade-offs, code layout |
| [DATABASE.md](docs/DATABASE.md) | ERD, implemented schema, planned inventory/sales/printing/finance schema |
| [API.md](docs/API.md) | Implemented and planned endpoints |
| [PERMISSIONS.md](docs/PERMISSIONS.md) | Role × permission matrix (generated from code) |
| [PRINTING.md](docs/PRINTING.md) | Three-printer architecture, **printer compatibility checklist** |
| [OFFLINE.md](docs/OFFLINE.md) | Offline strategy and its limitations |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deployment architecture, backups, recovery |
| [ROADMAP.md](docs/ROADMAP.md) | Phases 1–6 |
| [TEST_RESULTS.md](docs/TEST_RESULTS.md) | Actual test results |
| [PROGRESS_LOG.md](docs/PROGRESS_LOG.md) | Development log |
| [adr/](docs/adr) | Architecture decision records |
