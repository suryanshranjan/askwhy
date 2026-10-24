// Parse Codex `apply_patch` V4A patches into per-file chunks, then locate
// each chunk in the post-edit file to get line ranges.
//
// *** Begin Patch
// *** Update File: src/a.ts
// @@ optional anchor
//  context
// -removed
// +added
// *** Add File: src/new.ts
// +line
// *** Delete File: src/old.ts
// *** End Patch

import { sha256 } from './hunks.js';

export type PatchOp = 'add' | 'update' | 'delete';

export interface PatchChunk {
  oldText: string; // context + removed lines
  newText: string; // context + added lines
  firstAdded: number; // index of the first added line within newText lines, -1 if none
  lastAdded: number;
  removed: number; // count of '-' lines
  firstChange: number; // index within newText lines where the first +/- occurs
}

export interface PatchFile {
  op: PatchOp;
  path: string;
  moveTo?: string;
  chunks: PatchChunk[];
}

export function parsePatch(patch: string): PatchFile[] {
  const files: PatchFile[] = [];
  let cur: PatchFile | null = null;
  let oldLines: string[] = [];
  let newLines: string[] = [];
  let firstAdded = -1;
  let lastAdded = -1;
  let removed = 0;
  let firstChange = -1;

  const flush = () => {
    if (cur && (oldLines.length || newLines.length)) {
      cur.chunks.push({ oldText: oldLines.join('\n'), newText: newLines.join('\n'), firstAdded, lastAdded, removed, firstChange });
    }
    oldLines = [];
    newLines = [];
    firstAdded = -1;
    lastAdded = -1;
    removed = 0;
    firstChange = -1;
  };

  for (const raw of patch.replace(/\r\n/g, '\n').split('\n')) {
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(raw);
    if (header) {
      flush();
      cur = { op: header[1].toLowerCase() as PatchOp, path: header[2].trim(), chunks: [] };
      files.push(cur);
      continue;
    }
    const move = /^\*\*\* Move to: (.+)$/.exec(raw);
    if (move && cur) {
      cur.moveTo = move[1].trim();
      continue;
    }
    if (raw.startsWith('*** ')) {
      flush(); // Begin/End Patch, End of File
      continue;
    }
    if (!cur) continue;
    if (raw.startsWith('@@')) {
      flush();
      continue;
    }
    const tag = raw[0];
    const body = raw.slice(1);
    if ((tag === '+' || tag === '-') && firstChange === -1) firstChange = newLines.length;
    if (tag === '+') {
      if (firstAdded === -1) firstAdded = newLines.length;
      lastAdded = newLines.length;
      newLines.push(body);
    } else if (tag === '-') {
      removed++;
      oldLines.push(body);
    } else if (tag === ' ') {
      oldLines.push(body);
      newLines.push(body);
    } else if (raw === '') {
      // blank context line written without the leading space
      oldLines.push('');
      newLines.push('');
    }
  }
  flush();
  return files;
}

function lineOf(text: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

export interface ChunkRange {
  old_range: [number, number] | null;
  new_range: [number, number] | null;
  content_hash: string;
}

// Locate one chunk in the post-edit file. Unique match or nothing; never guess.
export function locateChunk(after: string, chunk: PatchChunk): ChunkRange | null {
  const text = after.replace(/\r\n/g, '\n');
  if (!chunk.newText) return null;
  const at = text.indexOf(chunk.newText);
  if (at === -1 || text.indexOf(chunk.newText, at + 1) !== -1) return null;
  const start = lineOf(text, at);
  const added = chunk.newText.split('\n').filter((_, i) => i >= chunk.firstAdded && i <= chunk.lastAdded).join('\n');
  const changeAt = start + Math.max(chunk.firstChange, 0);
  return {
    old_range: chunk.removed > 0 ? [changeAt, changeAt + chunk.removed - 1] : null,
    new_range: chunk.firstAdded === -1 ? null : [start + chunk.firstAdded, start + chunk.lastAdded],
    content_hash: sha256(chunk.firstAdded === -1 ? chunk.newText : added),
  };
}
