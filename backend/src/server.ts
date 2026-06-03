/**
 * Axis Live Streaming — HTTP server entry
 *
 * Routes:
 *   GET  /health             — process liveness
 *   GET  /channels           — channel registry
 *   GET  /hls/:channel/*     — HLS proxy (manifest rewrite + segment stream forwarding)
 *   GET  /events             — SSE: source health (Phase 3 implementation)
 *
 * Phase 1 implements /health /channels /hls/*; /events placeholder returns 501.
 */

import http from 'http';
import { URL } from 'url';
import { writeFileSync, appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { getChannels } from './streaming/registry.js';
import { handleHlsProxy } from './streaming/proxy.js';
import { startHealthMonitor, getAllHealth } from './streaming/healthMonitor.js';
import { startSseBroadcaster, handleSse } from './streaming/statusSse.js';
import { mountMockFailure, handleMockRoute } from './streaming/mockFailure.js';
import { recordPlayback, getPlaybackSummary } from './streaming/playbackLog.js';
import { sendGzipped } from './http/gzip.js';

/**
 * Smoothness score (0-5).
 *   base = min(3, variants/2)        // more variants → more ABR flexibility
 *   LIVE source +1                    // real live usually more stable than VOD loop
 *   health penalty: degraded -1, down -2
 *   range [0, 5]
 */
function computeSmoothness(c: { id: string; live: boolean; variants: number }): number {
  const base = Math.min(3, Math.floor(c.variants / 2));
  const liveBonus = c.live ? 1 : 0;
  const health = getAllHealth()[c.id]?.status;
  const healthPenalty = health === 'down' ? -2 : health === 'degraded' ? -1 : 0;
  return Math.max(0, Math.min(5, base + liveBonus + healthPenalty));
}

const PORT = Number(process.env.PORT ?? 5174);
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

function log(level: string, msg: string, extra?: Record<string, unknown>): void {
  if (level === 'debug' && LOG_LEVEL !== 'debug') return;
  const line = { ts: Date.now(), level, msg, ...extra };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(line));
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (req.method === 'GET' && url.pathname === '/channels') {
    const summary = getPlaybackSummary();
    const allChannels = getChannels();

    // Collect unique upstream origins (primary + backups) for preconnect hints.
    // The frontend injects <link rel="preconnect"> for each so the TLS/TCP
    // handshake completes before the first manifest/segment fetch.
    const originSet = new Set<string>();
    for (const c of allChannels) {
      try { originSet.add(new URL(c.primaryUrl).origin); } catch { /* skip bad url */ }
      for (const b of c.backupUrls) {
        try { originSet.add(new URL(b).origin); } catch { /* skip */ }
      }
    }
    const upstreamOrigins = [...originSet].sort();

    const enriched = allChannels
      .map(c => {
        const observed = summary[c.id];
        const staticScore = computeSmoothness(c);
        // Use observed as ground truth when we have enough samples (>= 5);
        // otherwise fall back to static score.
        const haveEnoughData = !!observed && observed.samples >= 5;
        const finalScore = haveEnoughData ? observed!.observedScore : staticScore;
        return {
          id: c.id,
          sport: c.sport,
          category: c.category,
          name: c.name,
          type: c.type,
          masterPath: c.masterPath,
          streamUrl: `/hls/${c.id}/${c.masterPath}`,
          backupStreamUrls: c.backupUrls,
          live: c.live,
          variants: c.variants,
          smoothnessScore: finalScore,
          staticScore,
          observed: observed ?? null,
        };
      })
      .sort((a, b) => {
        // Sports group first, then others; within each group, strongest smoothness first.
        if (a.category !== b.category) {
          return a.category === 'sports' ? -1 : 1;
        }
        return b.smoothnessScore - a.smoothnessScore;
      });

    // SWR cache: channel list changes rarely (registry + smoothness score).
    // 60s fresh + 600s stale-while-revalidate keeps clients snappy on
    // re-mount without making the UI feel stale.
    sendGzipped(req, res, {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ channels: enriched, upstreamOrigins }),
      extra: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=600' },
    });
    return;
  }

  if (url.pathname === '/api/playback-summary' && req.method === 'GET') {
    sendGzipped(req, res, {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(getPlaybackSummary()),
      extra: { 'Access-Control-Allow-Origin': '*' },
    });
    return;
  }

  if (url.pathname.startsWith('/hls/')) {
    log('debug', 'hls request', { path: url.pathname });
    await handleHlsProxy(req, res, url);
    return;
  }

  if (url.pathname === '/events') {
    handleSse(req, res);
    return;
  }

  if (handleMockRoute(req, res, url)) {
    return;
  }

  if (url.pathname === '/api/log-playback' && (req.method === 'POST' || req.method === 'OPTIONS')) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        recordPlayback(data);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end('{"ok":true}');
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(`{"error":"${(e as Error).message}"}`);
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

httpServer.listen(PORT, () => {
  log('info', 'server listening', { port: PORT, level: LOG_LEVEL });
  // eslint-disable-next-line no-console
  console.log(`➜ Local: http://localhost:${PORT}`);
  // -- start background services ------------------------------
  startHealthMonitor();
  startSseBroadcaster();
  mountMockFailure();
});
