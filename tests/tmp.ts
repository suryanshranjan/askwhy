// Temp directories for tests, removed when the test process exits so test
// runs do not pile up throwaway repos in the system temp folder.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const made: string[] = [];

process.on('exit', () => {
  for (const dir of made) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // a locked file on Windows: leave it to the OS
    }
  }
});

export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}
