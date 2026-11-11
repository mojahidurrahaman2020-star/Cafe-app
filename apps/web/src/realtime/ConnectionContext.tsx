import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RealtimeEvent } from '@bitebrew/shared';
import { useAuth } from '../auth/AuthContext';
import { IS_ONLINE_DEMO } from '../lib/demo';

/**
 * Connectivity model (see docs/OFFLINE.md):
 *  - ONLINE:      server reachable and live-update channel connected
 *  - DEGRADED:    server reachable but live updates disconnected (auto-retrying)
 *  - OFFLINE:     device has no network, or server/database unreachable
 */
export type ConnectionStatus = 'ONLINE' | 'DEGRADED' | 'OFFLINE';

interface ConnectionState {
  status: ConnectionStatus;
  browserOnline: boolean;
  serverReachable: boolean;
  databaseUp: boolean;
  liveConnected: boolean;
  lastCheckedAt: Date | null;
}

const Ctx = createContext<ConnectionState | null>(null);
const HEALTH_INTERVAL_MS = 15_000;

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [browserOnline, setBrowserOnline] = useState(navigator.onLine);
  const [serverReachable, setServerReachable] = useState(true);
  const [databaseUp, setDatabaseUp] = useState(true);
  const [liveConnected, setLiveConnected] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Browser online/offline events
  useEffect(() => {
    const on = () => setBrowserOnline(true);
    const off = () => setBrowserOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // Health polling (detects "Wi-Fi up but server/database down")
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        const body = (await res.json().catch(() => ({}))) as { database?: string };
        if (cancelled) return;
        setServerReachable(true);
        setDatabaseUp(body.database === 'up');
      } catch {
        if (!cancelled) setServerReachable(false);
      } finally {
        if (!cancelled) setLastCheckedAt(new Date());
      }
    };
    void check();
    const id = setInterval(check, HEALTH_INTERVAL_MS);
    window.addEventListener('online', check);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener('online', check);
    };
  }, []);

  // Live updates over WebSocket, with exponential back-off reconnect
  useEffect(() => {
    if (!user) return;
    if (IS_ONLINE_DEMO) {
      // The online demo has no server to push live updates; data changes locally.
      setLiveConnected(true);
      return;
    }
    let stopped = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setLiveConnected(true);
        // Anything may have changed while we were disconnected.
        void qc.invalidateQueries();
      };
      ws.onmessage = (msg) => {
        let ev: RealtimeEvent;
        try {
          ev = JSON.parse(String(msg.data)) as RealtimeEvent;
        } catch {
          return;
        }
        if (ev.type === 'settings.changed') void qc.invalidateQueries({ queryKey: ['settings'] });
        if (ev.type === 'categories.changed') void qc.invalidateQueries({ queryKey: ['categories'] });
        if (ev.type === 'users.changed') void qc.invalidateQueries({ queryKey: ['users'] });
        if (ev.type === 'orders.changed') {
          for (const k of ['orders', 'order', 'station', 'cash', 'dashboard', 'print-jobs', 'printers', 'report']) void qc.invalidateQueries({ queryKey: [k] });
        }
        if (ev.type === 'printers.changed') {
          for (const k of ['printers', 'print-jobs', 'dashboard']) void qc.invalidateQueries({ queryKey: [k] });
        }
        if (ev.type === 'finance.changed') {
          for (const k of ['expenses', 'report', 'cash', 'dashboard']) void qc.invalidateQueries({ queryKey: [k] });
        }
        if (ev.type === 'settings.changed') {
          for (const k of ['tax-rates', 'payment-methods']) void qc.invalidateQueries({ queryKey: [k] });
        }
        if (ev.type === 'products.changed' || ev.type === 'inventory.changed') {
          for (const k of ['products', 'availability', 'ingredients', 'suppliers', 'movements', 'batches', 'production-preview']) {
            void qc.invalidateQueries({ queryKey: [k] });
          }
        }
        if (ev.type !== 'hello') void qc.invalidateQueries({ queryKey: ['dashboard'] });
      };
      ws.onclose = (e) => {
        setLiveConnected(false);
        if (stopped) return;
        if (e.code === 4001) {
          window.dispatchEvent(new CustomEvent('bb:unauthorized'));
          return;
        }
        const delay = Math.min(30_000, 1000 * 2 ** attempt++);
        timer = setTimeout(connect, delay);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      wsRef.current?.close();
      setLiveConnected(false);
    };
  }, [user, qc]);

  const offline = !browserOnline || !serverReachable || !databaseUp;
  const status: ConnectionStatus = offline ? 'OFFLINE' : user && !liveConnected ? 'DEGRADED' : 'ONLINE';

  return (
    <Ctx.Provider value={{ status, browserOnline, serverReachable, databaseUp, liveConnected, lastCheckedAt }}>
      {children}
    </Ctx.Provider>
  );
}

export function useConnection() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useConnection outside ConnectionProvider');
  return c;
}
