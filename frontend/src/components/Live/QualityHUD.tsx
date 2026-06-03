/**
 * QualityHUD — 1Hz-sampled quality panel (§4.5).
 *
 * Rendered as a sibling of the video container in App.tsx (not as an overlay
 * over the video frame — see the P0 UI cleanup). Uses a normal-flow card so
 * the parent grid's `space-y-4` keeps it under the video.
 *
 * Design:
 *   - Takes a MetricsCollector instance (may be null before PlayerStage mounts)
 *   - Internal useState + setInterval(1000) forces re-render
 *   - Reads MetricsSnapshot from collector.current
 *   - Numbers use tabular-nums to prevent jitter
 *
 * Does not subscribe to the store, so metrics changes **do not** trigger an App re-render.
 */

import { useEffect, useState } from 'react';
import type { MetricsCollector } from '../../live/MetricsCollector';
import { Activity, Gauge, Clock, Zap, AlertTriangle, Timer } from 'lucide-react';

interface QualityHUDProps {
  /** May be null before PlayerStage mounts and populates the ref. */
  collector: MetricsCollector | null;
  visible?: boolean;
}

export function QualityHUD({ collector, visible = true }: QualityHUDProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!visible) return null;
  if (!collector) return null;
  const m = collector.current;
  if (m.samplingAt === 0) return null;

  return (
    <div
      data-testid="quality-hud"
      className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 text-xs space-y-1.5"
    >
      <div className="font-semibold text-zinc-300 mb-2 flex items-center gap-1.5">
        <Activity className="w-3.5 h-3.5" /> Quality
      </div>
      <Row icon={<Zap className="w-3 h-3" />} label="Bitrate" value={`${m.bitrateKbps} kbps`} />
      <Row icon={<Gauge className="w-3 h-3" />} label="Bandwidth" value={`${m.bandwidthKbps} kbps`} />
      <Row icon={<Timer className="w-3 h-3" />} label="Buffer" value={`${m.bufferSec.toFixed(1)} s`} warn={m.bufferSec < 3} />
      <Row icon={<Clock className="w-3 h-3" />} label="Latency" value={`${m.liveLatencySec.toFixed(1)} s`} />
      <Row icon={<Activity className="w-3 h-3" />} label="FPS" value={`${m.fps}`} />
      <Row icon={<AlertTriangle className="w-3 h-3" />} label="Dropped" value={`${m.droppedFrames}`} warn={m.droppedFrames > 0} />
      <Row icon={<AlertTriangle className="w-3 h-3" />} label="Stalls" value={`${m.stallCount} (${Math.round(m.totalStallMs)} ms)`} warn={m.stallCount > 0} />
    </div>
  );
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
