// Read token usage for one turn out of a Claude Code transcript (JSONL).
// Each assistant line carries message.usage and a timestamp; we sum the
// lines at or after the turn's start. The transcript may lag the final
// message at Stop time (documented), so the last request can be missing;
// the record still prices what it saw and never estimates.

import { existsSync, readFileSync } from 'node:fs';
import type { Price } from './record.js';
import { emptyPrice } from './record.js';
import { loadRates, rateFor, usd } from './prices.js';

interface UsageLine {
  type?: string;
  timestamp?: string;
  message?: {
    model?: string;
    id?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

export interface TurnUsage {
  price: Price;
  model: string | undefined;
}

export function usageSince(transcriptPath: string, sinceIso: string | null, cwd: string): TurnUsage | null {
  if (!transcriptPath || !existsSync(transcriptPath)) return null;
  const since = sinceIso ? Date.parse(sinceIso) : 0;
  const price = emptyPrice();
  let model: string | undefined;
  const seen = new Set<string>(); // the same API response can appear twice in a transcript
  for (const line of readFileSync(transcriptPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let o: UsageLine;
    try {
      o = JSON.parse(line) as UsageLine;
    } catch {
      continue;
    }
    if (o.type !== 'assistant' || !o.message?.usage) continue;
    if (o.timestamp && Date.parse(o.timestamp) < since) continue;
    const key = o.message.id ?? line;
    if (seen.has(key)) continue;
    seen.add(key);
    const u = o.message.usage;
    price.input_tokens += u.input_tokens ?? 0;
    price.output_tokens += u.output_tokens ?? 0;
    price.cache_read_tokens += u.cache_read_input_tokens ?? 0;
    price.cache_write_tokens += u.cache_creation_input_tokens ?? 0;
    price.turns += 1;
    if (o.message.model) model = o.message.model;
  }
  if (price.turns === 0) return null;
  price.usd = usd(
    { in: price.input_tokens, out: price.output_tokens, cache_read: price.cache_read_tokens, cache_write: price.cache_write_tokens },
    rateFor(model, loadRates(cwd)),
  );
  return { price, model };
}
