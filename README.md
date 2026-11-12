# Bite & Brew — Café & Hangout

Café management platform for **Bite & Brew** (est. 2027, Dhaka): POS, kitchen & barista
stations, raw & finished-goods inventory, three-printer ticket routing, and finance reporting.
Currency BDT (৳), timezone Asia/Dhaka. Runs in the browser on Windows PCs and touchscreen
tablets, all connected to one central PostgreSQL database.

**Current status: complete café system** — see [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md)
and the [Owner's Guide](docs/OWNER_GUIDE.md).

| Area | Status |
|---|---|
| Secure login, 5 roles, permissions, audit log | ✅ |
| Business settings (BDT ৳, Asia/Dhaka), VAT rates, payment methods, tables | ✅ |
| Menu categories & items, recipes, options, photos | ✅ |
| Ingredients, suppliers, deliveries, waste/spoilage/counts, stock ledger | ✅ |
| Batch production; live "what can we sell now" per item and category | ✅ |
| POS: dine-in/takeaway, tables, options, notes, discounts, VAT, held orders | ✅ |
| Payments: cash (change), card, bKash, Nagad, split; refunds; cancellations | ✅ |
| Cash drawer open/close with reconciliation | ✅ |
| Kitchen & barista live screens | ✅ |
| Three printers (receipt / barista / kitchen), auto-split, ESC/POS, reprint, status | ✅ built — **not yet tested on real printers** |
| Expenses, financial reports (day/week/month/custom), PDF / Excel / CSV | ✅ |
| Owner dashboard with live figures | ✅ |
| Regular customers (name + phone, visit history, pick at the till) | ✅ |
| Offline order queue on tills with sync & conflict review | ✅ |
| Daily backups, restore, off-site copy script | ✅ (off-site needs your cloud account) |
| Live online replica + remote owner dashboard | Not built (use VPN to the café server — see DEPLOYMENT.md) |

## Put it online as a website

See [docs/WEBSITE_HOSTING.md](docs/WEBSITE_HOSTING.md) (one-click Render blueprint in `render.yaml`;
first visit shows a page to create the owner account).

## Try it online (no installation)

A browser-only **online demo** with sample data is published as a private claude.ai page
(link shared with the owner). It runs the real screens and business rules against an
in-browser stand-in for the server; changes are saved only in that browser (Reset demo
restores the sample data). Rebuild it with:

```bash
node scripts/snapshot-demo.mjs           # copy sample data from a running DEMO server
node scripts/build-online-demo.mjs online-demo.html
```

The online demo is for trying the app only — the café runs the real server and database below.

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
npm run db:seed:demo       # DEMO ONLY: demo accounts, sample menu, ingredients & opening stock

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

## Remaining / not included

- **Physical printer test** — required before go-live; follow the checklist in docs/PRINTING.md.
- **Bangla text on thermal printers** — printers print `Tk` for ৳ and `?` for Bangla letters;
  bitmap printing can be added after testing the purchased printers.
- **Live online replica / remote dashboard** — owners reach the café server remotely through a
  VPN (Tailscale/WireGuard); off-site safety is covered by the backup copy script.
- PIN quick-switch on shared tablets, load testing with every device at once.

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
| [OWNER_GUIDE.md](docs/OWNER_GUIDE.md) | Day-one setup and daily routine |
| [ROADMAP.md](docs/ROADMAP.md) | How it was built, what remains |
| [TEST_RESULTS.md](docs/TEST_RESULTS.md) | Actual test results |
| [PROGRESS_LOG.md](docs/PROGRESS_LOG.md) | Development log |
| [adr/](docs/adr) | Architecture decision records |
