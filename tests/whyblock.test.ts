import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWhyBlock } from '../src/whyblock.js';

test('parses a full block', () => {
  const text = [
    'Done. Summary below.',
    '```why',
    'decision: Chose retry-with-jitter over circuit breaker',
    'reason: upstream is flaky, not down',
    'rejected: circuit breaker | would mask the 5xx we alert on',
    'rejected: plain retry | thundering herd on recovery',
    '```',
  ].join('\n');
  const w = parseWhyBlock(text);
  assert.ok(w);
  assert.equal(w.decision, 'Chose retry-with-jitter over circuit breaker');
  assert.equal(w.reason, 'upstream is flaky, not down');
  assert.deepEqual(w.rejected, [
    { option: 'circuit breaker', reason: 'would mask the 5xx we alert on' },
    { option: 'plain retry', reason: 'thundering herd on recovery' },
  ]);
  assert.equal(w.source, 'agent');
});

test('uses the last block when several appear', () => {
  const text = '```why\ndecision: first\n```\ntext\n```why\ndecision: second\n```';
  assert.equal(parseWhyBlock(text)?.decision, 'second');
});

test('returns null when there is no block or it is empty', () => {
  assert.equal(parseWhyBlock('no block here'), null);
  assert.equal(parseWhyBlock('```why\n\n```'), null);
});

test('rejected without a reason keeps the option', () => {
  const w = parseWhyBlock('```why\nrejected: do nothing\n```');
  assert.deepEqual(w?.rejected, [{ option: 'do nothing', reason: '' }]);
});
