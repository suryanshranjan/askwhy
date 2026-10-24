// `askwhy attach`: run by the post-commit hook. Pending records whose files
// are part of HEAD get attached to HEAD; the rest stay pending for a later
// commit. Hunk ranges are kept as recorded; git blame maps lines back later.

import { headSha, repoRoot, tryGit } from '../git.js';
import { readPending, replacePending } from '../pending.js';
import { appendRecords } from '../notes.js';
import { usageSince } from '../transcript.js';
import type { Record } from '../record.js';

// At Stop the transcript can lag the final response; by commit time it is
// complete, so re-read usage inside the turn's [prompt, stop] window.
function reprice(root: string, r: Record): Record {
  const t = r.agent.transcript_path;
  if (r.agent.name !== 'claude-code' || !t || !r.prompt?.ts || !r.ended_at) return r;
  const u = usageSince(t, r.prompt.ts, root, new Date(Date.parse(r.ended_at) + 5000).toISOString());
  if (!u || (r.price && u.price.turns < r.price.turns)) return r;
  return { ...r, price: u.price, agent: { ...r.agent, model: u.model ?? r.agent.model } };
}

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
  appendRecords(root, sha, attachNow.map((r) => reprice(root, r)));
  const attachedIds = new Set(attachNow.map((r) => r.id));
  replacePending(root, pending.filter((r) => !attachedIds.has(r.id)));
  if (!quiet) process.stdout.write(`attached ${attachNow.length} record(s) to ${sha.slice(0, 8)}\n`);
  return 0;
}
