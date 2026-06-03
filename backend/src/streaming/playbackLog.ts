/**
 * Playback log — client-side metrics collection (M3.7).
 *
 * 客户端每 5s 上报一次 /api/log-playback（含 channelId + stalls/dropped/avg-buffer 等），
 * 服务端 append 到 /tmp/playback-YYYYMMDD.jsonl（一行一条 JSON）。
 * 测试驱动：scripts/playback-test.sh 控制 2min × 4 频道；
 * 分析：scripts/analyze-playback.py 读 jsonl 给真实质量对比。
 */

import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

const LOG_DIR = '/tmp';
const PREFIX = 'playback-';

function todayFile(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return join(LOG_DIR, `${PREFIX}${yyyy}${mm}${dd}.jsonl`);
}

export interface PlaybackSample {
  channelId: string;
  ts?: number;
  stalls?: number;
  totalStallMs?: number;
  droppedFrames?: number;
  decodedFrames?: number;
  avgBufferSec?: number;
  avgBitrateKbps?: number;
  avgFps?: number;
  event?: 'sample' | 'unmount' | 'mount';
}

export function recordPlayback(data: PlaybackSample): void {
  if (!data.channelId) return;
  const line = JSON.stringify({
    receivedAt: Date.now(),
    ...data,
    ts: data.ts ?? Date.now(),
  });
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(todayFile(), line + '\n', 'utf8');
  } catch {
    // never crash on logging failure
  }
}

// ── /api/playback-summary support ─────────────────────────────────

export interface ChannelSummary {
  samples: number;
  spanSec: number;
  totalStalls: number;
  totalStallMs: number;
  totalDropped: number;
  observedScore: number;       // 0-5, from observed data; null if no data → caller falls back
  reasons: string[];           // e.g. ["buffer dropped to 1.2s"]
  hasData: boolean;
}

const KNOWN_TEST_CHANNELS = new Set(['test', 'smoke-test', 'proxy-test']);

/**
 * Score observed playback quality (0-5).
 * Higher = smoother.
 *
 * Per-minute rate normalization: a channel watched for 30 min with 4 stalls
 * is much smoother than one watched for 4 min with 4 stalls. The total counts
 * are misleading without normalizing by span.
 *
 * 评分维度（按权重）：
 *   - stalls/min  (0-2)   0 → 2, <0.05 → 2, <0.2 → 1.5, <0.5 → 1, ≥0.5 → 0
 *   - dropped/min (0-2)   0 → 2, <0.5 → 2, <2 → 1.5, <10 → 1, ≥10 → 0
 *   - min buffer (0-1)   ≥8s → 1, ≥5s → 0.5, <5s → 0
 *
 * Effective range: 0 (broken) to 5 (perfect). 3 = "watchable with minor issues".
 *
 * ⚠ `decodedFrames` sanity check: a sample with `decodedFrames=0` means the
 * video never actually played a frame on the client. Without this check, a
 * hung source (segments 404, geofenced, etc.) sends all-zero samples for
 * minutes and gets scored as "perfect" (stalls=0, dropped=0, buf=0 → 4/5).
 * We force a low score when decodedFrames is 0 across the whole window.
 */
export function scoreObserved(
  stalls: number,
  dropped: number,
  minBuffer: number,
  spanSec: number,
  decodedFrames = Number.POSITIVE_INFINITY,  // legacy callers may not pass this
): number {
  // No-data guard: client mounted but video never decoded a frame.
  // Caller must opt in by passing decodedFrames explicitly (default = assume
  // it played, to keep the legacy 4-arg call site working).
  if (decodedFrames === 0 && spanSec >= 30) {
    return 0;
  }

  const span = Math.max(spanSec, 30);  // floor at 30s so a 5s test isn't unfair
  const spanMin = span / 60;
  const stallsPerMin = stalls / spanMin;
  const droppedPerMin = dropped / spanMin;

  // Stalls: 0/min = perfect, <0.2/min = great, <0.5/min = fair, ≥0.5 = bad
  const stallPart = stallsPerMin < 0.05 ? 2 : stallsPerMin < 0.2 ? 1.5 : stallsPerMin < 0.5 ? 1 : 0;

  // Dropped: 0/min = perfect, <2/min = great, <10/min = fair, ≥10 = bad
  const dropPart = droppedPerMin < 0.5 ? 2 : droppedPerMin < 2 ? 1.5 : droppedPerMin < 10 ? 1 : 0;

  // Buffer min: absolute value (not rate)
  const bufPart = minBuffer >= 8 ? 1 : minBuffer >= 5 ? 0.5 : 0;

  return Math.max(0, Math.min(5, stallPart + dropPart + bufPart));
}

export function buildReasons(
  stalls: number,
  dropped: number,
  minBuffer: number,
  spanSec: number,
  decodedFrames = Number.POSITIVE_INFINITY,
): string[] {
  const reasons: string[] = [];
  // No-data guard reason first (most informative).
  if (decodedFrames === 0 && spanSec >= 30) {
    reasons.push('no playback observed — video never decoded a frame (hung/geofenced/CORS?)');
  }
  const span = Math.max(spanSec, 30);
  const spanMin = span / 60;
  const stallsPerMin = stalls / spanMin;
  const droppedPerMin = dropped / spanMin;
  if (stallsPerMin >= 0.5) reasons.push(`${stallsPerMin.toFixed(1)} stalls/min (${stalls} in ${Math.round(spanSec)}s)`);
  else if (stalls >= 2) reasons.push(`${stalls} stalls in ${Math.round(spanSec)}s`);
  else if (stalls === 1) reasons.push('1 stall during test');
  if (droppedPerMin >= 10) reasons.push(`${droppedPerMin.toFixed(0)} dropped/min — CDN can't sustain bitrate`);
  else if (droppedPerMin >= 2) reasons.push(`${droppedPerMin.toFixed(1)} dropped/min`);
  else if (dropped >= 5) reasons.push(`${dropped} dropped frames`);
  if (minBuffer > 0 && minBuffer < 2) reasons.push(`buffer dropped to ${minBuffer.toFixed(1)}s`);
  else if (minBuffer >= 5) reasons.push(`buffer stable ≥ ${minBuffer.toFixed(0)}s`);
  return reasons;
}

/**
 * Read today's playback log and aggregate per channel.
 * Used by GET /api/playback-summary.
 */
export function getPlaybackSummary(): Record<string, ChannelSummary> {
  const logFile = todayFile();
  if (!existsSync(logFile)) return {};

  const byChannel = new Map<string, {
    samples: number; span: number;
    maxStalls: number; maxStallMs: number; maxDropped: number;
    minBuffer: number; maxDecoded: number;
    firstTs: number; lastTs: number;
  }>();

  try {
    const content = readFileSync(logFile, 'utf8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const d = JSON.parse(line) as Record<string, unknown>;
        const ch = d.channelId as string;
        if (!ch || KNOWN_TEST_CHANNELS.has(ch) || (d.event && d.event !== 'sample')) continue;
        const cur = byChannel.get(ch) ?? {
          samples: 0, span: 0,
          maxStalls: 0, maxStallMs: 0, maxDropped: 0,
          minBuffer: 999, maxDecoded: 0,
          firstTs: Number.POSITIVE_INFINITY, lastTs: 0,
        };
        cur.samples++;
        const ts = d.ts as number;
        if (ts < cur.firstTs) cur.firstTs = ts;
        if (ts > cur.lastTs) cur.lastTs = ts;
        cur.maxStalls = Math.max(cur.maxStalls, (d.stalls as number) || 0);
        cur.maxStallMs = Math.max(cur.maxStallMs, (d.totalStallMs as number) || 0);
        cur.maxDropped = Math.max(cur.maxDropped, (d.droppedFrames as number) || 0);
        // decodedFrames is cumulative across samples (hls.js returns
        // totalVideoFrames), so MAX over samples ≈ final count.
        cur.maxDecoded = Math.max(cur.maxDecoded, (d.decodedFrames as number) || 0);
        const buf = (d.avgBufferSec as number) || 0;
        if (buf > 0 && buf < cur.minBuffer) cur.minBuffer = buf;
        byChannel.set(ch, cur);
      } catch { /* skip malformed */ }
    }
  } catch { /* file gone */ }

  const out: Record<string, ChannelSummary> = {};
  for (const [ch, c] of byChannel) {
    const span = (c.lastTs - c.firstTs) / 1000;
    const minBuffer = c.minBuffer === 999 ? 0 : c.minBuffer;
    out[ch] = {
      samples: c.samples,
      spanSec: Math.round(span),
      totalStalls: c.maxStalls,
      totalStallMs: c.maxStallMs,
      totalDropped: c.maxDropped,
      observedScore: scoreObserved(c.maxStalls, c.maxDropped, minBuffer, span, c.maxDecoded),
      reasons: buildReasons(c.maxStalls, c.maxDropped, minBuffer, span, c.maxDecoded),
      hasData: true,
    };
  }
  return out;
}
