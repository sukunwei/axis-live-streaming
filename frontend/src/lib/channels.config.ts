/**
 * Shared type definitions — aligned with backend /channels response fields.
 * Actual channel data fetched at runtime from /channels; this file only exports types.
 */

export type SourceHealth = 'ok' | 'degraded' | 'down';

export type ChannelCategory = 'sports' | 'others';

export interface Channel {
  id: string;
  sport: string;
  category: ChannelCategory;
  name: string;
  type: 'hls';
  /** Backend proxy path, e.g. '/hls/mux/x36xhzz.m3u8' */
  streamUrl: string;
  /** Master relative path, generally unused in frontend, kept for switch logic */
  masterPath: string;
  /**
   * @deprecated P0-3: always empty as of M1. Will be removed in M2.
   * Cross-channel URLs were the source of "auto switch to wrong content" —
   * see docs/failover-recovery-技术方案与开发计划.md §1.2.
   */
  backupStreamUrls: string[];
  /**
   * P0-3: proxy-rewritten same-content backup URLs (e.g.
   * '/hls/red-bull-tv/master_6660.m3u8'). Auto-failover only consults this
   * list. May be empty.
   */
  sameContentBackupUrls: string[];
  /** P0-3: derived from sameContentBackupUrls.length > 0. */
  autoFailoverEnabled: boolean;
  /** LIVE source flag (affects smoothness score) */
  live: boolean;
  /** Known variant count (affects smoothness score) */
  variants: number;
  /** Smoothness score 0-5, higher = smoother (backend returns sorted desc) */
  smoothnessScore: number;
}
