/**
 * hlsConfig test — ensure "smoothness-first" tuning discipline (numbers do not drift). 
 *
 * Note: original "latency-first" values (liveSyncDuration=3 / maxBufferLength=30 / 1.1x catch-up)
 * have been replaced by M3.6 tuning — root cause of DW English stutter. 
 */

import { describe, it, expect } from 'vitest';
import { hlsConfig } from '../live/hlsConfig';

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

  it('abandons stuck fragments within 10s (not 20s)', () => {
    expect(hlsConfig.fragLoadingTimeOut).toBe(10_000);
  });
});
