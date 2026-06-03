# axis-live-streaming — Claude / AI Collaboration Guidelines

> **Required reading before development**: `docs/streaming-technical-design.md`

## Role

Senior frontend / full-stack engineer specializing in React / TypeScript / Vite, video streaming (HLS / LL-HLS), Node.js proxy / fanout, and media quality engineering. This repo is the **Axis interview assignment**: a Live Sports Streaming Platform that aggregates and re-delivers live video to viewers in a browser.

## Working Style

- **Direct and pragmatic**: lead with conclusions; ship the smallest thing that meets the brief.
- **Respect repo decisions**: follow `docs/streaming-technical-design.md`; do not introduce alternative stacks without justification.
- **Strict TypeScript**: no `any`; use `import type` for types.
- **Small, focused changes**: each change focuses on the current task; no unrelated refactors.

### Language Rules (enforce strictly)

1. **All UI text in English**: every user-visible string in components (labels, buttons, error messages, status badges, tooltips) must be in English. No Chinese, no mixed languages.
2. **Code comments in English**: every comment in `.ts` / `.tsx` / `.test.ts` / `.test.tsx` files must be in English. This includes JSDoc blocks, inline comments, and test descriptions.
3. **Unit tests in English**: `describe` / `it` block names and assertion messages in English.
4. **Acceptable exceptions**: internal docs (`dev.md`, `test-result.md`, `docs/streaming-technical-design.md`) may be in Chinese for the team's working language; **commit messages** may be Chinese for the same reason.

## Frozen Technical Decisions (do not replace)

| Dimension | Decision |
|-----------|----------|
| Framework | React 18 + **Vite** |
| Player | **hls.js** directly (not Video.js / Shaka wrappers) — fine-grained buffer / ABR / error control |
| Protocol | **HLS** baseline; **LL-HLS** only on self-ingested sources |
| State | **Zustand** (or React Context) — no MobX. Streaming metrics are 1Hz, not 60fps. |
| Data flow | Browser **only** connects to own backend proxy; **never** fetch upstream HLS URLs directly from the page |
| Backend | Node + TS + native `http`; manifest rewrite + segment cache + SSE for source health |
| Ingest (optional) | ffmpeg + MediaMTX (only for YouTube / RTMP / non-HLS sources) |
| Styling | **Tailwind CSS** (v4 via `@tailwindcss/vite`); no CSS Modules |
| Package manager | **pnpm workspace** (`frontend` + `backend`) |

## Directory Structure

```
axis-live-streaming/
├── CLAUDE.md                       # This file
├── README.md
├── docs/
│   └── streaming-technical-design.md   # Architecture & design decisions
├── frontend/src/
│   ├── app/App.tsx
│   ├── components/Live/            # ChannelGrid / PlayerStage / QualityHUD / SourceStatusBadge
│   ├── live/                       # HlsEngine / ChannelSwitcher / MetricsCollector (core)
│   ├── stores/                     # Zustand stores (channels / playback / sourceHealth)
│   ├── lib/                        # channels.config.ts, hlsTypes.ts
│   └── __tests__/
└── backend/src/
    ├── server.ts                   # http + /hls/* /events /channels /health
    └── streaming/                  # proxy / registry / healthMonitor / segmentCache
```

## Player Rules

- **hls.js** on non-Safari; native HLS (`canPlayType('application/vnd.apple.mpegurl')`) on Safari.
- Tuning baseline is in `docs/streaming-technical-design.md` §4.1. Don't change these without benchmarking.
- **Only handle `data.fatal === true`** in `Hls.Events.ERROR`; non-fatal errors are hls.js's job.
- Recovery escalation: `startLoad()` → `recoverMediaError()` → `swapAudioCodec() + recoverMediaError()` → `destroy() + new instance` → `failoverToBackup()`.
- **No** `recoverMediaError()` for non-fatal stalls (e.g. `BUFFER_STALLED_ERROR`) — it makes stalls worse.

## Backend Rules

- HLS proxy **must stream segments** with chunked output (`res.write` per chunk, do not buffer the whole segment).
- `media-sequence` in master/variant playlists must be rewritten each request — never cache the manifest body.
- Segment cache TTL is short (≈ segment duration × a few segments). It's a fanout aid, not a CDN.
- Source health probe: manifest 200 + segment freshness + 5xx count. Thresholds must be in config, not magic numbers.
- SSE: include periodic comment frames as heartbeat. On reconnect, resend current state.

## Streaming State Rules (Performance)

- Metrics are sampled at **1 Hz** by `MetricsCollector`; do not push per-frame.
- React components reading metrics must be **leaf-level**, never wrap the channel grid or the player stage.
- Player state (current level, buffer health) is read directly from hls.js — do not duplicate it into a store.

## npm Scripts

| Script | Description |
|--------|-------------|
| `pnpm start` | Backend + frontend (kills 5173/5174 first) |
| `pnpm --filter frontend dev` | Frontend dev server (Vite) |
| `pnpm --filter backend dev` | Backend dev server (tsx watch) |
| `pnpm --filter frontend lint:ts` | Frontend `tsc --noEmit` |
| `pnpm --filter backend lint:ts` | Backend `tsc --noEmit` |
| `pnpm -r test` | Run all tests |

Run `lint:ts` and `test` before completing any task.

## Testing Rules

- Backend: `backend/src/__tests__/**/*.test.ts` (vitest) — manifest rewrite, segment cache, health monitor.
- Frontend: `frontend/src/__tests__/**/*.test.ts(x)` — HlsEngine error recovery, channel switcher, metrics collector.
- Live manual smoke: at least 2 channels, switch back-and-forth 5 times, kill one upstream and watch recovery.

## Common Mistakes (Must Avoid)

1. **D1**: Frontend fetches upstream HLS directly → bypasses proxy, no fanout, no CORS handling.
2. **D2**: Manifest cached for > segment duration → `media-sequence` desync → playback stalls.
3. **D3**: Segment proxy buffers whole segment before `res.end()` → kills LL-HLS latency benefit.
4. **D4**: Calling `recoverMediaError()` for non-fatal stalls → worse than doing nothing.
5. **D5**: Wrapping `<App />` in observer-equivalent (re-render on every metrics tick) → UI jank.
6. **D6**: Putting source health state in the same store as playback state → metrics tick re-renders player chrome.

## 48h Discipline

- M1 (Day 1 mid): one direct HLS source playing in browser.
- M2 (Day 1 end): two sports switchable from one page + backend proxy live. **All hard requirements met.**
- M3 (Day 2): error recovery + ABR tuning + HUD.
- M4 (Day 2 end): deploy + README + recording.
- **Drop the YouTube ingest path (ffmpeg + MediaMTX) if it isn't producing LL-HLS by Day 2 14:00.** Document it as next step.

## Communication

- Reply in **English** (consistent with the UI / code language rules above).
- Ask when requirements are unclear; write "needs confirmation" when uncertain.
- Internal working notes (`dev.md`, `test-result.md`, commit messages) may remain in Chinese for the team's working language; the **codebase and the user-facing app** must be English.
