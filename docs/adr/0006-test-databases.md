# ADR 0006 — API tests run on a throwaway database

**Status:** accepted

**Decision.** `npm test` creates a new database `bitebrew_test_<timestamp>`, applies all
migrations with `prisma migrate deploy` (the same command production uses), runs the suite,
then drops only that database.

**Why.** Proves the migrations apply to an empty database on every run, never touches
development or production data, and avoids destructive reset commands.
