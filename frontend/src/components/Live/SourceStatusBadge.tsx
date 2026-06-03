/**
 * SourceStatusBadge — current channel health badge (§4.5 + §5.3 contract). 
 */

import { useStreamingStore } from '../../stores/streamingStore';
import { Circle, AlertTriangle, XCircle } from 'lucide-react';

interface SourceStatusBadgeProps {
  channelId: string;
  reason?: string;
}

export function SourceStatusBadge({ channelId }: SourceStatusBadgeProps) {
  const health = useStreamingStore(s => s.healthByChannel[channelId] ?? 'ok');
  const reason = useStreamingStore(s => {
    // No dedicated reasonByChannel map (M3 simplified); inferred from health
    void s;  // keep subscription
    return undefined;
  });
  void reason;

  const config = {
    ok: { color: 'bg-green-600', icon: Circle, label: 'OK' },
    degraded: { color: 'bg-yellow-600', icon: AlertTriangle, label: 'Degraded' },
    down: { color: 'bg-red-600', icon: XCircle, label: 'Down' },
  }[health];

  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1 ${config.color} text-white text-xs px-2 py-0.5 rounded`}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}
