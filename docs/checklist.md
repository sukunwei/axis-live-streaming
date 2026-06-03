# PRD 要求对照清单

> 依据 [`docs/prd.md`](prd.md) 逐条说明本仓库（`axis-live-streaming`）的应对方式与验收状态。  
> 最后核对：2026-06-03

**图例**：`[x]` 已落实 · `[~]` 部分落实 / 需演示前再确认 · `[ ]` 未做或明确放弃

---

## 一、作业目标（Overview & Objective）

| PRD 要点 | 我们怎么处理 | 状态 |
|----------|--------------|------|
| 在浏览器聚合并再分发多路体育/赛事直播 | 上游 HLS → Node 同源代理（manifest 改写 + 段流式转发）→ 浏览器 `hls.js` + MSE | `[x]` |
| 评分重心是**流质量**（流畅、低延迟、快切台、源降级） | 投入在 `hlsConfig` 调优、`RecoveryGate`、健康探活 + SSE、QualityHUD、代理缓存与预取；功能广度刻意收敛 | `[x]` |
| 48 小时内务实取舍、能跑起来 | 单实例 Node、无 WebRTC/MediaMTX、无水平扩展；trade-off 写在 [`README.md`](../README.md) | `[x]` |

---

## 二、批准内容源（Approved Content Sources）

PRD 允许多类源；我们**未使用**聚合站抓取、YouTube HLS 抓取（合规与 ToS）。实测结论见 [`test-result.md`](../test-result.md)。

| PRD 类别 | 我们的选择 | 状态 |
|----------|------------|------|
| 聚合站（Buffstreams 等） | **不做** — 灰色来源，合规风险 | `[ ]` 有意放弃 |
| 联盟/广播方直播页 | **未接** — 多数无公开 HLS，需页面解析 | `[ ]` |
| 联赛 YouTube Live | **未接** — 违反 YouTube ToS；README Next Steps 仅作方向 | `[ ]` |
| Red Bull TV 等免费赛事 | 6/3 实测 variants 已 404，**未纳入当前配置** | `[~]` 曾测通，交付日失效 |
| FAST（Pluto / Tubi / Xumo） | **部分**：NHL 走 Tubi/CloudFront 公开 `playlist.m3u8`（`nhl-hockey`） | `[x]` |
| 公共测试流（Apple / Mux / Akamai 等） | `apple-bipbop` + 各频道 `backupUrls`（如 Mux）作兜底 | `[x]` |
| 真实免费线性频道 | `dw-english`（DW）、`acc-network`（ACC 大学体育，Amagi） | `[x]` |

**当前注册表**：[`backend/src/streaming/channels.config.ts`](../backend/src/streaming/channels.config.ts)  
**交付前纪律**：运行 `./scripts/test-sources.sh` 复测 master → variant → segment。

---

## 三、硬性要求（Requirements）

### R1 · Live demo（评审时可观看的实时演示）

| 子项 | 实现 | 状态 |
|------|------|------|
| 可运行的 Web 应用 | `pnpm start` 启动前后端（`:5173` / `:5174`） | `[x]` |
| 公网可达（部署 / 隧道 / 本地共享屏幕） | README § Live Demo：`ngrok`、`cloudflared`、Railway + Vercel 说明 | `[~]` 需你在提交前选定一种并填**实际 URL** |
| 评审电话时能 live | 依赖上述 URL 或 screen-share；本地 `pnpm start` 可作为 fallback | `[~]` |

### R2 · 至少两种运动，同页可切换，可见 ABR 与切台

| 子项 | 实现 | 状态 |
|------|------|------|
| ≥2 种不同运动 | `acc-network`（College Sports / 大学体育）+ `nhl-hockey`（Ice Hockey / 冰球） | `[x]` |
| 同页切换 | `ChannelGrid` + `PlayerStage`（`key={channelId}` 整组件重挂载） | `[x]` |
| 频道切换体验 | hover/focus 触发 `prefetchChannel`（master + 首 variant） | `[x]` |
| ABR 行为可观察 | 多码率上游 + `QualityHUD`（档位、码率、带宽 EWMA）+ `capLevelToPlayerSize` 等 | `[x]` |
| 额外频道（非硬性） | `dw-english`（新闻）、`apple-bipbop`（测试流）丰富演示与 failover | `[x]` |

### R3 · GitHub 仓库 + README

| 子项 | 实现 | 状态 |
|------|------|------|
| 源码在 GitHub | 远程：`https://github.com/sukunwei/axis-live-streaming`（分支 `feature/dev`） | `[x]` |
| Setup 说明 | README § Quick Start（`pnpm install`、`.env`、 `pnpm start`） | `[x]` |
| 架构说明 | README § Architecture + [`docs/streaming-technical-design.md`](streaming-technical-design.md) | `[x]` |
| Trade-offs | README § Trade-offs | `[x]` |
| Next steps | README § Next Steps | `[x]` |

### R4 · Stream quality first（流质量优先）

| 维度 | 实现要点 | 主要文件 / 文档 | 状态 |
|------|----------|-------------------|------|
| 启动时间 / TTFF | 预连接（`index.html` + `/channels.upstreamOrigins`）、切台预取、`makeHlsConfig()` 按 `navigator.connection` 估带宽起档 | `App.tsx`, `ChannelSwitcher.ts`, `hlsConfig.ts` | `[x]` |
| 延迟 vs 流畅 | **流畅优先**（Tune 3：`liveSyncDuration` 10、`startPosition` -8）；牺牲边缘延迟换少卡顿 | `hlsConfig.ts`, README trade-off | `[x]` |
| 重缓冲 / 卡顿 | `liveSyncOnStallIncrease`、`detectStallWithCurrentTimeMs`、较大 buffer 上限；HUD 统计 stall | `hlsConfig.ts`, `MetricsCollector.ts` | `[x]` |
| ABR | hls.js EWMA、`abrEwmaDefaultEstimate` 动态注入、`fragLoadPolicy` 超时重试 | `hlsConfig.ts`, `PlayerStage.tsx` | `[x]` |
| 坏源恢复 | `RecoveryGate`（10s 窗口限频）+ 后端 `HealthMonitor` + SSE + 前端 failover 到 `backupUrls` | `recoveryGate.ts`, `healthMonitor.ts`, `PlayerStage.tsx` | `[x]` |
| 演示坏源场景 | 开发环境 `POST /mock/break/:channelId`（生产返回 503） | `mockFailure.ts` | `[x]` |
| 代理层减抖 | manifest LRU + request collapsing、段 `immutable`/304、gzip 文本响应 | `proxy.ts`, `manifestCache.ts` | `[x]` |
| 量化指标（设计目标） | 目标表见技术方案 §3.7；README 性能表「实测」多为 _TBD_（待 Playwright） | `docs/streaming-technical-design.md` | `[~]` |

### R5 · Browser playback（标准桌面浏览器）

| 子项 | 实现 | 状态 |
|------|------|------|
| Chrome / Edge | `hls.js` 1.6 + MSE | `[x]` |
| Safari | `canPlayType('application/vnd.apple.mpegurl')` → 原生 HLS 路径 | `[x]` |
| 不直连上游 | 播放 URL 均为同源 `/hls/:channel/...`（failover 备用 URL 当前**直连上游**，见 README trade-off） | `[~]` |

---

## 四、值得思考的问题（Things Worth Thinking About）

| 主题 | PRD 关切 | 我们的处理 | 状态 |
|------|----------|------------|------|
| 协议 | HLS / LL-HLS / DASH / WebRTC | **HLS + hls.js** 为基线；`lowLatencyMode: true` 面向可自控源；**未做** WebRTC/DASH | `[x]` HLS · `[ ]` WebRTC |
| 接入与转码 | ffmpeg / MediaMTX / ABR ladder | **未实现**接入层；直连公共 HLS，ABR 由上游 ladder 提供 | `[ ]` 文档化 next step |
| 分发与扩展 | 打包、分片、缓存、多观众 | 进程内 manifest/段缓存、gzip、扇出 collapsing；**无** CDN/Redis | `[x]` MVP · `[ ]` 生产级 |
| 播放器 | 缓冲、ABR、错误恢复 | 自管 `hls.js` + `RecoveryGate` + HUD | `[x]` |
| 韧性 | 断流、停滞、中途变分辨率 | 探活（5xx、分片新鲜度）+ SSE 降级 + 多级 backup + MSE 自动跟档 | `[x]` |

---

## 五、API / 服务预算（≤ $50 USD）

| 子项 | 实现 | 状态 |
|------|------|------|
| 可使用付费 API / 托管流服务 | **未使用**付费流媒体 API | `[x]` 全程免费源 |
| README 记录费用与凭证 | README 未单独「Costs」小节；实际花费 **$0** | `[~]` 建议在 README 补一句「Costs: $0」+ 截图可选 |
| 免费方案不扣分 | 架构按免费公共 HLS + 自托管代理设计 | `[x]` |

---

## 六、提交物（What to Submit）

| 提交项 | 对应物 | 状态 |
|--------|--------|------|
| GitHub 仓库链接 | 见 R3 | `[x]` |
| 访问 live demo 的方式 | README § Live Demo（需补**最终公网 URL** 或写明 screen-share） | `[~]` |
| 评审电话可用时间 | **需你在 README 或邮件中自行填写** | `[ ]` 人工项 |
| 架构 / 取舍 / 费用 / next steps 短注 | README + 本清单 + 技术方案 | `[x]` |

---

## 七、评分维度对照（How We’ll Evaluate）

| 权重 | PRD 看什么 | 我们如何对应 | 自评准备 |
|------|------------|--------------|----------|
| **40%** Stream quality | 低延迟、快启动、少卡顿、干净 ABR、优雅恢复 | 见 R4；演示时开 **QualityHUD**，口述 Tune 3 取舍；可用 `mock/break` 演示 5s 内 failover | 准备念 HUD 数字 + 切换 ACC ↔ NHL |
| **25%** Problem-solving speed | 快速取舍、先跑通再打磨 | 先 M2（双运动 + 代理）再 M3（恢复/HUD）；未做 ingest/WebRTC | README trade-offs 即论据 |
| **20%** Architecture & clarity | 合理设计、README 清晰 | 技术方案 + 架构图（mermaid）+ 模块表；本 `checklist.md` | PR 描述可链到本文档 |
| **15%** Demo & polish | 能 live、易跟随 | 4 频道网格、状态徽章、SSE 健康、脚本 `test-sources.sh` | 彩排 5 分钟：默认频道 → 切体育 → 故意坏源（mock） |

---

## 八、工程与质量门禁（非 PRD 明文，但影响「提交 PR」）

| 项 | 说明 | 状态 |
|----|------|------|
| CI（`.github/workflows/ci.yml`） | push `feature/dev` 曾 **failure**（需在 GitHub Actions 查看失败步骤：lint / test / build） | `[~]` 合并前建议本地 `pnpm -r test` + `lint:ts` + `build` |
| 单元测试 | `recoveryGate.test.ts`、`hlsConfig.test.ts`、`healthMonitor.test.ts`、`registry.test.ts` | `[x]` |
| 源端到端脚本 | `./scripts/test-sources.sh`、`scripts/playback-test.sh` | `[x]` |

---

## 九、演示前最后检查（建议勾选）

- [ ] `./scripts/test-sources.sh` 全部关键频道 200
- [ ] `pnpm start` 本地可播 ACC + NHL，HUD 有码率/缓冲数据
- [ ] 已选定 demo 方式并写入 README：**公网 URL** 或 **screen-share**
- [ ] README 补充评审可用时间段
- [ ] CI 绿或 README 说明已知失败原因
- [ ] PR 从 `feature/dev` → `main`，描述链到本清单

---

## 十、快速索引（实现 → 文件）

| 能力 | 路径 |
|------|------|
| 频道注册表 | `backend/src/streaming/channels.config.ts` |
| HLS 代理 | `backend/src/streaming/proxy.ts` |
| 健康探活 + SSE | `backend/src/streaming/healthMonitor.ts`, `statusSse.ts` |
| 前端播放与恢复 | `frontend/src/components/Live/PlayerStage.tsx` |
| hls 调优 | `frontend/src/live/hlsConfig.ts` |
| 恢复状态机 | `frontend/src/live/recoveryGate.ts` |
| 切台预取 | `frontend/src/live/ChannelSwitcher.ts` |
| 质量 HUD | `frontend/src/components/Live/QualityHUD.tsx` |
| PRD 原文 | `docs/prd.md` |

---

*本清单随实现变更更新；若 PRD 与代码不一致，以代码与 `channels.config.ts` 为准。*
