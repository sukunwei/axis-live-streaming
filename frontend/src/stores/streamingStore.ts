/**
 * Streaming Zustand store (M2). 
 *
 * Discipline (already confirmed in §5.4): 
 *   - Do not store metrics / hls internal state
 *   - setHealth updates a single field, no whole-replace
 *   - Switching channels via setCurrent — PlayerStage key={currentChannelId} triggers whole-component remount
 */

import { create } from 'zustand';
import type { Channel, SourceHealth } from '../lib/channels.config';

interface StreamingState {
  channels: Channel[];
  currentChannelId: string | null;
  healthByChannel: Record<string, SourceHealth>;
  setChannels: (channels: Channel[]) => void;
  setCurrent: (id: string) => void;
  setHealth: (id: string, h: SourceHealth) => void;
}

export const useStreamingStore = create<StreamingState>(set => ({
  channels: [],
  currentChannelId: null,
  healthByChannel: {},
  setChannels: channels => set({ channels }),
  setCurrent: id => set({ currentChannelId: id }),
  setHealth: (id, h) =>
    set(s => ({ healthByChannel: { ...s.healthByChannel, [id]: h } })),
}));
