# ADR 0004 — Optimistic concurrency with a version column

**Status:** accepted

**Decision.** Editable records carry `version`. Updates are `UPDATE … WHERE id = $1 AND version = $2`
and increment the version. Zero rows updated → HTTP 409 `STALE_VERSION` with the current record;
the UI reloads and tells the user someone else saved first.

**Why.** "Multiple users without overwriting each other's work." Pessimistic locks held while a
person edits a form are fragile on tablets that sleep or drop Wi-Fi.

**Stock is different:** stock quantities are never edited as values; they change only through
ledger movements with conditional atomic updates (`… SET on_hand = on_hand - n WHERE on_hand >= n`)
inside the order transaction (Phase 2/3).
