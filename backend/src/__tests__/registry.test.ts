/**
 * Channel registry test — startup validation (§6.4 + P0-3).
 */

import { describe, it, expect } from 'vitest';
import { channels } from '../streaming/channels.config';
import { getChannels, getChannel } from '../streaming/registry';

describe('Channel registry', () => {
  it('at least 1 channel', () => {
    expect(channels.length).toBeGreaterThan(0);
  });

  it('each channel field is complete', () => {
    for (const ch of channels) {
      expect(ch.id).toBeTruthy();
      expect(ch.name).toBeTruthy();
      expect(ch.sport).toBeTruthy();
      expect(ch.category).toMatch(/^(sports|others)$/);
      expect(ch.primaryUrl).toMatch(/^https?:\/\//);
      expect(ch.masterPath).toBeTruthy();
      // P0-3: sameContentBackups must exist as an array (can be empty)
      expect(Array.isArray(ch.sameContentBackups)).toBe(true);
      for (const b of ch.sameContentBackups) {
        expect(b.url).toMatch(/^https?:\/\//);
      }
      // backupUrls is now optional — see registry.ts file header. Just
      // assert it exists as an array (can be empty).
      expect(Array.isArray(ch.backupUrls)).toBe(true);
    }
  });

  it('P0-3: backupUrls is empty for every channel (no cross-channel URLs)', () => {
    // After P0-3 M1, cross-channel failover is forbidden. This test is a
    // regression guard: if anyone re-adds a cross-channel URL to
    // backupUrls, this fails fast.
    for (const ch of channels) {
      expect(ch.backupUrls).toEqual([]);
    }
  });

  it('P0-3: at least one channel exercises the sameContentBackups field', () => {
    // Sanity check that the feature is actually wired up. If every channel
    // has empty sameContentBackups the auto-failover code path is
    // dead — either we forgot to populate the field, or the field is
    // misnamed and should not exist.
    const withBackups = channels.filter(c => c.sameContentBackups.length > 0);
    expect(withBackups.length).toBeGreaterThan(0);
  });

  it('P0-3: every sameContentBackup URL is http(s)', () => {
    for (const ch of channels) {
      for (const b of ch.sameContentBackups) {
        expect(b.url).toMatch(/^https?:\/\//);
      }
    }
  });

  it('each channel declares a valid category', () => {
    for (const ch of channels) {
      expect(['sports', 'others']).toContain(ch.category);
    }
  });

  it('ids are unique', () => {
    const ids = channels.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('getChannels returns the readonly array', () => {
    const list = getChannels();
    expect(list.length).toBe(channels.length);
  });

  it('getChannel(id) finds existing / returns undefined for missing', () => {
    expect(getChannel(channels[0].id)).toBeDefined();
    expect(getChannel('nonexistent')).toBeUndefined();
  });
});
