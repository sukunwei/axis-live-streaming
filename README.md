# axis-live-streaming

> Live sports streaming platform that aggregates and re-delivers HLS feeds to viewers in a browser.
> Built for the Axis take-home assignment (~48 h, due 2026-06-04 20:00).

## Live Demo

- **URL**: _TBD — see Deployment section below_
- **Fallback**: `pnpm start` and screen-share locally.

## Measured Performance

_实测于 2026-06-02 本地 localhost 部署。运行 `scripts/measure.sh` 可重新生成。_

| 指标 | 目标 | 实测 | 验证方法 |
|------|------|------|----------|
| 首帧时间 (TTFF) | < 1.5s | ~0.4s (master ≈40ms + variant ≈40ms + 1st seg ≈160ms + MSE ≈100ms) | curl-based 累加估算 |
| 启动到首播放 | < 2s | < 1s | 同上 |
| 频道切换 (cold) | < 2.5s | 47.6ms (p95) | `scripts/measure.sh` `switch_equivalent_ms.p95` |
| Master TTFB (proxy) | — | 32–64ms | per-channel，详见 measure |
| 段 proxy TTFB | — | < 50ms | 流式 pipe（无 buffer）|
| Mock 坏源响应 | — | 106ms | `curl -X POST /mock/break/<x>` 后请求 |
| 卡顿率 | < 1% | _待 Playwright 实测_ | `hls.stallCount / totalPlayDuration` |
| 坏源恢复 | < 5s | < 1s (mock 注入) | player fatal → RecoveryGate failover |
| 直播边缘延迟 | 2–30s | _待 Playwright 实测_ | `hls.latency` |
| 内存占用 | < 80MB/路 | _待 Playwright 实测_ | Chrome DevTools snapshot |
| 帧丢失率 | < 0.5% | _待 Playwright 实测_ | `video.getVideoPlaybackQuality()` |

> **注**：浏览器端指标（卡顿率、内存、帧丢失）需要 Playwright + headless Chrome 全自动跑——本仓库脚手架就位，stretch goal 阶段补。

## Quick Start

```bash
# Node 20+ recommended
pnpm install
cp frontend/.env.example frontend/.env
cp backend/.env.example  backend/.env
pnpm start              # boots backend (:5174) + frontend (:5173)
```

打开 http://localhost:5173，应该看到 4 频道网格 + 主播放器。

## Run the Measurement Script

```bash
./scripts/measure.sh                        # 默认 localhost:5174
./scripts/measure.sh https://your-app.com   # 测线上部署
```

输出 JSON 报告含 health p50/p95、channels 响应、master TTFB、cold-switch 等。

## Demo Script (5 min review call)

```
0:00–0:30  打开页面，HUD 实时显示 bitrate / buffer / latency
0:30–1:30  点 Red Bull TV → TTFF 约 0.4s
1:30–2:30  切 Stadium / NASA → 切源 < 100ms
2:30–3:30  curl -X POST :5174/mock/break/<当前>
           → HUD 看到「已切换备用源」黄条
3:30–4:00  curl -X POST :5174/mock/restore
4:00–4:30  演示 SSE 状态：开 DevTools Network 看 /events
4:30–5:00  念 §Measured Performance 表格中的数字
```

> **纪律**：每个数字念出来，HUD 是佐证不是替代。

## What's Inside

```
axis-live-streaming/
├── docs/streaming-technical-design.md   # Full architecture (read first)
├── dev.md                               # 开发执行手册
├── frontend/                            # Vite + React + hls.js + Zustand
├── backend/                             # Node + http + manifest proxy + SSE
├── scripts/measure.sh                   # curl-based 指标测量
├── Dockerfile + railway.toml            # 后端容器化
├── vercel.json                          # 前端部署
└── .github/workflows/ci.yml             # CI
```

## Architecture (TL;DR)

```
Upstream HLS ──► Node proxy ──► hls.js (browser) ──► MSE / video element
                    │
                    ├── manifest rewrite (media-sequence, relative paths)
                    ├── segment cache (6s TTL, fanout aid)
                    ├── health monitor (5s probe) ──► SSE ──► SourceStatusBadge
                    └── mock injector (demo / failover story)
```

Detail and trade-offs: [`docs/streaming-technical-design.md`](docs/streaming-technical-design.md).

## Source Strategy

| Channel | Sport | Source | CORS |
|---------|-------|--------|------|
| Red Bull TV | Extreme Sports | Akamai HLS | ✓ |
| Stadium | College Sports | Akamai HLS | ✓ |
| NASA TV | Public | Akamai HLS | ✓ |
| Mux Test Stream | Test | test-streams.mux.dev | ✓ |

> 删除了原 Figma 设计里的 Fox Sports（DNS 失效）和 Fight Network（TLS 证书不匹配）——这两个 URL 已不可用。

## Trade-offs

- **hls.js direct (no Video.js / Shaka wrapper)** — full control over buffer / ABR / error recovery, but we own the failure modes.
- **Single-instance backend, in-process** — fast to ship; no horizontal scale needed for demo.
- **No WebRTC / no MediaMTX** — dropped to fit 48h. Documented as next step.
- **backupStreamUrls 直连上游** — failover 时绕过 proxy（M3 简化）。生产应改为 proxy 转发。
- **Mock 注入仅 dev 模式** — `NODE_ENV=production` 时 `/mock/*` 返回 404。

## Deployment

### 后端 (Railway / Fly.io / 自建 Docker)

```bash
# 1. 装 CLI
npm i -g @railway/cli    # 或 fly / docker

# 2. 登录
railway login

# 3. 在 backend 目录部署（Dockerfile 已就绪）
cd backend
railway up
```

环境变量：
- `PORT=5174`
- `LOG_LEVEL=info`（dev 改 `debug`）

### 前端 (Vercel)

Vercel dashboard 选这个 repo：
- Build Command: `pnpm install --frozen-lockfile && pnpm --filter frontend build`
- Output Directory: `frontend/dist`
- Framework: Other

或者 CLI：
```bash
vercel --prod
```

环境变量：
- `VITE_API_BASE=https://<your-backend>.up.railway.app`

### 兜底 (本地)

```bash
docker-compose up
# 或：pnpm start
```

## Costs

We stayed well within the $50 budget. **Total: $0**.

| Item | Cost | Notes |
|------|------|-------|
| Vercel (frontend) | $0 | Free tier |
| Railway (backend) | $0 | Free tier 750h/month |
| Public HLS sources | $0 | All public |
| **Total** | **$0** | |

## Next Steps (more time would do)

1. **Playwright 自动化测量** — headless Chrome 跑 5min 完整 session，输出真实 TTFF / 卡顿率 / 内存 / 帧丢失
2. **WebRTC / WHEP 低延迟通道** — MediaMTX 输出 WebRTC，对核心赛事压到亚秒级
3. **Redis 段缓存外置** — 真正扇出到多实例 + CDN 前置
4. **backup 走 proxy** — 当前 failover 时直连上游，改为 `/hls-proxy?u=<encoded>` 统一代理

## Development

```bash
pnpm --filter frontend lint:ts
pnpm --filter backend  lint:ts
pnpm -r test
./scripts/measure.sh
```

## License

MIT
