/**
 * hls.js config — "smoothness-first" tuning (M3.6, DW-tuned).
 *
 * User feedback: "stutter when buffer < 3s". Empirical threshold: buffer >= 5s stable.
 * Tuning progression:
 *   - Tune 1 (latency-first): liveSyncDuration 3, buffer ~3s actual, on edge
 *   - Tune 2 (smoothness-first): liveSyncDuration 6, buffer ~3.6s actual, still on edge
 *   - Tune 3 (DW-tuned): liveSyncDuration 10, buffer ~8-10s actual, safe
 *
 * Tune 1 -> 2 -> 3 progression:
 *   - liveSyncDuration: 3 -> 6 -> 10
 *   - maxBufferLength: 30 -> 60 -> 80
 *   - backBufferLength: 30 -> 60 -> 80
 *   - maxMaxBufferLength: 60 -> 90 -> 120
 *   - maxBufferHole: 0.5 -> 1.0 -> 1.5
 *   - abrEwmaFastLive: 3.0 -> 6.0 -> 8.0 (more conservative)
 *   - abrEwmaSlowLive: 9.0 -> 15.0 -> 20.0
 *   - startPosition: -1 -> 0 -> -8 (start with 8s buffer)
 *
 * Smoothness vs performance trade-off (section 3.4):
 *   Tune 1: TTFF < 1.5s / live edge distance 2-5s
 *   Tune 2: TTFF slightly higher / live edge distance 6-10s
 *   Tune 3: TTFF ~2s (8s initial buffer) / live edge distance 10-12s / very smooth
 *
 * For the demo: smoothness is 10x more important than low latency.
 */

import type { HlsConfig } from 'hls.js';

/** Shared base config — see tuning notes above. */
const BASE_CONFIG: Partial<HlsConfig> = {
  // -- Latency / live edge --
  lowLatencyMode: true,
  liveSyncDuration: 10,             // Tune 3: 6 -> 10 (buffer >= 8s stable)
  liveMaxLatencyDuration: 15,
  maxLiveSyncPlaybackRate: 1.0,    // do not chase edge
  startPosition: -8,                // Tune 3: 0 -> -8 (start with 8s buffer)

  // -- Buffer (Tune 3: longer) --
  maxBufferLength: 80,             // Tune 3: 60 -> 80
  maxMaxBufferLength: 120,         // Tune 3: 90 -> 120
  maxBufferSize: 60 * 1000 * 1000,
  maxBufferHole: 1.5,              // Tune 3: 1.0 -> 1.5
  backBufferLength: 80,            // Tune 3: 60 -> 80
  enableWorker: true,

  // -- ABR (Tune 3: more conservative) --
  capLevelToPlayerSize: true,
  abrEwmaFastLive: 8.0,            // Tune 3: 6 -> 8
  abrEwmaSlowLive: 20.0,           // Tune 3: 15 -> 20
  abrBandWidthFactor: 0.95,
  abrBandWidthUpFactor: 0.7,

  // -- Retry / timeout --
  manifestLoadingTimeOut: 10_000,
  manifestLoadingMaxRetry: 4,
  manifestLoadingRetryDelay: 1_000,
  levelLoadingTimeOut: 10_000,
  levelLoadingMaxRetry: 4,
  // 20s → 10s: abandon stuck fragments sooner (hls.js 1.5 has no abandonLoadTimeout)
  fragLoadingTimeOut: 10_000,
  fragLoadingMaxRetry: 6,
};

export const hlsConfig: Partial<HlsConfig> = BASE_CONFIG;

/**
 * Build a per-mount HlsConfig. Currently the only runtime-dependent knob is
 * `abrEwmaDefaultEstimate`, which hls.js uses to pick the first ABR level
 * before any bandwidth sample exists. Without a sane default it guesses
 * ~1 Mbps, which causes the player to (a) pick a tier too high on slow
 * networks and stall, or (b) waste the first ~3-5s re-buffering down.
 *
 * `navigator.connection.effectiveType` is the cheapest signal the platform
 * exposes (Chromium + Edge; Safari/Firefox fall back to the default).
 */
export function makeHlsConfig(): Partial<HlsConfig> {
  return {
    ...BASE_CONFIG,
    abrEwmaDefaultEstimate: defaultBandwidthEstimate(),
  };
}

function defaultBandwidthEstimate(): number {
  if (typeof navigator === 'undefined') return 1_000_000;
  const conn = (navigator as Navigator & {
    connection?: { effectiveType?: string; downlink?: number };
  }).connection;
  // Prefer downlink (Mbps) when present — more accurate than effectiveType.
  if (typeof conn?.downlink === 'number' && conn.downlink > 0) {
    return Math.round(conn.downlink * 1_000_000);
  }
  switch (conn?.effectiveType) {
    case 'slow-2g': return   100_000;
    case '2g':      return   200_000;
    case '3g':      return   600_000;
    case '4g':      return 1_500_000;
    case '5g':      return 5_000_000;
    default:        return 1_000_000;
  }
}
