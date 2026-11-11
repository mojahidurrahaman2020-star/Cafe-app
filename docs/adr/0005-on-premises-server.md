# ADR 0005 — Recommend an on-premises server as primary

**Status:** accepted by the owner (2026-11-11) — together with an automatic online copy

**Context.** The café needs to keep trading through internet outages; printers live on the LAN.

**Decision.** Recommend a small always-on PC in the café (with UPS) running PostgreSQL, the
app and the print agent via Docker, with daily verified backups copied off-site and optional
VPN for remote owner access. Cloud hosting remains possible with the same images.

**Trade-off.** Requires owning hardware and doing off-site backups, in exchange for
internet-independence of daily operations. Device-level offline queuing (Phase 6) then only
needs to cover the rarer "server/LAN down" case.

**Owner decision (2026-11-11).** Approved as the *hybrid* model: the café computer is the
primary system and keeps working without internet; whenever the internet is available the
data is also copied to an online server (off-site safety + owner remote viewing); a till
that loses Wi-Fi keeps taking orders and synchronises later. Device-level offline ordering
moves forward to Phase 3 (built together with the POS) instead of Phase 6.
