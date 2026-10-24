// `git why <path>[:<line>]`
// With a line: blame it to the commit that last touched it, read that commit's
// records, and print the one whose hunk covers the line in that commit's
// coordinates. Without a line: every record that touched the file, newest first.

import { repoRoot, toRepoPath, tryGit } from '../git.js';
import { notedCommits, readRecords } from '../notes.js';
import { readPending } from '../pending.js';
import type { Hunk, Proof, Record } from '../record.js';
import { afterLastEdit } from './receipt.js';
import { displayCommand } from '../proof.js';
import { isAbsolute, resolve } from 'node:path';

interface Target {
  path: string;
  line: number | null;
}

export function parseTarget(root: string, arg: string): Target {
  const m = /^(.*?)(?::(\d+))?$/.exec(arg);
  const raw = m?.[1] ?? arg;
  const line = m?.[2] ? Number(m[2]) : null;
  const abs = isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
  return { path: toRepoPath(root, abs), line };
}

interface BlameHit {
  sha: string;
  origLine: number;
}

function blameLine(root: string, path: string, line: number): BlameHit | null {
  const out = tryGit(['blame', '--porcelain', '-L', `${line},${line}`, '--', path], root);
  if (!out) return null;
  const first = out.split('\n')[0];
  const parts = first.split(' ');
  if (parts.length < 3) return null;
  return { sha: parts[0], origLine: Number(parts[1]) };
}

function covers(h: Hunk, line: number): boolean {
  return h.new_range !== null && line >= h.new_range[0] && line <= h.new_range[1];
}

export function formatRecord(r: Record, path: string, line: number | null): string {
  const hunks = r.hunks.filter((h) => h.path === path);
  const span = hunks.find((h) => line !== null && covers(h, line)) ?? hunks[0];
  const range = span?.new_range ? `${span.new_range[0]}-${span.new_range[1]}` : 'whole file';
  const agent = `${r.agent.name}${r.agent.model ? ` · ${r.agent.model}` : ''}`;
  const after = r.proof.filter((p) => afterLastEdit(r, p));
  const proofAfter = after.filter((p) => p.kind !== 'other');
  const fmt = (p: Proof) => `${displayCommand(p.cmd).slice(0, 60)} · ${p.summary} · exit ${p.exit ?? '?'}`;
  const proofLine =
    proofAfter.length > 0
      ? proofAfter.map(fmt).join('\n           ')
      : after.length > 0
        ? `no test/build/lint/typecheck after the last edit; also ran: ${fmt(after[after.length - 1])}`
        : r.proof.some((p) => p.kind !== 'other')
          ? `nothing ran after the last edit (earlier: ${[...new Set(r.proof.filter((p) => p.kind !== 'other').map((p) => p.kind))].join(', ')})`
          : 'nothing ran';
  const price = r.price
    ? `${r.price.usd === null ? 'unpriced model' : `$${r.price.usd.toFixed(2)}`} · ${Math.round((r.price.input_tokens + r.price.output_tokens + r.price.cache_read_tokens + r.price.cache_write_tokens) / 1000)}k tokens · ${r.price.turns} turn${r.price.turns === 1 ? '' : 's'}`
    : 'not recorded';
  const lines = [`${path}:${range}${r.commit ? `  (${r.commit.slice(0, 8)})` : '  (pending, not committed)'}`];
  if (r.why.source === 'none') lines.push('  why      no recorded intent');
  else {
    lines.push(`  why      ${r.why.decision}`);
    if (r.why.reason) lines.push(`  because  ${r.why.reason}`);
    for (const rej of r.why.rejected) lines.push(`  rejected ${rej.option}${rej.reason ? ` (${rej.reason})` : ''}`);
  }
  if (r.prompt) {
    const p = r.prompt.text.replace(/\s+/g, ' ');
    lines.push(`  prompt   "${p.length > 110 ? p.slice(0, 107) + '...' : p}"`);
    lines.push(`  agent    ${agent}`);
  }
  else lines.push(`  agent    ${agent} (prompt not captured)`);
  lines.push(`  proof    ${proofLine}`);
  lines.push(`  price    ${price}`);
  return lines.join('\n');
}

export function why(cwd: string, args: string[]): number {
  const root = repoRoot(cwd);
  if (!root) {
    process.stderr.write('not inside a git repository\n');
    return 1;
  }
  const json = args.includes('--json');
  const target = args.find((a) => !a.startsWith('--'));
  if (!target) {
    process.stderr.write('usage: git why <path>[:<line>]\n');
    return 2;
  }
  const { path, line } = parseTarget(root, target);

  let matches: Record[] = [];
  if (line !== null) {
    const hit = blameLine(root, path, line);
    if (hit) {
      const recs = readRecords(root, hit.sha).filter((r) => r.hunks.some((h) => h.path === path));
      matches = recs.filter((r) => r.hunks.some((h) => h.path === path && covers(h, hit.origLine)));
      if (matches.length === 0) matches = recs; // commit touched the file but ranges were whole-file
      if (matches.length === 0 && hit.sha.startsWith('0000000')) {
        // uncommitted line: look in pending
        matches = readPending(root).filter((r) => !r.commit && r.hunks.some((h) => h.path === path));
      }
    }
  } else {
    for (const sha of notedCommits(root)) {
      for (const r of readRecords(root, sha)) if (r.hunks.some((h) => h.path === path)) matches.push(r);
    }
    for (const r of readPending(root)) if (!r.commit && r.hunks.some((h) => h.path === path)) matches.unshift(r);
  }

  if (json) {
    process.stdout.write(JSON.stringify(matches, null, 2) + '\n');
    return 0;
  }
  if (matches.length === 0) {
    process.stdout.write(`${path}${line !== null ? `:${line}` : ''}: no askwhy record (not written by a hooked agent, or written before askwhy init)\n`);
    return 1;
  }
  process.stdout.write(matches.map((r) => formatRecord(r, path, line)).join('\n\n') + '\n');
  return 0;
}
