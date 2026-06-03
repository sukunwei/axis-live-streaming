/**
 * Shared type definitions — aligned with backend /channels response fields. 
 * Actual channel data fetched at runtime from /channels; this file only exports types. 
 */

export type SourceHealth = 'ok' | 'degraded' | 'down';

export interface Channel {
  id: string;
  sport: string;
  name: string;
  type: 'hls';
  /** Backend proxy path, e.g. '/hls/mux/x36xhzz.m3u8' */
  streamUrl: string;
  /** Master relative path, generally unused in frontend, kept for switch logic */
  masterPath: string;
  /** Backup source URL (direct upstream HLS), used in M3.4 failover.  */
  backupStreamUrls: string[];
  /** LIVE source flag (affects smoothness score) */
  live: boolean;
  /** Known variant count (affects smoothness score) */
  variants: number;
  /** Smoothness score 0-5, higher = smoother (backend returns sorted desc) */
  smoothnessScore: number;
}
