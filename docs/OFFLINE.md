# Bite & Brew — Offline Strategy

> **Owner decision (2026-11-11):** the app must keep running offline and keep its data stored
> online whenever the internet is available. Agreed design: café computer as the primary
> system (works with no internet) → automatic online copy when connected (Phase 6) →
> offline order queue on tills that lose Wi-Fi (Phase 3).

## 1. Two very different kinds of "offline"

| Situation | How likely | Effect with the recommended **on-premises server** |
|---|---|---|
| **Internet down** (ISP outage) | Common | **No effect on tills, kitchen, barista or printers.** All devices talk to the café server over the local Wi-Fi/LAN. Only remote owner access and off-site backup copying pause. |
| **One device loses Wi-Fi** | Occasional | That device shows **OFFLINE**; others continue normally. |
| **Café server / LAN down** (power cut, router failure) | Rare with a UPS | All devices are offline. Only controlled offline order taking is possible (Phase 6). |

This is why the deployment recommendation puts the server **inside the café** with a UPS
(see DEPLOYMENT.md). It removes the most common failure (internet) from the critical path
instead of trying to engineer around it.

## 2. What exists now (Phase 1)

- Every screen shows a status pill: **ONLINE**, **RECONNECTING** (server reachable, live
  updates reconnecting) or **OFFLINE** (no network, server unreachable, or database down).
- An unmissable red **OFFLINE** banner explains which of the three it is and that changes
  cannot be saved.
- Detection: browser online/offline events + `/api/health` poll every 15 s (which also
  reports database status) + WebSocket heartbeat with exponential-backoff reconnect.
- On reconnect, all cached data is refetched (anything may have changed meanwhile).
- The PWA service worker caches **only the application shell**, so the app opens and can
  show its offline state without a connection. **Business data is never served from cache.**
- Writes are never retried automatically (prevents duplicate submissions).

Verified by the browser test "OFFLINE status is clearly displayed…" (see TEST_RESULTS.md).

## 3. Controlled offline ordering (implemented)

Only for devices the owner marks `offline_orders_allowed` (normally the main till).

1. **Local queue**: orders are written to the browser's local storage on that device as an outbox, each
   with a client-generated UUID (`client_request_id`) and a device-prefixed order number
   (e.g. `T1-0007`) so numbers never collide with server-issued ones.
2. **Stock while offline**: the device works from the **last synchronised availability
   snapshot** and decrements it locally. It cannot know what *other* offline devices sold.
   The UI marks items "offline estimate" and blocks items whose cached availability is 0.
3. **Payments offline**: cash only by default. bKash/Nagad/card need their own network and
   confirmation, so they are recorded as "unverified reference" and flagged for review.
4. **Printing offline**: kitchen/barista tickets still print if the **print agent and LAN**
   are up (internet-only outage). If the server itself is down, tickets cannot be routed;
   the till prints nothing automatically and shows the order for verbal hand-off.
5. **Synchronisation** when connectivity returns: `POST /sync/orders` uploads the queue in
   order. Each order is idempotent by `client_request_id` — re-sending is harmless.
6. **Conflict detection**: for each line the server tries the normal atomic stock
   deduction. If stock is insufficient (another device sold it), the order is **still
   recorded** (the food was already served), that line is marked `CONFLICT` without forcing
   stock negative, and the order is flagged **Needs review** (shown on the dashboard and in
   POS → Today's orders) for a manager.
   The server **never silently overwrites** stock counts or drops an order.
7. Manager resolves each conflict: confirm a stock correction (waste, miscount, extra
   batch prepared) or adjust — every resolution is audited.

## 4. Limitations (be aware before relying on offline mode)

- With several devices offline at once, **each sees only its own sales** — two tills can
  both sell the "last" portion. Offline mode trades guaranteed stock accuracy for keeping
  the café trading; conflicts are detected afterwards, not prevented.
- Kitchen and barista screens receive nothing from an offline till until it syncs.
- Owner dashboard figures are incomplete until all devices have synchronised.
- Card / mobile-payment confirmation is not possible without their networks.
- A device whose browser data is cleared while it holds unsynced orders loses them; the POS
  and Settings → This device show how many orders are waiting.
- Offline payments are cash only; offline is allowed per device by a manager/owner.
- Implemented & tested: queue → upload twice → created once with its payment; stock already
  gone → order kept and flagged for review (API tests). Browser-level offline queue on a
  real tablet with Wi-Fi switched off still needs a hands-on check at the café.
- Price or menu changes made while a device is offline reach it only after reconnecting;
  orders keep the price shown at the time of sale.

## 5. Online copy (backups: implemented · live replica: not built)

- Implemented: `scripts/offsite-copy.sh` copies every verified daily backup to the owner's
  cloud storage (Google Drive, OneDrive, Dropbox, B2, S3 via rclone) whenever the internet
  is up; failures retry next hour.
- Not built: a continuously replicated online database. Remote viewing is done by
  connecting to the café server over a VPN (DEPLOYMENT.md).
- If the internet is down for hours or days, the copy simply catches up later; nothing
  in the café waits for it.
- The online copy powers the owner's remote dashboard (read-only) and serves as the
  off-site backup in addition to the daily `pg_dump` files.
