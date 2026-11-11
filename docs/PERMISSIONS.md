# Bite & Brew — Roles & Permission Matrix

_Generated from `packages/shared/src/roles.ts` by `scripts/gen-permissions-doc.mjs`. Do not edit by hand._

The server checks these permissions on every request; the interface only hides what a role cannot use.
Permissions marked ● are enforced by built endpoints (Phases 1–2); the rest are declared now and enforced when their module ships.
`reports.view` currently controls who can see costs, stock values and margins.

| Permission | Description | Owner | Manager | Cashier | Barista | Kitchen staff |
|---|---|:-:|:-:|:-:|:-:|:-:|
| ● `dashboard.view` | Owner dashboard & KPIs | ✅ | ✅ | — | — | — |
| ● `settings.view` | Read business settings (currency, timezone) | ✅ | ✅ | ✅ | ✅ | ✅ |
| ● `settings.manage` | Change business settings, tax rates, payment methods | ✅ | — | — | — | — |
| ● `menu.view` | See menu categories & products | ✅ | ✅ | ✅ | ✅ | ✅ |
| ● `menu.manage` | Create / edit / delete categories, products, recipes | ✅ | ✅ | — | — | — |
| ● `users.view` | See staff accounts | ✅ | ✅ | — | — | — |
| ● `users.manage` | Create / edit / deactivate staff (only lower roles) | ✅ | ✅ | — | — | — |
| ● `audit.view` | Read the audit log | ✅ | ✅ | — | — | — |
| `pos.use` | Take orders and payments | ✅ | ✅ | ✅ | — | — |
| `orders.view` | See orders | ✅ | ✅ | ✅ | ✅ | ✅ |
| `orders.discount` | Apply discounts | ✅ | ✅ | — | — | — |
| `orders.cancel` | Cancel orders | ✅ | ✅ | — | — | — |
| `orders.refund` | Issue refunds | ✅ | ✅ | — | — | — |
| `orders.reprint` | Reprint receipts / tickets (logged) | ✅ | ✅ | ✅ | — | — |
| `cash.reconcile` | Open / close cash drawer, reconcile | ✅ | ✅ | — | — | — |
| `kitchen.view` | Kitchen ticket queue | ✅ | ✅ | — | — | ✅ |
| `barista.view` | Barista ticket queue | ✅ | ✅ | — | ✅ | — |
| ● `inventory.view` | See stock levels & movements | ✅ | ✅ | — | ✅ | ✅ |
| ● `inventory.adjust` | Add/edit ingredients; record waste, spoilage, corrections, counts | ✅ | ✅ | — | — | — |
| ● `production.manage` | Record batch preparation | ✅ | ✅ | — | — | ✅ |
| ● `purchases.manage` | Receive deliveries (stock in with cost), manage suppliers | ✅ | ✅ | — | — | — |
| `expenses.manage` | Record operating expenses | ✅ | ✅ | — | — | — |
| ● `reports.view` | Financial reports | ✅ | ✅ | — | — | — |
| `reports.export` | Export PDF / CSV / Excel | ✅ | ✅ | — | — | — |
| `printers.manage` | Configure printers, test print | ✅ | ✅ | — | — | — |

## Additional rules

- **Account management by rank**: Owner (100) > Manager (50) > Cashier = Barista = Kitchen (10).
  A user may create/edit only accounts of a strictly lower rank; owners may manage other owners.
- Nobody can change their own role or deactivate themselves.
- The last active Owner cannot be demoted or deactivated.
- Role change, deactivation or password reset immediately signs that person out on every device.
- Sensitive actions are written to the append-only audit log (sign-in, lockout, sign-out,
  password change, settings, categories, staff changes).

## Landing screen per role

| Role | Lands on |
|---|---|
| Owner | `/dashboard` |
| Manager | `/dashboard` |
| Cashier | `/pos` |
| Barista | `/barista` |
| Kitchen staff | `/kitchen` |
