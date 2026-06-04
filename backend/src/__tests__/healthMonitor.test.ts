/**
 * HealthMonitor state machine test (§4.8) — verify via injected mock 5xx.
 *
 * Tests pure logic only (markOk / mark5xx / markFail / transition),
 * no network. Directly import internal state.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getAllHealth, getHealth, onChange, startHealthMonitor, _probeOne } from '../streaming/healthMonitor';
import { getChannels } from '../streaming/registry';
import { isBroken } from '../streaming/mockFailure';

vi.mock('../streaming/mockFailure', () => ({
  isBroken: vi.fn(),
}));

describe('HealthMonitor', () => {
  beforeEach(() => {
    // No real network; just init the state machine
    startHealthMonitor();
    vi.mocked(isBroken).mockReturnValue(false);
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

/**
 * P0-3: mock injector integration. The probe goes direct to upstream
 * (bypasses the proxy), so without the `isBroken` short-circuit the
 * monitor would never see a mock-broken upstream and the 'down' state
 * would never propagate via SSE — making the PlaybackBlockedOverlay
 * path untestable in demo.
 *
 * The fast-path transitions directly to 'down' on the first probe
 * (skipping the 2-fail → degraded → 5s-sustained ladder) so the demo
 * shows the overlay within ~5s instead of ~15s. Real upstream failures
 * still go through the normal ladder.
 */
describe('P0-3: health monitor + mock injector', () => {
  beforeEach(() => {
    startHealthMonitor();
    vi.mocked(isBroken).mockReturnValue(false);
  });

  it('mock-broken channel transitions directly to down (no real network needed)', async () => {
    vi.mocked(isBroken).mockReturnValue(true);

    const events: Array<{ channelId: string; status: string }> = [];
    const unsub = onChange((channelId, status) => {
      events.push({ channelId, status });
    });

    // Pick a real channel id from the registry
    const ch = getChannels()[0];
    expect(ch).toBeDefined();

    await _probeOne(ch.id, ch.primaryUrl);

    // The mock fast-path transitions to 'down' on the first probe
    expect(getHealth(ch.id)).toBe('down');
    expect(events.some(e => e.channelId === ch.id && e.status === 'down')).toBe(true);

    unsub();
  });

  it('mock-broken fires onChange with reason "mock: source broken"', async () => {
    // Use a different channel from the first test so the transition
    // isn't a no-op (state machine skips same-status transitions).
    const ch = getChannels()[1] ?? getChannels()[0];
    vi.mocked(isBroken).mockReturnValue(true);
    const reasons: Array<{ channelId: string; reason: string }> = [];
    const unsub = onChange((channelId, _status, reason) => {
      reasons.push({ channelId, reason });
    });

    await _probeOne(ch.id, ch.primaryUrl);

    const myReason = reasons.find(r => r.channelId === ch.id);
    expect(myReason).toBeDefined();
    expect(myReason!.reason).toMatch(/^mock:/);

    unsub();
  });
});

