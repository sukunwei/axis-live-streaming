/**
 * SourceStatusBadge — current channel health badge (§4.5 + §5.3).
 *
 * Shows just the status (OK / Degraded / Down). The SSE `reason`
 * field (e.g. "5xx 3/30s" or "mock: source broken") is no longer
 * rendered here — P0-3 moved it to the dev bar / MockControls
 * where the mock context is explicit, and the dev-only flow
 * doesn't need a second surface. Real upstream failure reasons
 * are still available via the SSE store and `/health/streaming`.
 */

import { useStreamingStore } from '../../stores/streamingStore';
import { Circle, AlertTriangle, XCircle } from 'lucide-react';

interface SourceStatusBadgeProps {
  channelId: string;
}

export function SourceStatusBadge({ channelId }: SourceStatusBadgeProps) {
  const health = useStreamingStore(s => s.healthByChannel[channelId] ?? 'ok');

  const config = {
    ok: { color: 'bg-green-600', icon: Circle, label: 'OK' },
    degraded: { color: 'bg-yellow-600', icon: AlertTriangle, label: 'Degraded' },
    down: { color: 'bg-red-600', icon: XCircle, label: 'Down' },
  }[health];

  const Icon = config.icon;

  return (
    <span
      className={`inline-flex items-center gap-1 ${config.color} text-white text-xs px-2 py-0.5 rounded`}
      data-testid="source-status-badge"
      data-health={health}
    >
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}
