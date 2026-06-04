/**
 * QualityHUD — 1Hz-sampled quality panel (§4.5).
 *
 * Rendered as a sticky module in App.tsx's right column, below ChannelGrid.
 *
 * Design notes:
 *   - **Takes a ref, not a value.** Channel switches swap the underlying
 *     MetricsCollector but don't cause App to re-render, so a value-prop
 *     becomes stale (old collector is detached → samplingAt=0 → early
 *     return). Reading `ref.current` on every render gets the fresh
 *     instance.
 *   - **Always renders the shell.** The panel itself never unmounts
 *     mid-playback; un-sampled metrics show as '—' so the slot is
 *     visually stable. The 1Hz setInterval drives re-render to pick up
 *     the latest snapshot.
 *   - **No store subscription.** Metrics changes do not bubble up to App.
 *
 * Numbers use tabular-nums to prevent jitter.
 */

import { useEffect, useState, type MutableRefObject } from 'react';
import type { MetricsCollector, MetricsSnapshot } from '../../live/MetricsCollector';
import { Activity, Gauge, Clock, Zap, AlertTriangle, Timer } from 'lucide-react';

interface QualityHUDProps {
  /**
   * Ref to the active MetricsCollector. PlayerStage owns the instance and
   * mutates `ref.current` on mount/unmount. Reading it on every render
   * avoids the stale-prop problem described above.
   */
  collectorRef: MutableRefObject<MetricsCollector | null>;
  visible?: boolean;
}

const EMPTY_SNAPSHOT: MetricsSnapshot = {
  currentLevel: -1,
  resolution: 'auto',
  bitrateKbps: 0,
  bandwidthKbps: 0,
  bufferSec: 0,
  liveLatencySec: 0,
  droppedFrames: 0,
  decodedFrames: 0,
  stallCount: 0,
  totalStallMs: 0,
  fps: 0,
  samplingAt: 0,
};

export function QualityHUD({ collectorRef, visible = true }: QualityHUDProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!visible) return null;

  // Read the live collector on every render. If none is mounted yet, or the
  // collector has been detached (e.g. briefly during a channel switch before
  // the new PlayerStage's useEffect runs), fall back to an empty snapshot
  // — the shell still renders, the values show as '—'.
  const collector = collectorRef.current;
  const m: MetricsSnapshot =
    collector && collector.current.samplingAt > 0
      ? collector.current
      : EMPTY_SNAPSHOT;
  const isLive = collector !== null && collector.current.samplingAt > 0;

  return (
    <div
      data-testid="quality-hud"
      data-live={isLive ? 'true' : 'false'}
      className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 text-xs space-y-1.5"
    >
      <div className="font-semibold text-zinc-300 mb-2 flex items-center gap-1.5">
        <Activity className="w-3.5 h-3.5" /> Quality
        {!isLive && (
          <span className="ml-auto text-[10px] font-normal text-zinc-500 uppercase tracking-wider">
            waiting
          </span>
        )}
      </div>
      <Row icon={<Zap className="w-3 h-3" />} label="Bitrate" value={fmt(m.bitrateKbps, 'kbps', isLive)} />
      <Row icon={<Gauge className="w-3 h-3" />} label="Bandwidth" value={fmt(m.bandwidthKbps, 'kbps', isLive)} />
      <Row icon={<Timer className="w-3 h-3" />} label="Buffer" value={fmt(m.bufferSec, 's', isLive, 1)} warn={isLive && m.bufferSec < 3} />
      <Row icon={<Clock className="w-3 h-3" />} label="Latency" value={fmt(m.liveLatencySec, 's', isLive, 1)} />
      <Row icon={<Activity className="w-3 h-3" />} label="FPS" value={fmt(m.fps, '', isLive)} />
      <Row icon={<AlertTriangle className="w-3 h-3" />} label="Dropped" value={fmt(m.droppedFrames, '', isLive)} warn={isLive && m.droppedFrames > 0} />
      <Row icon={<AlertTriangle className="w-3 h-3" />} label="Stalls" value={fmtStalls(m.stallCount, m.totalStallMs, isLive)} warn={isLive && m.stallCount > 0} />
    </div>
  );
}

function fmt(n: number, unit: string, live: boolean, decimals = 0): string {
  if (!live) return '—';
  const body = decimals > 0 ? n.toFixed(decimals) : `${n}`;
  return unit ? `${body} ${unit}` : body;
}

function fmtStalls(count: number, totalMs: number, live: boolean): string {
  if (!live) return '—';
  return `${count} (${Math.round(totalMs)} ms)`;
}

interface RowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  warn?: boolean;
}

function Row({ icon, label, value, warn }: RowProps) {
  return (
    <div className={`flex items-center justify-between gap-2 tabular-nums ${warn ? 'text-yellow-400' : ''}`}>
      <span className="flex items-center gap-1 text-zinc-400">
        {icon}
        {label}
      </span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
