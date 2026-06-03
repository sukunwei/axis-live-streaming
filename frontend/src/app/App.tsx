/**
 * Axis Live Streaming — App shell (M2)
 *
 * - Fetch channel list from /channels on mount
 * - Default-select the first channel
 * - Switching channels: setCurrent(id) triggers whole-component remount of PlayerStage via key={id}
 * - ChannelGrid triggers prefetch on hover (§4.2 fast switching)
 * - Owns a shared MetricsCollector ref so QualityHUD can render as a sticky
 *   panel in the right column under ChannelGrid. Sticky positioning keeps
 *   bitrate / buffer / latency in view while the user scrolls the page.
 * - PlayerStage is lazy-loaded so the hls.js chunk (~80KB gz) doesn't block
 *   the initial render of the channel list / SSE hookup.
 */

import { Suspense, lazy, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { ChannelGrid } from '../components/Live/ChannelGrid';
import { QualityHUD } from '../components/Live/QualityHUD';
import { SourceStatusBadge } from '../components/Live/SourceStatusBadge';
import { useSourceHealthSse } from '../hooks/useSourceHealthSse';
import { useStreamingStore } from '../stores/streamingStore';
import type { Channel } from '../lib/channels.config';
import type { MetricsCollector } from '../live/MetricsCollector';

const PlayerStage = lazy(() =>
  import('../components/Live/PlayerStage').then(m => ({ default: m.PlayerStage })),
);

interface ChannelsResponse {
  channels: Channel[];
  /** Unique upstream origins (primary + backup) — preconnect targets. */
  upstreamOrigins: string[];
}

export default function App() {
  const channels = useStreamingStore(s => s.channels);
  const currentChannelId = useStreamingStore(s => s.currentChannelId);
  const setChannels = useStreamingStore(s => s.setChannels);
  const setCurrent = useStreamingStore(s => s.setCurrent);

  const [loadError, setLoadError] = useState<string | null>(null);

  // Shared collector: PlayerStage writes, QualityHUD reads (1Hz polling).
  // Keying PlayerStage by channelId gives us a fresh collector per channel.
  const collectorRef: MutableRefObject<MetricsCollector | null> = useRef(null);

  // Fetch channel list on mount; also warm preconnect to upstream HLS hosts.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/channels');
        if (!res.ok) throw new Error(`/channels status ${res.status}`);
        const data = (await res.json()) as ChannelsResponse;
        if (cancelled) return;
        warmPreconnects(data.upstreamOrigins);
        setChannels(data.channels);
        if (data.channels.length > 0 && !currentChannelId) {
          setCurrent(data.channels[0].id);
        }
      } catch (err) {
        if (!cancelled) setLoadError((err as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [setChannels, setCurrent, currentChannelId]);

  // Subscribe to SSE source health
  useSourceHealthSse();

  const currentChannel = channels.find(c => c.id === currentChannelId) ?? null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold">axis-live-streaming</h1>
        <span className="text-xs text-zinc-500">Live Sports Streaming</span>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 space-y-4">
            <div className="aspect-video bg-black rounded-xl overflow-hidden">
              {currentChannel ? (
                <Suspense fallback={<PlayerSkeleton />}>
                  <PlayerStage
                    key={currentChannel.id}
                    streamUrl={currentChannel.streamUrl}
                    streamName={currentChannel.name}
                    channelId={currentChannel.id}
                    backupStreamUrls={currentChannel.backupStreamUrls}
                    collectorRef={collectorRef}
                  />
                </Suspense>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-zinc-500">
                  {loadError ? `Error: ${loadError}` : 'Loading…'}
                </div>
              )}
            </div>
            {currentChannel && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">{currentChannel.name}</h2>
                  <p className="text-sm text-zinc-500 mt-1">
                    {currentChannel.sport} · {currentChannel.streamUrl}
                  </p>
                </div>
                <SourceStatusBadge channelId={currentChannel.id} />
              </div>
            )}
          </div>
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <ChannelGrid />
            </div>
            <p className="text-xs text-zinc-500 px-1">
              Hover a channel to prefetch its master. Click to switch. Source health pushed via SSE.
            </p>
            {/*
              QualityHUD lives here as a sticky module: always rendered, sticks
              to the top of the right column as the user scrolls. The component
              itself returns null while the collector ref is empty (between
              page load and PlayerStage mount) so this slot costs nothing.
            */}
            <div className="sticky top-4">
              <QualityHUD collector={collectorRef.current} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * Inject <link rel="preconnect"> for each unique upstream HLS origin.
 * Idempotent: re-running on channel-list refresh is a no-op (data-preconnect
 * attribute guards against duplicates).
 */
function warmPreconnects(origins: readonly string[]): void {
  if (typeof document === 'undefined') return;
  const head = document.head;
  for (const origin of origins) {
    if (head.querySelector(`link[data-preconnect="${origin}"]`)) continue;
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = origin;
    link.crossOrigin = 'anonymous';
    link.setAttribute('data-preconnect', origin);
    head.appendChild(link);
  }
}

function PlayerSkeleton(): JSX.Element {
  return (
    <div className="w-full h-full flex items-center justify-center text-zinc-500 text-sm">
      Loading player…
    </div>
  );
}
