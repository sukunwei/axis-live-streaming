/**
 * HLS proxy — manifest rewrite + segment streaming.
 *
 * Path:
 *   GET /hls/:channel/<relative-path>
 *
 *   <relative-path> is the relative path from the channel primaryUrl, e.g.:
 *     /hls/nasa/master.m3u8        → upstream is the channel primaryUrl itself
 *     /hls/nasa/v1/prog_index.m3u8 → upstream = primaryUrl dir + v1/prog_index.m3u8
 *     /hls/nasa/seg-001.ts         → upstream = primaryUrl dir + seg-001.ts
 *
 * Key constraints:
 *   - manifest must be rewritten to same-origin URL (§3.3 source-hiding + fanout)
 *   - segments must be `pipe()`-streamed; await getBuffer() then res.end() is forbidden (§4.1 LL-HLS dependency)
 *   - manifest Cache-Control: public, max-age=2 (§final-hls) + in-process 2s upstream cache
 *   - segment Cache-Control: public, max-age=30 (multi-viewer reuse)
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';
import type { IncomingMessage, ServerResponse } from 'http';
import type { RequestOptions } from 'http';
import { getChannel } from './registry.js';
import { isBroken } from './mockFailure.js';
import { LruCache } from './manifestCache.js';
import { sendGzipped } from '../http/gzip.js';

const SEGMENT_TTL_SEC = 30;
const MANIFEST_CACHE_TTL_MS = 2_000;
const MANIFEST_CACHE_CONTROL = 'public, max-age=2';
const UPSTREAM_TIMEOUT_MS = 10_000;
const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days
/** Upper bound on cached manifest entries. Maps preserve insertion order
 *  in V8, so we use that to evict the oldest entry when over capacity. */
const MANIFEST_CACHE_MAX_ENTRIES = 100;
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 32, maxFreeSockets: 8 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 32, maxFreeSockets: 8 });

const inflightManifest = new Map<string, Promise<FetchedText>>();
const upstreamManifestCache = new LruCache<string, { fetched: FetchedText; expiresAt: number }>(
  MANIFEST_CACHE_MAX_ENTRIES,
);

function upstreamGetOptions(parsed: URL): RequestOptions {
  return {
    agent: parsed.protocol === 'https:' ? httpsAgent : httpAgent,
    headers: { 'User-Agent': BROWSER_UA, Accept: '*/*' },
  };
}

export async function handleHlsProxy(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const parts = url.pathname.split('/').filter(Boolean); // ['hls', ':ch', ...rest]
  if (parts.length < 3) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('bad path: expected /hls/:channel/*');
    return;
  }
  const [, channelId, ...rest] = parts;
  const ch = getChannel(channelId);
  if (!ch) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('channel not found');
    return;
  }

  // mock injection (M3.5 demo use)
  if (isBroken(channelId)) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('mock: source broken (will auto-recover)');
    return;
  }

  try {
    // -- /hls/:channel/p?u=<base64> cross-domain proxy (M3.6 enhancement) ----
    if (rest[0] === 'p') {
      const upstreamUrl = decodeProxyUrl(url.searchParams.get('u'));
      if (!upstreamUrl) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('bad u param');
        return;
      }
      if (upstreamUrl.endsWith('.m3u8')) {
        const { text } = await fetchTextCached(upstreamUrl);
        const rewritten = rewriteManifest(text, channelId, ch.primaryUrl, upstreamUrl, false);
        sendGzipped(req, res, {
          status: 200,
          contentType: 'application/vnd.apple.mpegurl',
          body: rewritten,
          extra: {
            'Cache-Control': MANIFEST_CACHE_CONTROL,
            'Access-Control-Allow-Origin': '*',
          },
        });
      } else {
        await proxySegment(req, res, upstreamUrl);
      }
      return;
    }

    // No leading '/': new URL('master.m3u8', base) resolves relatively; new URL('/master.m3u8', base) replaces the whole path
    // Must resolve to primary's **directory** (strip the last filename), else the last segment gets treated as a file and replaced
    const relPath = rest.join('/');
    const primary = new URL(ch.primaryUrl);
    const primaryDir =
      primary.origin + primary.pathname.substring(0, primary.pathname.lastIndexOf('/') + 1);
    const upstream = new URL(relPath, primaryDir);
    const upstreamUrl = upstream.toString();
    const isLive = ch.live;

    if (relPath.endsWith('.m3u8')) {
      const isMaster = upstream.pathname === new URL(ch.primaryUrl).pathname;
      await proxyManifest(req, res, upstreamUrl, ch.primaryUrl, channelId, isMaster, isLive);
      return;
    }
    await proxySegment(req, res, upstreamUrl);
  } catch (err) {
    if (res.writableEnded) return;  // response already ended by prior code
    console.error('[proxy] error', {
      channelId,
      relPath: rest.join('/'),
      err: (err as Error).message,
    });
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
    }
    if (!res.writableEnded) {
      res.end('upstream error');
    }
  }
}

// -- manifest: Fetch upstream → rewrite segment URLs → return ----------------------
async function proxyManifest(
  req: IncomingMessage,
  res: ServerResponse,
  upstreamUrl: string,
  primaryUrl: string,
  channelId: string,
  isMaster: boolean,
  isLive: boolean,
): Promise<void> {
  const { text, lastModified } = await fetchTextCached(upstreamUrl);

  // Improvement 1: stale master detection (LIVE sources only; uses config.live field)
  if (isLive && lastModified !== null) {
    const age = Date.now() - lastModified;
    if (age > STALE_THRESHOLD_MS) {
      const days = Math.floor(age / 86_400_000);
      throw new Error(`stale master: last-modified ${days} days ago`);
    }
  }

  // Improvement 2: pre-check first variant reachable (LIVE + master only; catches "master 200 but variants 404" hidden failure)
  if (isLive && isMaster) {
    const firstVariant = parseFirstVariant(text);
    if (firstVariant) {
      const ok = await headOk(firstVariant, upstreamUrl);
      if (!ok) {
        throw new Error('first variant unreachable');
      }
    }
  }

  const rewritten = rewriteManifest(text, channelId, primaryUrl, upstreamUrl, isMaster);
  sendGzipped(req, res, {
    status: 200,
    contentType: 'application/vnd.apple.mpegurl',
    body: rewritten,
    extra: {
      'Cache-Control': MANIFEST_CACHE_CONTROL,
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function rewriteManifest(
  manifest: string,
  channelId: string,
  primaryUrl: string,
  baseUrl: string,
  isMaster: boolean,
): string {
  return manifest
    .split('\n')
    .map(line => rewriteLine(line, channelId, primaryUrl, baseUrl, isMaster))
    .join('\n');
}

function rewriteLine(
  line: string,
  channelId: string,
  primaryUrl: string,
  baseUrl: string,
  isMaster: boolean,
): string {
  const t = line.trim();
  if (!t) return line;
  if (t.startsWith('#')) {
    // Rewrite URI= attribute on variants (HLS spec allows EXT-X-MEDIA / EXT-X-I-FRAME-STREAM-INF)
    if (t.startsWith('#EXT-X-MEDIA') || t.startsWith('#EXT-X-I-FRAME-STREAM-INF')) {
      return line.replace(/URI="([^"]+)"/, (_m, uri: string) => {
        const rewritten = toProxyPath(uri, baseUrl, primaryUrl, channelId);
        return `URI="${rewritten}"`;
      });
    }
    return line;
  }
  // segment / variant URL line
  return toProxyPath(t, baseUrl, primaryUrl, channelId);
}

/**
 * Convert upstream URL to same-origin proxy path.
 *
 * Same domain: use relative path (cleaner for human inspection)
 * Cross-domain: encode full URL into ?u=<base64> so proxy can fetch (France 24-type sources)
 */
function toProxyPath(
  upstreamUri: string,
  baseUrl: string,
  primaryUrl: string,
  channelId: string,
): string {
  const abs = new URL(upstreamUri, baseUrl).toString();
  const rel = makeRelativeFromPrimary(abs, primaryUrl);
  if (rel.startsWith('http://') || rel.startsWith('https://')) {
    // cross-domain: encode the entire URL
    return `/hls/${channelId}/p?u=${encodeURIComponent(Buffer.from(abs).toString('base64'))}`;
  }
  return `/hls/${channelId}/${rel}`;
}

function makeRelativeFromPrimary(absoluteUrl: string, primaryUrl: string): string {
  const abs = new URL(absoluteUrl);
  const primary = new URL(primaryUrl);
  if (abs.host !== primary.host) {
    // cross-domain: return the original URL, caller detects http:// prefix and switches to encoded path
    return abs.toString();
  }
  // primary dir: strip the filename
  const primaryDir = primary.pathname.substring(0, primary.pathname.lastIndexOf('/') + 1);
  if (abs.pathname.startsWith(primaryDir)) {
    return abs.pathname.substring(primaryDir.length);
  }
  // fallback: strip leading /
  return abs.pathname.replace(/^\//, '');
}

/**
 * Decode ?u=<base64> to get upstream URL.
 * Returning null indicates a format error.
 */
function decodeProxyUrl(u: string | null): string | null {
  if (!u) return null;
  try {
    return Buffer.from(decodeURIComponent(u), 'base64').toString('utf8');
  } catch {
    return null;
  }
}

// -- segment: stream pipe upstream segments to client ----------------------
function proxySegment(req: IncomingMessage, res: ServerResponse, upstreamUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.writeHead(504, { 'Content-Type': 'text/plain' });
        res.end('upstream timeout');
      }
      settle(() => reject(new Error('upstream timeout')));
    }, UPSTREAM_TIMEOUT_MS);

    const follow = (url: string, redirectCount = 0): void => {
      if (redirectCount > 5) {
        settle(() => reject(new Error('too many redirects')));
        return;
      }
      const parsed = new URL(url);
      const mod = parsed.protocol === 'https:' ? https : http;
      const upstreamReq = mod.get(parsed, upstreamGetOptions(parsed), msg => {
        // follow 3xx
        if (msg.statusCode && msg.statusCode >= 300 && msg.statusCode < 400 && msg.headers.location) {
          msg.resume();
          upstreamReq.destroy();  // close the old request socket
          const next = new URL(msg.headers.location, url).toString();
          follow(next, redirectCount + 1);
          return;
        }
        if (settled || res.headersSent) return;  // prevent ERR_HTTP_HEADERS_SENT
        const status = msg.statusCode ?? 502;

        // Conditional GET: if client sent If-Modified-Since and upstream's
        // Last-Modified is unchanged, return 304 with no body. Saves the
        // full segment bytes on revalidation (browser cache, multi-tab).
        const upstreamLm = msg.headers['last-modified'];
        const clientIms = req.headers['if-modified-since'];
        if (status === 200 && upstreamLm && clientIms && upstreamLm === clientIms) {
          res.writeHead(304, {
            'Cache-Control': `public, max-age=${SEGMENT_TTL_SEC}, immutable`,
            'Access-Control-Allow-Origin': '*',
            'Last-Modified': upstreamLm,
          });
          msg.resume();
          return settle(resolve);
        }

        // Build response headers. `immutable` lets the browser skip
        // revalidation within max-age (live segments don't change once
        // published).
        const headers: Record<string, string | number> = {
          'Content-Type': msg.headers['content-type'] ?? 'video/mp2t',
          'Cache-Control': `public, max-age=${SEGMENT_TTL_SEC}, immutable`,
          'Access-Control-Allow-Origin': '*',
        };
        if (upstreamLm) headers['Last-Modified'] = upstreamLm;

        try {
          res.writeHead(status, headers);
        } catch {
          settle(() => reject(new Error('writeHead failed')));
          return;
        }
        msg.pipe(res);
        msg.on('end', () => settle(resolve));
        msg.on('error', err => settle(() => reject(err)));
      });
      upstreamReq.on('error', err => settle(() => reject(err)));
    };
    follow(upstreamUrl);
  });
}

// -- manifest text fetch (not streamed, needs rewriting; follow 3xx) -------
interface FetchedText {
  text: string;
  lastModified: number | null;  // ms timestamp
}

/** Single in-flight upstream fetch per URL (request collapsing). */
function fetchTextShared(key: string, fetchFn: () => Promise<FetchedText>): Promise<FetchedText> {
  const existing = inflightManifest.get(key);
  if (existing) return existing;
  const p = fetchFn().finally(() => {
    inflightManifest.delete(key);
  });
  inflightManifest.set(key, p);
  return p;
}

/** 2s in-process cache + collapsing — multi-tab / prefetch share one upstream hit. */
async function fetchTextCached(upstreamUrl: string): Promise<FetchedText> {
  const now = Date.now();
  const hit = upstreamManifestCache.get(upstreamUrl);  // bumps LRU
  if (hit && hit.expiresAt > now) return hit.fetched;
  const fetched = await fetchTextShared(`manifest:${upstreamUrl}`, () => fetchText(upstreamUrl));
  upstreamManifestCache.set(upstreamUrl, { fetched, expiresAt: now + MANIFEST_CACHE_TTL_MS });
  return fetched;
}

function fetchText(upstreamUrl: string): Promise<FetchedText> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('upstream timeout')), UPSTREAM_TIMEOUT_MS);
    const follow = (url: string, redirectCount = 0): void => {
      if (redirectCount > 5) { reject(new Error('too many redirects')); return; }
      const parsed = new URL(url);
      const mod = parsed.protocol === 'https:' ? https : http;
      mod.get(parsed, upstreamGetOptions(parsed), res => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          follow(new URL(res.headers.location, url).toString(), redirectCount + 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`upstream status ${res.statusCode}`));
          return;
        }
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', c => (buf += c));
        res.on('end', () => {
          clearTimeout(timer);
          const lmHeader = res.headers['last-modified'];
          const lastModified = lmHeader ? Date.parse(lmHeader) : null;
          resolve({ text: buf, lastModified: Number.isNaN(lastModified) ? null : lastModified });
        });
        res.on('error', err => { clearTimeout(timer); reject(err); });
      }).on('error', err => { clearTimeout(timer); reject(err); });
    };
    follow(upstreamUrl);
  });
}

/** Get the first non-comment line from manifest (first variant URL) */
function parseFirstVariant(manifest: string): string | null {
  for (const line of manifest.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    return t;
  }
  return null;
}

/** HEAD the first variant; 200/206 is treated as OK */
function headOk(upstreamUri: string, baseUrl: string): Promise<boolean> {
  return new Promise(resolve => {
    const abs = new URL(upstreamUri, baseUrl);
    const mod = abs.protocol === 'https:' ? https : http;
    const timer = setTimeout(() => resolve(false), 5_000);
    const req = mod.request(abs, { ...upstreamGetOptions(abs), method: 'HEAD' }, res => {
      clearTimeout(timer);
      res.resume();
      const code = res.statusCode ?? 0;
      resolve(code >= 200 && code < 400);
    });
    req.on('error', () => { clearTimeout(timer); resolve(false); });
    req.end();
  });
}
