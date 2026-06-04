/**
 * PlaybackBlockedOverlay — shown when health is `down` and the channel
 * has no same-content backup (P0-3 §3.3.3 / G2).
 *
 * Surfaces:
 *   - Why the player is not auto-switching (avoids the pre-P0-3 bug
 *     where `backupUrls` cross-channel entries silently misdirected
 *     viewers to a different sport / channel)
 *   - A manual retry path: in the demo this lets the reviewer prove
 *     that recovery is wired even when the upstream is mock-broken
 *
 * The parent owns the hls / gate refs and the retry side-effects —
 * this component is presentational only.
 */

interface PlaybackBlockedOverlayProps {
  /** Channel display name, e.g. "ACC Digital Network" */
  streamName: string;
  /** Called when the user clicks "Retry current source". */
  onRetry: () => void;
}

export function PlaybackBlockedOverlay({
  streamName,
  onRetry,
}: PlaybackBlockedOverlayProps) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-black/85 z-10"
      data-testid="playback-blocked-overlay"
    >
      <div className="flex flex-col items-center gap-4 text-center max-w-sm px-4">
        <div className="text-yellow-500 text-3xl">⚠</div>
        <h3 className="text-white text-lg font-semibold">Signal interrupted</h3>
        <p className="text-zinc-400 text-sm">
          Upstream is unavailable. <span className="text-white">{streamName}</span> has
          no same-content backup, so we won&apos;t auto-switch to a
          different channel. Try another channel, or wait for the
          source to recover.
        </p>
        <button
          onClick={onRetry}
          className="pointer-events-auto px-4 py-2 bg-white text-black rounded hover:bg-zinc-200 text-sm font-medium"
        >
          Retry current source
        </button>
      </div>
    </div>
  );
}
