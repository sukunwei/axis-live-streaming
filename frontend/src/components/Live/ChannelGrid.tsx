/**
 * ChannelGrid — sidebar channel list (M3.6 smoothness edition)
 *
 * - Backend /channels returns sorted by smoothnessScore desc; frontend renders directly
 * - Each card shows a smoothness icon at top-right (5 signal bars + color)
 * - Per-card hover triggers prefetch (§4.2 fast channel switching)
 * - Subscribes to streamingStore for current channel + health
 */

import { useStreamingStore } from '../../stores/streamingStore';
import { prefetchChannel } from '../../live/ChannelSwitcher';
import type { Channel } from '../../lib/channels.config';
import { Tv2, Signal } from 'lucide-react';

export function ChannelGrid() {
  const channels = useStreamingStore(s => s.channels);
  const currentChannelId = useStreamingStore(s => s.currentChannelId);
  const setCurrent = useStreamingStore(s => s.setCurrent);

  if (channels.length === 0) {
    return <div className="p-4 text-sm text-zinc-500">Loading channels…</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold text-zinc-300">Channels</h2>
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
          Smoothness ↓
        </span>
      </div>
      <div className="space-y-2">
        {channels.map(ch => (
          <ChannelCard
            key={ch.id}
            channel={ch}
            isActive={ch.id === currentChannelId}
            onSelect={() => setCurrent(ch.id)}
          />
        ))}
      </div>
    </div>
  );
}

interface ChannelCardProps {
  channel: Channel;
  isActive: boolean;
  onSelect: () => void;
}

function ChannelCard({ channel, isActive, onSelect }: ChannelCardProps) {
  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => { void prefetchChannel(channel); }}
      onFocus={() => { void prefetchChannel(channel); }}
      className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
        isActive
          ? 'border-blue-500 bg-blue-500/10 shadow-md'
          : 'border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 ${isActive ? 'text-blue-400' : 'text-zinc-500'}`}>
          <Tv2 className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-sm text-zinc-100 truncate">{channel.name}</h3>
            {isActive && (
              <span className="flex-shrink-0 bg-red-600 text-white text-[10px] px-1.5 py-0.5 rounded uppercase font-semibold">
                Live
              </span>
            )}
            <span
              data-testid="channel-category"
              className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold ${
                channel.category === 'sports'
                  ? 'bg-emerald-900/50 text-emerald-300 border border-emerald-700/50'
                  : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
              }`}
            >
              {channel.category === 'sports' ? 'Sports' : 'Other'}
            </span>
            <span className="ml-auto flex-shrink-0">
              <SmoothnessIcon score={channel.smoothnessScore} />
            </span>
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">{channel.sport}</p>
        </div>
      </div>
    </button>
  );
}

/** 5-level signal icon: 1-5 bars, red→orange→yellow→green */
function SmoothnessIcon({ score }: { score: number }) {
  const cfg = SMOOTHNESS_LEVELS[Math.max(0, Math.min(5, Math.round(score)))];
  const display = score.toFixed(1);
  return (
    <span
      className={`inline-flex items-center gap-0.5 ${cfg.color}`}
      title={`Smoothness: ${display}/5 — ${cfg.label}`}
    >
      <Signal className="w-3.5 h-3.5" strokeWidth={2.5} />
      <span className="text-[10px] font-mono font-semibold tabular-nums">{display}</span>
    </span>
  );
}

const SMOOTHNESS_LEVELS: Record<number, { color: string; label: string }> = {
  0: { color: 'text-red-500',    label: 'broken' },
  1: { color: 'text-red-500',    label: 'weak' },
  2: { color: 'text-orange-500', label: 'fair' },
  3: { color: 'text-yellow-500', label: 'good' },
  4: { color: 'text-green-500',  label: 'strong' },
  5: { color: 'text-green-400',  label: 'excellent' },
};
