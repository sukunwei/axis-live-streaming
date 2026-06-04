/**
 * VideoJsPlayer — video.js 8 + VHS wrapper, React-friendly.
 *
 * Phase 1 of the video.js migration (see docs/dev-video.md). The
 * player UI is owned entirely by video.js's default skin; React just
 * provides a stable mount point.
 *
 * React ownership boundary:
 *   - React owns ONE element: the <div ref={containerRef}> below.
 *   - video.js owns everything inside: the wrapping vjs-tech div, the
 *     <video> element, all the control bar DOM.
 *   - When the component unmounts, we call player.dispose() FIRST
 *     (which removes video.js's DOM), then React removes the (now
 *     empty) container.
 *   - Crucially: the <video> element is NOT in the JSX. video.js
 *     creates it via document.createElement + containerRef.appendChild.
 *     This avoids the classic "Failed to execute 'removeChild'"
 *     error: React tries to removeChild a node that video.js has
 *     already moved/rewrapped.
 *
 * Channel switching: we never re-mount this component. When
 * `streamUrl` changes (channel clicked), the second useEffect calls
 * `player.src(...)` which is video.js's native hot-swap path —
 * the VHS instance tears down and rebuilds, but the wrapping
 * DOM stays put. App.tsx must NOT pass `key={channelId}` on this
 * component (removed in this commit).
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
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  // Keep latest streamName/poster accessible from the ready callback
  // without re-running the init effect when they change.
  const metaRef = useRef({ streamName, poster });
  metaRef.current = { streamName, poster };

  // 1) Mount: create the <video> element imperatively, init player.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Create the video element ourselves so React doesn't track it.
    const videoEl = document.createElement('video');
    videoEl.className = 'video-js vjs-default-skin vjs-big-play-centered w-full h-full';
    videoEl.setAttribute('playsinline', '');
    container.appendChild(videoEl);

    const player = videojs(videoEl, {
      autoplay: 'muted',  // hint; we also set muted=true below for autoplay policy
      muted: true,        // autoplay policy requires muted on cold load
      playsinline: true,
      controls: true,
      fluid: true,
      responsive: true,
      preload: 'auto',
      // No initial source — the second useEffect below calls
      // player.src([...]) once the player is ready.
      html5: {
        vhs: {
          overrideNative: false,  // Safari uses native HLS; others use VHS+hls.js
        },
      },
    });
    playerRef.current = player;

    // eslint-disable-next-line no-console
    console.log('[VideoJsPlayer] player created, container has', container.children.length, 'children');

    // Verbose debug listeners — drop after we know it works.
    player.on('ready', () => {
      // eslint-disable-next-line no-console
      console.log('[VideoJsPlayer] ready, video size:', player.currentWidth(), 'x', player.currentHeight());
      // a11y: announce the channel name on the underlying tech element.
      const techEl = player.tech().el() as HTMLVideoElement | undefined;
      if (techEl) {
        techEl.setAttribute('aria-label', `${metaRef.current.streamName} live stream`);
      }
      // Explicitly call play() to start. autoplay: 'muted' relies on
      // the browser being ready to play, but the ready event fires
      // before the manifest is fully loaded — Chrome may reject the
      // autoplay request. Calling play() ourselves gives the browser a
      // second chance once it's actually ready to render frames.
      const p = player.play();
      if (p && typeof p.then === 'function') {
        p.catch((err: Error) => {
          // eslint-disable-next-line no-console
          console.log('[VideoJsPlayer] play() rejected:', err.message);
        });
      }
    });
    player.on('loadedmetadata', () => {
      // eslint-disable-next-line no-console
      console.log('[VideoJsPlayer] loadedmetadata, duration=', player.duration());
    });
    player.on('error', () => {
      // eslint-disable-next-line no-console
      const err = player.error();
      console.error('[VideoJsPlayer] error:', err);
    });
    player.on('play', () => {
      // eslint-disable-next-line no-console
      console.log('[VideoJsPlayer] play');
    });
    player.on('pause', () => {
      // eslint-disable-next-line no-console
      console.log('[VideoJsPlayer] pause');
    });

    // Clean up on unmount: dispose video.js (which removes its own DOM)
    // BEFORE React tries to removeChild the container.
    return () => {
      const p = playerRef.current;
      if (p) {
        try { p.dispose(); } catch { /* defensive: video.js sometimes throws on rapid dispose */ }
        playerRef.current = null;
      }
      // Remove the video element we created. video.js's dispose() may
      // have already done this; check first.
      if (videoEl.parentNode === container) {
        container.removeChild(videoEl);
      }
    };
  }, []);  // mount once

  // 2) Update source when streamUrl changes (no remount).
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    // Resolve the relative path against the page origin. The <video>
    // element is created via document.createElement + appendChild; without
    // a document <base>, the browser may resolve 'src' against an
    // unexpected base URL (chrome resolves it to about:blank in some
    // cases for orphan elements). Passing an absolute URL sidesteps the
    // whole class of base-URL resolution issues.
    const absolute = streamUrl.startsWith('http')
      ? streamUrl
      : `${window.location.origin}${streamUrl.startsWith('/') ? '' : '/'}${streamUrl}`;
    // eslint-disable-next-line no-console
    console.log('[VideoJsPlayer] setting src:', absolute);
    // video.js src() takes an array of source objects. Switching source
    // tears down the current VHS instance and rebuilds. The wrapping
    // DOM stays put, so React doesn't see anything change.
    p.src([{ src: absolute, type: 'application/x-mpegURL' }]);
  }, [streamUrl]);

  // 3) Update poster / aria-label when streamName or poster changes.
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    if (poster) p.poster(poster);
    p.one('ready', () => {
      const techEl = p.tech().el() as HTMLVideoElement | undefined;
      if (techEl) techEl.setAttribute('aria-label', `${streamName} live stream`);
    });
  }, [poster, streamName]);

  // React only renders the container; video.js owns everything inside.
  return <div ref={containerRef} className="w-full h-full" data-vjs-player />;
}
