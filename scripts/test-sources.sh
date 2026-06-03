#!/usr/bin/env bash
# 批量测 5 类源是否可用，输出 JSON 报告。
# 运行：./scripts/test-sources.sh

set -uo pipefail

# 通用测：HEAD → 200/3xx/4xx/5xx，UA 设为浏览器
check() {
  local label="$1"
  local url="$2"
  local code size t
  read code size t <<<"$(curl -s -o /dev/null -L --max-time 8 -w "%{http_code} %{size_download} %{time_total}" -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" "$url" 2>/dev/null || echo "0 0 0")"
  printf "%-50s %-65s %s %sB  %ss\n" "$label" "$url" "$code" "$size" "$t"
}

echo "================================================================"
echo " 1. 公共测试源（PRD 批准：开发/演示用）"
echo "================================================================"
check "Mux test (x36xhzz)"          "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"
check "Apple BipBop ABR"            "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8"
check "Akamai CPH live test"        "https://cph-p2p-msl.akamaized.net/hls/live/2000341/test/master.m3u8"
check "Akamai BigBuckBunny"         "https://multiplatform-f.akamaihd.net/i/multi/will/bunny/big_buck_bunny_,640x360_400,640x360_700,640x360_1000,950x540_1500,.f4v.csmil/master.m3u8"
check "Akamai 4x3 BipBop"           "https://multiplatform-f.akamaihd.net/i/multi/will/bunny/big_buck_bunny_,640x360_400,640x360_700,640x360_1000,950x540_1500,.f4v.csmil/master.m3u8"
check "TearsOfSteel multi-bitrate"  "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8"
check "Mux Test (ll-hls)"           "https://test-streams.mux.dev/test_001/stream.m3u8"

echo ""
echo "================================================================"
echo " 2. 真实免费直播（Red Bull / 公共广播）"
echo "================================================================"
check "Red Bull TV (BoRB-AT)"       "https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8"
check "NASA TV (NTV1)"              "https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8"
check "Stadium (College Sports)"    "https://stadiumlivein-i.akamaihd.net/hls/live/522512/mux_4/master.m3u8"
check "Bloomberg TV+"               "https://liveprodeuwest.global.ssl.fastly.net/Z2GBl1bX/bloomberg.m3u8"
check "France 24 EN"                "https://static.france24.com/live/F24_EN_LO_HLS/live_web.m3u8"
check "DW English"                  "https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8"
check "Euronews EN"                 "https://euronews-euronews-english-2-eu.rakuten.wurl.tv/playlist.m3u8"
check "ABC News Live"               "https://content.uplynk.com/channel/3324f2467c414329b3b2cc5cd9874f12.m3u8"
check "CBS News NY"                 "https://cbsn-us.cbsnstream.cbsnews.com/out/v1/55a8648e8f134ccaa13d0d5cd55e1b3a/master.m3u8"

echo ""
echo "================================================================"
echo " 3. FAST 频道（Pluto / Tubi / Xumo）— 已知通常需 API token"
echo "================================================================"
check "Pluto TV (示例公开频道)"        "https://siloh-fastly-ad-pluto.dais.akamaized.net/playlist.m3u8"
check "Tubi 示例"                      "https://tubitv.com/live/playlist.m3u8"
check "Xumo Play (示例)"              "https://xumo.com/live/playlist.m3u8"
check "Pluto East HD (公开试)"        "https://siloh-fastly-ad-pluto.dais.akamaized.net/east/master.m3u8"

echo ""
echo "================================================================"
echo " 4. YouTube Live 官方频道（**不**走 HLS，仅 embed 可行）"
echo "================================================================"
echo "⚠ YouTube HLS 抓取违反 YouTube ToS（详见 §1.4 合规边界）"
echo "  → 仅可通过 iframe embed，无法用 hls.js 播放，不会走本平台 proxy"
echo "  → 候选频道（仅参考）："
echo "    - NFL:           https://www.youtube.com/@NFL/streams"
echo "    - Formula 1:     https://www.youtube.com/@Formula1/streams"
echo "    - NBA G League:  https://www.youtube.com/@nbagleague"
echo "    - MLB:           https://www.youtube.com/@MLB"
echo "    - LaLiga:        https://www.youtube.com/@LaLiga"

echo ""
echo "================================================================"
echo " 5. 聚合站（Buffstreams 等）— 灰色，不做"
echo "================================================================"
echo "⚠ Buffstreams 类聚合站 HLS 抓取灰色；按 §1.4 合规边界**不**做"
echo "  → 仅 PRD 提到作为「最直接的演示方式」；本项目合规优先"

echo ""
echo "================================================================"
echo " 6. 官方广播页面（NCAA March Madness 等）"
echo "================================================================"
echo "⚠ NCAA / 联盟官网直播 Web 化，无公开 HLS 端点"
echo "  → 不适用于本平台（需要嵌入其 Web 播放器，无法走 hls.js）"

echo ""
echo "================================================================"
echo " 收尾：拿主链路（Red Bull）做端到端测试"
echo "================================================================"
echo ""
echo "--- Red Bull master ---"
curl -s "https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8" | grep -E "^#EXT-X-STREAM-INF|^http" | head -6
echo ""
echo "--- Red Bull variant (master_264.m3u8) ---"
curl -s "https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master_264.m3u8" | head -10
