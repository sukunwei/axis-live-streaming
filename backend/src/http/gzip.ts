/**
 * HTTP gzip helper for text/JSON responses.
 *
 * Why here, not in proxy.ts: every text-typed handler (channels list,
 * manifests, JSON APIs) wants the same Accept-Encoding check + Vary header
 * + content-length handling. Segments (.ts / .m4s) are skipped — the
 * payloads are already video-compressed and gzipping them just burns CPU
 * for a 0-1% size delta.
 *
 * Behavior:
 *   - `Accept-Encoding: gzip` → gzip body, set Content-Encoding, Vary
 *   - anything else            → send raw, set Content-Length
 *   - the caller is responsible for status code & ETag/Last-Modified
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { gzipSync } from 'node:zlib';

export interface GzipOptions {
  /** HTTP status code. */
  status: number;
  /** Content-Type header (e.g. 'application/json'). */
  contentType: string;
  /** Body to send. Will be stringified as UTF-8 when uncompressed. */
  body: string;
  /** Any additional headers to merge in (e.g. Cache-Control). */
  extra?: Record<string, string | number | undefined>;
}

export function sendGzipped(req: IncomingMessage, res: ServerResponse, opts: GzipOptions): void {
  const accept = (req.headers['accept-encoding'] ?? '') as string;
  const extra: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(opts.extra ?? {})) {
    if (v !== undefined) extra[k] = v;
  }
  if (accept.includes('gzip')) {
    const compressed = gzipSync(Buffer.from(opts.body, 'utf8'));
    res.writeHead(opts.status, {
      'Content-Type': opts.contentType,
      'Content-Encoding': 'gzip',
      'Vary': 'Accept-Encoding',
      'Content-Length': compressed.length,
      ...extra,
    });
    res.end(compressed);
    return;
  }
  const buf = Buffer.from(opts.body, 'utf8');
  res.writeHead(opts.status, {
    'Content-Type': opts.contentType,
    'Content-Length': buf.length,
    ...extra,
  });
  res.end(buf);
}
