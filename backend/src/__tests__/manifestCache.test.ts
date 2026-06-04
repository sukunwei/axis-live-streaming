/**
 * LRU contract test — capacity, eviction order, and touch-on-read.
 * Exists because the manifest cache previously grew without bound; if
 * someone refactors the implementation, these assertions stay the same.
 */

import { describe, it, expect } from 'vitest';
import { LruCache } from '../streaming/manifestCache';

describe('LruCache', () => {
  it('rejects capacity < 1', () => {
    expect(() => new LruCache<string, number>(0)).toThrow();
  });

  it('stores and retrieves up to capacity', () => {
    const c = new LruCache<string, number>(3);
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    expect(c.get('a')).toBe(1);
    expect(c.get('b')).toBe(2);
    expect(c.get('c')).toBe(3);
    expect(c.size).toBe(3);
  });

  it('evicts the oldest entry when over capacity', () => {
    const c = new LruCache<string, number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);  // a is oldest → evicted
    expect(c.has('a')).toBe(false);
    expect(c.get('b')).toBe(2);
    expect(c.get('c')).toBe(3);
  });

  it('read bumps the key to most-recently-used', () => {
    const c = new LruCache<string, number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a');  // a is now newest
    c.set('c', 3);  // b is oldest → evicted
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(false);
    expect(c.has('c')).toBe(true);
  });

  it('overwriting an existing key does not add capacity', () => {
    const c = new LruCache<string, number>(2);
    c.set('a', 1);
    c.set('a', 99);
    c.set('b', 2);
    expect(c.size).toBe(2);
    expect(c.get('a')).toBe(99);
  });

  it('returns undefined for missing key', () => {
    const c = new LruCache<string, number>(2);
    expect(c.get('nope')).toBeUndefined();
  });

  it('handles expiry semantics — a downstream test mirrors the manifest use', () => {
    // The manifest cache wraps LruCache with a TTL on the value side.
    // This test pins the integration shape so refactors keep the touch
    // behavior (touch happens on get, not on has).
    const c = new LruCache<string, { v: number; expiresAt: number }>(2);
    const now = Date.now();
    c.set('k1', { v: 1, expiresAt: now + 1_000 });
    c.set('k2', { v: 2, expiresAt: now + 1_000 });

    // Hit, even if "expired", still touches:
    const hit = c.get('k1');
    expect(hit).toBeDefined();
    c.set('k3', { v: 3, expiresAt: now + 1_000 });
    // k2 should be evicted because k1 was touched above.
    expect(c.has('k2')).toBe(false);
    expect(c.has('k1')).toBe(true);
    expect(c.has('k3')).toBe(true);
  });
});
