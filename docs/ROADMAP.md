# Bite & Brew — Development Roadmap

Each phase ends with acceptance tests run and recorded in `TEST_RESULTS.md`, and waits for
the owner's approval before the next phase starts.

| Phase | Scope | Key acceptance criteria |
|---|---|---|
| **1 — Foundation** ✅ | Monorepo, React PWA, Node API, PostgreSQL + Prisma migrations, secure login, roles & permissions, audit log, owner dashboard layout, navigation, business settings (BDT, Asia/Dhaka), menu category management, live updates, OFFLINE indicator, backups, Docker | See `TEST_RESULTS.md` |
| **2 — Menu items & inventory** ✅ | Products (price, cost, station, image, customisation options), units & conversions, suppliers, raw ingredients, stock ledger, recipes with yields & wastage, **batch production** (prepare 20 Biriyani → 20 portions), made-to-order recipes, waste/spoilage/adjustments/stock counts, low-stock & sold-out, **availability per item and per category** ("how many can still be ordered") | Preparing a batch deducts raw stock once; selling portions never deducts raw stock again; conversions exact; ledger reconciles to on-hand |
| **3 — POS & payments** | Touch POS, dine-in/takeaway, tables, order numbers, customisation, notes, holds, discounts, owner-configured VAT, cash/card/bKash/Nagad/split, cancellations (restore vs waste), refunds, idempotent submission, atomic stock reservation, cash drawer sessions & daily reconciliation, **offline order queue on tills with sync & conflict review** (moved forward from Phase 6 at the owner's request) | Two tills racing for the last portion → exactly one succeeds; double-tap never creates two orders/payments; totals correct to the paisa; a till with Wi-Fi switched off keeps taking orders and syncs them exactly once |
| **4 — Stations & printing** | Kitchen and barista live queues, print agent, three printer destinations with automatic split, 58/80 mm, test print, status, controlled reprint, failure log, duplicate prevention | Verified **on the purchased printers**; pulled-cable and paper-out tests |
| **5 — Finance & reports** | Stock purchases (inventory, not COGS), expenses & categories, COGS from consumption, gross/net profit estimate, daily/weekly/monthly/custom reports, payment & category breakdowns, live owner dashboard KPIs, PDF/CSV/Excel export | Report figures reconcile with order, payment and stock ledgers |
| **6 — Online copy & hardening** | Automatic online copy of the café database when internet is available (off-site safety + owner remote dashboard), device registration, PIN quick-switch for shared tablets, session idle lock, WAL backups, monitoring, load test with all devices, staff training material, go-live checklist | Internet cut for a day → café keeps trading; online copy catches up automatically with nothing lost or duplicated |

Rationale for the order: printing and POS both need products and stock (Phase 2) to exist;
financial reports need sales and purchases; offline sync needs the final order model.

**2026-11-11 — owner decision:** the app must run offline and keep data stored online when
connected. Delivered as: café computer (works without internet) + automatic online copy
(Phase 6) + offline order queue on tills (Phase 3). See ADR 0005 and OFFLINE.md.
