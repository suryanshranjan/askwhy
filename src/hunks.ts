// Map an agent edit (old_string -> new_string on a file) to line ranges.
// We never guess: if old_string is not found exactly once in the pre-edit
// content, the range is null and the caller records a whole-file hunk.

import { createHash } from 'node:crypto';

export interface EditInput {
  before: string; // file content before the edit
  oldString: string;
  newString: string;
}

export interface MappedEdit {
  old_range: [number, number] | null;
  new_range: [number, number] | null;
  after: string; // file content after the edit
  content_hash: string; // sha256 of newString (or of the whole file when ranges are unknown)
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function lineOfOffset(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  let n = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++;
  }
  // a trailing newline does not start a new line of content
  if (text.endsWith('\n')) n--;
  return n;
}

function splitLines(text: string): string[] {
  if (text === '') return [];
  return (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');
}

// Agents often send context lines with an edit (Antigravity may replace the
// whole file to add three lines). Drop the lines that are the same at the
// start and end of both sides so the hunk covers what actually changed.
// A pure deletion keeps its full range: an empty new range would point at
// no line at all.
export function changedLines(oldString: string, newString: string): { lead: number; oldCount: number; newCount: number } {
  const a = splitLines(oldString);
  const b = splitLines(newString);
  let lead = 0;
  while (lead < a.length && lead < b.length && a[lead] === b[lead]) lead++;
  let tail = 0;
  while (tail < a.length - lead && tail < b.length - lead && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const newCount = b.length - lead - tail;
  if (newCount <= 0) return { lead: 0, oldCount: a.length, newCount: b.length };
  return { lead, oldCount: a.length - lead - tail, newCount };
}

// PostToolUse runs after the edit, so we only have the post-edit content.
// Locate newString in it (must be unique) and derive both ranges from there.
export function mapEditAfter(after: string, oldString: string, newString: string): Omit<MappedEdit, 'after'> {
  if (newString !== '') {
    const first = after.indexOf(newString);
    const unique = first !== -1 && after.indexOf(newString, first + 1) === -1;
    if (unique) {
      const startLine = lineOfOffset(after, first);
      const { lead, oldCount, newCount } = changedLines(oldString, newString);
      return {
        old_range: oldCount > 0 ? [startLine + lead, startLine + lead + oldCount - 1] : null,
        new_range: newCount > 0 ? [startLine + lead, startLine + lead + newCount - 1] : null,
        content_hash: sha256(newString),
      };
    }
  }
  // Deletion or ambiguous: whole file, nothing fabricated.
  const n = countLines(after);
  return {
    old_range: null,
    new_range: n > 0 ? [1, n] : null,
    content_hash: sha256(after),
  };
}

export function wholeFile(after: string, before: string | null): Omit<MappedEdit, 'after'> {
  const n = countLines(after);
  const o = before === null ? 0 : countLines(before);
  return {
    old_range: o > 0 ? [1, o] : null,
    new_range: n > 0 ? [1, n] : null,
    content_hash: sha256(after),
  };
}

export function mapEdit(input: EditInput): MappedEdit {
  const { before, oldString, newString } = input;

  // Write / new file: no old range, new range covers the whole file.
  if (oldString === '' && before === '') {
    const n = countLines(newString);
    return {
      old_range: null,
      new_range: n > 0 ? [1, n] : null,
      after: newString,
      content_hash: sha256(newString),
    };
  }

  const first = before.indexOf(oldString);
  const unique = first !== -1 && before.indexOf(oldString, first + 1) === -1;
  if (!unique) {
    // Ambiguous or missing: record the whole file so nothing is fabricated.
    const after = oldString === '' ? newString : before;
    const n = countLines(after);
    return {
      old_range: null,
      new_range: n > 0 ? [1, n] : null,
      after,
      content_hash: sha256(after),
    };
  }

  const startLine = lineOfOffset(before, first);
  const oldLines = countLines(oldString);
  const newLines = countLines(newString);
  const after = before.slice(0, first) + newString + before.slice(first + oldString.length);

  return {
    old_range: oldLines > 0 ? [startLine, startLine + oldLines - 1] : null,
    new_range: newLines > 0 ? [startLine, startLine + newLines - 1] : null,
    after,
    content_hash: sha256(newString),
  };
}
