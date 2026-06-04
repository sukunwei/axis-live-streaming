/**
 * ChannelSwitcher — manifest prefetch (M2).
 *
 * Does not create hls instances (warm pool §2.5 = 0); only pre-warms the
 * proxy cache for the master AND the first variant. On switch, the browser
 * would otherwise still need to fetch the variant manifest before the
 * first segment can be requested; warming it cuts cold-switch time by
 * ~30-100ms per channel.
 */

import type { Channel } from '../lib/channels.config';

/** Pre-fetch master + first variant for a single channel (no segments). */
export async function prefetchChannel(ch: Channel): Promise<void> {
  try {
    // 1. Master
    const masterRes = await fetch(ch.streamUrl);
    if (!masterRes.ok) return;
    const masterText = await masterRes.text();
    // Free the body — the proxy has already transmitted and the manifest
    // is now in proxy cache for 2s anyway.
    void masterRes.arrayBuffer().catch(() => { /* best-effort */ });

    // 2. First variant manifest. The proxy rewrites variant URLs to
    //    /hls/<id>/<rel-path> (or /hls/<id>/p?u=... for cross-origin).
    //    Resolving against the page origin keeps this dev/prod-portable.
    const firstVariantRel = parseFirstVariantUrl(masterText);
    if (!firstVariantRel) return;
    const variantUrl = firstVariantRel.startsWith('http')
      ? firstVariantRel
      : new URL(firstVariantRel, window.location.origin + ch.streamUrl).toString();
    const vRes = await fetch(variantUrl);
    if (!vRes.ok) return;
    await vRes.text();
  } catch {
    // Prefetch failures do not throw — re-fetched on switch
  }
}

/** Prefetch multiple channels (Promise.all concurrent) */
export async function prefetchAll(channels: readonly Channel[]): Promise<void> {
  await Promise.all(channels.map(prefetchChannel));
}

/** First non-comment, non-empty line of an HLS playlist. */
function parseFirstVariantUrl(manifest: string): string | null {
  for (const line of manifest.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    return t;
  }
  return null;
}
