// `askwhy price [--since 7d] [--by agent|session|file] [--json]`
// What agent-written changes cost, and $ per line that actually landed.

import { repoRoot } from '../git.js';
import { allRecords, flagValue, linesLanded, parseSince } from '../records.js';

interface Row {
  key: string;
  changes: number;
  usd: number;
  unpriced: number;
  tokens: number;
  turns: number;
  lines: number;
}

function fmtUsd(n: number): string {
  if (n > 0 && n < 0.01) return `$${n.toFixed(4)}`; // per-line costs are often fractions of a cent
  return `$${n.toFixed(2)}`;
}

function fmtK(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`;
}

export function price(cwd: string, args: string[]): number {
  const root = repoRoot(cwd);
  if (!root) {
    process.stderr.write('not inside a git repository\n');
    return 1;
  }
  const since = parseSince(flagValue(args, '--since'));
  const by = flagValue(args, '--by') ?? 'commit';
  const json = args.includes('--json');
  const located = allRecords(root, since);

  const rows = new Map<string, Row>();
  const linesSeen = new Set<string>(); // count each commit+file's landed lines once
  for (const { record: r, commit, subject } of located) {
    const files = [...new Set(r.hunks.map((h) => h.path))];
    const keys =
      by === 'agent'
        ? [r.agent.name + (r.agent.model ? ` · ${r.agent.model}` : '')]
        : by === 'session'
          ? [r.agent.session_id.slice(0, 8)]
          : by === 'file'
            ? files
            : [commit ? `${commit.slice(0, 8)}  ${subject.slice(0, 48)}` : 'pending'];
    const share = by === 'file' ? 1 / Math.max(files.length, 1) : 1; // split a turn's cost across its files
    for (const key of keys) {
      const row = rows.get(key) ?? { key, changes: 0, usd: 0, unpriced: 0, tokens: 0, turns: 0, lines: 0 };
      row.changes += 1;
      if (r.price) {
        if (r.price.usd === null) row.unpriced += 1;
        else row.usd += r.price.usd * share;
        row.tokens += (r.price.input_tokens + r.price.output_tokens + r.price.cache_read_tokens + r.price.cache_write_tokens) * share;
        row.turns += r.price.turns;
      }
      if (commit) {
        const paths = by === 'file' ? [key] : files;
        const fresh = paths.filter((p) => !linesSeen.has(`${key}|${commit}|${p}`));
        fresh.forEach((p) => linesSeen.add(`${key}|${commit}|${p}`));
        row.lines += linesLanded(root, commit, fresh);
      }
      rows.set(key, row);
    }
  }

  const list = [...rows.values()].sort((a, b) => b.usd - a.usd);
  if (json) {
    process.stdout.write(JSON.stringify(list, null, 2) + '\n');
    return 0;
  }
  if (list.length === 0) {
    process.stdout.write('no askwhy records' + (since ? ` since ${since.slice(0, 10)}` : '') + '\n');
    return 1;
  }
  const keyW = Math.min(Math.max(...list.map((r) => r.key.length), 6), 64);
  const head = `${'by ' + by}`.padEnd(keyW) + '  changes      cost   tokens  lines landed   $/line';
  process.stdout.write(head + '\n' + '-'.repeat(head.length) + '\n');
  let tot = { usd: 0, lines: 0, tokens: 0, changes: 0, unpriced: 0 };
  for (const r of list) {
    const perLine = r.lines > 0 && r.usd > 0 ? fmtUsd(r.usd / r.lines) : '-';
    const cost = fmtUsd(r.usd) + (r.unpriced ? '*' : '');
    process.stdout.write(
      `${r.key.slice(0, keyW).padEnd(keyW)}  ${String(r.changes).padStart(7)}  ${cost.padStart(8)}  ${fmtK(r.tokens).padStart(7)}  ${String(r.lines).padStart(12)}  ${perLine.padStart(7)}\n`,
    );
    tot = { usd: tot.usd + r.usd, lines: tot.lines + r.lines, tokens: tot.tokens + r.tokens, changes: tot.changes + r.changes, unpriced: tot.unpriced + r.unpriced };
  }
  process.stdout.write('-'.repeat(head.length) + '\n');
  process.stdout.write(
    `${'total'.padEnd(keyW)}  ${String(tot.changes).padStart(7)}  ${fmtUsd(tot.usd).padStart(8)}  ${fmtK(tot.tokens).padStart(7)}  ${String(tot.lines).padStart(12)}  ${(tot.lines && tot.usd ? fmtUsd(tot.usd / tot.lines) : '-').padStart(7)}\n`,
  );
  if (tot.unpriced) process.stdout.write(`\n* ${tot.unpriced} change(s) on a model with no price entry; add it to .git/why/prices.json\n`);
  return 0;
}
