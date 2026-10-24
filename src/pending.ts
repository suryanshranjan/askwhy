// Pending records: turns that edited files but have not been committed yet.
// Stored as JSONL under <gitdir>/why/pending.jsonl, one record per line,
// keyed by record id. Writes are append-only; "update" appends a newer copy
// and readers keep the last one per id.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Record } from './record.js';
import { stateDir } from './git.js';

export function pendingPath(cwd: string): string | null {
  const dir = stateDir(cwd);
  return dir ? join(dir, 'pending.jsonl') : null;
}

export function readPending(cwd: string): Record[] {
  const file = pendingPath(cwd);
  if (!file || !existsSync(file)) return [];
  const byId = new Map<string, Record>();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as Record;
      byId.set(rec.id, rec);
    } catch {
      // a torn write from a crashed hook; skip the line, never the file
    }
  }
  return [...byId.values()];
}

export function upsertPending(cwd: string, rec: Record): void {
  const file = pendingPath(cwd);
  if (!file) throw new Error('not inside a git repository');
  appendFileSync(file, JSON.stringify(rec) + '\n', 'utf8');
}

export function replacePending(cwd: string, records: Record[]): void {
  const file = pendingPath(cwd);
  if (!file) throw new Error('not inside a git repository');
  writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''), 'utf8');
}

// The open record for a session: the last pending record with no commit.
export function openRecord(cwd: string, sessionId: string): Record | undefined {
  const all = readPending(cwd).filter((r) => !r.commit && r.agent.session_id === sessionId);
  return all[all.length - 1];
}
