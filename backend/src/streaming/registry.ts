/**
 * Channel registry loader + validator.
 * Statically validates at startup; missing field throws (§6.4 discipline).
 */

import { channels, type Channel } from './channels.config.js';

function validate(ch: Channel): void {
  if (!ch.id) throw new Error('[registry] channel missing id');
  if (!ch.name) throw new Error(`[registry] channel ${ch.id} missing name`);
  if (!ch.sport) throw new Error(`[registry] channel ${ch.id} missing sport`);
  if (!ch.primaryUrl) throw new Error(`[registry] channel ${ch.id} missing primaryUrl`);
  if (!ch.primaryUrl.startsWith('http')) {
    throw new Error(`[registry] channel ${ch.id} primaryUrl must be http(s)`);
  }
  if (!ch.masterPath) throw new Error(`[registry] channel ${ch.id} missing masterPath`);
  if (typeof ch.variants !== 'number' || ch.variants < 1) {
    throw new Error(`[registry] channel ${ch.id} variants must be a positive number`);
  }
  if (!Array.isArray(ch.backupUrls) || ch.backupUrls.length === 0) {
    throw new Error(`[registry] channel ${ch.id} must have at least 1 backupUrl`);
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
