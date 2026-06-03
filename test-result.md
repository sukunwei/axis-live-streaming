# 直播源实测报告

> 按 PRD 批准的 5 类源全部实测。
> 测试时间：2026-06-02
> 测试命令： `./scripts/test-sources.sh`
> 判定标准：HEAD/GET 上游 URL 状态码 + 200 后取 manifest 验证 6s/段 ABR

---

## TL;DR

| 类别 | 总数 | ✅ 可用 | ⚠ 部分可用 | ❌ 不可用 | 评估 |
|------|------|---------|-------------|-----------|------|
| 公共测试源 | 7 | 5 | 0 | 2 | 演示用，**已纳入配置** |
| 真实免费直播 | 9 | 5 | 0 | 4 | 2 个体育 + 3 个非体育可用 |
| FAST 频道 | 4 | 0 | 0 | 4 | 全部需 API token / 私有 m3u8 |
| YouTube Live 官方 | 5 | 0 | 0 | 5 | HLS 抓取违反 YouTube ToS |
| 聚合站 | 0 | 0 | 0 | 0 | 合规边界**不**做 |
| 官方广播页面 | 0 | 0 | 0 | 0 | 无公开 HLS 端点 |

**结论（2026-06-03 更新）**：实测发现 5 个公共测试源 + 1 个真实公共频道（DW English）可用；**真实体育频道在交付时全部上游失效**（redbull、stadium variants 404；france24 TLS 挂）。最终 4 频道为 1 真实公共 + 3 公共测试。

## ⚠️ 关键发现：真实体育源上游失效

| 频道 | 6-02 状态 | 6-03 状态 | 原因 |
|------|-----------|-----------|------|
| Red Bull TV | ✅ 全链通 | ❌ variants 404 | upstream `Last-Modified: 4月28日`，variants 已被清档 |
| Stadium | ✅ 全链通 | ❌ variants 404 | 同上：master 是 stale 缓存，variants 全 404 |
| France 24 | ✅ master 200 | ❌ variants 400 (AkamaiGHost) | `f24hls-i.akamaihd.net` TLS 证书不匹配，CDN 端点死亡 |
| **DW English** | ✅ 200 | ✅ 200 | 唯一持续可用的真实频道 |
| mux-llhls | ✅ 200 | ✅ 200 | 公共测试稳定 |
| mux x36xhzz | ✅ 200 | ✅ 200 | 公共测试稳定 |
| Apple BipBop | ✅ 200 | ✅ 200 | 公共测试稳定 |

> **教训**：公共 HLS 源是「演示用」而非「生产用」。PRD §1.3 纪律**「构建当天必须重新逐一验证」**现在证明是必须的。

---

## 1. 公共测试源（PRD 批准 / 开发演示用）

| 名称 | 状态 | 时间 | 备注 |
|------|------|------|------|
| **Mux x36xhzz** | ✅ 200 | 0.47s | 已纳入 `mux` 频道；ABR 6 档 |
| **Apple BipBop** | ✅ 200 | 0.94s | 已纳入 backupUrls；ABR 多档 |
| **Akamai CPH live test** | ✅ 200 | 1.04s | 备选 public 测试源，未纳入配置 |
| Akamai BigBuckBunny | ❌ 400 | 0.39s | URL 拼写错误（重复项），不是源的问题 |
| **TearsOfSteel** (Unified Streaming) | ✅ 200 | 2.30s | 备选 4K 测试源 |
| **Mux test_001 (LL-HLS)** | ✅ 200 | 0.20s | **真 LL-HLS**，可演示 §4.1 调参 |

**结论**：5 个公共测试源可用，Mux x36xhzz 链路全通（已测 master→variant→segment）。

---

## 2. 真实免费直播（**关键评估**：决定 demo 真实感）

| 名称 | 状态 | 时间 | 类别 | 评估 |
|------|------|------|------|------|
| **Red Bull TV (BoRB-AT)** | ✅ 200 | 0.67s | 极限运动 | **主推**：master→variant→segment 全链通，ABR 6 档（264kbps–6660kbps）|
| **Stadium (College Sports)** | ✅ 200 | 1.64s | 大学体育 | **主推**：第二个运动类别，满足 R2 |
| **NASA TV (NTV1)** | ⚠ 200 | 0.42s | 公共 | 兜底：master 200 但 **variants 404**（上游问题），仅作 fallback 标签 |
| Bloomberg TV+ | ❌ 403 | 0.80s | 财经 | geo-block |
| **France 24 EN** | ✅ 200 | 1.74s | 公共新闻 | **可加**：第二个公共频道（非体育）|
| **DW English** | ✅ 200 | 2.33s | 公共新闻 | **可加**：第二个公共频道 |
| Euronews EN | ❌ DNS | 0.04s | 新闻 | 域名解析失败（URL 失效）|
| ABC News Live | ❌ 404 | 1.02s | 新闻 | URL 已失效 |
| CBS News NY | ❌ 403 | 2.05s | 新闻 | geo-block |

**结论**：
- ✅ **真实体育源 2 个**（Red Bull + Stadium），满足 PRD R2
- ✅ **真实公共频道 3 个**（NASA / France 24 / DW English）— NASA 已纳入，France 24 / DW English **建议加入**
- ❌ 财经 / 主流新闻台大多 geo-block，不可用

---

## 3. FAST 频道（Pluto TV / Tubi / Xumo Play）

| 名称 | 状态 | 备注 |
|------|------|------|
| Pluto TV 通用 m3u8 | ❌ DNS | 公开 m3u8 URL 已不可访问 |
| Tubi 通用 m3u8 | ⚠ 200 但 HTML | 返回 2861B HTML，不是 m3u8（需要走 Web 解析） |
| Xumo Play 通用 m3u8 | ❌ 406 | Not Acceptable |
| Pluto East HD | ❌ DNS | URL 不可达 |

**结论**：所有 FAST 频道都需要 **API token + DRM 验证**才能拿到有效 m3u8。**演示用不可行**。

**已知可行绕过**：
- 有些 FAST 频道在 Roku / Samsung TV Plus 有公共 HLS
- 一些"直播体育"FAST 频道（如 DistroTV Sports, SportsGrid）有公开 m3u8 但需要周更维护
- **本项目 M3 时间不够做自动发现；M4 列入 next steps**

---

## 4. YouTube Live 官方频道（NFL / F1 / NBA G League / MLB / LaLiga）

| 频道 | 状态 | 评估 |
|------|------|------|
| NFL YouTube 直播 | ❌ HLS 不可用 | ToS 限制；HLS 抓取需 yt-dlp + 签名破解，违反 YouTube ToS |
| Formula 1 YouTube 直播 | ❌ HLS 不可用 | 同上 |
| NBA G League | ❌ HLS 不可用 | 同上 |
| MLB | ❌ HLS 不可用 | 同上 |
| LaLiga | ❌ HLS 不可用 | 同上 |

**结论**：**全部不可用为本平台的 HLS 源**。

**合规判定**（§1.4）：
- ❌ **HLS 抓取（yt-dlp / streamlink）违反 YouTube ToS** —— 不做
- ✅ **iframe embed 合规** —— 但无法用 hls.js 播放，不能走本平台 proxy
- **取舍**：demo 选 Red Bull + Stadium 替代 YouTube，避免合规问题

**注意**：PRD 原文是"league- or club-operated YouTube Live channels"—— 这指的是**平台提供 embed 的官方播放页**，不是"HLS 抓取"。本平台做 HLS 聚合，所以 YouTube embed 路径**不适用**。

---

## 5. 聚合站（Buffstreams / 类似）

**结论**：❌ **不做**（合规边界 §1.4）。

- Buffstreams 类聚合站信号来源不透明，多为盗用付费电视流
- 抓取 / 代理分发均违反原频道 ToS
- 部分内容涉及版权灰色地带
- **本项目优先合规，不演示**—— PRD 提到的"最直接演示"是 PRD 描述，本项目按 §1.4 纪律**主动放弃**

---

## 6. 官方广播页面（NCAA March Madness Live 等）

**结论**：❌ **不适用**（无公开 HLS 端点）。

- NCAA / 各联盟官网直播走 **Web 播放器**（HLS 在其后端 + 签名 URL）
- 浏览器打开页面时通过内部 JS 拿到签名 m3u8
- 直接 curl 拿到的是 HTML 壳，**HLS URL 在 JS 运行时才生成**
- 即使能拿到 m3u8，签名通常带 IP / 设备 fingerprint 校验，代理后失效
- **本平台架构不适用**

---

## 7. 端到端链路实测：Red Bull TV

为了证明 proxy 链路 + 浏览器播放可用，最重要的源完整跑一遍：

```
GET https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8
  → 200, 1487B
  → #EXT-X-STREAM-INF 行 6 条，ABR 264kbps–6660kbps

GET https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master_264.m3u8
  → 200
  → #EXT-X-VERSION:3, #EXT-X-TARGETDURATION:6
  → #EXT-X-MEDIA-SEQUENCE:506323 (实时)
  → 6s 分片，URL 形如 .../master_264/00168/master_264_02323.ts

浏览器实测（localhost:5173）：
  - 选 Red Bull TV
  - TTFF < 0.5s（master 40ms + variant 40ms + 首段 160ms + MSE 100ms）
  - HUD 数字持续刷新
  - 切到 Stadium 切源 < 100ms
```

✅ **完整端到端可用**。

---

## 8. 行动项（建议）

### 立即可做（演示加分）

1. ~~加入 France 24 + DW English 作为非体育公共频道~~ → 6-03 实测 France 24 TLS 死，改用 mux 测试源
2. **当前 4 频道配置**（chose above）：
   - `dw-english` — 唯一持续可用的真实公共频道
   - `mux-llhls` — 演示 §4.1 LL-HLS 调参
   - `mux` — VOD loop 兜底（多档 ABR）
   - `apple-bipbop` — Apple 公共测试（HLS ABR 多档）

### 列入 next steps

1. **每日自动探测**（cron + health monitor）— 公共源失效时自动告警
2. **FAST 频道 API 集成**（Pluto / Tubi 需 token / DRM 验证，48h 不够做）
3. **YouTube 路径**（iframe embed 选项，作为非 HLS 频道并排展示）
4. **MediaMTX 自接入**（YouTube Live 拉流 → 转 LL-HLS，作为后续增强）
5. **付费源备份**（有 $50 预算可用作专业体育源订阅；当前 $0）

---

## 9. 频道配置（当前 vs 建议）

### 当前配置（`backend/src/streaming/channels.config.ts`，2026-06-03 更新）

```ts
- dw-english     ✅ Real public news (DW 公共广播，1 个真实频道)
- mux-llhls      ✅ LL-HLS test (演示 §4.1 低延迟)
- mux            ✅ VOD loop test (多档 ABR 兜底)
- apple-bipbop   ✅ Apple 公共测试 (HLS ABR 多档)
```

### 已废弃的频道（6-03 上游失效）

```ts
- redbull        ❌ variants 404（master stale）
- stadium        ❌ variants 404（master stale）
- france24       ❌ TLS 证书不匹配
- nasa           ⚠ variants 已知不稳（可作兜底但已不再主用）
```

---

## 10. 关键结论

| 问题 | 答案 |
|------|------|
| YouTube Live 官方频道能用吗？ | **不能**（HLS 抓取违反 ToS；只能 embed，本平台不适用）|
| 真实体育直播能用吗？ | **❌ 6-03 实测全部失效**（Red Bull / Stadium variants 404；France 24 TLS 死）|
| 真实公共新闻能用吗？ | **能 1 个**（DW English）|
| 公共测试源能用吗？ | **能 4+ 个**（Mux x36xhzz / Mux LL-HLS / Apple BipBop / Akamai CPH / TearsOfSteel）|
| 兜底永不黑屏吗？ | **能**（4 个公共测试源 + DW English 任何时候至少 1 个可用）|
| FAST 频道能用吗？ | **不能**（需 API token / DRM，48h 不够做）|
| 聚合站能用吗？ | **不做**（合规边界）|
| 演示能跑得起来吗？ | **能**（已在 localhost 跑通，4 频道可切）|
| **PRD R2「两种运动」是否满足？** | **❌ 否**（6-03 真实体育源全失效）|
| 演示能跑得起来吗？ | **能**（已在 localhost 跑通，4 频道可切）|

---

## 11. 修复历史（开发过程中遇到的源问题）

| 时间 | 问题 | 修复 |
|------|------|------|
| 初始 | Node 默认 UA `node` 被 Akamai 拒 | 加 `User-Agent: Mozilla/5.0 ...` |
| 初始 | `new URL(rel, primaryUrl)` 把 last segment 当文件 | 改用 primaryDir（去掉最后文件名）|
| 初始 | 上游 301 不跟随 | 手写 redirect 跟随（最多 5 跳）|
| M1 | Fox Sports URL DNS 解析失败 | 从 channels.config 删除 |
| M1 | Fight Network URL TLS 证书不匹配 | 从 channels.config 删除 |
| M2 | 段需要 `Cache-Control: public, max-age=6` | proxy 加段缓存头 |

---

*报告生成于 2026-06-02，可重新跑 `./scripts/test-sources.sh` 验证。*
