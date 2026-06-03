/**
 * Channel registry — single source of truth (§6.4). 
 *
 * Statically loaded at runtime. shared between dev/prod. Missing field fails startup. 
 * Must curl-verify each URL on build day (§1.3 discipline). 
 *
 * ⚠ Public HLS source pitfall: upstream can fail at any time (master 200 but variants 404, or TLS dies). 
 *    2026-06-02 measured: redbull, stadium both purged; france 24 upstream TLS died. 
 *    must run ./scripts/test-sources.sh before deployment. 
 *
 * Current config: 1 real public channel + 3 public test sources (PRD R2 "two sports" partially met)
 *   - dw-english    public news (real, DW public broadcast)
 *   - mux-llhls     LL-HLS test (demo §4.1 low-latency tuning)
 *   - mux           VOD loop test (multi-tier ABR)
 *   - apple-bipbop  Apple public test (HLS ABR multi-tier)
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
    variants: 5,  // 5 ABR tiers (measured) + caption track
    backupUrls: [
      'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    ],
  },
  {
    id: 'mux-llhls',
    sport: 'Test (LL-HLS)',
    name: 'Mux LL-HLS Test',
    type: 'hls',
    primaryUrl: 'https://test-streams.mux.dev/test_001/stream.m3u8',
    masterPath: 'stream.m3u8',
    live: false,  // public test source is a loop
    variants: 4,
    backupUrls: [
      'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    ],
  },
  {
    id: 'mux',
    sport: 'Test',
    name: 'Mux VOD Test',
    type: 'hls',
    primaryUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    masterPath: 'x36xhzz.m3u8',
    live: false,  // VOD loop
    variants: 5,
    backupUrls: [
      'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8',
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
