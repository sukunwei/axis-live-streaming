/**
 * PlayerStage — main player (M3.4 + M3.6 SSE-driven failover)
 *
 * Responsibilities:
 *   - Mount <video> element
 *   - Create hls.js instance (hlsConfig) + MetricsCollector
 *   - Error recovery via RecoveryGate (4 levels, local fatal trigger)
 *   - Improvement 3: subscribe to store.healthByChannel[currentChannelId], auto-switch to backup after 2s of down
 *   - Exposes QualityHUD (observer reads metrics via collector.current)
 *   - Exposes SourceStatusBadge (channelId passed externally, read from store)
 *
 * Key constraints:
 *   - on channelId change, **whole-component remount** (parent uses key={channelId})
 *   - on destroy: hls.destroy() + collector.detach()
 *   - on backup switch: only swap loadSource, keep video element (preserves frame)
 */

import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import Hls from 'hls.js';
import { makeHlsConfig } from '../../live/hlsConfig';
import { RecoveryGate, type RecoveryAction } from '../../live/recoveryGate';
import { MetricsCollector } from '../../live/MetricsCollector';
import { useStreamingStore } from '../../stores/streamingStore';
import { Volume2, VolumeX, Maximize2, Minimize2, Play, Pause } from 'lucide-react';

function isBufferFullDetail(details: string | undefined): boolean {
  if (!details) return false;
  const d = details.toLowerCase();
  return d.includes('bufferfull') || d === 'buffer_full_error';
}

function trimHlsBackBuffer(hls: Hls): void {
  const h = hls as Hls & { flushBackBuffer?: () => void; flushBuffer?: () => void };
  if (typeof h.flushBackBuffer === 'function') {
    h.flushBackBuffer();
    return;
  }
  if (typeof h.flushBuffer === 'function') {
    h.flushBuffer();
  }
}

/**
 * Best-effort playback log via sendBeacon. Doesn't compete with HLS segment
 * fetches for the HTTP/1.1 socket pool and survives page unloads (the page
 * hide / unmount event below).
 */
function sendLog(payload: Record<string, unknown>): void {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return;
  try {
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    navigator.sendBeacon('/api/log-playback', blob);
  } catch {
    // Queue full or serialization failed — drop the log.
  }
}

/**
 * Try to start playback with audio on. Browsers block unmuted autoplay
 * unless the user has previously interacted with the origin (Chrome MEI,
 * Safari whitelist) or we're on a privileged context (localhost).
 *
 * Heuristic to avoid the wasted unmuted-then-reject round-trip on cold
 * visits (where it'll always fail):
 *   - `navigator.userActivation.hasBeenActive === true` (Chrome/Edge):
 *     user has interacted with the origin at some point this session —
 *     unmuted-first is very likely to succeed.
 *   - `window.location.hostname === 'localhost'`: privileged context.
 *   - Otherwise: skip the unmuted attempt and start muted immediately;
 *     the first-interaction listener will unmute as soon as the user
 *     clicks anywhere on the page.
 *
 * Falls back to muted playback + first-interaction unlock if unmuted is
 * rejected (handles Firefox / Safari which don't expose userActivation).
 */
function playWithAudio(
  video: HTMLVideoElement,
  setMutedState: (muted: boolean) => void,
): void {
  const canTryUnmuted = canAutoplayUnmuted();
  // Always register the unlock — even if unmuted-first works, the
  // listener is harmless once it fires (it short-circuits on
  // video.muted === false) and protects against later state changes
  // (e.g. user muting via the control bar, then clicking).
  const registerUnlock = (): void => {
    const unlock = (): void => {
      video.muted = false;
      setMutedState(false);
      document.removeEventListener('click', unlock, true);
      document.removeEventListener('keydown', unlock, true);
      document.removeEventListener('touchstart', unlock, true);
    };
    document.addEventListener('click', unlock, true);
    document.addEventListener('keydown', unlock, true);
    document.addEventListener('touchstart', unlock, true);
  };

  if (canTryUnmuted) {
    video.muted = false;
    setMutedState(false);
    const attempt = video.play();
    if (attempt === undefined) {
      // Some older WebKit returns undefined instead of a Promise.
      registerUnlock();
      return;
    }
    void attempt.catch((err: Error) => {
      if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
        // eslint-disable-next-line no-console
        console.log('[hls] play error:', err.message);
        return;
      }
      // Rejected — switch to muted and unlock on first interaction.
      video.muted = true;
      setMutedState(true);
      void video.play().catch((err2: Error) => {
        // eslint-disable-next-line no-console
        console.log('[hls] muted autoplay also blocked:', err2.message);
      });
      registerUnlock();
    });
    return;
  }

  // Cold visit — start muted immediately, no wasted unmuted attempt.
  video.muted = true;
  setMutedState(true);
  void video.play().catch((err: Error) => {
    // eslint-disable-next-line no-console
    console.log('[hls] muted autoplay blocked:', err.message);
  });
  registerUnlock();
}

function canAutoplayUnmuted(): boolean {
  if (typeof window === 'undefined') return false;
  // localhost is a privileged context in all browsers.
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return true;
  }
  // Chrome / Edge expose userActivation; true means the user has
  // interacted with the origin at some point, so unmuted autoplay is
  // very likely to succeed.
  if (typeof navigator !== 'undefined') {
    const ua = (navigator as Navigator & {
      userActivation?: { hasBeenActive?: boolean };
    }).userActivation;
    if (ua?.hasBeenActive === true) return true;
  }
  return false;
}

interface PlayerStageProps {
  /** Proxied m3u8 URL (frontend never connects to upstream directly) */
  streamUrl: string;
  streamName: string;
  channelId?: string;
  /** Backup sources (upstream direct URL) */
  backupStreamUrls?: readonly string[];
  /**
   * Optional externally-owned MetricsCollector ref. When provided, PlayerStage
   * populates this ref instead of creating its own — lets a parent (App) share
   * the same instance with a QualityHUD rendered as a sibling below the video.
   */
  collectorRef?: MutableRefObject<MetricsCollector | null>;
  onPlaying?: () => void;
  onError?: (kind: 'network' | 'media' | 'other', detail: string) => void;
}

export function PlayerStage({
  streamUrl,
  streamName,
  channelId,
  backupStreamUrls = [],
  collectorRef: externalCollectorRef,
  onError,
}: PlayerStageProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const gateRef = useRef(new RecoveryGate());
  const internalCollectorRef = useRef<MetricsCollector | null>(null);
  const collectorRef = externalCollectorRef ?? internalCollectorRef;
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [currentQuality, setCurrentQuality] = useState<string>('auto');
  const [isPlaying, setIsPlaying] = useState(false);
  const [failoverNotice, setFailoverNotice] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const playerContainerRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = (): void => {
    const el = playerContainerRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      void document.exitFullscreen();
    } else {
      void el.requestFullscreen();
    }
  };

  // Improvement 3: subscribe to health monitor, auto-switch to backup after 2s of down
  const health = useStreamingStore(s =>
    channelId ? s.healthByChannel[channelId] ?? 'ok' : 'ok',
  );
  useEffect(() => {
    if (health !== 'down' || !channelId) return;
    const t = setTimeout(() => {
      // Pick the next untried backup (avoid loops: if currently on backup[0], jump to backup[1])
      const currentIsBackup = (backupStreamUrls ?? []).some(b => hlsRef.current?.url === b);
      const nextIdx = currentIsBackup ? 1 : 0;
      const target = (backupStreamUrls ?? [])[nextIdx];
      if (!target || !hlsRef.current) return;
      setFailoverNotice(`SSE-driven failover → backup #${nextIdx + 1}`);
      // eslint-disable-next-line no-console
      console.warn(`[player] sse-driven failover → backup[${nextIdx}] (channel ${channelId})`);
      hlsRef.current.destroy();
      const next = new Hls(makeHlsConfig());
      hlsRef.current = next;
      next.loadSource(target);
      if (videoRef.current) next.attachMedia(videoRef.current);
    }, 2_000);
    return () => clearTimeout(t);
  }, [health, channelId, backupStreamUrls]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setIsLoading(true);
    setErrorMsg(null);
    setFailoverNotice(null);
    gateRef.current.reset();

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    // Reset/own the collector for this mount. If the parent provided an
    // external ref (so a sibling QualityHUD can read it), assign a fresh
    // instance; otherwise fall back to the internal ref. A reset on a
    // fresh collector clears any prior sampling.
    const collector: MetricsCollector = new MetricsCollector();
    collectorRef.current = collector;

    // Start MetricsCollector
    // (attach after hls is created below)

    if (!Hls.isSupported()) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = streamUrl;
        const onLoaded = (): void => {
          setIsLoading(false);
          playWithAudio(video, setIsMuted);
        };
        const onError = (): void => {
          setErrorMsg('Safari HLS load failed');
          setIsLoading(false);
        };
        video.addEventListener('loadedmetadata', onLoaded, { once: true });
        video.addEventListener('error', onError, { once: true });
        return () => {
          video.removeEventListener('loadedmetadata', onLoaded);
          video.removeEventListener('error', onError);
        };
      }
      setErrorMsg('HLS not supported in this browser');
      setIsLoading(false);
      return;
    }

    const hls = new Hls(makeHlsConfig());
    hlsRef.current = hls;

    const tryLoad = (url: string): void => {
      hls.loadSource(url);
    };

    tryLoad(streamUrl);
    hls.attachMedia(video);

    // Stall detection: waiting events → collector records stall
    video.addEventListener('waiting', () => {
      collector.onStallStart();
      setIsLoading(true);
    });
    video.addEventListener('canplay', () => {
      collector.onStallEnd();
      setIsLoading(false);
    });

    hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
      // eslint-disable-next-line no-console
      console.log(`[hls] manifest parsed, ${data.levels.length} levels`);
      setIsLoading(false);
      // Hard cap ABR at 720p: 1080p variants observed to stall on common
      // connections, and the visual delta over 720p on a typical screen
      // is small. Find the highest level index with height ≤ 720 and
      // set autoLevelCapping — hls.js's 1.6+ API for hard max level
      // (maxLevelHeight was removed in 1.6).
      const MAX_HEIGHT = 720;
      let capIndex = -1;
      for (let i = 0; i < hls.levels.length; i++) {
        if (hls.levels[i].height !== undefined && hls.levels[i].height! <= MAX_HEIGHT) {
          capIndex = i;
        }
      }
      if (capIndex >= 0) {
        hls.autoLevelCapping = capIndex;
        // eslint-disable-next-line no-console
        console.log(`[hls] autoLevelCapping=${capIndex} (height=${hls.levels[capIndex].height}p)`);
      }
      playWithAudio(video, setIsMuted);
    });

    hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
      const level = hls.levels[data.level];
      if (level) setCurrentQuality(`${level.height}p`);
    });

    const onVisibility = (): void => {
      if (document.hidden) hls.stopLoad();
      else hls.startLoad();
    };
    document.addEventListener('visibilitychange', onVisibility);

    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (isBufferFullDetail(data.details)) {
        try {
          trimHlsBackBuffer(hls);
        } catch {
          // non-fatal buffer trim — ignore
        }
        return;
      }
      if (!data.fatal) return;

      const kind: 'network' | 'media' | 'other' =
        data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'network'
        : data.type === Hls.ErrorTypes.MEDIA_ERROR ? 'media'
        : 'other';

      const action: RecoveryAction = gateRef.current.nextAction(kind);
      // eslint-disable-next-line no-console
      console.warn(`[hls] fatal ${kind} → ${action}`, data.details);

      switch (action) {
        case 'retry':
          setErrorMsg('Network error, reconnecting…');
          hls.startLoad();
          break;
        case 'recover':
          setErrorMsg('Media error, recovering…');
          hls.recoverMediaError();
          break;
        case 'swapAudio':
          setErrorMsg('Media error, swapping audio codec…');
          hls.swapAudioCodec();
          hls.recoverMediaError();
          break;
        case 'destroyRebuild': {
          setErrorMsg('Rebuilding playback instance…');
          hls.destroy();
          const reborn = new Hls(makeHlsConfig());
          hlsRef.current = reborn;
          reborn.loadSource(streamUrl);
          reborn.attachMedia(video);
          break;
        }
        case 'failover': {
          const idx = gateRef.current.nextBackupIndex();
          const backup = backupStreamUrls[idx];
          if (backup) {
            setErrorMsg(null);
            setFailoverNotice(`Switched to backup #${idx + 1}`);
            hls.destroy();
            const next = new Hls(makeHlsConfig());
            hlsRef.current = next;
            next.loadSource(backup);
            next.attachMedia(video);
            // eslint-disable-next-line no-console
            console.warn(`[hls] failover → backup[${idx}]: ${backup}`);
          } else {
            setErrorMsg('All backup sources unavailable');
            onError?.(kind, data.details ?? 'all backups exhausted');
          }
          break;
        }
        default: {
          const _exhaustive: never = action;
          void _exhaustive;
        }
      }
    });

    // Start MetricsCollector
    collector.attach(hls, video);

    // Send mount event
    if (channelId) {
      sendLog({ channelId, event: 'mount' });
    }

    // Periodic sample upload: 5s while playing
    const sampleTimer = window.setInterval(() => {
      if (!channelId) return;
      const m = collector.current;
      if (m.samplingAt === 0) return;
      sendLog({
        channelId,
        event: 'sample',
        stalls: m.stallCount,
        totalStallMs: Math.round(m.totalStallMs),
        droppedFrames: m.droppedFrames,
        decodedFrames: m.decodedFrames,
        avgBufferSec: m.bufferSec,
        avgBitrateKbps: m.bitrateKbps,
        avgFps: m.fps,
      });
    }, 5_000);

    // Keyboard shortcut: M toggles mute, F toggles fullscreen, K/space toggles play-pause
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'm' || e.key === 'M') {
        const v = videoRef.current;
        if (!v) return;
        v.muted = !v.muted;
        setIsMuted(v.muted);
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      } else if (e.key === 'k' || e.key === 'K' || e.key === ' ') {
        e.preventDefault();
        const v = videoRef.current;
        if (!v) return;
        if (v.paused) void v.play();
        else v.pause();
      }
    };
    document.addEventListener('keydown', onKey);

    // Fullscreen state sync (F11 / Esc / browser fullscreen button)
    const onFsChange = (): void => {
      setIsFullscreen(document.fullscreenElement === playerContainerRef.current);
    };
    document.addEventListener('fullscreenchange', onFsChange);

    return () => {
      // Final unmount sample
      if (channelId) {
        const m = collector.current;
        if (m.samplingAt !== 0) {
          sendLog({
            channelId,
            event: 'unmount',
            stalls: m.stallCount,
            totalStallMs: Math.round(m.totalStallMs),
            droppedFrames: m.droppedFrames,
            decodedFrames: m.decodedFrames,
            avgBufferSec: m.bufferSec,
            avgBitrateKbps: m.bitrateKbps,
            avgFps: m.fps,
          });
        }
      }
      window.clearInterval(sampleTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFsChange);
      collector.detach();
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [streamUrl, backupStreamUrls, onError]);

  return (
    <div ref={playerContainerRef} className="relative w-full h-full bg-black rounded-lg overflow-hidden">
      <video
        ref={videoRef}
        className="w-full h-full"
        autoPlay
        playsInline
        onPlay={() => { setIsPlaying(true); }}
        onPause={() => setIsPlaying(false)}
        onClick={() => (videoRef.current?.paused ? videoRef.current?.play() : videoRef.current?.pause())}
      />

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 pointer-events-none">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin" />
            <p className="text-white text-sm">Loading {streamName}…</p>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="absolute top-4 left-4 right-4 bg-red-500/90 text-white px-4 py-2 rounded-lg">
          <p className="text-sm">{errorMsg}</p>
        </div>
      )}

      {failoverNotice && (
        <div className="absolute bottom-16 left-4 right-4 bg-yellow-500/90 text-black px-4 py-2 rounded-lg">
          <p className="text-sm font-medium">⚠ {failoverNotice}</p>
        </div>
      )}

      <div className="absolute top-4 left-4 bg-black/70 text-white px-3 py-1.5 rounded">
        <p className="text-sm font-medium">{streamName}</p>
      </div>

      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent">
        <div className="flex items-center gap-3 px-3 pb-3 text-white text-sm pointer-events-none">
          <span className="bg-red-600 px-2 py-0.5 rounded text-xs font-semibold">
            LIVE
          </span>
          {currentQuality !== 'auto' && parseInt(currentQuality, 10) > 0 && (
            <span className="bg-black/60 px-2 py-0.5 rounded text-xs">{currentQuality}</span>
          )}
          <div className="flex-1" />
          <button
            onClick={() => {
              const v = videoRef.current;
              if (!v) return;
              if (v.paused) void v.play();
              else v.pause();
            }}
            className="pointer-events-auto text-white hover:text-zinc-300 transition-colors p-1.5 rounded hover:bg-white/10"
            title={isPlaying ? 'Pause (K)' : 'Play (K)'}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying
              ? <Pause className="w-5 h-5" />
              : <Play className="w-5 h-5" />}
          </button>
          <button
            onClick={() => {
              const v = videoRef.current;
              if (!v) return;
              v.muted = !v.muted;
              setIsMuted(v.muted);
            }}
            className="pointer-events-auto text-white hover:text-zinc-300 transition-colors p-1.5 rounded hover:bg-white/10"
            title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted
              ? <VolumeX className="w-5 h-5" />
              : <Volume2 className="w-5 h-5" />}
          </button>
          <button
            onClick={toggleFullscreen}
            className="pointer-events-auto text-white hover:text-zinc-300 transition-colors p-1.5 rounded hover:bg-white/10"
            title={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen
              ? <Minimize2 className="w-5 h-5" />
              : <Maximize2 className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

