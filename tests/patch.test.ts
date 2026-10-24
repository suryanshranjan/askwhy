import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locateChunk, parsePatch } from '../src/patch.js';

const PATCH = [
  '*** Begin Patch',
  '*** Update File: src/a.ts',
  '@@ export function f',
  ' line1',
  '-line2',
  '+LINE2',
  '+line2b',
  ' line3',
  '*** Add File: src/new.ts',
  '+one',
  '+two',
  '*** Delete File: src/old.ts',
  '*** End Patch',
].join('\n');

test('parses update, add and delete sections', () => {
  const files = parsePatch(PATCH);
  assert.deepEqual(files.map((f) => [f.op, f.path, f.chunks.length]), [
    ['update', 'src/a.ts', 1],
    ['add', 'src/new.ts', 1],
    ['delete', 'src/old.ts', 0],
  ]);
  const c = files[0].chunks[0];
  assert.equal(c.oldText, 'line1\nline2\nline3');
  assert.equal(c.newText, 'line1\nLINE2\nline2b\nline3');
  assert.equal(c.firstAdded, 1);
  assert.equal(c.lastAdded, 2);
});

test('locates the added lines in the post-edit file', () => {
  const after = 'line0\nline1\nLINE2\nline2b\nline3\nline4\n';
  const r = locateChunk(after, parsePatch(PATCH)[0].chunks[0]);
  assert.deepEqual(r?.new_range, [3, 4]);
  assert.deepEqual(r?.old_range, [3, 3]);
});

test('added file covers its lines', () => {
  const r = locateChunk('one\ntwo\n', parsePatch(PATCH)[1].chunks[0]);
  assert.deepEqual(r?.new_range, [1, 2]);
  assert.equal(r?.old_range, null);
});

test('ambiguous chunk is not located', () => {
  const chunk = parsePatch('*** Begin Patch\n*** Update File: x\n-a\n+b\n*** End Patch')[0].chunks[0];
  assert.equal(locateChunk('b\nb\n', chunk), null);
});

test('handles a move', () => {
  const f = parsePatch('*** Begin Patch\n*** Update File: a.ts\n*** Move to: b.ts\n@@\n-x\n+y\n*** End Patch')[0];
  assert.equal(f.moveTo, 'b.ts');
});
