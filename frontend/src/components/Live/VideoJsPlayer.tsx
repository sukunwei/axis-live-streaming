/**
 * VideoJsPlayer — video.js 8 + VHS (videojs-http-streaming) wrapper.
 *
 * Phase 1 of the video.js migration (see docs/dev-video.md). Just the
 * player UI: the controls bar, big-play button, time slider, quality
 * menu, fullscreen toggle — all from video.js's default skin.
 *
 * The hls.js engine is wrapped inside VHS (same hls.js 1.6.16 we used
 * before), so manifest parsing / ABR / MSE appending behave identically
 * to the old PlayerStage. The browser hits our proxy at the same
 * `/hls/<id>/<path>` URL, so all the P0/P1/P2 perf work on the proxy
 * side keeps working.
 *
 * What this replaces (for now): only the visual chrome of the player.
 * The custom RecoveryGate, MetricsCollector, SSE-driven failover, and
 * QualityHUD stay wired to the (now-removed) PlayerStage via a noop
 * ref for this phase. They will be ported in Phase 2-3 of the
 * migration plan.
 *
 * Cleanup: video.js is stateful (it attaches DOM event listeners and
 * spawns a VHS instance). Always call `player.dispose()` on unmount.
 */
import { useEffect, useRef } from 'react';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';
import type Player from 'video.js/dist/types/player';

export interface VideoJsPlayerProps {
  /** Proxied m3u8 URL, e.g. '/hls/red-bull-tv/master.m3u8'. */
  streamUrl: string;
  streamName: string;
  /** Optional poster URL shown before the first frame. */
  poster?: string;
}

export function VideoJsPlayer({ streamUrl, streamName, poster }: VideoJsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<Player | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;

    // video.js mutates the <video> element in place (replaces with a
    // wrapping div + its own controls). We let it own that DOM.
    const player = videojs(videoRef.current, {
      autoplay: 'muted',  // hint; we still set muted=true below to satisfy autoplay policy
      muted: true,        // autoplay policy requires muted on cold load
      playsinline: true,
      controls: true,
      fluid: true,        // responsive container sizing
      responsive: true,
      preload: 'auto',
      // source: set below so we can rebuild on streamUrl change
      sources: [{
        src: streamUrl,
        type: 'application/x-mpegURL',
      }],
      // VHS config — mostly default; we keep our P0/P1 tuning on the
      // proxy side, so the engine itself doesn't need many overrides.
      html5: {
        vhs: {
          // Don't override native HLS (Safari) — let Safari use its
          // built-in MSE pipeline; only Chrome/Firefox use VHS+hls.js.
          overrideNative: false,
        },
      },
    });
    playerRef.current = player;

    // The <video> tag doesn't render the poster attribute correctly
    // once video.js takes it over; set it on the player instead.
    if (poster) {
      player.poster(poster);
    }
    // a11y: announce the channel name on the player.
    const techEl = player.tech(true).el() as HTMLVideoElement | undefined;
    if (techEl) {
      techEl.setAttribute('aria-label', `${streamName} live stream`);
    }

    return () => {
      player.dispose();
      playerRef.current = null;
    };
  }, [streamUrl, streamName, poster]);

  return (
    <div data-vjs-player className="w-full h-full">
      <video
        ref={videoRef}
        className="video-js vjs-default-skin vjs-big-play-centered w-full h-full"
        playsInline
      />
    </div>
  );
}
