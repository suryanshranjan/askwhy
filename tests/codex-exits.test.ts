import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexExits } from '../src/transcript.js';
import { tempDir } from './tmp.js';

// Line shapes copied from a real Codex 0.160 rollout (code-mode `exec` tool).
const TURN = 'turn-1';
const meta = (turn: string) => ({ internal_chat_message_metadata_passthrough: { turn_id: turn } });
const call = (id: string, input: string, turn = TURN) => ({
  type: 'response_item',
  payload: { type: 'custom_tool_call', name: 'exec', call_id: id, input, ...meta(turn) },
});
const output = (id: string, results: object[], turn = TURN) => ({
  type: 'response_item',
  payload: {
    type: 'custom_tool_call_output',
    call_id: id,
    output: [
      { type: 'input_text', text: 'Script completed\nOutput:\n' },
      ...results.map((r) => ({ type: 'input_text', text: JSON.stringify(r) })),
    ],
    ...meta(turn),
  },
});

function rollout(lines: object[]): string {
  const dir = tempDir('askwhy-codex-');
  const path = join(dir, 'rollout.jsonl');
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n'));
  return path;
}

test('codexExits pairs exec_command calls with exit codes from the rollout', () => {
  const path = rollout([
    call('a', 'text(await tools.exec_command({cmd:"npm test",max_output_tokens:2000}));\n'),
    output('a', [{ exit_code: 1, output: '1 failed' }]),
    call('b', 'text(await tools.apply_patch("*** Begin Patch\\n*** End Patch"));\n'),
    output('b', [{}]),
    call('c', 'text(await tools.exec_command({cmd:"node -e \\"console.log(1)\\""}));\n'),
    output('c', [{ exit_code: 0, output: '1\n' }]),
    call('d', 'text(await tools.exec_command({cmd:"ls"}));\n', 'other-turn'),
    output('d', [{ exit_code: 0 }], 'other-turn'),
  ]);
  assert.deepEqual(codexExits(path, TURN), [
    { cmd: 'npm test', exit: 1 },
    { cmd: 'node -e "console.log(1)"', exit: 0 },
  ]);
});

test('codexExits reads plain function calls too', () => {
  const path = rollout([
    { type: 'response_item', payload: { type: 'function_call', call_id: 'x', arguments: '{"cmd":"cargo test"}' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'x', output: '{"exit_code":101}' } },
  ]);
  assert.deepEqual(codexExits(path, null), [{ cmd: 'cargo test', exit: 101 }]);
});

test('codexExits returns nothing for a missing rollout', () => {
  assert.deepEqual(codexExits(join(tmpdir(), 'no-such-rollout.jsonl'), TURN), []);
});
