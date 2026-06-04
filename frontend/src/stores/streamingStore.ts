/**
 * Streaming Zustand store (M2 + P0-3).
 *
 * Discipline (already confirmed in §5.4):
 *   - Do not store metrics / hls internal state
 *   - setHealth / setReason update a single field, no whole-replace
 *   - Switching channels via setCurrent — PlayerStage key={currentChannelId} triggers whole-component remount
 */

import { create } from 'zustand';
import type { Channel, SourceHealth } from '../lib/channels.config';

interface StreamingState {
  channels: Channel[];
  currentChannelId: string | null;
  healthByChannel: Record<string, SourceHealth>;
  /**
   * P0-3: short human-readable reason for the current health state, pushed
   * via SSE alongside `healthByChannel`. Surfaced in SourceStatusBadge.
   * Empty string means "no specific reason" (typically when health is ok).
   */
  reasonByChannel: Record<string, string>;
  setChannels: (channels: Channel[]) => void;
  setCurrent: (id: string) => void;
  setHealth: (id: string, h: SourceHealth) => void;
  setReason: (id: string, reason: string) => void;
}

export const useStreamingStore = create<StreamingState>(set => ({
  channels: [],
  currentChannelId: null,
  healthByChannel: {},
  reasonByChannel: {},
  setChannels: channels => set({ channels }),
  setCurrent: id => set({ currentChannelId: id }),
  setHealth: (id, h) =>
    set(s => ({ healthByChannel: { ...s.healthByChannel, [id]: h } })),
  setReason: (id, reason) =>
    set(s => ({ reasonByChannel: { ...s.reasonByChannel, [id]: reason } })),
}));
