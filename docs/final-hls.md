# HLS 性能优化实施方案 — final-hls.md

> **来源**: `docs/performance.md`
> **状态**: ✅ 2026-06-03 已落地（M1–M4 + final-hls 修订项）
> **目的**: 对照 performance.md，记录已实现项、取舍与验证方式

---

## 1. 对照总览（performance.md）

| # | 建议 | 状态 | 说明 |
|---|------|------|------|
| 1 | Node.js Proxy 解决 CORS | ✅ | `proxy.ts` |
| 2 | 段 `Cache-Control: max-age` | ✅ | `max-age=30` |
| 3 | Manifest 短缓存 2s | ✅ | `public, max-age=2` + 进程内 2s upstream 缓存 |
| 4 | Request Collapsing | ✅ | `fetchTextShared` + `fetchTextCached` |
| 5 | HTTP Keep-Alive | ✅ | 显式 `http.Agent` / `https.Agent`（keepAlive, maxSockets=32） |
| 6 | 部署位置优化 | 文档 | DevOps，见 README |
| 7 | `maxBufferLength: 30` | ❌ 不采纳 | 实测 buffer &lt; 3s 易卡，保持 80s |
| 8 | `startLevel: -1` | ✅ | 默认 auto |
| 9 | 片段加载超时 | ✅ | `fragLoadingTimeOut: 10_000`（非 `abandonLoadTimeout`，hls.js 1.5 无此字段） |
| 10 | `liveSyncDuration: 3` | ❌ 不采纳 | 保持 10s（流畅优先） |
| 11 | `liveMaxLatencyDuration: 60` | ❌ 跳过 | 已有 15s，足够 |
| 12 | 段预取（首段） | ⏸ 未做 | ROI 低；master 预取 + 服务端缓存已覆盖大部分收益 |
| 13 | 备用源切换 | ✅ | 4 级 + SSE |
| 14 | `BUFFER_FULL` 处理 | ✅ | 非 fatal 分支 + `flushBackBuffer` / `flushBuffer` |
| 15 | Tab 后台降载 | ✅ | `visibilitychange` → `stopLoad` / `startLoad` |
| 16 | hover 预取走浏览器缓存 | ✅ | 去掉 `cache: 'no-store'` |

---

## 2. 已实现：后端（`proxy.ts`）

### 2.1 Request Collapsing + 2s 内存缓存

同一 `upstreamUrl` 在 2s 内：

1. **in-flight 合并**：并发请求共享一个 `Promise`（只打上游 1 次）
2. **结果缓存**：完成后写入 `upstreamManifestCache`，2s 内直接返回

多 tab / hover 预取 / 多观众刷新 master → 上游请求 ≈ 1 次/2s。

### 2.2 Manifest `Cache-Control: public, max-age=2`

浏览器/CDN 可缓存 manifest；与进程内缓存叠加。

### 2.3 Keep-Alive Agent

```ts
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 32, maxFreeSockets: 8 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 32, maxFreeSockets: 8 });
```

manifest / segment / HEAD 探活均复用连接。

---

## 3. 已实现：前端

### 3.1 `BUFFER_FULL`（`PlayerStage.tsx`）

在 `if (!data.fatal) return` **之前**处理（hls.js 中多为 non-fatal）：

```ts
if (isBufferFullDetail(data.details)) {
  trimHlsBackBuffer(hls); // flushBackBuffer 或 flushBuffer
  return;
}
```

### 3.2 `fragLoadingTimeOut: 10_000`（`hlsConfig.ts`）

从 20s 降至 10s，卡死片段更快放弃；保留 `fragLoadingMaxRetry: 6`。

未使用 `abandonLoadTimeout`（hls.js ^1.5.17 无稳定对应字段）。

### 3.3 Tab 后台 `stopLoad` / `startLoad`

隐藏 tab 停止拉流，回到前台恢复，减轻长 session 缓冲压力。

### 3.4 预取（`ChannelSwitcher.ts`）

`fetch(streamUrl)` 使用默认 cache，配合 proxy `max-age=2`。

---

## 4. 未做 / 不采纳

| 项 | 理由 |
|----|------|
| `maxBufferLength: 30` / `liveSyncDuration: 3` | DW 源实测流畅优先 |
| `liveMaxLatencyDuration: 60` | 已有 15s |
| 首段预取（两层 manifest 解析） | 复杂度高，收益 ~200–500ms |
| Segment 内存 LRU / 服务端「下一段预取」 | 可选 next step；直播段 URL 常变 |

---

## 5. 实施记录（已完成）

| 步骤 | 项 | 文件 |
|------|-----|------|
| 1 | Request Collapsing + 2s 内存缓存 | `proxy.ts` |
| 2 | Manifest `max-age=2` | `proxy.ts` |
| 3 | Keep-Alive Agent | `proxy.ts` |
| 4 | `BUFFER_FULL` 非 fatal 处理 | `PlayerStage.tsx` |
| 5 | `fragLoadingTimeOut: 10s` | `hlsConfig.ts` |
| 6 | visibility 降载 | `PlayerStage.tsx` |
| 7 | 预取允许浏览器缓存 | `ChannelSwitcher.ts` |

---

## 6. 验证

```bash
pnpm -r lint:ts
pnpm -r test
./scripts/measure.sh   # 若有
```

端到端：

- 开 4 个 tab 同时刷新 → 服务端日志 / 上游仅 1 次 manifest 拉取（2s 窗口内）
- 长 session 1h → Memory 无持续爬升
- 切 tab 到后台再回来 → 播放恢复、无僵尸缓冲

---

## 7. 相关文件

- `docs/performance.md` — 原始建议
- `backend/src/streaming/proxy.ts`
- `frontend/src/live/hlsConfig.ts`
- `frontend/src/components/Live/PlayerStage.tsx`
- `frontend/src/live/ChannelSwitcher.ts`

---

*最后更新：2026-06-03（final-hls 修订项已落地）*
