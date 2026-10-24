// codex capture + receipt / price / export over a throwaway repo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { handleClaudeCode, handleCodex } from '../src/hooks/core.js';
import { attach } from '../src/commands/attach.js';
import { verdict } from '../src/commands/receipt.js';
import { readPending } from '../src/pending.js';
import { readRecords } from '../src/notes.js';
import { allRecords, linesLanded, parseSince } from '../src/records.js';
import { headSha } from '../src/git.js';

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'askwhy-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@example.com']);
  git(dir, ['config', 'user.name', 'T']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'a.ts'), 'one\ntwo\nthree\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}

test('codex apply_patch + shell + stop with codex usage', () => {
  const dir = repo();
  const base = { session_id: 'cx', cwd: dir, model: 'gpt-x', turn_id: 'turn-1' };
  handleCodex({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'uppercase two' });
  writeFileSync(join(dir, 'src', 'a.ts'), 'one\nTWO\nthree\n');
  handleCodex({
    ...base,
    hook_event_name: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: { command: '*** Begin Patch\n*** Update File: src/a.ts\n@@\n one\n-two\n+TWO\n three\n*** End Patch' },
    tool_response: 'Success. Updated the following files:\nM src/a.ts',
  });
  handleCodex({
    ...base,
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: ['bash', '-lc', 'npm test'] },
    tool_response: 'Exit code: 1\nOutput:\nTests: 1 failed, 2 passed, 3 total',
  });
  const t = join(dir, 'rollout.jsonl');
  const usage = (turn: string, id: string) =>
    JSON.stringify({ type: 'token_usage_record', timestamp: new Date().toISOString(), payload: { turn_id: turn, response_id: id, usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 50 } } });
  writeFileSync(t, [usage('turn-1', 'r1'), usage('turn-1', 'r1'), usage('turn-0', 'r0')].join('\n') + '\n');
  handleCodex({ ...base, hook_event_name: 'Stop', transcript_path: t, last_assistant_message: 'Done, all tests pass.' });

  const r = readPending(dir)[0];
  assert.equal(r.agent.name, 'codex');
  assert.equal(r.agent.model, 'gpt-x');
  assert.deepEqual(r.hunks.map((h) => [h.path, h.old_range, h.new_range, h.tool]), [['src/a.ts', [2, 2], [2, 2], 'apply_patch']]);
  assert.equal(r.proof[0].cmd, 'npm test');
  assert.equal(r.proof[0].exit, 1);
  assert.equal(r.proof[0].kind, 'test');
  assert.equal(r.price?.turns, 1);
  assert.equal(r.price?.input_tokens, 200);
  assert.equal(r.price?.cache_read_tokens, 800);
  assert.equal(r.price?.usd, null); // unknown model: never guessed
  assert.equal(r.claim, 'all tests pass');
  assert.equal(verdict(r).status, 'failed');
});

test('receipt flags a claim with no test after the edit', () => {
  const dir = repo();
  const base = { session_id: 'cc', cwd: dir };
  handleClaudeCode({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'fix' });
  handleClaudeCode({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout: 'Tests: 3 passed' } });
  writeFileSync(join(dir, 'src', 'a.ts'), 'one\n2\nthree\n');
  handleClaudeCode({
    ...base,
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: 'src/a.ts', old_string: 'two', new_string: '2' },
    tool_response: {},
  });
  handleClaudeCode({ ...base, hook_event_name: 'Stop', last_assistant_message: 'Fixed. Tests pass.' });
  const r = readPending(dir)[0];
  assert.equal(r.proof[0].after_edit, false);
  assert.equal(verdict(r).status, 'claimed-not-run');
  assert.match(verdict(r).detail, /Tests pass/);
});

test('verified when the last test after the edit passed; price counts landed lines', () => {
  const dir = repo();
  const base = { session_id: 'v', cwd: dir };
  handleClaudeCode({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'add four' });
  writeFileSync(join(dir, 'src', 'a.ts'), 'one\ntwo\nthree\nfour\nfive\n');
  handleClaudeCode({
    ...base,
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: 'src/a.ts', old_string: 'three\n', new_string: 'three\nfour\nfive\n' },
    tool_response: {},
  });
  handleClaudeCode({ ...base, hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'npm test' }, error: 'Exit code 1\nTests: 1 failed' });
  handleClaudeCode({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout: 'Tests: 4 passed' } });
  handleClaudeCode({ ...base, hook_event_name: 'Stop', last_assistant_message: 'ok' });
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'add four']);
  attach(dir, true);
  const sha = headSha(dir)!;
  const r = readRecords(dir, sha)[0];
  assert.equal(verdict(r).status, 'verified');
  assert.equal(linesLanded(dir, sha, ['src/a.ts']), 2);
  const all = allRecords(dir);
  assert.equal(all.length, 1);
  assert.equal(all[0].subject, 'add four');
});

test('parseSince understands relative and absolute dates', () => {
  const d = parseSince('7d')!;
  assert.ok(Date.now() - Date.parse(d) > 6.9 * 86400e3);
  assert.equal(parseSince('2026-10-01')?.slice(0, 10), '2026-10-01');
  assert.equal(parseSince('nonsense'), null);
});
