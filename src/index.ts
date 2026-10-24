import { handleClaudeCode, handleCodex, readStdinJson } from './hooks/core.js';
import { init } from './commands/init.js';
import { doctor } from './commands/doctor.js';
import { attach } from './commands/attach.js';
import { why } from './commands/why.js';
import { receipt } from './commands/receipt.js';
import { price } from './commands/price.js';
import { exportTrace } from './commands/export.js';
import { readPending } from './pending.js';
import { repoRoot } from './git.js';

const VERSION = '0.1.0';

const USAGE = `askwhy ${VERSION}

Usage:
  askwhy init              detect agents, install hooks, notes ref, git alias
  git why <path>[:<line>]  intent for the hunk covering a line
  askwhy receipt [sha|pending]  what was verified after the edit
  askwhy price [--since 7d] [--by commit|agent|session|file]
                           cost per change and $ per line landed
  askwhy pending           records waiting for a commit
  askwhy attach            attach pending records to HEAD (post-commit)
  askwhy export [--since]  Agent Trace JSON (with intent, proof, price)
  askwhy doctor            hooks installed? notes ref ok? agents detected?
  askwhy hook <agent>      hook entry point (reads JSON on stdin)
`;

function pending(cwd: string, json: boolean): number {
  const root = repoRoot(cwd);
  if (!root) {
    process.stderr.write('not inside a git repository\n');
    return 1;
  }
  const records = readPending(root).filter((r) => !r.commit);
  if (json) {
    process.stdout.write(JSON.stringify(records, null, 2) + '\n');
    return 0;
  }
  if (records.length === 0) {
    process.stdout.write('no pending records\n');
    return 0;
  }
  for (const r of records) {
    const files = [...new Set(r.hunks.map((h) => h.path))];
    const proof = r.proof.filter((p) => p.after_edit);
    process.stdout.write(
      `${r.id.slice(0, 8)}  ${r.agent.name}  ${files.length} file(s): ${files.join(', ')}\n` +
        `          why: ${r.why.source === 'none' ? '(none recorded)' : r.why.decision}\n` +
        `          proof after edit: ${proof.length ? proof.map((p) => `${p.kind} exit ${p.exit ?? '?'}`).join(', ') : 'none'}\n`,
    );
  }
  return 0;
}

export async function run(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const json = rest.includes('--json');
  const cwd = process.cwd();
  switch (command) {
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      process.stdout.write(USAGE);
      return 0;
    case '-v':
    case '--version':
      process.stdout.write(`${VERSION}\n`);
      return 0;
    case 'hook': {
      const input = readStdinJson();
      if (input && rest[0] === 'claude-code') handleClaudeCode(input);
      if (input && rest[0] === 'codex') handleCodex(input);
      return 0; // never fail the agent's session
    }
    case 'init':
      return init(cwd, rest);
    case 'doctor':
      return doctor(cwd);
    case 'pending':
      return pending(cwd, json);
    case 'attach':
      return attach(cwd, rest.includes('--quiet'));
    case 'why':
      return why(cwd, rest);
    case 'receipt':
      return receipt(cwd, rest);
    case 'price':
      return price(cwd, rest);
    case 'export':
      return exportTrace(cwd, rest);
    default:
      process.stderr.write(`askwhy: '${command}' is not implemented yet\n\n${USAGE}`);
      return 2;
  }
}
