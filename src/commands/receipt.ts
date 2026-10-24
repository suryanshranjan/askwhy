// `askwhy receipt [sha|pending]`: what was verified for a change.
// A claim of "tests pass" with no test after the last edit is flagged.

import { repoRoot, tryGit } from '../git.js';
import { readRecords } from '../notes.js';
import { readPending } from '../pending.js';
import type { Proof, Record } from '../record.js';
import { displayCommand } from '../proof.js';

export const CLAIM = /\b(tests? (?:now )?pass(?:es|ing)?|all (?:tests|checks) (?:pass|green)|build (?:passes|succeeds|is green)|typecheck(?:s)? (?:pass|clean)|lint(?:s)? (?:pass|clean)|verified|works now)\b/i;

const VERIFYING = new Set(['test', 'build', 'lint', 'typecheck']);

export interface Verdict {
  status: 'verified' | 'failed' | 'unverified' | 'claimed-not-run';
  detail: string;
}

export function verdict(r: Record, claimText = ''): Verdict {
  const after = r.proof.filter((p) => p.after_edit && VERIFYING.has(p.kind));
  const claimed = !!r.claim || CLAIM.test(claimText) || CLAIM.test(r.why.reason) || CLAIM.test(r.why.decision);
  if (after.length === 0) {
    return claimed
      ? { status: 'claimed-not-run', detail: `agent said "${r.claim ?? 'verified'}", but no test/build/lint/typecheck ran after the last edit` }
      : { status: 'unverified', detail: 'no test/build/lint/typecheck ran after the last edit' };
  }
  // the last run of each kind decides
  const lastByKind = new Map<string, Proof>();
  for (const p of after) lastByKind.set(p.kind, p);
  const failed = [...lastByKind.values()].filter((p) => p.exit !== 0);
  if (failed.length) return { status: 'failed', detail: failed.map((p) => `${p.kind} exit ${p.exit ?? '?'}`).join(', ') };
  return { status: 'verified', detail: [...lastByKind.values()].map((p) => `${p.kind} ok`).join(', ') };
}

const MARK: { [K in Verdict['status']]: string } = {
  verified: '✓',
  failed: '✗',
  unverified: '·',
  'claimed-not-run': '⚠',
};

export function formatReceipt(r: Record, label: string): string {
  const v = verdict(r);
  const files = [...new Set(r.hunks.map((h) => h.path))];
  const lines = [`${MARK[v.status]} ${v.status.toUpperCase()}  ${label}  ·  ${r.agent.name}${r.agent.model ? ` · ${r.agent.model}` : ''}`];
  lines.push(`  files    ${files.join(', ')}`);
  if (r.proof.length === 0) lines.push('  ran      nothing');
  for (const p of r.proof) {
    if (p.kind === 'other' && p.exit === 0) continue; // reads, greps: not evidence
    lines.push(`  ${p.after_edit ? 'after ' : 'before'}   ${p.kind.padEnd(9)} exit ${String(p.exit ?? '?').padEnd(3)} ${displayCommand(p.cmd).slice(0, 60)}  →  ${p.summary}`);
  }
  lines.push(`  verdict  ${v.detail}`);
  return lines.join('\n');
}

export function receipt(cwd: string, args: string[]): number {
  const root = repoRoot(cwd);
  if (!root) {
    process.stderr.write('not inside a git repository\n');
    return 1;
  }
  const json = args.includes('--json');
  const target = args.find((a) => !a.startsWith('--')) ?? 'HEAD';
  let recs: Array<{ r: Record; label: string }> = [];
  if (target === 'pending') {
    recs = readPending(root)
      .filter((r) => !r.commit)
      .map((r) => ({ r, label: 'pending' }));
  } else {
    const sha = tryGit(['rev-parse', target], root);
    if (!sha) {
      process.stderr.write(`unknown revision: ${target}\n`);
      return 2;
    }
    recs = readRecords(root, sha).map((r) => ({ r, label: sha.slice(0, 8) }));
  }
  if (json) {
    process.stdout.write(JSON.stringify(recs.map(({ r }) => ({ id: r.id, commit: r.commit ?? null, verdict: verdict(r), proof: r.proof })), null, 2) + '\n');
    return 0;
  }
  if (recs.length === 0) {
    process.stdout.write(`${target}: no askwhy records\n`);
    return 1;
  }
  process.stdout.write(recs.map(({ r, label }) => formatReceipt(r, label)).join('\n\n') + '\n');
  return recs.some(({ r }) => verdict(r).status === 'claimed-not-run' || verdict(r).status === 'failed') ? 3 : 0;
}
