/**
 * Axis Live Streaming — App shell (M2)
 *
 * - Fetch channel list from /channels on mount
 * - Default-select the first channel
 * - Switching channels: setCurrent(id) triggers whole-component remount of PlayerStage via key={id}
 * - ChannelGrid triggers prefetch on hover (§4.2 fast switching)
 */

import { useEffect, useState } from 'react';
import { PlayerStage } from '../components/Live/PlayerStage';
import { ChannelGrid } from '../components/Live/ChannelGrid';
import { SourceStatusBadge } from '../components/Live/SourceStatusBadge';
import { useSourceHealthSse } from '../hooks/useSourceHealthSse';
import { useStreamingStore } from '../stores/streamingStore';
import type { Channel } from '../lib/channels.config';

export default function App() {
  const channels = useStreamingStore(s => s.channels);
  const currentChannelId = useStreamingStore(s => s.currentChannelId);
  const setChannels = useStreamingStore(s => s.setChannels);
  const setCurrent = useStreamingStore(s => s.setCurrent);

  const [loadError, setLoadError] = useState<string | null>(null);

  // Fetch channel list on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/channels');
        if (!res.ok) throw new Error(`/channels status ${res.status}`);
        const data: Channel[] = await res.json();
        if (cancelled) return;
        setChannels(data);
        if (data.length > 0 && !currentChannelId) {
          setCurrent(data[0].id);
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="aspect-video bg-black rounded-xl overflow-hidden">
              {currentChannel ? (
                <PlayerStage
                  key={currentChannel.id}
                  streamUrl={currentChannel.streamUrl}
                  streamName={currentChannel.name}
                  channelId={currentChannel.id}
                  backupStreamUrls={currentChannel.backupStreamUrls}
                />
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
          <div className="lg:col-span-1">
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <ChannelGrid />
            </div>
            <p className="mt-3 text-xs text-zinc-500 px-1">
              Hover a channel to prefetch its master. Click to switch. Source health pushed via SSE.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
