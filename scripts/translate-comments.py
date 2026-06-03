#!/usr/bin/env python3
"""
Translate remaining Chinese to English with an extended dictionary.
"""
import re
from pathlib import Path

# Comprehensive phrase table
TABLE = [
    # proxy.ts
    ('HLS proxy — manifest rewrite + segment streaming.', 'HLS proxy — manifest rewrite + segment streaming.'),
    ('路径', 'Path'),
    ('<relative-path> 是从频道 primaryUrl 算起的相对路径，例如：',
     '<relative-path> is the relative path from the channel primaryUrl, e.g.:'),
    ('upstream 是频道 primaryUrl 本身', 'upstream is the channel primaryUrl itself'),
    ('upstream = primaryUrl 目录 +', 'upstream = primaryUrl dir +'),
    ('Key constraints：', 'Key constraints:'),
    ('优化：6 → 30（多观众共享段，减少上游回源）',
     'tuning: 6 → 30 (multi-viewer segment sharing, reduce upstream fetches)'),
    ('7 天', '7 days'),
    ('mock 注入（M3.5 demo use）', 'mock injection (M3.5 demo use)'),
    ('/hls/:channel/p?u=<base64> 跨域名 proxy（M3.6 enhancement)────',
     '/hls/:channel/p?u=<base64> cross-domain proxy (M3.6 enhancement) ────'),
    ("不要前导 `/`：new URL('master.m3u8', base) 会相对解析；new URL('/master.m3u8', base) 会替换整个 path",
     "No leading '/': new URL('master.m3u8', base) resolves relatively; new URL('/master.m3u8', base) replaces the whole path"),
    ('必须解析到 primary 的**目录**（去掉最后的文件名），否则 last segment 当文件被替换',
     'Must resolve to primary\'s **directory** (strip the last filename), else the last segment gets treated as a file and replaced'),
    ('response 已被前序代码 end 掉', 'response already ended by prior code'),
    ('── manifest: Fetch upstream → rewrite segment URLs → return ──────────────────────',
     '── manifest: Fetch upstream → rewrite segment URLs → return ──────────────────────'),
    ('改写 variant 上的 URI= attribute（HLS spec 允许 EXT-X-MEDIA / EXT-X-I-FRAME-STREAM-INF）',
     'Rewrite URI= attribute on variants (HLS spec allows EXT-X-MEDIA / EXT-X-I-FRAME-STREAM-INF)'),
    ('分片 / variant URL 行', 'segment / variant URL line'),
    # healthMonitor.ts
    ('Health Monitor — 周期探活（§4.4 + §4.8）', 'Health Monitor — periodic probe (§4.4 + §4.8)'),
    ('状态机：', 'State machine:'),
    ('→ 探活 200', '→ probe 200'),
    ('→ 5xx 3 次/30s  或  探活连续 2 次失败', '→ 5xx 3 times/30s OR 2 consecutive probe failures'),
    ('→ degraded 持续 5s 且无restore', '→ degraded sustained 5s with no restore'),
    ('探活策略（M3 简化）：只 HEAD/GET 上游 master，不拉分片',
     'Probe strategy (M3 simplified): only HEAD/GET upstream master, no segments'),
    ('上游不可达 → fail；HTTP 200/206 → ok；HTTP 5xx → 5xx 计数',
     'upstream unreachable → fail; HTTP 200/206 → ok; HTTP 5xx → 5xx count'),
    ('连续探活失败次数', 'consecutive probe failures'),
    ('5xx 时间戳列表（30s 滑窗）', '5xx timestamp list (30s sliding window)'),
    ('进入 degraded 状态的时间', 'timestamp when entering degraded state'),
    ('阈值（来自 §2.5 配置表）', 'Thresholds (from §2.5 config table)'),
    ('30s 内 3 次 5xx → degraded', '3 5xx in 30s → degraded'),
    ('连续 2 次失败 → degraded', '2 consecutive failures → degraded'),
    ('degraded 持续 5s → down', 'degraded sustained 5s → down'),
    ('初始化所有频道状态', 'Initialize all channel states'),
    ('VOD loop 源（live=false）不查 stale；只对 LIVE 源做 stale 检测',
     'VOD loop sources (live=false) skip stale check; only LIVE sources are checked'),
    ('3xx 算 ok（manifest 拉下来会跟 redirect）；其他算 fail',
     '3xx counts as ok (manifest follows redirect); others count as fail'),
    # channels.config.ts
    ('Channel registry — single source of truth（§6.4）', 'Channel registry — single source of truth (§6.4)'),
    ('启动时静态加载。', 'Statically loaded at runtime. '),
    ('Missing field fails startup。', 'Missing field fails startup. '),
    ('构建当天必须 curl 验证每个 URL（§1.3 纪律）',
     'Must curl-verify each URL on build day (§1.3 discipline)'),
    ('公共 HLS 源通病：上游随时会失效（master 200 但 variants 404，或 TLS 挂）',
     'Public HLS source pitfall: upstream can fail at any time (master 200 but variants 404, or TLS dies)'),
    ('2026-06-02 实测：redbull、stadium 都被清档；france 24 上游 TLS 死亡',
     '2026-06-02 measured: redbull, stadium both purged; france 24 upstream TLS died'),
    ('   - dw-english    ', '   - dw-english    '),
    ('公共新闻（真，DW 公共广播）', 'public news (real, DW public broadcast)'),
    ('   - mux-llhls     ', '   - mux-llhls     '),
    ('LL-HLS 测试（演示 §4.1 低延迟调参）', 'LL-HLS test (demo §4.1 low-latency tuning)'),
    ('   - mux           ', '   - mux           '),
    ('VOD loop 测试（多档 ABR）', 'VOD loop test (multi-tier ABR)'),
    ('   - apple-bipbop  ', '   - apple-bipbop  '),
    ('Apple 公共测试（HLS ABR 多档）', 'Apple public test (HLS ABR multi-tier)'),
    ('Field notes：', 'Field notes:'),
    ('true=LIVE 源（启 stale 检测）；false=VOD loop',
     'true = LIVE source (enables stale check); false = VOD loop'),
    ('5 个 ABR 档（实测）+ 字幕轨', '5 ABR tiers (measured) + caption track'),
    # statusSse.ts
    ('Status SSE — /events route (§6.2)。', 'Status SSE — /events route (§6.2).'),
    ('Protocol：', 'Protocol:'),
    ('Events：', 'Events:'),
    ('Keep-alive：comment frame every 15s `: ping\\n\\n`', 'Keep-alive: comment frame every 15s `: ping\\n\\n`'),
    ("禁用 nginx buffering（部署时）", 'disable nginx buffering (in production deploys)'),
    ('初始状态：发送所有频道当前状态', 'initial state: send current state of all channels'),
    # registry.ts
    ('Channel registry loader + validator.', 'Channel registry loader + validator.'),
    ('启动时静态校验；missing field throws (§6.4 discipline)。',
     'Statically validates at startup; missing field throws (§6.4 discipline).'),
    # mockFailure.ts
    ('Mock failure injector — demo use (M3.5)。', 'Mock failure injector — demo use (M3.5).'),
    ('接下来 30s all HLS requests for that channel return 500',
     'For the next 30s all HLS requests for that channel return 500'),
    ('channelId → expireAt', 'channelId → expireAt'),
    # server.ts
    ('Axis Live Streaming — HTTP server entry', 'Axis Live Streaming — HTTP server entry'),
    ('进程 liveness', 'process liveness'),
    ('频道注册表', 'channel registry'),
    ('HLS proxy（manifest 改写 + 段流式转发）', 'HLS proxy (manifest rewrite + segment stream forwarding)'),
    ('SSE: 源健康（Phase 3 才实现）', 'SSE: source health (Phase 3 implementation)'),
    ('Phase 1 实现 /health /channels /hls/* 三个，/events 占位返回 501。',
     'Phase 1 implements /health /channels /hls/*; /events placeholder returns 501.'),
    ('流畅度评分（0-5）。', 'Smoothness score (0-5).'),
    ('基础分 = min(3, variants/2)        // 变体多 → ABR 灵活',
     'base = min(3, variants/2)        // more variants → more ABR flexibility'),
    ('LIVE 源 +1                          // 真实直播通常比 VOD loop 稳',
     'LIVE source +1                    // real live usually more stable than VOD loop'),
    ('健康扣分：degraded -1, down -2', 'health penalty: degraded -1, down -2'),
    ('范围 [0, 5]', 'range [0, 5]'),
    ('强 → 弱', 'strong → weak'),
    ('启动后台服务', 'start background services'),
    # hlsConfig.ts
    ('hls.js 配置 — 「流畅优先」调参（M3.6 优化版，DW 调优）。',
     'hls.js config — "smoothness-first" tuning (M3.6, DW-tuned).'),
    ('用户反馈："Buffer < 3s 就卡"。经验阈值：Buffer 稳定 ≥ 5s 才不卡',
     'User feedback: "stutter when buffer < 3s". Empirical threshold: buffer stable ≥ 5s avoids stutter'),
    ('优化历程：', 'Tuning progression:'),
    ('优化 1（延迟优先）：liveSyncDuration: 3，buffer 实际 ~3s，临界',
     'Tune 1 (latency-first): liveSyncDuration 3, buffer ~3s actual, on edge'),
    ('优化 2（流畅优先）：liveSyncDuration: 6，buffer 实际 ~3.6s，仍临界',
     'Tune 2 (smoothness-first): liveSyncDuration 6, buffer ~3.6s actual, still on edge'),
    ('优化 3（DW 调优）：liveSyncDuration: 10，buffer 实际 ~8-10s，**安全**',
     'Tune 3 (DW-tuned): liveSyncDuration 10, buffer ~8-10s actual, **safe**'),
    ('优化 1 → 2 → 3 演进：', 'Tune 1 → 2 → 3 progression:'),
    ('   - liveSyncDuration: 3 → 6 → 10', '   - liveSyncDuration: 3 → 6 → 10'),
    # PlayerStage.tsx
    ('PlayerStage — main player (M3.4 + M3.6 SSE-driven failover)',
     'PlayerStage — main player (M3.4 + M3.6 SSE-driven failover)'),
    ('职责：', 'Responsibilities:'),
    ('改进 3：订阅 store.healthByChannel[currentChannelId]，down 持续 2s 自动切 backup',
     'Improvement 3: subscribe to store.healthByChannel[currentChannelId], auto-switch to backup after 2s of down'),
    ('Key constraints：', 'Key constraints:'),
    ('channelId 变化时**整组件 remount**（父组件用 key={channelId}）',
     'on channelId change, **whole-component remount** (parent uses key={channelId})'),
    ('destroy 时 hls.destroy() + collector.detach()', 'on destroy: hls.destroy() + collector.detach()'),
    ('切 backup 时只换 loadSource，video element 不动（保留帧）',
     'on backup switch: only swap loadSource, keep video element (preserves frame)'),
    ('走代理的 m3u8 URL（前端永远不直连上游）', 'Proxied m3u8 URL (frontend never connects to upstream directly)'),
    ('备用源（upstream direct URL）', 'Backup sources (upstream direct URL)'),
    ('改进 3：订阅 health monitor，down 持续 2s 触发自动切 backup',
     'Improvement 3: subscribe to health monitor, auto-switch to backup after 2s of down'),
    ('Pick the next untried backup (avoid loops: if currently on backup[0], jump to backup[1])',
     'Pick the next untried backup (avoid loops: if currently on backup[0], jump to backup[1])'),
    ('启动 MetricsCollector', 'Start MetricsCollector'),
    ('（先 attach 在下面 hls 创建后）', '(attach after hls is created below)'),
    ('卡顿检测：waiting Events → collector 记 stall', 'Stall detection: waiting events → collector records stall'),
    # MetricsCollector.ts
    ('MetricsCollector — 1Hz sampling of hls.js + video metrics (§4.5 + §5.4 discipline)。',
     'MetricsCollector — 1Hz sampling of hls.js + video metrics (§4.5 + §5.4 discipline).'),
    ('Key constraints：', 'Key constraints:'),
    ('Sample results write to ref (`current`), **not** to Zustand store',
     'Sample results write to ref (`current`), **not** to Zustand store'),
    ('HUD independently uses useState + setInterval to force 1Hz re-render',
     'HUD independently uses useState + setInterval to force 1Hz re-render'),
    ('On reset, counts zero; on stop, interval cleared', 'On reset, counts zero; on stop, interval cleared'),
    ('由 PlayerStage 在检测到 waiting Events时调用', 'Called by PlayerStage when a waiting event is detected'),
    ('hls.js 1.6+: mainForwardBufferInfo.len 给当前前向buffer seconds',
     'hls.js 1.6+: mainForwardBufferInfo.len gives current forward buffer in seconds'),
    # recoveryGate.ts
    ('RecoveryGate — 错误恢复状态机（§4.6 完整版）', 'RecoveryGate — error recovery state machine (§4.6 full version)'),
    ('决策表（10s 滑动窗口，跨错误类型共享）', 'Decision table (10s sliding window, shared across error types)'),
    ('    1    → retry (hls.startLoad)', '    1    → retry (hls.startLoad)'),
    ('    2    → retry (含锁档 currentLevel)', '    2    → retry (with level lock currentLevel)'),
    ('    ≥3   → failover', '    ≥3   → failover'),
    ('    1    → recover (hls.recoverMediaError)', '    1    → recover (hls.recoverMediaError)'),
    ('    2    → swapAudio (swapAudioCodec + recoverMediaError)',
     '    2    → swapAudio (swapAudioCodec + recoverMediaError)'),
    # recoveryGate.test.ts
    ('describe block names + test descriptions', 'describe block names + test descriptions'),
    ('窗口共享 across error types', 'window shared across error types'),
    ('总入口', 'overall entry'),
    ('其他只看同类型计数，所以 NETWORK 仍是 retry', 'other type only counts same-type, so NETWORK still retry'),
    ('这是设计选择：跨类型由 other 路径处理', 'this is a design choice: cross-type handled by other path'),
    ('清空所有计数', 'clears all counts'),
    # QualityHUD.tsx
    ('QualityHUD — 1Hz-sampled quality overlay (§4.5)。', 'QualityHUD — 1Hz-sampled quality overlay (§4.5).'),
    ('设计：', 'Design:'),
    ('Does not subscribe to the store, so metrics changes**do not**trigger an App re-render。',
     'Does not subscribe to the store, so metrics changes **do not** trigger an App re-render.'),
    # proxy.ts remaining
    ('把上游 URL 转成同源代理Path。', 'Convert upstream URL to same-origin proxy path.'),
    ('同域名：用相对Path（path 干净，便于人眼检查）',
     'Same domain: use relative path (cleaner for human inspection)'),
    ('跨域名：encode 完整 URL 到 ?u=<base64>，确保 proxy 能 fetch（France 24 类源）',
     'Cross-domain: encode full URL into ?u=<base64> so proxy can fetch (France 24-type sources)'),
    ('跨域名：encode 整个 URL', 'cross-domain: encode the entire URL'),
    ('跨域名：返回原 URL，caller 检测到 http:// 前缀就改走 encoded path',
     'cross-domain: return the original URL, caller detects http:// prefix and switches to encoded path'),
    ('primary 的目录：去掉文件名', 'primary dir: strip the filename'),
    ('兜底：去掉开头的 /', 'fallback: strip leading /'),
    ('解码 ?u=<base64> 拿到上游 URL。', 'Decode ?u=<base64> to get upstream URL.'),
    ('返回 null 表示格式错误。', 'Returning null indicates a format error.'),
    # MetricsCollector.ts
    ('采样时刻', 'sampling timestamp'),
    ('上一次采样的 dropped/decoded 帧数（用于估算 fps）',
     'Last sample\'s dropped/decoded frame counts (for fps estimation)'),
    # proxy.ts last bits
    ('Path：', 'Path:'),
    ('关掉旧 request 的 socket', 'close the old request socket'),
    ('防 ERR_HTTP_HEADERS_SENT', 'prevent ERR_HTTP_HEADERS_SENT'),
    ('── segment: 流式 pipe 上游分片到客户端 ──────────────────────',
     '── segment: stream pipe upstream segments to client ──────────────────────'),
    ('── manifest 文本拉取（not streamed (needs rewriting)；follow 3xx） ───────',
     '── manifest text fetch (not streamed, needs rewriting; follow 3xx) ───────'),
    # hlsConfig.ts
    ('进一步保守', 'even more conservative'),
    ('启动直接 8s 缓冲', 'start with direct 8s buffer'),
    ('性能 vs 流畅 trade-off(§3.4):', 'smoothness vs performance trade-off (§3.4):'),
    # recoveryGate.ts
    ('(同一 URL 重建实例)', '(rebuild instance with same URL)'),
    ('(兜底: UI 显示「演示模式」)', '(fallback: UI shows "demo mode")'),
    ('(不直接切源)', '(no direct source switch)'),
    ('关键纪律:', 'Key discipline:'),
    # recoveryGate.test.ts
    ('(虽然 NETWORK 自己只 2 次)', '(although NETWORK itself only 2 times)'),
    ('(实际: gate 只看同类型计数, 所以 NETWORK 仍是 retry)',
     '(actual: gate only counts same-type, so NETWORK is still retry)'),
    # registry.test.ts
    ('Channel registry 测试 —— 启动校验(§6.4).', 'Channel registry test — startup validation (§6.4).'),
    ('至少 1 个频道', 'at least 1 channel'),
    ('每个频道字段完整', 'each channel field is complete'),
    # healthMonitor.test.ts
    ('HealthMonitor 状态机测试(§4.8)—— 通过注入 mock 5xx 验证.',
     'HealthMonitor state machine test (§4.8) — verify via injected mock 5xx.'),
    ('这里只测纯逻辑(markOk / mark5xx / markFail / transition),',
     'Tests pure logic only (markOk / mark5xx / markFail / transition),'),
    ('不启 network. 直接 import 内部状态.', 'no network. Directly import internal state.'),
]

TABLE.sort(key=lambda x: -len(x[0]))

def translate(text):
    for src, dst in TABLE:
        text = text.replace(src, dst)
    return text

def main():
    root = Path(__file__).parent.parent
    src_dirs = [root / 'frontend' / 'src', root / 'backend' / 'src']
    targets = []
    for d in src_dirs:
        targets.extend(d.rglob('*.ts'))
        targets.extend(d.rglob('*.tsx'))

    for f in sorted(targets):
        content = f.read_text(encoding='utf-8')
        new_content = translate(content)
        if new_content != content:
            f.write_text(new_content, encoding='utf-8')
            remaining = len(re.findall(r'[一-鿿]', new_content))
            status = 'OK' if remaining == 0 else f'PARTIAL ({remaining} cn)'
            print(f'{status:14s} {f.relative_to(root)}')

if __name__ == '__main__':
    main()
