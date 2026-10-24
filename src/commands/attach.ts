// `askwhy attach`: run by the post-commit hook. Pending records whose files
// are part of HEAD get attached to HEAD; the rest stay pending for a later
// commit. Hunk ranges are kept as recorded; git blame maps lines back later.

import { headSha, repoRoot, tryGit } from '../git.js';
import { readPending, replacePending } from '../pending.js';
import { appendRecords } from '../notes.js';

export function attach(cwd: string, quiet = false): number {
  const root = repoRoot(cwd);
  if (!root) return 1;
  const sha = headSha(root);
  if (!sha) return 1;
  const changed = new Set(
    (tryGit(['diff-tree', '--no-commit-id', '--name-only', '-r', sha], root) ?? '').split('\n').filter(Boolean),
  );
  const pending = readPending(root);
  const attachNow = pending.filter((r) => !r.commit && r.hunks.some((h) => changed.has(h.path)));
  if (attachNow.length === 0) {
    if (!quiet) process.stdout.write('nothing to attach\n');
    return 0;
  }
  appendRecords(root, sha, attachNow);
  const attachedIds = new Set(attachNow.map((r) => r.id));
  replacePending(root, pending.filter((r) => !attachedIds.has(r.id)));
  if (!quiet) process.stdout.write(`attached ${attachNow.length} record(s) to ${sha.slice(0, 8)}\n`);
  return 0;
}
