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
    const enriched = getChannels()
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
      .sort((a, b) => b.smoothnessScore - a.smoothnessScore);  // strong → weak
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(enriched));
    return;
  }

  if (url.pathname === '/api/playback-summary' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(getPlaybackSummary()));
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
