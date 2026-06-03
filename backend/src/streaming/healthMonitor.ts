/**
 * Health Monitor — periodic probe (§4.4 + §4.8). 
 *
 * State machine:
 *   ok       → probe 200
 *   degraded → 5xx 3 times/30s OR 2 consecutive probe failures
 *   down     → degraded sustained 5s with no restore
 *
 * Probe strategy (M3 simplified): only HEAD/GET upstream master, no segments. 
 * upstream unreachable → fail; HTTP 200/206 → ok; HTTP 5xx → 5xx count. 
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';
import { getChannels, getChannel } from './registry.js';

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export type SourceHealth = 'ok' | 'degraded' | 'down';

interface ChannelState {
  status: SourceHealth;
  reason: string;
  consecutiveFails: number;     // consecutive probe failures
  fivexxWindow: number[];        // 5xx timestamp list (30s sliding window)
  degradedAt: number | null;     // timestamp when entering degraded state
  lastChange: number;
}

const state = new Map<string, ChannelState>();
type Listener = (channelId: string, health: SourceHealth, reason: string) => void;
const listeners = new Set<Listener>();

// Thresholds (from §2.5 config table)
const PROBE_INTERVAL_MS = 5_000;
const FIVE_XX_THRESHOLD = 3;            // 3 5xx in 30s → degraded
const FIVE_XX_WINDOW_MS = 30_000;
const CONSECUTIVE_FAIL_TO_DEGRADED = 2; // 2 consecutive failures → degraded
const DEGRADED_TO_DOWN_MS = 5_000;      // degraded sustained 5s → down
const PROBE_TIMEOUT_MS = 8_000;
const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days

export function getHealth(channelId: string): SourceHealth {
  return state.get(channelId)?.status ?? 'ok';
}

export function getAllHealth(): Record<string, { status: SourceHealth; reason: string }> {
  const result: Record<string, { status: SourceHealth; reason: string }> = {};
  for (const [id, s] of state) result[id] = { status: s.status, reason: s.reason };
  return result;
}

export function onChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function startHealthMonitor(): void {
  // Initialize all channel states
  for (const c of getChannels()) {
    if (!state.has(c.id)) {
      state.set(c.id, {
        status: 'ok',
        reason: 'init',
        consecutiveFails: 0,
        fivexxWindow: [],
        degradedAt: null,
        lastChange: Date.now(),
      });
    }
  }
  setInterval(probeAll, PROBE_INTERVAL_MS).unref();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ts: Date.now(), level: 'info', msg: 'health monitor started', intervalMs: PROBE_INTERVAL_MS }));
}

async function probeAll(): Promise<void> {
  await Promise.all(getChannels().map(c => probeOne(c.id, c.primaryUrl)));
}

function probeOne(channelId: string, url: string): Promise<void> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = setTimeout(() => {
      finish();
    }, PROBE_TIMEOUT_MS);

    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.get(parsed, { headers: { 'User-Agent': BROWSER_UA, 'Accept': '*/*' } }, res => {
      res.resume();
      clearTimeout(timer);
      // VOD loop sources (live=false) skip stale check; only LIVE sources are checked
      const ch = getChannel(channelId);
      const lmHeader = res.headers['last-modified'];
      const lastModified = lmHeader ? Date.parse(lmHeader) : 0;
      const isStale = !!ch?.live && lastModified > 0 && (Date.now() - lastModified) > STALE_THRESHOLD_MS;

      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
        if (isStale) {
          const days = Math.floor((Date.now() - lastModified) / 86_400_000);
          markFail(channelId, `stale master: ${days} days old`);
        } else {
          markOk(channelId);
        }
      } else if (res.statusCode && res.statusCode >= 500) {
        mark5xx(channelId);
      } else {
        // 3xx counts as ok (manifest follows redirect); others count as fail
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
          markOk(channelId);
        } else {
          markFail(channelId, `status ${res.statusCode}`);
        }
      }
      finish();
    });
    req.on('error', err => {
      clearTimeout(timer);
      markFail(channelId, err.message);
      finish();
    });
  });
}

function markOk(channelId: string): void {
  const s = state.get(channelId);
  if (!s) return;
  s.consecutiveFails = 0;
  s.fivexxWindow = [];
  if (s.status !== 'ok') {
    transition(channelId, 'ok', 'recovered');
  } else {
    s.reason = 'ok';
  }
}

function mark5xx(channelId: string): void {
  const s = state.get(channelId);
  if (!s) return;
  const now = Date.now();
  s.fivexxWindow = s.fivexxWindow.filter(t => now - t < FIVE_XX_WINDOW_MS);
  s.fivexxWindow.push(now);
  s.consecutiveFails = 0;
  if (s.fivexxWindow.length >= FIVE_XX_THRESHOLD) {
    transition(channelId, 'degraded', `5xx ${s.fivexxWindow.length}/${FIVE_XX_WINDOW_MS / 1000}s`);
  } else {
    s.reason = `5xx ${s.fivexxWindow.length}/${FIVE_XX_THRESHOLD}`;
  }
}

function markFail(channelId: string, reason: string): void {
  const s = state.get(channelId);
  if (!s) return;
  s.consecutiveFails++;
  s.fivexxWindow = [];
  if (s.status === 'ok' && s.consecutiveFails >= CONSECUTIVE_FAIL_TO_DEGRADED) {
    transition(channelId, 'degraded', `consecutive fails × ${s.consecutiveFails}: ${reason}`);
  } else if (s.status === 'ok') {
    s.reason = `fail ${s.consecutiveFails}: ${reason}`;
  } else if (s.status === 'degraded') {
    s.reason = `fail: ${reason}`;
    checkDown(channelId);
  }
}

function transition(channelId: string, next: SourceHealth, reason: string): void {
  const s = state.get(channelId);
  if (!s || s.status === next) return;
  const prev = s.status;
  s.status = next;
  s.reason = reason;
  s.lastChange = Date.now();
  s.degradedAt = next === 'degraded' ? Date.now() : null;
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ts: Date.now(), level: 'warn', msg: 'health change', channelId, from: prev, to: next, reason }));
  for (const l of listeners) {
    try { l(channelId, next, reason); } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[health] listener error', e);
    }
  }
  if (next === 'degraded') {
    setTimeout(() => checkDown(channelId), DEGRADED_TO_DOWN_MS).unref();
  }
}

function checkDown(channelId: string): void {
  const s = state.get(channelId);
  if (!s || s.status !== 'degraded') return;
  if (s.consecutiveFails >= CONSECUTIVE_FAIL_TO_DEGRADED) {
    transition(channelId, 'down', `still failing after ${DEGRADED_TO_DOWN_MS / 1000}s`);
  }
}
