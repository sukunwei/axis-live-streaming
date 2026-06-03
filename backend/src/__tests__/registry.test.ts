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
      expect(ch.primaryUrl).toMatch(/^https?:\/\//);
      expect(ch.masterPath).toBeTruthy();
      expect(ch.backupUrls.length).toBeGreaterThan(0);
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
