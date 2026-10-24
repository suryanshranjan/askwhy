import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedLines, mapEdit, mapEditAfter, sha256 } from '../src/hunks.js';

const before = ['a', 'b', 'c', 'd', 'e'].join('\n') + '\n';

test('single-line replacement keeps the same line', () => {
  const r = mapEdit({ before, oldString: 'c', newString: 'C' });
  assert.deepEqual(r.old_range, [3, 3]);
  assert.deepEqual(r.new_range, [3, 3]);
  assert.equal(r.after, 'a\nb\nC\nd\ne\n');
  assert.equal(r.content_hash, sha256('C'));
});

test('multi-line replacement grows the range', () => {
  const r = mapEdit({ before, oldString: 'c\nd', newString: 'c\nx\ny\nd' });
  assert.deepEqual(r.old_range, [3, 4]);
  assert.deepEqual(r.new_range, [3, 6]);
  assert.equal(r.after, 'a\nb\nc\nx\ny\nd\ne\n');
});

test('deletion yields null new_range', () => {
  const r = mapEdit({ before, oldString: 'b\n', newString: '' });
  assert.deepEqual(r.old_range, [2, 2]);
  assert.equal(r.new_range, null);
  assert.equal(r.after, 'a\nc\nd\ne\n');
});

test('new file (Write) has no old range', () => {
  const r = mapEdit({ before: '', oldString: '', newString: 'one\ntwo\n' });
  assert.equal(r.old_range, null);
  assert.deepEqual(r.new_range, [1, 2]);
});

test('ambiguous old_string records whole file, never guesses', () => {
  const dup = 'x\ny\nx\n';
  const r = mapEdit({ before: dup, oldString: 'x', newString: 'z' });
  assert.equal(r.old_range, null);
  assert.deepEqual(r.new_range, [1, 3]);
  assert.equal(r.after, dup);
});

test('missing old_string records whole file', () => {
  const r = mapEdit({ before, oldString: 'nope', newString: 'z' });
  assert.equal(r.old_range, null);
  assert.deepEqual(r.new_range, [1, 5]);
});

test('mapEditAfter trims context lines both sides share', () => {
  const after = 'export function add(a, b) {\n  return a + b;\n}\n\nexport function multiply(a, b) {\n  return a * b;\n}\n';
  // whole-file replacement that only appends multiply
  const m = mapEditAfter(after, 'export function add(a, b) {\n  return a + b;\n}\n', after);
  assert.deepEqual(m.new_range, [4, 7]);
  assert.equal(m.old_range, null); // nothing old changed: a pure insertion
});

test('changedLines keeps a pure deletion whole', () => {
  assert.deepEqual(changedLines('a\nb\nc', 'a\nc'), { lead: 0, oldCount: 3, newCount: 2 });
  assert.deepEqual(changedLines('x\ny\nz\n', 'x\nY\nz\n'), { lead: 1, oldCount: 1, newCount: 1 });
});
