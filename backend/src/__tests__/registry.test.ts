/**
 * Channel registry test — startup validation (§6.4). 
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
      // backupUrls is now optional — see registry.ts file header. Just
      // assert it exists as an array (can be empty).
      expect(Array.isArray(ch.backupUrls)).toBe(true);
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
