/**
 * ChannelSwitcher — manifest prefetch (M2). 
 *
 * Does not create hls instances (warm pool §2.5 = 0); only pre-warms master + variant proxy cache. 
 * On switch, browser only fetches segments after master; prefetch warms the proxy cache to 200 OK. 
 */

import type { Channel } from '../lib/channels.config';

/** Pre-fetch master for a single channel (no segments) */
export async function prefetchChannel(ch: Channel): Promise<void> {
  try {
    // Default cache: honors proxy manifest Cache-Control max-age=2
    const res = await fetch(ch.streamUrl);
    if (!res.ok) return;
    // Consume body immediately to let the proxy transmit; discard the content
    await res.text();
  } catch {
    // Prefetch failures do not throw — re-fetched on switch
  }
}

/** Prefetch multiple channels (Promise.all concurrent) */
export async function prefetchAll(channels: readonly Channel[]): Promise<void> {
  await Promise.all(channels.map(prefetchChannel));
}
