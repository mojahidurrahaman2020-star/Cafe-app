# ADR 0001 — npm-workspaces monorepo with a shared package

**Status:** accepted (Phase 1)

**Context.** The same rules (permissions, validation, money/time formatting) are needed in
the browser and on the server. Duplicating them invites drift: the UI would say one thing
and the server enforce another.

**Decision.** One repository with npm workspaces: `packages/shared`, `apps/server`, `apps/web`.
`@bitebrew/shared` holds the role/permission matrix, Zod schemas, DTO types, money and time
helpers. Both apps import it. `docs/PERMISSIONS.md` is generated from it.

**Consequences.** Shared must be built before the apps (`npm run build:shared`, done by the
root scripts). No extra tooling (Nx/Turborepo) is needed at this size.
