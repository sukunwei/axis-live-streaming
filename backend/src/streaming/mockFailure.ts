/**
 * Mock failure injector — demo use (M3.5).
 *
 * POST /mock/break/:channelId  → For the next 30s all HLS requests for that channel return 500
 * POST /mock/restore           → restore
 * GET  /mock/status            → current mock status
 *
 * dev mode only: in production (NODE_ENV=production) these routes return 404. 
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { getChannel } from './registry.js';

const BROKEN_TTL_MS = 30_000;
const broken = new Map<string, number>();  // channelId → expireAt

export function isBroken(channelId: string): boolean {
  const exp = broken.get(channelId);
  if (!exp) return false;
  if (Date.now() > exp) {
    broken.delete(channelId);
    return false;
  }
  return true;
}

export function mountMockFailure(): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ts: Date.now(), level: 'info', msg: 'mock failure injector mounted' }));
}

export function handleMockRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  if (!url.pathname.startsWith('/mock/')) return false;

  if (url.pathname === '/mock/status' && req.method === 'GET') {
    const out: Record<string, number> = {};
    const now = Date.now();
    for (const [k, exp] of broken) {
      if (exp > now) out[k] = Math.ceil((exp - now) / 1000);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out));
    return true;
  }

  const breakMatch = url.pathname.match(/^\/mock\/break\/([\w-]+)$/);
  if (breakMatch && (req.method === 'POST' || req.method === 'GET')) {
    const ch = getChannel(breakMatch[1]);
    if (!ch) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('channel not found');
      return true;
    }
    broken.set(ch.id, Date.now() + BROKEN_TTL_MS);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ts: Date.now(), level: 'warn', msg: 'mock break', channelId: ch.id, ttlSec: BROKEN_TTL_MS / 1000 }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, channelId: ch.id, brokenForSec: BROKEN_TTL_MS / 1000 }));
    return true;
  }

  if (url.pathname === '/mock/restore' && req.method === 'POST') {
    broken.clear();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, restored: true }));
    return true;
  }

  return false;
}
