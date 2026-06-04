/**
 * RecoveryGate — error recovery state machine (section 4.6 full version).
 *
 * Decision table (10s sliding window, shared across error types):
 *
 *   NETWORK_ERROR
 *     1    -> retry (hls.startLoad)
 *     2    -> retry (with level lock)
 *     >=3  -> failover
 *
 *   MEDIA_ERROR
 *     1    -> recover (hls.recoverMediaError)
 *     2    -> swapAudio (swapAudioCodec + recoverMediaError)
 *     >=3  -> failover
 *
 *   OTHER (mux/manifest etc)
 *     1    -> destroyRebuild (rebuild instance with same URL)
 *     2    -> failover (backupStreamUrls[0])
 *     3    -> failover (backupStreamUrls[1])
 *     >=4  -> failover (fallback: UI shows "demo mode")
 *
 * Key discipline:
 *   - Non-fatal errors: do NOT go through this class (hls.js handles them)
 *   - 10s silence resets the window
 *   - Window shared across error types (avoid 1 NET + 1 MEDIA = 1+1 actual window total of 2)
 */

export type FatalKind = 'network' | 'media' | 'other';

export type RecoveryAction =
  | 'retry'             // hls.startLoad() (with level lock)
  | 'recover'           // hls.recoverMediaError()
  | 'swapAudio'         // swapAudioCodec() + recoverMediaError()
  | 'destroyRebuild'    // rebuild instance with same URL
  | 'failover';         // switch to backupStreamUrls[next]

export class RecoveryGate {
  private readonly windowMs = 10_000;
  private readonly events: { kind: FatalKind; at: number }[] = [];
  private otherCount = 0;  // counter for OTHER events (used to pick the Nth backup)

  nextAction(kind: FatalKind): RecoveryAction {
    const now = Date.now();
    this.prune(now);
    this.events.push({ kind, at: now });

    if (kind === 'network') {
      const netInWindow = this.events.filter(e => e.kind === 'network').length;
      if (netInWindow <= 2) return 'retry';
      return 'failover';
    }
    if (kind === 'media') {
      const medInWindow = this.events.filter(e => e.kind === 'media').length;
      if (medInWindow === 1) return 'recover';
      return 'swapAudio';  // 2nd or later media errors: swap audio first
    }
    // other
    this.otherCount++;
    return 'destroyRebuild';
  }

  /** Get the next backup index (driven by otherCount) */
  nextBackupIndex(): number {
    // otherCount starts at 1:
    //   1 = 1st other (destroyRebuild, no backup)
    //   2 = 2nd other (switch to backup[0])
    //   3 = 3rd other (switch to backup[1])
    //  >=4 = fallback test source
    return Math.max(0, this.otherCount - 2);
  }

  reset(): void {
    this.events.length = 0;
    this.otherCount = 0;
  }

  totalInWindow(): number {
    this.prune(Date.now());
    return this.events.length;
  }

  private prune(now: number): void {
    const fresh = this.events.filter(e => now - e.at < this.windowMs);
    if (fresh.length !== this.events.length) this.events.length = 0, this.events.push(...fresh);
  }
}

/**
 * P0-3: resolve the next same-content backup URL the player should
 * `hls.loadSource()` when `RecoveryGate` returns the `failover` action.
 * Returns `null` when the gate has escalated past the available
 * backups — the player must surface a terminal state (e.g.
 * `PlaybackBlockedOverlay`) rather than load a cross-channel URL.
 *
 * Boundary guarantee: the function's only source of URLs is
 * `sameContentBackupUrls`. There is no code path that can return a URL
 * outside that list. The cross-channel failure mode of the pre-P0-3
 * `backupUrls` field is therefore not reproducible from this function.
 */
export function resolveFailoverTarget(
  sameContentBackupUrls: readonly string[],
  gateIndex: number,
): string | null {
  if (!Array.isArray(sameContentBackupUrls)) return null;
  if (gateIndex < 0 || !Number.isInteger(gateIndex)) return null;
  return sameContentBackupUrls[gateIndex] ?? null;
}
