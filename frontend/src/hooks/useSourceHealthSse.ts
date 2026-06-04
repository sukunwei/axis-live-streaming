/**
 * useSourceHealthSse — subscribe to /events SSE, update store.healthByChannel
 * and store.reasonByChannel (P0-3).
 *
 * EventSource auto-reconnects; we just open on mount, close on unmount.
 * Each source-health event → setHealth(channelId, status) + setReason(channelId, reason).
 *
 * On reconnect, the SSE does not replay history. The /health/streaming
 * endpoint is the recovery path (call it once on `error` to backfill
 * the current state). This hook leaves that to consumers — for the
 * P0-3 demo the steady-state ok → ok transition doesn't matter and a
 * transient reason staleness is harmless.
 */

import { useEffect } from 'react';
import { useStreamingStore } from '../stores/streamingStore';
import type { SourceHealth } from '../lib/channels.config';

interface HealthEvent {
  channel: string;
  status: SourceHealth;
  reason: string;
  ts: number;
}

export function useSourceHealthSse(): void {
  const setHealth = useStreamingStore(s => s.setHealth);
  const setReason = useStreamingStore(s => s.setReason);

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/events');

    es.addEventListener('source-health', (e: MessageEvent) => {
      try {
        const data: HealthEvent = JSON.parse(e.data);
        setHealth(data.channel, data.status);
        setReason(data.channel, data.reason);
      } catch {
        // ignore malformed data
      }
    });

    es.addEventListener('error', () => {
      // EventSource auto-reconnects; no manual handling needed
    });

    return () => {
      es.close();
    };
  }, [setHealth, setReason]);
}
