// `askwhy export [--since 7d]`: records as Agent Trace v0.1-shaped JSON,
// plus askwhy's own fields under `metadata.askwhy`, so other tools that read
// the spec get attribution and we keep intent/proof/price alongside.

import { repoRoot } from '../git.js';
import { allRecords, flagValue, parseSince } from '../records.js';

export function exportTrace(cwd: string, args: string[]): number {
  const root = repoRoot(cwd);
  if (!root) {
    process.stderr.write('not inside a git repository\n');
    return 1;
  }
  const since = parseSince(flagValue(args, '--since'));
  const traces = allRecords(root, since, args.includes('--pending')).map(({ record: r, commit }) => ({
    version: '0.1.0',
    id: r.id,
    timestamp: r.prompt?.ts ?? r.hunks[0]?.ts,
    vcs: commit ? { type: 'git', revision: commit } : undefined,
    tool: { name: r.agent.name },
    files: Object.entries(
      r.hunks.reduce<Record<string, typeof r.hunks>>((acc, h) => {
        (acc[h.path] ??= []).push(h);
        return acc;
      }, {}),
    ).map(([path, hunks]) => ({
      path,
      conversations: [
        {
          contributor: { type: r.trace.contributor, model_id: r.agent.model },
          ranges: hunks
            .filter((h) => h.new_range)
            .map((h) => ({ start_line: h.new_range![0], end_line: h.new_range![1], content_hash: h.content_hash })),
        },
      ],
    })),
    metadata: {
      askwhy: {
        session_id: r.agent.session_id,
        prompt: r.prompt?.text ?? null,
        why: r.why,
        proof: r.proof,
        price: r.price,
      },
    },
  }));
  process.stdout.write(JSON.stringify(traces, null, 2) + '\n');
  return 0;
}
