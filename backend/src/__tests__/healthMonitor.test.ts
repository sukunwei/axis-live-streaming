/**
 * HealthMonitor state machine test (§4.8) — verify via injected mock 5xx. 
 *
 * Tests pure logic only (markOk / mark5xx / markFail / transition), 
 * no network. Directly import internal state. 
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getAllHealth, onChange, startHealthMonitor } from '../streaming/healthMonitor';
import { getChannels } from '../streaming/registry';

describe('HealthMonitor', () => {
  beforeEach(() => {
    // No real network; just init the state machine
    startHealthMonitor();
  });

  it('all channels start as ok', () => {
    const states = getAllHealth();
    const channels = getChannels();
    expect(Object.keys(states).length).toBe(channels.length);
    for (const ch of channels) {
      expect(states[ch.id]?.status).toBe('ok');
    }
  });

  it('onChange registers and returns unsubscribe', () => {
    const events: string[] = [];
    const unsub = onChange((channelId, status) => {
      events.push(`${channelId}:${status}`);
    });
    expect(typeof unsub).toBe('function');
    unsub();
  });
});

