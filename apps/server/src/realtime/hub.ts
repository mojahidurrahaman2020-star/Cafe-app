import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { RealtimeEvent } from '@bitebrew/shared';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { resolveSession, SESSION_COOKIE } from '../modules/auth/session.js';

interface Client {
  ws: WebSocket;
  userId: string;
  sessionCookie: string;
  alive: boolean;
}

const clients = new Set<Client>();
let wss: WebSocketServer | null = null;

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  if (env.webOrigins.includes(origin)) return true;
  // Same-origin deployment (server also serves the web app)
  const host = req.headers.host;
  return !!host && (origin === `http://${host}` || origin === `https://${host}`);
}

export function attachRealtime(server: Server) {
  wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  server.on('upgrade', async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const reject = (code: number, text: string) => {
      socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    try {
      if (!req.url?.startsWith('/ws')) return reject(404, 'Not Found');
      if (!originAllowed(req)) return reject(403, 'Forbidden');
      const token = readCookie(req.headers.cookie, SESSION_COOKIE);
      const session = await resolveSession(token);
      if (!session || !token) return reject(401, 'Unauthorized');

      wss!.handleUpgrade(req, socket, head, (ws) => {
        const client: Client = { ws, userId: session.user.id, sessionCookie: token, alive: true };
        clients.add(client);
        ws.on('pong', () => (client.alive = true));
        ws.on('close', () => clients.delete(client));
        ws.on('error', () => clients.delete(client));
        // Clients only listen in Phase 1; ignore inbound messages.
        ws.on('message', () => undefined);
        send(ws, { type: 'hello', serverTime: new Date().toISOString() });
      });
    } catch (err) {
      logger.error({ err }, 'WebSocket upgrade failed');
      reject(500, 'Internal Server Error');
    }
  });

  // Heartbeat + periodic re-validation, so a revoked/expired session is disconnected.
  const interval = setInterval(async () => {
    for (const c of clients) {
      if (!c.alive) {
        c.ws.terminate();
        clients.delete(c);
        continue;
      }
      c.alive = false;
      c.ws.ping();
      const still = await resolveSession(c.sessionCookie).catch(() => null);
      if (!still) {
        c.ws.close(4001, 'Session ended');
        clients.delete(c);
      }
    }
  }, 30_000);
  interval.unref();
}

function send(ws: WebSocket, event: RealtimeEvent) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
}

export function broadcast(event: RealtimeEvent) {
  for (const c of clients) send(c.ws, event);
}

export const connectedClientCount = () => clients.size;
