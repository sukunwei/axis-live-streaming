/**
 * hlsConfig test — ensure "smoothness-first" tuning discipline (numbers do not drift).
 *
 * Note: original "latency-first" values (liveSyncDuration=3 / maxBufferLength=30 / 1.1x catch-up)
 * have been replaced by M3.6 tuning — root cause of DW English stutter.
 *
 * hls.js 1.6 migration: legacy `fragLoadingTimeOut` etc. are gone; pinned via
 * `fragLoadPolicy.default.{maxTimeToFirstByteMs, maxLoadTimeMs, ...}`.
 */

import { describe, it, expect } from 'vitest';
import { hlsConfig, makeHlsConfig } from '../live/hlsConfig';

describe('hlsConfig (smoothness-first edition)', () => {
  it('enables low-latency mode', () => {
    expect(hlsConfig.lowLatencyMode).toBe(true);
  });

  it('live edge 10s (buffer ≥ 8s stable, jitter-proof)', () => {
    expect(hlsConfig.liveSyncDuration).toBe(10);
  });

  it('max buffer 80s', () => {
    expect(hlsConfig.maxBufferLength).toBe(80);
  });

  it('back buffer 80s', () => {
    expect(hlsConfig.backBufferLength).toBe(80);
  });

  it('caps resolution by player size', () => {
    expect(hlsConfig.capLevelToPlayerSize).toBe(true);
  });

  it('worker enabled', () => {
    expect(hlsConfig.enableWorker).toBe(true);
  });

  it('does not chase edge (1.0x default)', () => {
    expect(hlsConfig.maxLiveSyncPlaybackRate).toBe(1.0);
  });

  it('upgrades very conservatively (fast ≥ 8, slow ≥ 20)', () => {
    expect(hlsConfig.abrEwmaFastLive).toBeGreaterThanOrEqual(8);
    expect(hlsConfig.abrEwmaSlowLive).toBeGreaterThanOrEqual(20);
  });

  it('recovers live edge on stall (1.6 liveSyncOnStallIncrease)', () => {
    expect(hlsConfig.liveSyncOnStallIncrease).toBeGreaterThanOrEqual(1);
  });

  it('detects stalls with a small grace window', () => {
    expect(hlsConfig.detectStallWithCurrentTimeMs).toBeGreaterThanOrEqual(1_000);
  });

  it('fragment load policy caps TTFB at 8s and total at 20s (1.6)', () => {
    const policy = hlsConfig.fragLoadPolicy?.default;
    expect(policy).toBeDefined();
    expect(policy?.maxTimeToFirstByteMs).toBeLessThanOrEqual(8_000);
    expect(policy?.maxLoadTimeMs).toBeLessThanOrEqual(20_000);
  });

  it('fragment load policy has timeout + error retry with exponential backoff', () => {
    const policy = hlsConfig.fragLoadPolicy?.default;
    expect(policy?.timeoutRetry?.backoff).toBe('exponential');
    expect(policy?.errorRetry?.backoff).toBe('exponential');
    expect(policy?.timeoutRetry?.maxNumRetry).toBeGreaterThanOrEqual(4);
    expect(policy?.errorRetry?.maxNumRetry).toBeGreaterThanOrEqual(2);
  });
});

describe('makeHlsConfig (per-mount runtime overrides)', () => {
  it('clones the base config', () => {
    const cfg = makeHlsConfig();
    expect(cfg.liveSyncDuration).toBe(hlsConfig.liveSyncDuration);
    expect(cfg.fragLoadPolicy).toEqual(hlsConfig.fragLoadPolicy);
  });

  it('returns a fresh object (not the singleton reference)', () => {
    const a = makeHlsConfig();
    const b = makeHlsConfig();
    expect(a).not.toBe(b);
  });
});
