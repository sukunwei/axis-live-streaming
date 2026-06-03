/**
 * useSourceHealthSse — subscribe to /events SSE, update store.healthByChannel. 
 *
 * EventSource auto-reconnects; we just open on mount, close on unmount. 
 * Each source-health event → setHealth(channelId, status). 
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

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/events');

    es.addEventListener('source-health', (e: MessageEvent) => {
      try {
        const data: HealthEvent = JSON.parse(e.data);
        setHealth(data.channel, data.status);
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
  }, [setHealth]);
}
