# 开发计划 — axis-live-streaming

> **本文档是开发执行手册**。架构与设计决策见 [`docs/streaming-technical-design.md`](docs/streaming-technical-design.md)，本文不重复论证。
> 任务追踪按本文 §4 **M1–M4 顺序**推进。

---

## 1. 文档定位

| 文档 | 回答的问题 |
|------|------------|
| `docs/streaming-technical-design.md` | 为什么这样设计？ |
| `dev.md`（本文件） | **下一步做什么？** |
| `README.md` | 怎么部署 / 怎么演示？ |
| `CLAUDE.md` | 编码协作规范 |

---

## 2. 技术栈与版本

| 维度 | 选择 | 版本 | 备注 |
|------|------|------|------|
| 前端框架 | React | 18.3 | Vite 6 配套 |
| 构建 | Vite | 6.3 | `pnpm dev` 即开 |
| 样式 | Tailwind | 4.1 | 通过 `@tailwindcss/vite`，**不**单独写 `tailwind.config` |
| 播放器 | hls.js | 1.6+ | 直接用，不套 Video.js / Shaka |
| 前端 store | Zustand | 5.0 | **不**用 MobX（流质量 1Hz 采样） |
| 后端 | Node | 20+ | native `http`，不引入 Express |
| 后端运行 | tsx | 4.19 | `pnpm dev` 直接跑 TS |
| 包管理 | pnpm | 11+ | workspace：`frontend` + `backend` |
| 测试 | vitest | 3.0+ | 共享前后端 |
| Lint | `tsc --noEmit` | — | 不引入 ESLint（48h 内 ROI 低） |

**不引入**（避免诱惑）：
- ❌ Express / Koa / Fastify（native `http` 够用）
- ❌ React Router（单页 tab 切换，state-based 即可）
- ❌ Redux / MobX（Zustand 足够）
- ❌ shadcn UI 套件（40+ 文件死代码，按需补 1–2 个原生组件）
- ❌ Storybook（demo 演示用不到）

---

## 3. 目录结构（目标态）

```
axis-live-streaming/
├── README.md                       # 已写
├── CLAUDE.md                       # 已写
├── dev.md                          # 本文件
├── package.json                    # workspace 根
├── pnpm-workspace.yaml
├── docs/
│   └── streaming-technical-design.md
├── frontend/
│   ├── package.json
│   ├── vite.config.ts              # 已写（代理 /hls /events /channels /health → :5174）
│   ├── tsconfig.json               # 已写
│   ├── index.html
│   ├── .env.example
│   └── src/
│       ├── main.tsx
│       ├── index.css
│       ├── vite-env.d.ts
│       ├── app/App.tsx             # 🆕 顶层壳
│       ├── components/Live/        # 🆕
│       │   ├── PlayerStage.tsx
│       │   ├── ChannelGrid.tsx
│       │   ├── QualityHUD.tsx
│       │   └── SourceStatusBadge.tsx
│       ├── live/                   # 🆕 核心逻辑层（不依赖 React）
│       │   ├── hlsConfig.ts        # 合并后的 hls.js 配置
│       │   ├── HlsEngine.ts        # hls.js 生命周期 + RecoveryGate
│       │   ├── ChannelSwitcher.ts  # 预取 + 暖池（可选）
│       │   ├── MetricsCollector.ts # 1Hz 采样
│       │   └── recoveryGate.ts     # §4.6 状态机
│       ├── stores/
│       │   └── streamingStore.ts   # Zustand
│       ├── hooks/
│       │   └── useSourceHealthSse.ts  # SSE 客户端 hook
│       └── lib/
│           └── channels.config.ts  # 镜像后端（dev 时可用，避免冷启动 5174）
└── backend/
    ├── package.json
    ├── tsconfig.json
    ├── .env.example
    └── src/
        ├── server.ts               # 🆕 挂路由
        └── streaming/
            ├── channels.config.ts  # 单一事实来源（§6.4）
            ├── registry.ts         # 加载 + 校验
            ├── proxy.ts            # /hls/:channel/*
            ├── healthMonitor.ts    # 周期探活
            └── statusSse.ts        # /events SSE
```

---

## 4. 任务清单（按 M1–M4 顺序）

### M1 — Day1 上午 4h — 后端最小可播 + 前端单源

**目标**：浏览器打开 `localhost:5173`，能看到 NASA 频道直播。

#### 4.1 后端（3 个文件，~2h）

| # | 文件 | 内容 | 验证 |
|---|------|------|------|
| 1 | `backend/src/streaming/channels.config.ts` | 5 个频道（含 backupUrls） | `curl :5174/channels` 返回 JSON |
| 2 | `backend/src/streaming/registry.ts` | `getChannels()` 加载 + 校验 | TS 编译通过 |
| 3 | `backend/src/streaming/proxy.ts` | `/hls/:channel/master.m3u8` + `/hls/:channel/segment/*` | `curl :5174/hls/nasa/master.m3u8` 返回 m3u8 |
| 4 | `backend/src/server.ts` | 挂 `/health` / `/channels` / `/hls/*` | `curl :5174/health` → `ok` |

**关键约束（proxy.ts）**：

```ts
// 段必须流式转发，不能 buffer
import { request as httpRequest } from 'http';
// proxy 段时：res.write(chunk) 一次一段，最后 res.end()
// 千万不要 const buf = await getBuffer(); res.end(buf);   ← LL-HLS 会废
```

#### 4.2 前端（3 个文件，~2h）

| # | 文件 | 内容 | 验证 |
|---|------|------|------|
| 1 | `frontend/src/live/hlsConfig.ts` | 合并后配置（见 §6.1） | TS 编译通过 |
| 2 | `frontend/src/live/recoveryGate.ts` | §4.6 状态机（先 2 级） | 单元测试 |
| 3 | `frontend/src/components/Live/PlayerStage.tsx` | 视频元素 + hls.js 挂载 + 错误恢复 | 浏览器看到画面 |

**M1 不做的**：
- ❌ 频道切换（只播一个）
- ❌ 备用源（先验证主源能播）
- ❌ QualityHUD
- ❌ SSE 健康监控
- ❌ Zustand store（用 useState 撑过 M1）

**M1 验证清单**：
- [ ] `curl :5174/hls/nasa/master.m3u8` 返回 manifest
- [ ] 浏览器 `http://localhost:5173` 看到 `<video>` 元素且自动播放
- [ ] DevTools Network 看到分片请求 200
- [ ] DevTools Console 无 ERROR 级别日志
- [ ] `pnpm --filter frontend lint:ts` 0 错
- [ ] `pnpm --filter backend lint:ts` 0 错

---

### M2 — Day1 下午 5h — 双源切换 + 频道网格

**目标**：至少 2 个运动频道可切，切换时间 < 2.5s。

#### 4.3 后端（无新增大文件）

- [ ] `proxy.ts` 加 manifest 改写：分片 URL → `/hls/:channel/segment/...`
- [ ] `proxy.ts` 段转发加 `Cache-Control: public, max-age=6`（与段时长对齐）

#### 4.4 前端（4 个文件，~4h）

| # | 文件 | 内容 |
|---|------|------|
| 1 | `frontend/src/stores/streamingStore.ts` | Zustand：`channels / currentChannelId / healthByChannel` |
| 2 | `frontend/src/app/App.tsx` | 改写：从 `/channels` 拉数据 + 渲染 ChannelGrid + PlayerStage |
| 3 | `frontend/src/components/Live/ChannelGrid.tsx` | 侧边列表 + 选中态 |
| 4 | `frontend/src/live/ChannelSwitcher.ts` | `prefetch(channelId)` + 切换逻辑 |

**ChannelGrid 状态约束**：
- 用 `currentChannelId` 单一来源
- 切换时 PlayerStage 整组件 unmount/remount（React key）
- 暖池**先不实现**（§2.5 标 0）

**M2 验证清单**：
- [ ] 4 个频道能切换（手动点 5 次来回）
- [ ] 切换时间 < 2.5s（用 DevTools Performance 测）
- [ ] Console 无 leak warning（多次切换后）
- [ ] 网络请求数与切换次数匹配

---

### M3 — Day2 上午 5h — 容错 + 质量 HUD + 故障转移

**目标**：故意 kill 上游能在 5s 内切到备用源；HUD 显示实时指标。

#### 4.5 后端（2 个新文件）

| # | 文件 | 内容 |
|---|------|------|
| 1 | `backend/src/streaming/healthMonitor.ts` | 周期探活（5s/次）；状态：`ok / degraded / down` |
| 2 | `backend/src/streaming/statusSse.ts` | `/events` SSE，事件 `source-health` |

**健康判定**（§2.5 配置表）：
- `5xx` 连续 3 次/30s → `degraded`
- `degraded` 持续 5s + 段 12s 未刷新 → `down`

#### 4.6 前端（4 个文件，~5h）

| # | 文件 | 内容 |
|---|------|------|
| 1 | `frontend/src/live/MetricsCollector.ts` | 1Hz 采样 hls.js 指标，写 ref（**不写 store**） |
| 2 | `frontend/src/components/Live/QualityHUD.tsx` | 显示指标；observer 包裹，只在 metrics 变化时 re-render |
| 3 | `frontend/src/components/Live/SourceStatusBadge.tsx` | 当前频道健康徽章 |
| 4 | `frontend/src/hooks/useSourceHealthSse.ts` | EventSource client + 重连 |

**HlsEngine 升级**：
- `RecoveryGate` 用 §6 完整 4 级版本
- 第 4 级动作：`failoverToBackup()` 切 `backupUrls[0]`
- 切源时 `MetricsCollector.reset()`

**M3 验证清单**：
- [ ] HUD 数字 1Hz 更新
- [ ] 模拟 upstream 5xx：3 次后 SSE 推 `degraded`
- [ ] 持续 down ≥ 5s：自动切 `backupUrls[0]`，UI 标注
- [ ] 切到 NASA 兜底：UI 标注「演示模式」

---

### M3.5 — Day2 下午 2h — 演示用 mock 坏源 endpoint

**目标**：review call 上**确定性**触发故障演示。

| # | 文件 | 内容 |
|---|------|------|
| 1 | `backend/src/streaming/mockFailure.ts` | 路由 `/mock/break/:channel` → 接下来 30s 该 channel 5xx |
| 2 | `backend/src/server.ts` | 挂 `/mock/break/*`（仅 dev 模式） |
| 3 | `README.md` | 加一行 `curl -X POST :5174/mock/break/redbull` |

**演示纪律**：
- review call 时直接执行这条 curl
- HUD 数字变化 + 切源过程**逐秒念出**

---

### M4 — Day2 下午 4h — 部署 + README 量化 + 录屏

**目标**：所有 §4.7 验收指标有**实测值**；评审 URL 可访问。

#### 4.7 部署清单

| 组件 | 平台 | 步骤 |
|------|------|------|
| 前端 | Vercel | `vercel --prod`，环境变量 `VITE_API_BASE=https://<backend>` |
| 后端 | Railway | `railway up`，环境变量 `PORT=5174 LOG_LEVEL=info` |
| HTTPS | 平台自带 | — |

**部署后立即验证**：
- [ ] 评审 URL 能打开
- [ ] `/channels` JSON 正确
- [ ] 切源在 4G 网络下 < 2.5s（用朋友手机测一次）

#### 4.8 量化指标实测

按 §4.7 表逐项跑一遍，写进 README：

| 指标 | 目标 | 实测 |
|------|------|------|
| 首帧时间 | < 1.5s | ___ |
| 启动到首播放 | < 2s | ___ |
| 切换耗时（冷） | < 2.5s | ___ |
| 卡顿率 | < 1% | ___ |
| 坏源恢复 | < 5s | ___ |
| ... | ... | ... |

**实测方法**：
- 打开 Chrome DevTools → Performance → Record
- 跑 5 次冷切换，取 95 分位
- 跑 5min 稳定播放，看 `hls.stallCount / totalPlayDuration`

#### 4.9 README 增补

- [ ] 顶部加实测指标表（§4.7 那一表）
- [ ] 加「How to demo」章节：5 分钟脚本（§8）
- [ ] 加「Run locally」一段
- [ ] 加录屏 GIF / mp4 链接

---

## 5. 关键文件实现指南

### 5.1 `hlsConfig.ts`（§6.1 内容，C 节）

直接复制 dev doc C 节的代码。**禁止散落 magic number**——所有数字都来自 §2.5 配置表。

### 5.2 `recoveryGate.ts`（§4.6 完整版）

```ts
// frontend/src/live/recoveryGate.ts
type FatalKind = 'network' | 'media' | 'other';

export class RecoveryGate {
  private windowMs = 10_000;
  private counts = new Map<FatalKind, number[]>();

  /** 返回决策：'retry' | 'recover' | 'swapAudio' | 'destroyRebuild' | 'failover' */
  nextAction(kind: FatalKind): Action {
    const now = Date.now();
    const list = (this.counts.get(kind) ?? []).filter(t => now - t < this.windowMs);
    list.push(now);
    this.counts.set(kind, list);

    // 跨类型共享窗口（§4.6 纪律 #4）
    const totalRecent = [...this.counts.values()]
      .flat()
      .filter(t => now - t < this.windowMs).length;

    if (kind === 'network') {
      if (list.length === 1) return 'retry';
      if (list.length === 2) return 'retry';  // 含锁档
      return 'failover';
    }
    if (kind === 'media') {
      if (list.length === 1) return 'recover';
      return 'swapAudio';
    }
    // other
    if (list.length === 1) return 'destroyRebuild';
    if (list.length === 2) return 'failover';  // backupUrls[0]
    if (list.length === 3) return 'failover';  // backupUrls[1]
    return 'failover';                          // 兜底测试流
  }
}
```

### 5.3 `proxy.ts`（最小可编译版）

```ts
// backend/src/streaming/proxy.ts
import type { IncomingMessage, ServerResponse } from 'http';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import { getChannel } from './registry.js';

const SEGMENT_TTL = 6;  // 与段时长对齐

export async function handleHlsProxy(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  // /hls/:channel/master.m3u8
  // /hls/:channel/variant/:name.m3u8
  // /hls/:channel/segment/:name
  const parts = url.pathname.split('/').filter(Boolean);  // ['hls', ':ch', ...]
  if (parts.length < 3) {
    res.writeHead(400);
    res.end();
    return;
  }
  const [, channelId, kind, ...rest] = parts;
  const ch = getChannel(channelId);
  if (!ch) {
    res.writeHead(404);
    res.end();
    return;
  }
  const upstream = new URL(ch.primaryUrl);

  if (kind === 'master.m3u8' || kind.endsWith('.m3u8')) {
    // 拉 manifest + 改写 URL
    const text = await fetchText(upstream);
    const rewritten = rewriteUrls(text, channelId, upstream);
    res.writeHead(200, {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-store',
    });
    res.end(rewritten);
    return;
  }
  if (kind === 'segment') {
    const segPath = '/' + rest.join('/');
    upstream.pathname = new URL(segPath, upstream).pathname;
    await pipeStream(req, res, upstream, SEGMENT_TTL);
    return;
  }
  res.writeHead(404);
  res.end();
}

function fetchText(u: URL): Promise<string> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    mod.get(u, res => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', c => (buf += c));
      res.on('end', () => resolve(buf));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function rewriteUrls(manifest: string, channelId: string, base: URL): string {
  return manifest
    .split('\n')
    .map(line => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return line;
      // 绝对 URL 改成同源 /hls/.../segment/...
      // 相对 URL 同上
      const abs = new URL(t, base).toString();
      const u = new URL(abs);
      return `/hls/${channelId}/segment${u.pathname}`;
    })
    .join('\n');
}

function pipeStream(
  _req: IncomingMessage,
  res: ServerResponse,
  upstream: URL,
  cacheMaxAge: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const mod = upstream.protocol === 'https:' ? https : http;
    const upstreamRes = mod.get(upstream, upstreamMsg => {
      res.writeHead(upstreamMsg.statusCode ?? 502, {
        'Content-Type': upstreamMsg.headers['content-type'] ?? 'video/mp2t',
        'Cache-Control': `public, max-age=${cacheMaxAge}`,
      });
      upstreamMsg.pipe(res);            // ← 流式转发，不要 buffer
      upstreamMsg.on('end', resolve);
      upstreamMsg.on('error', reject);
    });
    upstreamRes.on('error', reject);
  });
}
```

**proxy 调试要点**：
- `curl :5174/hls/nasa/master.m3u8 | head` 看 manifest 是否改写
- `curl -I :5174/hls/nasa/segment/...` 看 `Cache-Control`
- **禁用代理段时**用 `wget --recursive` 测试，**不要**用前端测试 LL-HLS（流式不可见）

### 5.4 `MetricsCollector.ts`

```ts
// frontend/src/live/MetricsCollector.ts
import type Hls from 'hls.js';
import type { MetricsSnapshot } from '../components/Live/QualityHUD';  // 类型复用

export class MetricsCollector {
  private timer: number | null = null;
  private video: HTMLVideoElement | null = null;
  public current: MetricsSnapshot | null = null;

  start(hls: Hls, video: HTMLVideoElement, onUpdate: () => void): void {
    this.video = video;
    this.current = empty();
    this.timer = window.setInterval(() => {
      this.current = this.sample(hls);
      onUpdate();
    }, 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.video = null;
    this.current = null;
  }

  private sample(hls: Hls): MetricsSnapshot {
    const v = this.video!;
    const level = hls.levels[hls.currentLevel];
    const q = v.getVideoPlaybackQuality?.() ?? { droppedVideoFrames: 0, totalVideoFrames: 0 };
    return {
      currentLevel: hls.currentLevel,
      bitrateKbps: level ? Math.round(level.bitrate / 1000) : 0,
      bandwidthKbps: Math.round((hls.bandwidthEstimate ?? 0) / 1000),
      bufferSec: hls.bufferInfo?.len ?? 0,
      liveLatencySec: hls.latency ?? 0,
      stallCount: 0,  // 由 PlayerStage 累加
      totalStallMs: 0,
      droppedFrames: q.droppedVideoFrames,
      decodedFrames: q.totalVideoFrames,
    };
  }
}

const empty = (): MetricsSnapshot => ({
  currentLevel: -1, bitrateKbps: 0, bandwidthKbps: 0, bufferSec: 0,
  liveLatencySec: 0, stallCount: 0, totalStallMs: 0,
  droppedFrames: 0, decodedFrames: 0,
});
```

**关键纪律**：
- 采样写 ref（`MetricsCollector.current`）**不**写 Zustand store
- HUD 用 `useState` 持有 `current` 的镜像，每秒 re-render 一次（acceptable）
- HUD **不**用 observer 包整个页面

---

## 6. 状态管理（Zustand）

```ts
// frontend/src/stores/streamingStore.ts
import { create } from 'zustand';
import type { Channel, SourceHealth } from '../lib/channels.config';

interface StreamingState {
  channels: Channel[];
  currentChannelId: string | null;
  healthByChannel: Record<string, SourceHealth>;
  setChannels: (channels: Channel[]) => void;
  setCurrent: (id: string) => void;
  setHealth: (id: string, h: SourceHealth) => void;
}

export const useStreamingStore = create<StreamingState>(set => ({
  channels: [],
  currentChannelId: null,
  healthByChannel: {},
  setChannels: channels => set({ channels }),
  setCurrent: id => set({ currentChannelId: id }),
  setHealth: (id, h) =>
    set(s => ({ healthByChannel: { ...s.healthByChannel, [id]: h } })),
}));
```

**纪律**：
- **不**在 store 里存 `metrics` / `hls` / `bufferSec`（避免 re-render 风暴）
- `setHealth` 单字段更新，**不**整体 replace

---

## 7. 测试策略

### 7.1 单元测试（vitest，强制 0 错）

| 文件 | 测试 |
|------|------|
| `backend/src/__tests__/proxy.test.ts` | manifest 改写（相对 URL、绝对 URL、variant） |
| `backend/src/__tests__/healthMonitor.test.ts` | 5xx 累计、stall 判定、状态转换 |
| `frontend/src/__tests__/recoveryGate.test.ts` | §4.6 决策表全覆盖 |
| `frontend/src/__tests__/metricsCollector.test.ts` | sample() 输出 schema、稳定 |

### 7.2 手动 smoke（M3 后必跑）

```
1. 打开页面：4 个频道网格，HUD 实时刷新
2. 切换 5 次：每次 < 2.5s
3. curl -X POST :5174/mock/break/redbull
4. HUD 5s 内显示 degraded → down
5. 自动切 backupUrls[0]，UI 标注「已切换备用源」
6. curl -X POST :5174/mock/restore/redbull（如果做了）
7. 不切回主源（保持演示用）
```

### 7.3 不写的测试

- ❌ Playwright e2e（48h 内 ROI 低，列入 next steps）
- ❌ 视觉回归（无设计稿对比基线）
- ❌ 性能基准（手动跑 5 次取 95 分位即可）

---

## 8. 演示脚本（5 分钟 review call）

按 `docs/streaming-technical-design.md` §9.4 走，逐秒念数字：

```
0:00–0:30  打开页面，HUD 实时显示
0:30–1:30  点 Red Bull TV → TTFF < 1.5s
1:30–2:30  切 Stadium → 切换 < 2.5s
2:30–3:30  curl -X POST :5174/mock/break/redbull
           → 看 SSE 推 degraded → down
           → 5s 内切 backup
3:30–4:00  HUD 恢复时间显示
4:00–4:30  演示 NASA 兜底（永远不黑屏）
4:30–5:00  念 §4.7 量化指标表
```

**演示纪律**：
- **每个数字念出来**（HUD 是佐证）
- **不要**说"看起来挺顺"——说"切换 1.2s，符合 < 2.5s 目标"
- 提前 30 分钟用同一台机器跑一遍（避免现场环境问题）

---

## 9. 部署清单

### 9.1 前端（Vercel）

```bash
cd frontend
vercel --prod
# 环境变量：VITE_API_BASE=https://<railway-app>.up.railway.app
```

### 9.2 后端（Railway）

```bash
cd backend
railway up
# 环境变量：PORT=5174 LOG_LEVEL=info
```

**部署后**：
- [ ] `curl https://<railway>/health` → `ok`
- [ ] `curl https://<railway>/channels` → JSON
- [ ] 前端 `vite.config.ts` 改为线上后端地址
- [ ] 浏览器打开前端 URL，4 个频道能播

### 9.3 兜底（演示失败时）

```bash
docker-compose up
# 本地起前后端
# 评审电话时用 ngrok 暴露 5173
```

---

## 10. 常见坑（先打预防针）

| 坑 | 现象 | 预防 |
|----|------|------|
| **proxy buffer 段** | LL-HLS 退化为标准 HLS，6s+ 延迟 | 强制 `pipe()`，**不**用 `await getBuffer()` |
| **manifest 缓存** | 客户端收到旧 `media-sequence` | `Cache-Control: no-store`（§6.1） |
| **recoverMediaError 死循环** | 每秒重建一次，UI 闪 | §4.6 RecoveryGate 限频 |
| **store 存 metrics** | HUD 数字闪动 + 整页 re-render | metrics 走 ref（§5.4） |
| **PlayerStage 用 observer** | 切源时整播放器重渲染 | 内部用 useState，**不**订阅 store metrics |
| **SSE 客户端无心跳** | 中间设备 60s 断流 | 服务端每 15s 发 `: ping\n\n` |
| **public source 突然挂** | 演示中途黑屏 | backupUrls 链 → 兜底测试流（§D 节） |
| **hls.js worker 内存泄漏** | 长 session 1h 后 OOM | 切源时 `hls.destroy()`（§6.3.2） |
| **CORS 突变更** | 浏览器直连被拦 | **所有**源都走 proxy（§3.3） |
| **部署后忘了改 VITE_API_BASE** | 评审 URL 拿到的是 mock 数据 | 部署前 grep 检查 |

---

## 11. 进度跟踪

每完成一个里程碑，勾选对应 M 章节的所有 `[ ]`。

- [ ] M1 — 单源能播
- [ ] M2 — 双源可切
- [ ] M3 — 容错 + HUD
- [ ] M3.5 — Mock 坏源
- [ ] M4 — 部署 + 量化 + README

---

## 12. 提交前自检（最终 checklist）

部署完成后、提交前，逐项过：

- [ ] `pnpm install --frozen-lockfile` 0 警告
- [ ] `pnpm -r lint:ts` 0 错
- [ ] `pnpm -r test` 全绿
- [ ] 评审 URL 打开 → 4 频道可切
- [ ] `curl -X POST .../mock/break/<x>` 触发降级可见
- [ ] README 含：setup / architecture / trade-offs / costs / metrics / next steps
- [ ] 录屏文件已上传（GitHub Release / S3）
- [ ] 演示脚本（§8）走过一遍
- [ ] §4.7 量化指标表有实测值
- [ ] 合规声明（§1.4）写在 README

**全部勾选**才提交。

---

*文档结束。*
