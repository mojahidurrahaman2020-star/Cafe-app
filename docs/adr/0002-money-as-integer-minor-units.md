# ADR 0002 — Money as integer minor units (paisa)

**Status:** accepted

**Decision.** All monetary amounts are integers in the currency's minor unit (৳1 = 100 paisa),
stored in `INT`/`BIGINT` `*_minor` columns. Display uses `formatMoney` with the owner's
symbol, decimal places and digit grouping (lakh/crore by default: ৳1,25,000.00).
Tax rates are basis points (integers). Rounding happens once, at defined points
(line total, tax total), with the rule documented in Phase 3.

**Why.** Floating point cannot represent 0.10 exactly; accounting totals must match to the paisa.
