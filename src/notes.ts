// Records attached to commits live in git notes on refs/notes/why.
// One note per commit: { "askwhy": 1, "records": [ ...Record ] }.

import { NOTES_REF, readNote, tryGit, writeNote } from './git.js';
import type { Record } from './record.js';

interface NoteBody {
  askwhy: 1;
  records: Record[];
}

export function readRecords(cwd: string, sha: string): Record[] {
  const raw = readNote(cwd, sha);
  if (!raw) return [];
  try {
    const body = JSON.parse(raw) as NoteBody;
    return Array.isArray(body.records) ? body.records : [];
  } catch {
    return [];
  }
}

export function appendRecords(cwd: string, sha: string, records: Record[]): void {
  const existing = readRecords(cwd, sha);
  const byId = new Map(existing.map((r) => [r.id, r]));
  for (const r of records) byId.set(r.id, { ...r, commit: sha });
  const body: NoteBody = { askwhy: 1, records: [...byId.values()] };
  writeNote(cwd, sha, JSON.stringify(body));
}

// Every commit that has a note, newest first.
export function notedCommits(cwd: string): string[] {
  const list = tryGit(['notes', `--ref=${NOTES_REF}`, 'list'], cwd);
  if (!list) return [];
  const shas = list
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(' ')[1])
    .filter(Boolean);
  if (shas.length === 0) return [];
  // order by commit date, newest first
  const ordered = tryGit(['rev-list', '--no-walk', '--date-order', ...shas], cwd);
  return ordered ? ordered.split('\n').filter(Boolean) : shas;
}
