# Bite & Brew — Owner's Guide

A short, practical guide for running the café on the system. For installation see
[DEPLOYMENT.md](DEPLOYMENT.md).

## First day: set up in this order

1. **Sign in as the owner** (account created with `npm run create-owner`).
2. **Business settings** → check name, address, phone (printed on receipts), timezone
   *Asia/Dhaka*, currency *BDT ৳*, number of tables, and the receipt footer.
3. **Tax / VAT** (on the Settings page) → add your VAT rate if you are registered and choose
   whether menu prices already include it. Until you add one, no tax is charged.
4. **Payment methods** → Cash, Card, bKash and Nagad are ready. Add others (Rocket, Upay, bank).
5. **Staff & roles** → create one account per person (cashier, barista, kitchen, manager).
   Everyone signs in with their own account so every sale is traceable.
6. **Inventory → Suppliers** and **Inventory → Ingredients** → add what you buy, the unit you
   count it in (kg, g, L, mL, pieces) and a minimum level for low-stock warnings.
7. **Inventory → Receive** → record what is in stock today and what you paid (opening stock).
8. **Menu categories** → already created (Tehari, Biriyani, … Desserts). Each sends tickets to
   the kitchen or barista printer.
9. **Menu items** → add each item with its price and how its stock works:
   - *Batch cooked* (Tehari, Biriyani, Khichuri): add a recipe for one pot and how many
     portions it makes. Each morning record the batch on **Production**.
   - *Made to order* (coffee, burgers): add the recipe for one portion; ingredients are used
     when it is sold.
   - *Ready-made* (bottled drinks, bought desserts): receive units with their cost.
   - Add customisation options (milk type, extra shot, spice level) on the **Options** tab.
10. **Printers** → when the printers arrive, enter each one's IP address, choose 58 or 80 mm,
    press *Save & check connection*, then *Test print*.
11. On the main till: **Settings → This device → Allow offline orders** (manager/owner only).

## Every day

| When | Who | Where |
|---|---|---|
| Opening | Cashier | POS → **Open cash drawer** with the float |
| Morning cooking | Kitchen | **Production** → record each batch (e.g. 20 × Chicken Biriyani) |
| All day | Cashier | **POS** → tap items → Send & pay. Dine-in: choose the table. Hold an order to finish later |
| All day | Kitchen / Barista | **Kitchen** / **Barista** screens → Start → Ready → Served |
| Deliveries | Manager | **Inventory → Receive** with the amount paid |
| Waste | Manager | **Inventory → Adjust** (waste / spoilage) or the item's Stock tab |
| Bills paid | Manager | **Expenses** → rent, electricity, salaries… |
| Closing | Manager | POS → **Drawer** → count the cash → Close drawer (shows any difference) |
| Any time | Owner | **Dashboard** and **Reports** (today / week / month, PDF / Excel / CSV) |

## Good to know

- **Prices and stock are checked on the server.** Two tills can never sell the last portion
  twice; double-tapping a button never creates two orders or payments.
- **Cancelling an order**: items not yet started go back into stock; items already being made
  are recorded as waste. Paid orders must be refunded first (manager/owner).
- **Reprints** need a reason and are marked "REPRINT" on the paper.
- **Discounts and refunds** are manager/owner only and always need a reason.
- **Internet down**: the café keeps working on the local network. If a till loses its
  connection to the café computer it shows OFFLINE; if allowed, it keeps taking cash orders
  and uploads them when reconnected. Any stock clash is shown on the Dashboard for review.
- **Profit** on the dashboard is an estimate: net sales − cost of ingredients actually used
  − waste − expenses. Stock you buy is not an expense until it is used.
- Everything sensitive is recorded in the **Audit log**.
