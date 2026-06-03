/**
 * playbackLog scoring test — guards against the "all-zero samples look perfect"
 * regression (see commit history). A hung source sends zero metrics for
 * minutes; without a no-data guard, scoreObserved returns 4/5 and the
 * channel ranks at the top of /channels.
 */

import { describe, it, expect } from 'vitest';
import { scoreObserved, buildReasons } from '../streaming/playbackLog';

describe('scoreObserved', () => {
  it('perfect playback: 0 stalls, 0 dropped, high buffer', () => {
    const s = scoreObserved(0, 0, 10, 300, 10000);
    expect(s).toBe(5);  // 2 + 2 + 1
  });

  it('no-data (decodedFrames=0) returns 0 even if stalls/dropped are 0', () => {
    // The exact failure case: 7+ samples all with zeros, span ≥ 30s.
    // Old code would return 4 (2+2+0) — calling it "perfect".
    const s = scoreObserved(0, 0, 0, 300, 0);
    expect(s).toBe(0);
  });

  it('no-data guard only fires at span ≥ 30s (short test window tolerated)', () => {
    // A 5s window with decodedFrames=0 might just be a slow first frame.
    const s = scoreObserved(0, 0, 0, 5, 0);
    expect(s).toBeGreaterThan(0);  // legacy behaviour: treats zeros as good
  });

  it('legacy 4-arg call site (no decodedFrames) still works', () => {
    // Existing callers that don't pass decodedFrames shouldn't break.
    const s = scoreObserved(0, 0, 10, 300);
    expect(s).toBe(5);
  });

  it('mid-quality: 1 stall / 5 min, no dropped, buffer 6s', () => {
    const s = scoreObserved(1, 0, 6, 300, 5000);
    // stalls/min = 0.2 → 1 (boundary: 0.2 is NOT < 0.2, falls to next tier)
    // dropped/min = 0 → 2; buffer 6s → 0.5; total 3.5
    expect(s).toBe(3.5);
  });

  it('bad: 5 stalls in 1 min, 50 dropped', () => {
    const s = scoreObserved(5, 50, 1, 60, 1000);
    // stalls/min = 5 → 0; dropped/min = 50 → 0; buffer 1s → 0; total 0
    expect(s).toBe(0);
  });

  it('clamped to 0-5 range', () => {
    expect(scoreObserved(0, 0, 100, 60, 999999)).toBeLessThanOrEqual(5);
    expect(scoreObserved(9999, 9999, 0, 60, 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('buildReasons', () => {
  it('flags no-playback as the first reason', () => {
    const reasons = buildReasons(0, 0, 0, 300, 0);
    expect(reasons[0]).toMatch(/no playback observed/);
  });

  it('omits the no-data reason when decodedFrames > 0', () => {
    const reasons = buildReasons(0, 0, 10, 300, 5000);
    expect(reasons.some(r => /no playback/.test(r))).toBe(false);
  });

  it('omits the no-data reason on short windows', () => {
    const reasons = buildReasons(0, 0, 0, 5, 0);
    expect(reasons.some(r => /no playback/.test(r))).toBe(false);
  });

  it('reports high stalls/min as a reason', () => {
    const reasons = buildReasons(10, 0, 5, 60, 5000);
    expect(reasons.some(r => /stalls\/min/.test(r))).toBe(true);
  });
});
