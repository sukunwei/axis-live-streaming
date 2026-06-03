/**
 * Channel registry loader + validator.
 * Statically validates at startup; missing field throws (§6.4 discipline).
 *
 * Note: backupUrls is now optional (empty array is legal). The original
 * "at least 1 backup" rule assumed the SSE-driven failover always has a
 * target. With the current schema — where backupUrls points to OTHER
 * channels rather than "same content from a different CDN" — that
 * assumption is wrong (the failover ships the user to wrong content).
 * Some channels (livestar is the first) have no same-content backup,
 * so we leave the slot empty and rely on the source-hiding / fault
 * reporting paths instead of misdirecting the user.
 */

import { channels, type Channel } from './channels.config.js';

function validate(ch: Channel): void {
  if (!ch.id) throw new Error('[registry] channel missing id');
  if (!ch.name) throw new Error(`[registry] channel ${ch.id} missing name`);
  if (!ch.sport) throw new Error(`[registry] channel ${ch.id} missing sport`);
  if (!ch.category) throw new Error(`[registry] channel ${ch.id} missing category`);
  if (!['sports', 'others'].includes(ch.category)) {
    throw new Error(`[registry] channel ${ch.id} category must be 'sports' or 'others'`);
  }
  if (!ch.primaryUrl) throw new Error(`[registry] channel ${ch.id} missing primaryUrl`);
  if (!ch.primaryUrl.startsWith('http')) {
    throw new Error(`[registry] channel ${ch.id} primaryUrl must be http(s)`);
  }
  if (!ch.masterPath) throw new Error(`[registry] channel ${ch.id} missing masterPath`);
  if (typeof ch.variants !== 'number' || ch.variants < 1) {
    throw new Error(`[registry] channel ${ch.id} variants must be a positive number`);
  }
  // backupUrls is now optional; see file header for why.
  if (!Array.isArray(ch.backupUrls)) {
    throw new Error(`[registry] channel ${ch.id} backupUrls must be an array (can be empty)`);
  }
}

for (const c of channels) validate(c);

const byId = new Map<string, Channel>(channels.map(c => [c.id, c]));

export function getChannels(): readonly Channel[] {
  return channels;
}

export function getChannel(id: string): Channel | undefined {
  return byId.get(id);
}
