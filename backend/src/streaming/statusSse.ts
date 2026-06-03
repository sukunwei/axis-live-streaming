/**
 * Status SSE — /events route (§6.2).
 *
 * Protocol:
 *   GET /events
 *   Content-Type: text/event-stream
 *   Cache-Control: no-cache
 *   Connection: keep-alive
 *
 * Events:
 *   event: source-health
 *   data: {"channel":"<id>","status":"ok|degraded|down","reason":"...","ts":<ms>}
 *
 * Keep-alive: comment frame every 15s `: ping\n\n`
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { getAllHealth, onChange } from './healthMonitor.js';

const HEARTBEAT_MS = 15_000;
const clients = new Set<ServerResponse>();

export function startSseBroadcaster(): void {
  onChange((channelId, status, reason) => {
    const event = formatEvent('source-health', {
      channel: channelId,
      status,
      reason,
      ts: Date.now(),
    });
    for (const res of clients) {
      try { res.write(event); } catch { /* client gone */ }
    }
  });
}

export function handleSse(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Accel-Buffering': 'no',  // disable nginx buffering (in production deploys)
  });
  res.write(': connected\n\n');

  // initial state: send current state of all channels
  for (const [channel, h] of Object.entries(getAllHealth())) {
    res.write(formatEvent('source-health', {
      channel,
      status: h.status,
      reason: h.reason,
      ts: Date.now(),
    }));
  }

  clients.add(res);
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* will be cleaned up below */ }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  const cleanup = (): void => {
    clearInterval(heartbeat);
    clients.delete(res);
    try { res.end(); } catch { /* already ended */ }
  };
  res.on('close', cleanup);
  res.on('error', cleanup);
}

function formatEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
