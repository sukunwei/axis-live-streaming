# axis-live-streaming

> Live sports streaming platform that aggregates and re-delivers HLS feeds to viewers in a browser.
> Built for the Axis take-home assignment (~48 h, due 2026-06-04 20:00).

## Performance Optimizations (P0/P1/P2)

> 三轮迭代全部已落地并合并。**预测收益** 列基于 Chrome DevTools 离线 throttle + 上游 HLS 一般响应大小；**实测量化** 需 Playwright 跑 headless session。

### 网络层（P0）

| 改动 | 文件 | 预测收益 | 实测 |
|---|---|---|---|
| `<link rel=preconnect>` 后端（dev）+ dns-prefetch 兜底 | `frontend/index.html` | 首 SSE / `/hls/*` 省 50–200ms TCP+TLS | _TBD_ |
| 动态注入 upstream preconnect（从 `/channels.upstreamOrigins`）| `frontend/src/app/App.tsx` | 每个 upstream 省 100–300ms DNS+TCP+TLS | _TBD_ |
| `prefetchChannel` 预热 master **+ 第一 variant** | `frontend/src/live/ChannelSwitcher.ts` | 冷切台省 30–100ms | _TBD_ |
| `/channels` 加 `max-age=60, stale-while-revalidate=600` | `backend/src/server.ts` | 二次访问直接 304 | _TBD_ |
| segment 加 `immutable` + 透传 `Last-Modified` + 命中 `If-Modified-Since` → 304 | `backend/src/streaming/proxy.ts` | 多 tab / 浏览器回放省段字节 | _TBD_ |
| `PlayerStage` 改 `React.lazy` + `Suspense` | `frontend/src/app/App.tsx` | hls.js ~80KB gz 不进首屏 bundle | _TBD_ |
| 播放日志全切 `navigator.sendBeacon` | `frontend/src/components/Live/PlayerStage.tsx` | 不抢 HLS 段 socket，页面隐藏也能落盘 | — |

### 运行时（P1）

| 改动 | 文件 | 预测收益 | 实测 |
|---|---|---|---|
| `abrEwmaDefaultEstimate` 按 `navigator.connection.{downlink,effectiveType}` 选档 | `frontend/src/live/hlsConfig.ts` + `PlayerStage.tsx` | 移动端/弱网开局不再 3–5s 卡顿降档 | _TBD_ |
| `upstreamManifestCache` 加 LRU 容量 100 | `backend/src/streaming/manifestCache.ts` | 长跑进程不再因 unique URL 涨内存 | — |
| Service Worker 缓存 app shell + `/channels`（网络优先 + 后台刷新）| `frontend/public/sw.js` + `main.tsx` | 二次访问秒开 / 离线 | _TBD_ |

### 传输层（P2）

| 改动 | 文件 | 预测收益 | 实测 |
|---|---|---|---|
| `/channels`、`/api/playback-summary`、所有 manifest 加 `gzip` | `backend/src/http/gzip.ts` + `proxy.ts` + `server.ts` | manifest 1–3KB → ~400B（节 60–80%），弱网 4G 节 100–200ms | _TBD_ |
| 段响应 (`video/mp2t`) **不**加 gzip | — | 视频流已压缩，gzip 仅耗 CPU | — |

### 故意没做

- **hls.js 段请求 `fetchPriority: high`**：hls.js 1.5/1.6 默认 XHR loader 无法透传 priority；改 fetch loader 工程量 > 收益。1.6 已用 `fragLoadPolicy.default` 拿到更精确的加载预算控制，等后续上 1.7+ fetch-loader 升级再评估。
- **HTTP/3 / QUIC**：平台层，< 1% 用户受益。
- **主 manifest 也缓存到 SW**：HTTP cache + SWR 已经够，SW 缓存增 stale 风险。

## Quick Start

```bash
# Node 20+ recommended
pnpm install
cp frontend/.env.example frontend/.env
cp backend/.env.example  backend/.env
pnpm start              # boots backend (:5174) + frontend (:5173)
```

打开 http://localhost:5173，应该看到 4 频道网格 + 主播放器。

## Architecture (TL;DR)

```
Upstream HLS ──► Node proxy ──► hls.js (browser) ──► MSE / <video>
                    │
                    ├── manifest rewrite (same-origin proxy paths)
                    ├── segment stream pipe (no buffer, immutable + 304)
                    ├── manifest cache (LRU 100, 2s TTL, request collapsing)
                    ├── gzip on text responses (manifests + /channels + /api)
                    ├── health monitor (5s probe)
                    │      └── SSE → SourceStatusBadge + RecoveryGate
                    └── mock injector (POST /mock/break/:id for demo)
```

- **Frontend**: React 18 + Vite + hls.js 1.6 + Zustand. PlayerStage direct import (lazy import was tried and reverted — see TTFF regression in commit history).
- **Backend**: Node + TypeScript + native `http` + `ws`. Single in-process instance; in-memory caches with proper LRU eviction.
- **Data flow**: Browser **only** connects to own backend WS/HTTP. Never direct to upstream — proxy is the single source of truth, hides upstream topology, and centralises caching.

Detail and protocol spec: [`docs/streaming-technical-design.md`](docs/streaming-technical-design.md).

## Trade-offs

- **hls.js direct (no Video.js / Shaka wrapper)** — full control over buffer / ABR / error recovery, but we own the failure modes. Wrappers would have hidden the RecoveryGate + custom frag-load-policy tuning that this build depends on.
- **Single-instance backend, in-process** — fast to ship, no horizontal scale needed for demo. Caches (manifest, LRU) and SSE broadcaster all live in one process. Production would need Redis-backed cache + multi-instance coordination.
- **No WebRTC / no MediaMTX** — dropped to fit 48h. Documented as a next step. Current architecture is "HLS in, HLS out" only.
- **`backupStreamUrls` bypass the proxy on failover** — M3 simplification; failover reaches upstream directly. Production should reroute through `/hls-proxy?u=<encoded>` to keep the source-hiding invariant intact.
- **Mock injector only in dev** — `POST /mock/break/:id` returns 503 in production. Kept gated so it never accidentally trips a real outage.
- **Smoothness-first, not latency-first** — Tune 3 of `hlsConfig` trades ~2s of edge distance for a stable 8–10s buffer. The PRD weights smoothness / rebuffering more than raw latency, so this is the right tilt for the assignment.
- **Static `hlsConfig` + `makeHlsConfig()` factory split** — base tuning is the public API the tests pin; the factory injects `abrEwmaDefaultEstimate` from `navigator.connection` at mount time. Tests stay deterministic, runtime stays adaptive.

## Source Strategy

> 当前注册表见 [`backend/src/streaming/channels.config.ts`](backend/src/streaming/channels.config.ts)。下表是各频道**实际接入**的源；上游失效时可通过修改注册表切换，proxy 层无需改动。
>
> 所有频道都是体育内容。`dw-english`（DW 英语新闻）已于 2026-06-03 移除。

| Channel | Sport | Upstream | Notes |
|---------|-------|----------|-------|
| `red-bull-tv` | Extreme Sports | `rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8` | Red Bull TV 全球版（直 Akamai），6 档到 **1080p** |
| `red-bull-tv-es` | Extreme Sports (ES) | `886bd3fbc782459f8de7555d32d7e9ce.mediatailor.us-west-2.amazonaws.com/v1/master/.../LINEAR-957-WORBLATAMESFAST-WHALETVPLUS/.../playlist.m3u8` | Red Bull TV LATAM/Spanish 版（AWS MediaTailor 做广告插入），5 档到 1080p，seg 实际从 `freqsyndlin.redbull.com` 出，Spanish CC 轨道 |
| `acc-network` | College Sports | `raycom-accdn-firetv.amagi.tv/playlist.m3u8` | ACC Digital Network（ACC 大学体育），5 个变体，Amagi 平台 |
| `nhl-hockey` | Ice Hockey | `aegis-cloudfront-1.tubi.video/.../1f4cbb33.../playlist.m3u8` | NHL（冰球），6 个变体，Tubi / CloudFront CDN |
| `draftkings` | Sports Betting | `na.linear.zype.com/.../live.m3u8` | DraftKings Network，4 视频档 + I-frame + 字幕，Zype CDN |
| `fubo-sports` | General Sports | `dnf08l6u6uxnz.cloudfront.net/master.m3u8` | Fubo Sports Network，6 个变体，CloudFront CDN |

PRD "至少两种运动"远超满足 —— 4 个明确不同的体育类别：extreme (Red Bull)、college (ACCDN)、hockey (NHL)、general/betting (DraftKings + Fubo)。`draftkings` 内容是体育博彩/分析/赛事直播，**归为体育类**（与 ESPN Bet、Fox Bet 同类）。

**Failover cross-references**：每个 sports 频道列了 2 个其它源做 backup（不同 CDN），所以任意一路挂掉都能切到不共享 upstream 的回源。

> **关于源稳定性**：所有 URL 在 2026-06-03 已 curl 端到端验证（master 200 → variant 200 → segment 200）。**扫了 30+ 候选源**，绝大多数（Abu Dhabi / Dubai / Pluto stitcher / beIN Espanol / FanDuel / ACCDN-alternate / B1B Box / Afizzionados / EDGEsport / FITE-247 / ATV2 / Pluto M3U lists / 等）都因为 404 / TLS 拒握 / DNS 解析不了 / 协议不对（Pluto Stitcher）/ Cloudflare 风控（nocords）失败，详细 discard 列表在 commit history 里。公共源随时可能失效，部署前可跑 `scripts/test-sources.sh` 复测。

## Live Demo

部署到 Vercel/Railway 或用 tunnel 暴露本地 dev 服务器。**最快 5 分钟**：

### ngrok（推荐，最快）

```bash
# 安装（macOS）
brew install ngrok
ngrok config add-authtoken <your-token>    # 一次性，去 ngrok.com 注册

# 启动后端
pnpm --filter backend dev                # localhost:5174

# 另开一个 terminal，暴露 5174
ngrok http 5174
# 输出 Forwarding 行就是公网 URL，例如：
#   https://a1b2c3d4.ngrok-free.app → http://localhost:5174
```

然后前端 Vite dev 服务器跑在 5173 也用 ngrok 暴露（或者直接改 `frontend/.env` 把 `VITE_API_BASE` 指到后端的 ngrok URL）。

### cloudflared（免费、无需账号）

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:5174
# 输出 https://<random>.trycloudflare.com → http://localhost:5174
```

### 部署到 Railway + Vercel（更稳，30-60 min）

参考 `docs/streaming-technical-design.md` §1.3：后端 `railway up`、前端 `vercel --prod`、Vercel 环境变量 `VITE_API_BASE` 指 Railway URL。

## Next Steps (more time would do)

1. **Playwright 自动化测量** — headless Chrome 跑 5min 完整 session，输出真实 TTFF / 卡顿率 / 内存 / 帧丢失
2. **WebRTC / WHEP 低延迟通道** — MediaMTX 输出 WebRTC，对核心赛事压到亚秒级
3. **Redis 段缓存外置** — 真正扇出到多实例 + CDN 前置
4. **backup 走 proxy** — 当前 failover 时直连上游，改为 `/hls-proxy?u=<encoded>` 统一代理
5. **真 sports 源扩展** — 当前 PRD "2 sports" 用 ACCDN + NHL 满足；下一步可加 Pluto TV (Pluto TV Sports) / Tubi (Fox Sports) 拿到更多品类

## License

MIT
