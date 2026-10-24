// End-to-end over a throwaway git repo: feed the hook handler the same JSON
// Claude Code sends, then check the pending record.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { handleClaudeCode } from '../src/hooks/core.js';
import { readPending } from '../src/pending.js';

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'askwhy-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir });
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

function transcript(dir: string, ts: string): string {
  const file = join(dir, 'transcript.jsonl');
  const line = {
    type: 'assistant',
    timestamp: ts,
    message: {
      id: 'msg_1',
      model: 'claude-sonnet-4-5-20250929',
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 },
    },
  };
  writeFileSync(file, JSON.stringify(line) + '\n' + JSON.stringify(line) + '\n'); // duplicated on purpose
  return file;
}

test('prompt -> edit -> test -> stop produces one priced, proven record', () => {
  const dir = repo();
  const session = 'sess-1';
  const base = { session_id: session, cwd: dir };

  handleClaudeCode({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'rename b to bee, token ghp_abcdefghijklmnopqrstuvwxyz1234' });

  // simulate the agent's Edit having happened
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\nexport const bee = 2;\nexport const c = 3;\n');
  handleClaudeCode({
    ...base,
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: join(dir, 'src', 'a.ts'), old_string: 'export const b = 2;', new_string: 'export const bee = 2;' },
    tool_response: {},
  });

  handleClaudeCode({
    ...base,
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
    tool_response: { stdout: 'Tests: 3 passed, 3 total\n', stderr: '' },
  });

  const t = transcript(dir, new Date(Date.now() + 1000).toISOString());
  handleClaudeCode({
    ...base,
    hook_event_name: 'Stop',
    transcript_path: t,
    last_assistant_message: 'Renamed.\n```why\ndecision: rename b to bee\nreason: asked to\n```',
  });

  const recs = readPending(dir);
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.equal(r.prompt?.text, 'rename b to bee, token [REDACTED_GITHUB_TOKEN]');
  assert.equal(r.hunks.length, 1);
  assert.equal(r.hunks[0].path, 'src/a.ts');
  assert.deepEqual(r.hunks[0].new_range, [2, 2]);
  assert.deepEqual(r.hunks[0].old_range, [2, 2]);
  assert.equal(r.proof.length, 1);
  assert.equal(r.proof[0].kind, 'test');
  assert.equal(r.proof[0].after_edit, true);
  assert.equal(r.proof[0].summary, '3 passed, 3 total');
  assert.equal(r.why.decision, 'rename b to bee');
  assert.equal(r.why.source, 'agent');
  assert.equal(r.price?.turns, 1); // duplicate transcript line counted once
  assert.equal(r.price?.input_tokens, 100);
  assert.equal(r.agent.model, 'claude-sonnet-4-5-20250929');
  assert.equal(r.price?.usd, 0.0014); // (100*3 + 50*15 + 1000*0.3) / 1e6 = 0.00135, rounded to 4 places
});

test('a turn with no edits never becomes a record', () => {
  const dir = repo();
  const base = { session_id: 's2', cwd: dir };
  handleClaudeCode({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'what does a.ts do?' });
  handleClaudeCode({ ...base, hook_event_name: 'Stop', last_assistant_message: 'It exports three constants.' });
  assert.equal(readPending(dir).length, 0);
});

test('bash failure records the exit code and a Write records a whole-file hunk', () => {
  const dir = repo();
  const base = { session_id: 's3', cwd: dir };
  handleClaudeCode({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'add b.ts' });
  writeFileSync(join(dir, 'src', 'b.ts'), 'export const z = 0;\n');
  handleClaudeCode({
    ...base,
    hook_event_name: 'PostToolUse',
    tool_name: 'Write',
    tool_input: { file_path: 'src/b.ts', content: 'export const z = 0;\n' },
    tool_response: {},
  });
  handleClaudeCode({
    ...base,
    hook_event_name: 'PostToolUseFailure',
    tool_name: 'Bash',
    tool_input: { command: 'npx tsc --noEmit' },
    error: 'Exit code 2\nsrc/b.ts(1,1): error TS1234\nFound 1 error.',
  });
  handleClaudeCode({ ...base, hook_event_name: 'Stop', last_assistant_message: 'done' });
  const r = readPending(dir)[0];
  assert.equal(r.hunks[0].old_range, null);
  assert.deepEqual(r.hunks[0].new_range, [1, 1]);
  assert.equal(r.proof[0].kind, 'typecheck');
  assert.equal(r.proof[0].exit, 2);
  assert.equal(r.proof[0].summary, 'Found 1 error');
  assert.equal(r.why.source, 'none');
  const log = join(dir, '.git', 'why', 'hooks.log');
  assert.equal(readFileSync(join(dir, '.git', 'why', 'pending.jsonl'), 'utf8').split('\n').filter(Boolean).length, 1);
  void log;
});
