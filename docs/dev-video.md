# Dev Plan: video.js Migration Evaluation

> Date: 2026-06-04  
> Status: **Recommendation = DON'T DO IT (this close to deadline)**  
> Audience: future me / anyone continuing this work after submission

This document is the result of a "should we swap our custom hls.js player
for video.js" evaluation. It captures the current state, what
video.js would actually buy us, the implementation plan if we
proceed, and why I'd push back against doing it for the current
submission.

---

## 1. Current state inventory

The custom player is 1189 LOC across these files (and has
associated tests + backend hooks):

| File | LOC | Role |
|------|-----|------|
| `frontend/src/components/Live/PlayerStage.tsx` | 658 | Main player: hls.js lifecycle, recovery, AB-loop keybinds, controls bar, timeSlider |
| `frontend/src/components/Live/QualityHUD.tsx` | 123 | Sticky metrics panel: 1Hz polled, `'—'` placeholders while inactive |
| `frontend/src/live/hlsConfig.ts` | 142 | BASE_CONFIG + `makeHlsConfig()` factory (network-dependent estimate, 1.6 fragLoadPolicy) |
| `frontend/src/live/MetricsCollector.ts` | 127 | Polls `getVideoPlaybackQuality` + `mainForwardBufferInfo`, 1Hz |
| `frontend/src/live/ChannelSwitcher.ts` | 53 | Master + first-variant prefetch on hover |
| `frontend/src/live/recoveryGate.ts` | 86 | 4-level recovery: retry → recover → swapAudio → destroyRebuild → failover |

Plus the backend hooks that the player drives:
- `backend/src/streaming/playbackLog.ts` — telemetry receiver + scoring
- `backend/src/streaming/healthMonitor.ts` — SSE source-health publisher
- `backend/src/streaming/proxy.ts` — HLS manifest proxy

Tests: 27 frontend + 26 backend. Lint clean.

## 2. What video.js would actually give us

video.js (with `videojs-http-streaming` for HLS) bundles:

| Feature | Already in our build? |
|---------|----------------------|
| Player chrome (controls, settings, fullscreen, captions UI) | Custom, ~150 LOC in PlayerStage |
| Quality level selector | Custom (just shows `1080p` badge, not a menu) |
| Audio track selector | Not built — Red Bull ES has Spanish CC but no switching UI |
| Hotkeys | Partial: M (mute), F (fullscreen), K/space (play-pause) |
| Mobile touch gestures | **No** — desktop only |
| Picture-in-picture | **No** |
| Cast (Chromecast) | **No** |
| Captions/subtitles UI | **No** (track exists in manifest but no overlay) |
| A11y (ARIA, keyboard nav) | Basic — buttons have aria-label, no full a11y audit |
| HLS engine | `hls.js 1.6.16` (same as VHS uses) |
| Bundle size | Custom UI ≈ 50KB gz, video.js ≈ 250-300KB gz |

So the wins are: chrome, a11y, mobile gestures, PiP, cast, captions
overlay. The losses are: control, custom recovery, custom metrics.

## 3. Trade-offs

### Pros
- 5-7 features we don't have (captions UI, PiP, cast, mobile gestures, full a11y)
- ~Less code to maintain in the long term
- Battle-tested UI; future maintainers don't need to know hls.js internals
- Plugin ecosystem (analytics, ads, DRM, etc.) for future

### Cons
- **Bundle +200KB gz** — after P0 perf work to keep the initial bundle small (we removed React.lazy for PlayerStage specifically to avoid a 100-300ms chunk fetch)
- **Recovery story gets weaker** — VHS's built-in error recovery is a simple retry. Our 4-level RecoveryGate is more sophisticated for our specific failure modes
- **SSE-driven failover** — the videojs-contrib-* plugin API doesn't have a clean hook for "switch to a different stream URL on a health event from the server." We'd have to write that plugin from scratch
- **MetricsCollector** — relies on `getVideoPlaybackQuality` + `hls.mainForwardBufferInfo` (hls.js-specific). Video.js wraps hls.js but doesn't expose this directly; we'd need to fish into `player.tech_.vhs` or similar
- **Time + risk** — submitting in <24h, replacing the player means re-doing 5 days of work, high risk of regression
- The "demo polish" axis is **already strong** — the user is asking this because they noticed the custom UI works well, not because there's a problem

## 4. Recommendation

**Do NOT migrate for the current submission.** Reasoning:

1. **Risk-reward is wrong for the deadline.** Current submission is on
   track, with a tested, working player that handles 4 live sources
   end-to-end. Replacing it 18 hours before the deadline is a recipe
   for a regression that costs more than the polish gain.
2. **The "video.js features we lack" set is mostly demo polish**, not
   PRD scoring. PRD weights Stream quality 40% (we're strong) and
   Demo & polish 15% (decent). A 15% gain at 60% risk-of-regression
   isn't worth it.
3. **Migration would consume the time we should be using for
   verification** — running `pnpm start` on all 4 channels, Playwright
   tests, README fill-in. That's the higher-leverage work right now.

**If this is a "after submission, consider for v2" plan**: yes, this
document. Re-evaluate then with the actual demo feedback.

## 5. Implementation plan (if we proceed anyway)

### Phase 0 — Recon (30 min)
- `pnpm add video.js @types/video.js`
- Audit bundle impact: `pnpm --filter frontend build`, check chunk sizes
- Identify which videojs-contrib-* plugins we need:
  - `videojs-http-streaming` (VHS, the HLS engine — included by default in video.js 8+)
  - `videojs-contrib-eme` (DRM, not needed now)
  - `videojs-contrib-quality-levels` (built-in in VHS)
  - `videojs-http-source-selector` (built-in fallback)

### Phase 1 — Spike (1.5h)
- Mount `<video-player>` element with one channel
- Configure VHS to use our proxy URL
- Verify: autoPlay muted, MSE playback, ABR
- Bundle size delta check

### Phase 2 — Recovery plugin (3h)
- Write a video.js plugin wrapping our `recoveryGate.ts`:
  - Hook into `player.on('error')` → route to RecoveryGate
  - Map VHS error categories to gate levels
- Write a second plugin for SSE-driven failover:
  - `EventSource('/events')` → on `source-health` for current channelId
  - After 2s of 'down' → `player.src(backupUrl)`
  - The "wrong-content" issue from commit 8ec93b3 still applies; this plugin doesn't fix that

### Phase 3 — Metrics → telemetry (2h)
- Video.js exposes events: `player.on('timeupdate')`, `player.on('progress')`, `player.on('playing')`, etc.
- Replace `MetricsCollector` direct hls.js access with event-based aggregation:
  - bitrate: track `player.tech_.vhs.playlistController_.mainForwardBufferInfo` (or extract from `loadedmetadata`)
  - dropped frames: still `getVideoPlaybackQuality()` (works the same)
  - stalls: video.js fires `waiting` event
- Plumb through existing `sendLog()` → `playbackLog.ts` (no backend change)

### Phase 4 — UI parity (3h)
- Quality HUD: video.js has a quality menu built-in. The current
  QualityHUD is sticky + always-visible (per PRD scoring). Decide
  one:
  - **Path A**: Hide VHS menu, keep custom QualityHUD as a plugin
    extending the player bar
  - **Path B**: Drop QualityHUD, use VHS menu, lose the "always visible"
    aspect
  - **Path C**: Custom plugin that adds a quality badge to the
    control bar (YouTube-style)
- Play/pause / volume / fullscreen / timeSlider: video.js has all
  of these, but our timeSlider was just fixed for the drag bug
  (commit 4f62f7c). Replace with video.js's `<progress>` control,
  verify drag still works in their implementation.

### Phase 5 — Validation (2h)
- Re-run all 27 frontend tests (some may need updates)
- `pnpm start` and click through all 4 channels + livestar
- Run `scripts/measure.sh` to compare TTFF / stalls pre vs post
- Bundle size budget: should NOT regress >100KB gz on initial load

**Total: ~12h**. Half of that is in the recovery/telemetry plugin code
where hls.js-specific knowledge is at risk of being lost.

## 6. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Bundle size regression breaks P0 perf work | High | Medium | Set size budget; abort if +100KB |
| Recovery logic ported wrong → silent regression | Medium | High | Keep both players running behind a feature flag, compare error events |
| VHS handles some edge case differently from raw hls.js | Medium | High | Test all 4 channels' manifest+variant+segment end-to-end |
| Plugin lifecycle (register/getInstance) leaks | Low | Medium | Cleanup in `player.dispose()` hooks |
| Hot-key behavior changed | Low | Low | Maintain key handler in wrapper, override video.js defaults |

## 7. Open questions

- **After submission, who maintains this code?** If "future me",
  they should know the current custom code better than video.js
  internals. If "new contributor", video.js is friendlier.
- **Are we ever going to monetize / add DRM?** videojs-contrib-eme
  is the entry point. If yes, video.js is a clearer path.
- **Do we care about mobile?** PRD doesn't mention it. Current
  build is desktop-only. If mobile matters, video.js wins outright.
- **Do we have bandwidth for the 250KB extra?** First-load metric
  on the live demo URL — measure on a 3G profile before deciding.

## 8. Recommendation (final)

**Don't do it for the current submission.** The current build is
working, tested, and demo-ready. video.js is a v2 conversation, not
a v1 fix.

**If you do it anyway** (operator override), follow Phase 0 → 5 in
order, with the bundle budget and feature-flag as escape hatches.
Stop and roll back if Phase 1 spike shows +200KB or any channel
regresses.

---

## 9. Quick reference: video.js vs our current code

| Concern | Current (hls.js 1.6 + custom UI) | video.js 8 |
|---------|------------------------------|------------|
| HLS engine | hls.js 1.6.16 directly | videojs-http-streaming (VHS) wrapping same hls.js |
| Recovery | 4-level RecoveryGate (custom) | VHS built-in: simple retry, source swap, error event |
| ABR | hls.js 1.6 internal + our tuning (liveSyncOnStallIncrease, fragLoadPolicy) | VHS same hls.js internal; tune via `html5.vhs` config |
| Metrics | MetricsCollector polling hls internals | Plugin listening to player events; some hls internals behind `player.tech_.vhs` |
| Quality level UI | QualityHUD sticky panel | VHS built-in menu, or custom plugin to keep it sticky |
| TimeSlider | Custom controlled input with isDragging state (commit 4f62f7c) | Built-in `<vjs-progress-control>` |
| Bundle | 50KB custom | ~300KB with VHS |
| Captions | None (track in manifest only) | Built-in overlay |
| PiP | None | Built-in |
| A11y | aria-label on buttons | Full ARIA + keyboard nav |
| Mobile gestures | None | Built-in |

## 10. References

- video.js: https://videojs.com/
- VHS: https://github.com/videojs/http-streaming
- Current commit history: see `git log` for the prior 30+ commits
  building up the custom player (recover, metrics, quality HUD,
  timeSlider, RecoveryGate, etc.)
- PRD scoring: `docs/prd.md` — Stream quality 40%, Problem-solving
  25%, Architecture 20%, Demo polish 15%
