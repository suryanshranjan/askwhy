// Gather records across commits and pending, with git metadata for views.

import { tryGit } from './git.js';
import { notedCommits, readRecords } from './notes.js';
import { readPending } from './pending.js';
import type { Record } from './record.js';

export interface Located {
  record: Record;
  commit: string | null; // null = pending
  subject: string;
  date: string; // ISO, commit date or record prompt time
}

export function allRecords(root: string, sinceIso: string | null = null, includePending = true): Located[] {
  const out: Located[] = [];
  for (const sha of notedCommits(root)) {
    const meta = tryGit(['show', '-s', '--format=%cI%x00%s', sha], root) ?? '';
    const [date, subject] = meta.split('\u0000');
    if (sinceIso && date && Date.parse(date) < Date.parse(sinceIso)) continue;
    for (const r of readRecords(root, sha)) out.push({ record: r, commit: sha, subject: subject ?? '', date: date ?? '' });
  }
  if (includePending) {
    for (const r of readPending(root)) {
      if (r.commit) continue;
      const date = r.prompt?.ts ?? r.hunks[0]?.ts ?? '';
      if (sinceIso && date && Date.parse(date) < Date.parse(sinceIso)) continue;
      out.push({ record: r, commit: null, subject: '(pending)', date });
    }
  }
  return out;
}

// Lines added in a commit for the files a record touched (from git, not from
// the record), so $/line is measured against what actually landed.
export function linesLanded(root: string, sha: string, paths: string[]): number {
  if (paths.length === 0) return 0;
  const out = tryGit(['show', '--numstat', '--format=', sha, '--', ...paths], root);
  if (!out) return 0;
  let added = 0;
  for (const line of out.split('\n')) {
    const n = Number(line.split('\t')[0]);
    if (Number.isFinite(n)) added += n;
  }
  return added;
}

// "7d", "24h", "2026-10-01" -> ISO
export function parseSince(value: string | undefined): string | null {
  if (!value) return null;
  const rel = /^(\d+)([hdw])$/.exec(value);
  if (rel) {
    const n = Number(rel[1]);
    const ms = rel[2] === 'h' ? 3600e3 : rel[2] === 'd' ? 86400e3 : 7 * 86400e3;
    return new Date(Date.now() - n * ms).toISOString();
  }
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0) return args[i + 1];
  const eq = args.find((a) => a.startsWith(`${name}=`));
  return eq ? eq.slice(name.length + 1) : undefined;
}
