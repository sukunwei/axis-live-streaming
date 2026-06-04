/**
 * Channel registry — single source of truth (§6.4).
 *
 * Statically loaded at runtime. shared between dev/prod. Missing field fails startup.
 * Must curl-verify each URL on build day (§1.3 discipline).
 *
 * ⚠ Public HLS source pitfall: upstream can fail at any time (master 200 but variants 404,
 *    or TLS dies). All sources below were re-verified end-to-end on 2026-06-03
 *    (master → variant → segment 200 OK under BROWSER_UA). The full iptv-org sports
 *    list was scanned in the same session — most (Abu Dhabi / Dubai / Pluto stitcher /
 *    beIN Espanol / FanDuel / ACCDN-alternate / B1B Box / Afizzionados / EDGEsport /
 *    FITE-247 / ATV2) failed with 404 / TLS / DNS / 405 errors. The discarded list
 *    lives in commit history if anyone wants to retry.
 *
 * Current config: 5 sports + 1 others = 6 channels total.
 *
 * NHL was removed 2026-06-03 because the SSE-driven failover
 * (PlayerStage.tsx, the `health === 'down'` effect) switches to the
 * first `backupUrls` entry, which for NHL was ACCDN — a different
 * channel entirely (college sports), not the same content from a
 * different CDN. The "auto switch to wrong content" UX is misleading
 * and was visible enough that keeping NHL in the registry actively
 * hurt the demo. (The underlying design issue — that backupUrls
 * currently points to other channels instead of "same content from
 * a different CDN" — remains for the other channels; the README
 * Next Steps calls it out as a follow-up.)
 *
 * Registry is grouped: `sports` first, `others` last. The /channels
 * endpoint preserves that grouping when sorting (sports first by
 * smoothnessScore desc, then others by the same).
 *
 *   sports:
 *   - red-bull-tv        extreme sports (Red Bull TV global, direct Akamai) — 6 variants, 1080p
 *   - acc-network        college sports (ACCDN) — Amagi, 5 variants
 *   - draftkings         sports betting / analysis — Zype, 4 video variants + iframe + subs
 *
 *   others:
 *   - livestar           general live (Live Star HD, single-bitrate media playlist) — 1 variant, 720p
 *
 * Field notes:
 *   - primaryUrl: Full URL of upstream master (or media playlist for single-bitrate)
 *   - masterPath: relative path, browser requests /hls/:channel/<masterPath>
 */

export type ChannelCategory = 'sports' | 'others';

export interface Channel {
  readonly id: string;
  readonly sport: string;            // human label shown next to the channel name
  readonly category: ChannelCategory;
  readonly name: string;
  readonly type: 'hls';
  readonly primaryUrl: string;
  readonly masterPath: string;
  readonly live: boolean;            // true = LIVE source (enables stale check); false = VOD loop
  readonly variants: number;         // Known variant count (used for smoothness score)
  readonly backupUrls: readonly string[];
}

// === sports =================================================================
const sportsChannels: readonly Channel[] = [
  {
    id: 'red-bull-tv',
    sport: 'Extreme Sports',
    category: 'sports',
    name: 'Red Bull TV',
    type: 'hls',
    primaryUrl: 'https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8',
    masterPath: 'master.m3u8',
    live: true,
    variants: 6,  // 180p / 240p / 360p / 540p / 720p / 1080p (6660 kbps)
    backupUrls: [
      'https://raycom-accdn-firetv.amagi.tv/playlist.m3u8',
      'https://na.linear.zype.com/e0bd0e23-a958-4e43-8164-4f2fef8876a8/fd3614bd-90bf-4530-a277-65ae3a1720c8-zype/live.m3u8',
    ],
  },
  {
    id: 'acc-network',
    sport: 'College Sports',
    category: 'sports',
    name: 'ACC Digital Network',
    type: 'hls',
    primaryUrl: 'https://raycom-accdn-firetv.amagi.tv/playlist.m3u8',
    masterPath: 'playlist.m3u8',
    live: true,
    variants: 5,  // 240p / 360p / 480p / 720p / 1080p
    backupUrls: [
      'https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8',
      'https://na.linear.zype.com/e0bd0e23-a958-4e43-8164-4f2fef8876a8/fd3614bd-90bf-4530-a277-65ae3a1720c8-zype/live.m3u8',
    ],
  },
  {
    id: 'draftkings',
    sport: 'Sports Betting',
    category: 'sports',
    name: 'DraftKings Network',
    type: 'hls',
    primaryUrl: 'https://na.linear.zype.com/e0bd0e23-a958-4e43-8164-4f2fef8876a8/fd3614bd-90bf-4530-a277-65ae3a1720c8-zype/live.m3u8',
    masterPath: 'live.m3u8',
    live: true,
    variants: 4,  // 4 video variants (240/480/720/1080p) + 1 I-frame track + 1 subtitle track
    backupUrls: [
      'https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8',
      'https://raycom-accdn-firetv.amagi.tv/playlist.m3u8',
    ],
  },
];

// === others =================================================================
const othersChannels: readonly Channel[] = [
  {
    id: 'livestar',
    sport: 'General',
    category: 'others',
    name: 'Live Star HD',
    type: 'hls',
    // Single-bitrate media playlist (no master, no variants). hls.js consumes
    // it directly. The proxy serves it as /hls/livestar/star_inthd.m3u8 and
    // the relative segment paths get rewritten to /hls/livestar/<seg>.ts.
    primaryUrl: 'https://livestar.siliconweb.com/starvod/star_int/star_inthd.m3u8',
    masterPath: 'star_inthd.m3u8',
    live: true,
    variants: 1,  // single bitrate; 'hd' filename suggests 720p
    backupUrls: [], // intentionally empty — see "SSE-driven failover" caveat in README
  },
];

export const channels: readonly Channel[] = [...sportsChannels, ...othersChannels];
