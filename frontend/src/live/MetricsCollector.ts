/**
 * MetricsCollector — 1Hz sampling of hls.js + video metrics (§4.5 + §5.4 discipline).
 *
 * Key constraints:
 *   - Sample results write to ref (`current`), **not** to Zustand store
 *   - HUD independently uses useState + setInterval to force 1Hz re-render
 *   - On reset, counts zero; on stop, interval cleared
 */

import type Hls from 'hls.js';

export interface MetricsSnapshot {
  currentLevel: number;        // -1 = auto
  resolution: string;          // 'auto' | '720p' | '1080p'
  bitrateKbps: number;
  bandwidthKbps: number;       // EWMA
  bufferSec: number;           // buffer seconds
  liveLatencySec: number;      // live edge distance
  droppedFrames: number;
  decodedFrames: number;
  stallCount: number;
  totalStallMs: number;
  fps: number;                 // estimated fps
  samplingAt: number;          // sampling timestamp
}

const EMPTY: MetricsSnapshot = {
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

export class MetricsCollector {
  private timer: number | null = null;
  private hls: Hls | null = null;
  private video: HTMLVideoElement | null = null;
  private stallStart: number | null = null;
  public current: MetricsSnapshot = EMPTY;
  // Last sample's dropped/decoded frame counts (for fps estimation)
  private prevDecoded = 0;
  private prevSampleAt = 0;

  attach(hls: Hls, video: HTMLVideoElement): void {
    this.detach();
    this.hls = hls;
    this.video = video;
    this.stallStart = null;
    this.current = { ...EMPTY, samplingAt: Date.now() };
    this.prevDecoded = 0;
    this.prevSampleAt = Date.now();
    this.timer = window.setInterval(() => this.sample(), 1000);
  }

  /** Called by PlayerStage when a waiting event is detected */
  onStallStart(): void {
    if (this.stallStart === null) this.stallStart = performance.now();
  }
  onStallEnd(): void {
    if (this.stallStart !== null) {
      const dur = performance.now() - this.stallStart;
      this.stallStart = null;
      this.current = { ...this.current, stallCount: this.current.stallCount + 1, totalStallMs: this.current.totalStallMs + dur };
    }
  }

  reset(): void {
    this.stallStart = null;
    this.current = { ...EMPTY, samplingAt: Date.now() };
    this.prevDecoded = 0;
    this.prevSampleAt = Date.now();
  }

  detach(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.hls = null;
    this.video = null;
    this.current = EMPTY;
    this.stallStart = null;
  }

  private sample(): void {
    const hls = this.hls;
    const video = this.video;
    if (!hls || !video) return;
    const now = Date.now();
    const dtSec = Math.max(0.001, (now - this.prevSampleAt) / 1000);

    const level = hls.currentLevel >= 0 ? hls.levels[hls.currentLevel] : null;
    const q = video.getVideoPlaybackQuality?.() ?? { droppedVideoFrames: 0, totalVideoFrames: 0 };
    // hls.js 1.6+: mainForwardBufferInfo.len gives current forward buffer in seconds
    const buf = (hls as unknown as { mainForwardBufferInfo?: { len?: number } }).mainForwardBufferInfo?.len ?? 0;
    const bandwidth = hls.bandwidthEstimate ?? 0;
    const latency = hls.latency ?? 0;

    const dFrames = q.totalVideoFrames - this.prevDecoded;
    const fps = Math.round(dFrames / dtSec);
    this.prevDecoded = q.totalVideoFrames;
    this.prevSampleAt = now;

    this.current = {
      currentLevel: hls.currentLevel,
      resolution: level ? `${level.height}p` : 'auto',
      bitrateKbps: level ? Math.round(level.bitrate / 1000) : 0,
      bandwidthKbps: Math.round(bandwidth / 1000),
      bufferSec: Math.round(buf * 10) / 10,
      liveLatencySec: Math.round(latency * 10) / 10,
      droppedFrames: q.droppedVideoFrames,
      decodedFrames: q.totalVideoFrames,
      stallCount: this.current.stallCount,
      totalStallMs: this.current.totalStallMs,
      fps,
      samplingAt: now,
    };
  }
}
