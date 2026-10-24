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

// PostToolUse runs after the edit, so we only have the post-edit content.
// Locate newString in it (must be unique) and derive both ranges from there.
export function mapEditAfter(after: string, oldString: string, newString: string): Omit<MappedEdit, 'after'> {
  if (newString !== '') {
    const first = after.indexOf(newString);
    const unique = first !== -1 && after.indexOf(newString, first + 1) === -1;
    if (unique) {
      const startLine = lineOfOffset(after, first);
      const oldLines = countLines(oldString);
      const newLines = countLines(newString);
      return {
        old_range: oldLines > 0 ? [startLine, startLine + oldLines - 1] : null,
        new_range: newLines > 0 ? [startLine, startLine + newLines - 1] : null,
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
