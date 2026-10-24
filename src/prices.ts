// USD per million tokens. Only models we are confident about are listed;
// anything else prices as null and the record says so. Override or extend
// with <gitdir>/why/prices.json: { "<model id>": { "in": 3, "out": 15, "cache_read": 0.3, "cache_write": 3.75 } }

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateDir } from './git.js';

export interface Rate {
  in: number;
  out: number;
  cache_read: number;
  cache_write: number;
  cache_write_1h?: number;
}

// From platform.claude.com/docs/en/about-claude/pricing, 2026-10-24.
// cache_write is the 5-minute rate; cache_write_1h is used when the transcript
// splits cache creation by TTL. Haiku 5.5 uses the <=100k-prompt tier.
const BUILT_IN: Record<string, Rate> = {
  'claude-fable-5-1': { in: 10, out: 50, cache_read: 0.25, cache_write: 12.5, cache_write_1h: 20 },
  'claude-mythos-5-1': { in: 10, out: 50, cache_read: 0.25, cache_write: 12.5, cache_write_1h: 20 },
  'claude-fable-5': { in: 10, out: 50, cache_read: 1, cache_write: 12.5, cache_write_1h: 20 },
  'claude-mythos-5': { in: 10, out: 50, cache_read: 1, cache_write: 12.5, cache_write_1h: 20 },
  'claude-opus-5-5': { in: 4, out: 20, cache_read: 0.2, cache_write: 5, cache_write_1h: 8 },
  'claude-opus-5': { in: 5, out: 25, cache_read: 0.5, cache_write: 6.25, cache_write_1h: 10 },
  'claude-opus-4-8': { in: 5, out: 25, cache_read: 0.5, cache_write: 6.25, cache_write_1h: 10 },
  'claude-opus-4-7': { in: 5, out: 25, cache_read: 0.5, cache_write: 6.25, cache_write_1h: 10 },
  'claude-opus-4-6': { in: 5, out: 25, cache_read: 0.5, cache_write: 6.25, cache_write_1h: 10 },
  'claude-opus-4-5': { in: 5, out: 25, cache_read: 0.5, cache_write: 6.25, cache_write_1h: 10 },
  'claude-opus-4-1': { in: 15, out: 75, cache_read: 1.5, cache_write: 18.75, cache_write_1h: 30 },
  'claude-opus-4': { in: 15, out: 75, cache_read: 1.5, cache_write: 18.75, cache_write_1h: 30 },
  'claude-sonnet-5-5': { in: 2, out: 10, cache_read: 0.1, cache_write: 2.5, cache_write_1h: 4 },
  'claude-sonnet-5': { in: 2, out: 10, cache_read: 0.2, cache_write: 2.5, cache_write_1h: 4 },
  'claude-sonnet-4-6': { in: 3, out: 15, cache_read: 0.3, cache_write: 3.75, cache_write_1h: 6 },
  'claude-sonnet-4-5': { in: 3, out: 15, cache_read: 0.3, cache_write: 3.75, cache_write_1h: 6 },
  'claude-sonnet-4': { in: 3, out: 15, cache_read: 0.3, cache_write: 3.75, cache_write_1h: 6 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cache_read: 0.01, cache_write: 0.125, cache_write_1h: 0.2 },
  'claude-haiku-4-5': { in: 1, out: 5, cache_read: 0.1, cache_write: 1.25, cache_write_1h: 2 },
  'claude-3-5-haiku': { in: 0.8, out: 4, cache_read: 0.08, cache_write: 1, cache_write_1h: 1.6 },
};

export function loadRates(cwd: string): Record<string, Rate> {
  const dir = stateDir(cwd);
  const file = dir ? join(dir, 'prices.json') : null;
  if (!file || !existsSync(file)) return BUILT_IN;
  try {
    return { ...BUILT_IN, ...(JSON.parse(readFileSync(file, 'utf8')) as Record<string, Rate>) };
  } catch {
    return BUILT_IN;
  }
}

// Match "claude-sonnet-4-5-20250929" to "claude-sonnet-4-5" by longest prefix.
export function rateFor(model: string | undefined, rates: Record<string, Rate>): Rate | null {
  if (!model) return null;
  if (rates[model]) return rates[model];
  let best: string | null = null;
  for (const key of Object.keys(rates)) {
    if (model.startsWith(key) && (!best || key.length > best.length)) best = key;
  }
  return best ? rates[best] : null;
}

export function usd(
  tokens: { in: number; out: number; cache_read: number; cache_write: number; cache_write_1h?: number },
  rate: Rate | null,
): number | null {
  if (!rate) return null;
  const w1h = tokens.cache_write_1h ?? 0;
  const v =
    (tokens.in * rate.in +
      tokens.out * rate.out +
      tokens.cache_read * rate.cache_read +
      (tokens.cache_write - w1h) * rate.cache_write +
      w1h * (rate.cache_write_1h ?? rate.cache_write)) /
    1_000_000;
  return Math.round(v * 10000) / 10000;
}
