// Antigravity capture: replay a transcript (real line shapes) at Stop.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { handleAntigravity, userRequest } from '../src/hooks/antigravity.js';
import { installAntigravityHooks } from '../src/commands/init.js';
import { verdict } from '../src/commands/receipt.js';
import { readPending } from '../src/pending.js';

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'askwhy-ag-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@example.com']);
  git(dir, ['config', 'user.name', 'T']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  writeFileSync(join(dir, 'math.js'), 'export function add(a, b) {\n  return a + b;\n}\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}

const step = (i: number, o: object) =>
  JSON.stringify({ step_index: i, status: 'DONE', created_at: '2026-10-25T00:30:00Z', ...o });

function transcript(dir: string, mathFile: string, extra: string[] = []): string {
  const lines = [
    step(0, { source: 'USER_EXPLICIT', type: 'USER_INPUT', content: '<USER_REQUEST>\nadd multiply\n</USER_REQUEST>\n<ADDITIONAL_METADATA>x</ADDITIONAL_METADATA>' }),
    step(1, { source: 'SYSTEM', type: 'CONVERSATION_HISTORY' }),
    step(2, { source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'Looking.', tool_calls: [{ name: 'view_file', args: { AbsolutePath: mathFile } }] }),
    step(3, { source: 'MODEL', type: 'VIEW_FILE', content: 'File Path: math.js' }),
    step(4, {
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      tool_calls: [
        {
          name: 'replace_file_content',
          args: {
            TargetFile: mathFile,
            TargetContent: '  return a + b;\n}',
            ReplacementContent: '  return a + b;\n}\n\nexport function multiply(a, b) {\n  return a * b;\n}',
            Description: 'Added multiply next to add with the same export style',
          },
        },
      ],
    }),
    step(5, { source: 'MODEL', type: 'CODE_ACTION', content: 'The following changes were made' }),
    step(6, { source: 'MODEL', type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'write_to_file', args: { TargetFile: join(tmpdir(), 'plan.md'), CodeContent: 'x' } }] }),
    step(7, { source: 'MODEL', type: 'CODE_ACTION', content: 'Created file' }),
    step(8, { source: 'MODEL', type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'run_command', args: { CommandLine: 'npm test', Cwd: dir } }] }),
    step(9, {
      source: 'MODEL',
      type: 'RUN_COMMAND',
      exit_code: 1,
      content: 'Created At: x\nCompleted At: y\n\n\t\t\t\tThe command exited with code 1.\n\t\t\t\tOutput:\n\t\t\t\tTests: 1 failed, 2 passed, 3 total\n',
    }),
    ...extra,
  ];
  const path = join(dir, 'transcript_full.jsonl');
  writeFileSync(path, lines.join('\n') + '\n');
  return path;
}

test('userRequest strips the request wrapper', () => {
  assert.equal(userRequest('<USER_REQUEST>\nfix it\n</USER_REQUEST>\n<META/>'), 'fix it');
  assert.equal(userRequest('plain'), 'plain');
});

test('antigravity: Stop replays edits and commands from the transcript', () => {
  const dir = repo();
  const math = join(dir, 'math.js');
  writeFileSync(math, 'export function add(a, b) {\n  return a + b;\n}\n\nexport function multiply(a, b) {\n  return a * b;\n}\n');
  const t = transcript(dir, math, [
    step(10, { source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'Done.\n```why\ndecision: multiply beside add\nreason: same export style\n```' }),
  ]);
  handleAntigravity({ conversationId: 'conv-1', transcriptPath: t, workspacePaths: [dir], modelName: 'auto' });

  const recs = readPending(dir);
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.equal(r.agent.name, 'antigravity');
  assert.equal(r.prompt?.text, 'add multiply');
  assert.deepEqual(r.hunks.map((h) => [h.path, h.new_range]), [['math.js', [4, 7]]]); // plan.md outside the repo is skipped
  assert.equal(r.why.decision, 'multiply beside add');
  assert.equal(r.proof.length, 1);
  assert.equal(r.proof[0].exit, 1);
  assert.equal(r.proof[0].after_edit, true);
  assert.equal(r.proof[0].summary, '1 failed, 2 passed, 3 total');
  assert.equal(verdict(r).status, 'failed');
  assert.equal(r.price, null);

  // a second Stop with nothing new records nothing more
  handleAntigravity({ conversationId: 'conv-1', transcriptPath: t, workspacePaths: [dir] });
  assert.equal(readPending(dir).length, 1);
});

test('antigravity: edit Descriptions stand in when there is no why block', () => {
  const dir = repo();
  const math = join(dir, 'math.js');
  writeFileSync(math, 'export function add(a, b) {\n  return a + b;\n}\n\nexport function multiply(a, b) {\n  return a * b;\n}\n');
  const t = transcript(dir, math);
  handleAntigravity({ conversationId: 'conv-2', transcriptPath: t, workspacePaths: [dir] });
  const r = readPending(dir)[0];
  assert.equal(r.why.decision, 'Added multiply next to add with the same export style');
  assert.equal(r.why.source, 'agent');
});

test('installAntigravityHooks keeps other named hooks', () => {
  const dir = repo();
  mkdirSync(join(dir, '.agents'));
  writeFileSync(join(dir, '.agents', 'hooks.json'), JSON.stringify({ lint: { PostToolUse: [] } }));
  installAntigravityHooks(dir, 'askwhy hook antigravity', false);
  const cfg = JSON.parse(readFileSync(join(dir, '.agents', 'hooks.json'), 'utf8'));
  assert.deepEqual(Object.keys(cfg), ['lint', 'askwhy']);
  assert.equal(cfg.askwhy.Stop[0].command, 'askwhy hook antigravity');
});

test('antigravity: background commands take the exit code from the task-finished message', () => {
  const dir = repo();
  const math = join(dir, 'math.js');
  writeFileSync(math, 'export function add(a, b) {\n  return a + b;\n}\n\nexport function multiply(a, b) {\n  return a * b;\n}\n');
  const t = transcript(dir, math, [
    step(10, { source: 'MODEL', type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'run_command', args: { CommandLine: 'npm run typecheck' } }] }),
    step(11, { source: 'MODEL', type: 'RUN_COMMAND', status: 'RUNNING', content: 'Tool is running as a background task with task id: conv-3/task-11\nTask Description: x' }),
    step(12, { source: 'MODEL', type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'schedule', args: {} }] }),
    step(13, { source: 'MODEL', type: 'GENERIC', content: 'Wait cancelled' }),
    step(14, {
      source: 'SYSTEM',
      type: 'SYSTEM_MESSAGE',
      content: '<SYSTEM_MESSAGE> content=Task id "conv-3/task-11" finished with result: The command exited with code 0\nOutput:\nok',
    }),
  ]);
  handleAntigravity({ conversationId: 'conv-3', transcriptPath: t, workspacePaths: [dir] });
  const r = readPending(dir)[0];
  assert.deepEqual(r.proof.map((p) => [p.cmd, p.exit, p.kind]), [
    ['npm test', 1, 'test'],
    ['npm run typecheck', 0, 'typecheck'],
  ]);
  assert.equal(verdict(r).status, 'failed'); // the last test run still failed
});
