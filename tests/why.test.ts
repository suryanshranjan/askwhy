// attach + git why over a throwaway repo, driven through the real hook handler.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { handleClaudeCode } from '../src/hooks/core.js';
import { attach } from '../src/commands/attach.js';
import { readRecords } from '../src/notes.js';
import { readPending } from '../src/pending.js';
import { formatRecord, parseTarget } from '../src/commands/why.js';
import { headSha } from '../src/git.js';
import { tempDir } from './tmp.js';

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

function repo(): string {
  const dir = tempDir('askwhy-');
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@example.com']);
  git(dir, ['config', 'user.name', 'T']);
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'a.ts'), 'line1\nline2\nline3\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}

test('attach moves the record into a note on HEAD and git why finds it by line', () => {
  const dir = repo();
  const base = { session_id: 's', cwd: dir };
  handleClaudeCode({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'change line2' });
  writeFileSync(join(dir, 'src', 'a.ts'), 'line1\nchanged\nline3\n');
  handleClaudeCode({
    ...base,
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: 'src/a.ts', old_string: 'line2', new_string: 'changed' },
    tool_response: {},
  });
  handleClaudeCode({
    ...base,
    hook_event_name: 'Stop',
    last_assistant_message: '```why\ndecision: replaced line2 with changed\nreason: test\nrejected: leave it | pointless\n```',
  });
  assert.equal(readPending(dir).length, 1);

  // an unrelated commit must not steal the record
  writeFileSync(join(dir, 'other.txt'), 'x\n');
  git(dir, ['add', '-A', '--', 'other.txt']);
  git(dir, ['commit', '-q', '-m', 'unrelated']);
  attach(dir, true);
  assert.equal(readPending(dir).length, 1, 'still pending after unrelated commit');

  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'the change']);
  attach(dir, true);
  const sha = headSha(dir)!;
  assert.equal(readPending(dir).length, 0);
  const recs = readRecords(dir, sha);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].commit, sha);

  // blame line 2 -> this commit -> hunk covers orig line 2
  const blame = git(dir, ['blame', '--porcelain', '-L', '2,2', '--', 'src/a.ts']).split('\n')[0];
  assert.ok(blame.startsWith(sha));
  const out = formatRecord(recs[0], 'src/a.ts', 2);
  assert.match(out, /^src\/a\.ts:2-2  \(/);
  assert.match(out, /why      replaced line2 with changed\n  because  test/);
  assert.match(out, /rejected leave it \(pointless\)/);
  assert.match(out, /prompt   "change line2"\n  agent    claude-code/);
  assert.match(out, /proof    nothing ran/);
});

test('parseTarget splits path and line', () => {
  const dir = repo();
  const t = parseTarget(dir, join(dir, 'src', 'a.ts') + ':17');
  assert.equal(t.path, 'src/a.ts');
  assert.equal(t.line, 17);
  const u = parseTarget(dir, join(dir, 'src', 'a.ts'));
  assert.equal(u.line, null);
});
