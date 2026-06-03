/**
 * Axis Live Streaming — Service Worker (P1)
 *
 * Scope:
 *   - Cache static assets (HTML / JS / CSS) for instant reloads and offline.
 *   - Network-first for /channels with cache fallback (short window).
 *   - Pass-through for HLS segments, SSE, and API (always live).
 *
 * Out of scope:
 *   - Master / variant manifest caching (HTTP cache + SWR is enough; SW
 *     caching them risks stale channel list).
 *   - Push notifications, background sync.
 *
 * Bump STATIC_VERSION / CHANNELS_VERSION to invalidate on deploy.
 */

const STATIC_VERSION = 'static-v1';
const CHANNELS_VERSION = 'channels-v1';

const STATIC_CACHE = `axis-static-${STATIC_VERSION}`;
const CHANNELS_CACHE = `axis-channels-${CHANNELS_VERSION}`;

/** Skip-list: always go to network. */
function isPassthrough(pathname) {
  return (
    pathname.startsWith('/hls/') ||
    pathname === '/events' ||
    pathname.startsWith('/api/')
  );
}

self.addEventListener('install', event => {
  // Pre-cache the app shell so the first offline load isn't blank.
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache =>
      cache.addAll(['/']).catch(() => {
        // / may 404 in some dev configs; not fatal.
      }),
    ).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  // Drop old cache versions on activate.
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== STATIC_CACHE && k !== CHANNELS_CACHE)
          .map(k => caches.delete(k)),
      ),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Only handle same-origin requests.
  if (url.origin !== self.location.origin) return;

  if (isPassthrough(url.pathname)) return; // streaming / live data — always network

  if (url.pathname === '/channels') {
    event.respondWith(networkFirst(request, CHANNELS_CACHE));
    return;
  }

  // Same-origin static asset.
  event.respondWith(cacheFirst(request, STATIC_CACHE));
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response('', { status: 504, statusText: 'offline' });
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    // Refresh in the background (stale-while-revalidate flavor).
    fetch(request)
      .then(response => {
        if (response && response.ok) cache.put(request, response.clone());
      })
      .catch(() => { /* offline, keep cached */ });
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 504, statusText: 'offline' });
  }
}
