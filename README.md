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

## Source Strategy

| Channel | Sport | Source | CORS |
|---------|-------|--------|------|
| Red Bull TV | Extreme Sports | Akamai HLS | ✓ |
| Stadium | College Sports | Akamai HLS | ✓ |
| NASA TV | Public | Akamai HLS | ✓ |
| Mux Test Stream | Test | test-streams.mux.dev | ✓ |

> 删除了原 Figma 设计里的 Fox Sports（DNS 失效）和 Fight Network（TLS 证书不匹配）——这两个 URL 已不可用。

## Next Steps (more time would do)

1. **Playwright 自动化测量** — headless Chrome 跑 5min 完整 session，输出真实 TTFF / 卡顿率 / 内存 / 帧丢失
2. **WebRTC / WHEP 低延迟通道** — MediaMTX 输出 WebRTC，对核心赛事压到亚秒级
3. **Redis 段缓存外置** — 真正扇出到多实例 + CDN 前置
4. **backup 走 proxy** — 当前 failover 时直连上游，改为 `/hls-proxy?u=<encoded>` 统一代理

## License

MIT
