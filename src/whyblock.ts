// Parse the structured `why:` block an agent is asked to emit at the end of
// a turn that edited files. Format (fenced, language tag `why`):
//
// ```why
// decision: Chose retry-with-jitter over circuit breaker
// reason: upstream is flaky, not down; a breaker would hide the 5xx we alert on
// rejected: circuit breaker | would mask the 5xx we need to alert on
// rejected: plain retry | thundering herd on recovery
// ```
//
// Anything missing stays empty; the record's `source` says where it came from.

import type { Rejected, Why } from './record.js';

const FENCE = /```why\s*\n([\s\S]*?)```/g;

export function parseWhyBlock(text: string): Why | null {
  let last: string | null = null;
  for (const m of text.matchAll(FENCE)) last = m[1];
  if (last === null) return null;

  let decision = '';
  let reason = '';
  const rejected: Rejected[] = [];
  for (const raw of last.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'decision') decision = value;
    else if (key === 'reason') reason = value;
    else if (key === 'rejected') {
      const bar = value.indexOf('|');
      rejected.push(
        bar === -1
          ? { option: value, reason: '' }
          : { option: value.slice(0, bar).trim(), reason: value.slice(bar + 1).trim() },
      );
    }
  }
  if (!decision && !reason && rejected.length === 0) return null;
  return { decision, reason, rejected, source: 'agent' };
}
