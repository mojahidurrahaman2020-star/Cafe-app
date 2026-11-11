# ADR 0005 — Recommend an on-premises server as primary

**Status:** proposed for owner approval

**Context.** The café needs to keep trading through internet outages; printers live on the LAN.

**Decision.** Recommend a small always-on PC in the café (with UPS) running PostgreSQL, the
app and the print agent via Docker, with daily verified backups copied off-site and optional
VPN for remote owner access. Cloud hosting remains possible with the same images.

**Trade-off.** Requires owning hardware and doing off-site backups, in exchange for
internet-independence of daily operations. Device-level offline queuing (Phase 6) then only
needs to cover the rarer "server/LAN down" case.
