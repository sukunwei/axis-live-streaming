/**
 * MockControls — dev-only UI for the `/mock/break/:id` and
 * `/mock/restore` endpoints (P0-3 review-demo).
 *
 * Renders as an independent dev bar (not mixed with channel info).
 * A left/right toggle switch represents the local "intent" of the
 * mock state for the current channel:
 *
 *   OFF  →  POST /mock/break/:currentChannelId   (toggle ON, 30s)
 *   ON   →  POST /mock/restore                  (clears all)
 *
 * The proxy-side mock injector (`backend/src/streaming/mockFailure.ts`)
 * returns 404 in production (`NODE_ENV=production`), so this component
 * is gated by `import.meta.env.DEV` at the call site. The bar is
 * mounted in App.tsx; when running a production build the entire
 * bar is omitted.
 *
 * Note: the local toggle state is "user intent", not synced with the
 * server's TTL. After 30s the server-side mock auto-expires; the
 * toggle would still read ON. That's a deliberate trade-off — the
 * 48h review flow is "click ON, see effect, click OFF" and never
 * leaves the toggle ON for the full 30s.
 */

import { useEffect, useState } from 'react';
import { useStreamingStore } from '../../stores/streamingStore';

interface MockControlsProps {
  channelId: string;
  channelName: string;
}

export function MockControls({ channelId, channelName }: MockControlsProps) {
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** P0-3: when the mock is active, when it auto-expires (mirrors
   *  backend BROKEN_TTL_MS). null = not active. */
  const [mockExpiresAt, setMockExpiresAt] = useState<number | null>(null);
  // P0-3: source health reason from the SSE-driven healthByChannel
  // store. When the mock is active the backend sets it to
  // "mock: source broken" — we surface that string here so the dev
  // bar carries the full mock status (intent + reason) without the
  // user having to hover the SourceStatusBadge.
  const reason = useStreamingStore(s => s.reasonByChannel[channelId] ?? '');

  // Reset toggle + error when the user switches channels — the new
  // channel is presumed not mocked until the user opts in.
  useEffect(() => {
    setActive(false);
    setError(null);
    setMockExpiresAt(null);
  }, [channelId]);

  // P0-3: when the mock is active, flip the toggle back to OFF at
  // the same instant the backend mock auto-expires. Without this the
  // toggle would stay ON forever after the user moved on, drifting
  // from the actual mock state and confusing later demo runs.
  useEffect(() => {
    if (!active || mockExpiresAt === null) return;
    const remaining = mockExpiresAt - Date.now();
    if (remaining <= 0) {
      setActive(false);
      setMockExpiresAt(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setActive(false);
      setMockExpiresAt(null);
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [active, mockExpiresAt]);

  const toggle = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (active) {
        const res = await fetch('/mock/restore', { method: 'POST' });
        if (res.ok) {
          setActive(false);
          setMockExpiresAt(null);
        } else if (res.status === 404) {
          setError('mock injector not available (production build?)');
        } else {
          setError(`HTTP ${res.status}`);
        }
      } else {
        const res = await fetch(`/mock/break/${channelId}`, { method: 'POST' });
        if (res.ok) {
          // Sync the local TTL with the backend's BROKEN_TTL_MS so the
          // auto-flip above lines up with the actual server-side
          // expiry. Falls back to 30s if the response shape ever
          // changes (defensive — the field is set in mockFailure.ts).
          const data = (await res.json().catch(() => ({}))) as { brokenForSec?: number };
          const ttlMs = typeof data.brokenForSec === 'number' ? data.brokenForSec * 1000 : 30_000;
          setActive(true);
          setMockExpiresAt(Date.now() + ttlMs);
        } else if (res.status === 404) {
          setError('mock injector not available (production build?)');
        } else {
          setError(`HTTP ${res.status}`);
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex items-center gap-3"
      data-testid="mock-controls"
    >
      <span className="px-1.5 py-0.5 rounded bg-amber-900/60 text-amber-200 font-mono text-[10px] uppercase tracking-wider font-semibold">
        Dev
      </span>
      <span className="text-sm text-zinc-300">
        Mock-break <span className="text-zinc-400">{channelName}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={active}
        aria-label={`Mock ${active ? 'off' : 'on'} for ${channelName}`}
        onClick={toggle}
        disabled={busy}
        data-testid="mock-toggle"
        className={`relative inline-flex w-10 h-5 rounded-full transition-colors duration-150 ease-out focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${
          active ? 'bg-red-600' : 'bg-zinc-700'
        } ${busy ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span
          aria-hidden="true"
          className={`inline-block w-4 h-4 rounded-full bg-white shadow transform transition-transform duration-150 ease-out ${
            active ? 'translate-x-5' : 'translate-x-0.5'
          } mt-0.5`}
        />
      </button>
      <span
        className={`text-xs font-mono min-w-[2.25rem] ${
          active ? 'text-red-300' : 'text-zinc-500'
        }`}
        data-testid="mock-state"
      >
        {active ? 'ON' : 'OFF'}
      </span>
      {active && reason && (
        <span
          className="text-xs text-zinc-500 font-mono"
          data-testid="mock-reason"
          title="SSE health reason"
        >
          · {reason} <span className="text-zinc-600">(auto-recovers in 30s)</span>
        </span>
      )}
      {error && (
        <span className="text-xs text-red-400" data-testid="mock-error" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}
