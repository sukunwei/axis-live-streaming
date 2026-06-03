/**
 * Channel registry — single source of truth (§6.4).
 *
 * Statically loaded at runtime. shared between dev/prod. Missing field fails startup.
 * Must curl-verify each URL on build day (§1.3 discipline).
 *
 * ⚠ Public HLS source pitfall: upstream can fail at any time (master 200 but variants 404,
 *    or TLS dies). 2026-06-02 measured: redbull, stadium both purged; france 24 upstream
 *    TLS died. The two real sports sources below were re-verified end-to-end on 2026-06-03
 *    (master + variant + segment 200 OK under BROWSER_UA).
 *
 * Current config: 2 public news / sports + 2 test sources
 *   - dw-english    public news (real, DW public broadcast) — live, 5 variants
 *   - acc-network   college sports (real, ACC Digital Network via Amagi) — live, 5 variants
 *   - nhl-hockey    ice hockey (real, NHL via Tubi/CloudFront) — live, 6 variants
 *   - apple-bipbop  Apple public test (HLS ABR multi-tier) — VOD loop
 *
 * Meets PRD requirement "at least two sports": ACCDN (college football/basketball) and
 * NHL (ice hockey) are two different sports categories with different upstream CDNs
 * (Amagi vs. CloudFront) for failover-story contrast.
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
    ],
  },
  {
    id: 'apple-bipbop',
    sport: 'Test',
    name: 'Apple BipBop Test',
    type: 'hls',
    primaryUrl: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8',
    masterPath: 'bipbop_4x3_variant.m3u8',
    live: false,  // VOD loop
    variants: 4,
    backupUrls: [
      'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    ],
  },
];
