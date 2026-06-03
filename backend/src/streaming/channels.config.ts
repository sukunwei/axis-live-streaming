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
 * Current config: 1 public news + 4 sports + (no test) — was 6 channels with
 * apple-bipbop test, replaced it with Red Bull TV (1080p + Akamai + 6 variants)
 * for a stronger live sports demo.
 *   - dw-english    public news  (real, DW public broadcast) — Akamai, 5 variants
 *   - red-bull-tv   extreme sports (Red Bull TV free live events) — Akamai, 6 variants, 1080p
 *   - acc-network   college sports (ACCDN) — Amagi, 5 variants
 *   - nhl-hockey    ice hockey (NHL) — Tubi/CloudFront, 6 variants
 *   - draftkings    sports betting / analysis — Zype, 4 video variants + iframe + subs
 *   - fubo-sports   general sports (Fubo Sports Network) — CloudFront, 6 variants
 *
 * PRD "at least two sports" is satisfied by acc-network + nhl-hockey (or any
 * pair). All 5 sports channels live on different CDNs (Akamai / Amagi / Tubi-CF /
 * Zype / CloudFront), so a single CDN outage can only kill at most 1 of the
 * 4 backup cross-references per channel.
 *
 * Field notes:
 *   - primaryUrl: Full URL of upstream master
 *   - masterPath: relative path, browser requests /hls/:channel/<masterPath>
 */

export interface Channel {
  readonly id: string;
  readonly sport: string;
  readonly name: string;
  readonly type: 'hls';
  readonly primaryUrl: string;
  readonly masterPath: string;
  readonly live: boolean;            // true = LIVE source (enables stale check); false = VOD loop
  readonly variants: number;         // Known variant count (used for smoothness score)
  readonly backupUrls: readonly string[];
}

export const channels: readonly Channel[] = [
  {
    id: 'dw-english',
    sport: 'Public News',
    name: 'DW English',
    type: 'hls',
    primaryUrl: 'https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8',
    masterPath: 'index.m3u8',
    live: true,
    variants: 5,
    backupUrls: [
      'https://raycom-accdn-firetv.amagi.tv/playlist.m3u8',
    ],
  },
  {
    id: 'red-bull-tv',
    sport: 'Extreme Sports',
    name: 'Red Bull TV',
    type: 'hls',
    primaryUrl: 'https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8',
    masterPath: 'master.m3u8',
    live: true,
    variants: 6,  // 180p / 240p / 360p / 540p / 720p / 1080p (6660 kbps)
    backupUrls: [
      'https://raycom-accdn-firetv.amagi.tv/playlist.m3u8',
      'https://dnf08l6u6uxnz.cloudfront.net/master.m3u8',
    ],
  },
  {
    id: 'acc-network',
    sport: 'College Sports',
    name: 'ACC Digital Network',
    type: 'hls',
    primaryUrl: 'https://raycom-accdn-firetv.amagi.tv/playlist.m3u8',
    masterPath: 'playlist.m3u8',
    live: true,
    variants: 5,  // 240p / 360p / 480p / 720p / 1080p
    backupUrls: [
      'https://aegis-cloudfront-1.tubi.video/1f4cbb33-cb23-40ab-b54b-2965cc551b32/playlist.m3u8',
      'https://dnf08l6u6uxnz.cloudfront.net/master.m3u8',
    ],
  },
  {
    id: 'nhl-hockey',
    sport: 'Ice Hockey',
    name: 'NHL',
    type: 'hls',
    primaryUrl: 'https://aegis-cloudfront-1.tubi.video/1f4cbb33-cb23-40ab-b54b-2965cc551b32/playlist.m3u8',
    masterPath: 'playlist.m3u8',
    live: true,
    variants: 6,
    backupUrls: [
      'https://raycom-accdn-firetv.amagi.tv/playlist.m3u8',
      'https://na.linear.zype.com/e0bd0e23-a958-4e43-8164-4f2fef8876a8/fd3614bd-90bf-4530-a277-65ae3a1720c8-zype/live.m3u8',
    ],
  },
  {
    id: 'draftkings',
    sport: 'Sports Betting',
    name: 'DraftKings Network',
    type: 'hls',
    primaryUrl: 'https://na.linear.zype.com/e0bd0e23-a958-4e43-8164-4f2fef8876a8/fd3614bd-90bf-4530-a277-65ae3a1720c8-zype/live.m3u8',
    masterPath: 'live.m3u8',
    live: true,
    variants: 4,  // 4 video variants (240/480/720/1080p) + 1 I-frame track + 1 subtitle track
    backupUrls: [
      'https://dnf08l6u6uxnz.cloudfront.net/master.m3u8',
      'https://aegis-cloudfront-1.tubi.video/1f4cbb33-cb23-40ab-b54b-2965cc551b32/playlist.m3u8',
    ],
  },
  {
    id: 'fubo-sports',
    sport: 'General Sports',
    name: 'Fubo Sports Network',
    type: 'hls',
    primaryUrl: 'https://dnf08l6u6uxnz.cloudfront.net/master.m3u8',
    masterPath: 'master.m3u8',
    live: true,
    variants: 6,  // 216p / 216p / 288p / 404p / 720p / 1080p
    backupUrls: [
      'https://na.linear.zype.com/e0bd0e23-a958-4e43-8164-4f2fef8876a8/fd3614bd-90bf-4530-a277-65ae3a1720c8-zype/live.m3u8',
      'https://raycom-accdn-firetv.amagi.tv/playlist.m3u8',
    ],
  },
];
