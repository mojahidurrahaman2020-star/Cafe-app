/**
 * Offline order queue for tills (see docs/OFFLINE.md).
 *
 * When the till cannot reach the café server, orders are kept on this device with a
 * client-generated id and uploaded when the connection returns. The server creates each
 * queued order exactly once (idempotent by id) and flags any stock conflicts for review.
 * Only devices where a manager or the owner switched on "Allow offline orders" may queue.
 */
import type { OrderDTO, PaymentMethodDTO, ProductDTO, SessionUser } from '@bitebrew/shared';
import { api } from '../api/client';

const QUEUE = 'bb-offline-orders-v1';
const ALLOWED = 'bb-offline-allowed-v1';
const MENU = 'bb-offline-menu-v1';
const USER = 'bb-last-user-v1';
const METHODS = 'bb-offline-methods-v1';

export interface QueuedOrder {
  clientRequestId: string;
  serviceType: 'DINE_IN' | 'TAKEAWAY';
  tableNo?: string | null;
  customerName?: string;
  customerId?: string;
  notes?: string;
  lines: { productId: string; quantity: number; modifierIds: string[]; notes?: string; name: string; unitPriceMinor: number }[];
  offlinePlacedAt: string;
  totalMinor: number;
  payments: { methodId: string; amountMinor: number; tenderedMinor?: number | null; idempotencyKey: string }[];
  localNo: string;
}

const read = <T>(k: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
};

export const offlineAllowed = () => read<boolean>(ALLOWED, false);
export const setOfflineAllowed = (v: boolean) => write(ALLOWED, v);
export const queuedOrders = () => read<QueuedOrder[]>(QUEUE, []);
export function enqueueOrder(o: QueuedOrder) {
  if (!write(QUEUE, [...queuedOrders(), o])) throw new Error('This device cannot store offline orders (storage is blocked).');
  window.dispatchEvent(new CustomEvent('bb:queue-changed'));
}
export const cacheMenu = (products: ProductDTO[]) => write(MENU, { at: new Date().toISOString(), products });
export const cachedMenu = () => read<{ at: string; products: ProductDTO[] } | null>(MENU, null);
export const cacheMethods = (m: PaymentMethodDTO[]) => write(METHODS, m);
export const cachedMethods = () => read<PaymentMethodDTO[]>(METHODS, []);
export const rememberUser = (u: SessionUser | null) => (u ? write(USER, u) : localStorage.removeItem(USER));
export const lastUser = () => read<SessionUser | null>(USER, null);

let syncing = false;
/** Upload queued orders. Orders the server accepted (or already had) leave the queue. */
export async function syncQueue(): Promise<{ sent: number; flagged: number; failed: number }> {
  const queue = queuedOrders();
  if (!queue.length || syncing) return { sent: 0, flagged: 0, failed: 0 };
  syncing = true;
  try {
    const { results } = await api<{ results: { clientRequestId: string; status: string; needsReview?: boolean }[] }>('POST', '/sync/orders', {
      orders: queue.map(({ lines, localNo: _n, totalMinor: _t, ...o }) => ({ ...o, lines: lines.map(({ name: _x, unitPriceMinor: _y, ...l }) => l) })),
    });
    const done = new Set(results.filter((r) => r.status !== 'error').map((r) => r.clientRequestId));
    write(QUEUE, queuedOrders().filter((q) => !done.has(q.clientRequestId)));
    window.dispatchEvent(new CustomEvent('bb:queue-changed'));
    return { sent: done.size, flagged: results.filter((r) => r.needsReview).length, failed: results.filter((r) => r.status === 'error').length };
  } finally {
    syncing = false;
  }
}

export type { OrderDTO };
