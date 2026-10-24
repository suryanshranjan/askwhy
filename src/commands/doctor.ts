// `askwhy doctor`: is this repo wired up, and is anything waiting?

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOTES_REF, gitDir, repoRoot, tryGit } from '../git.js';
import { readPending } from '../pending.js';

export function doctor(cwd: string): number {
  const root = repoRoot(cwd);
  if (!root) {
    process.stderr.write('not inside a git repository\n');
    return 1;
  }
  const checks: Array<[boolean, string]> = [];

  const settingsFiles = ['settings.json', 'settings.local.json'].map((f) => join(root, '.claude', f));
  const hooked = settingsFiles.filter((file) => {
    if (!existsSync(file)) return false;
    try {
      return JSON.stringify(JSON.parse(readFileSync(file, 'utf8'))).includes('hook claude-code');
    } catch {
      return false;
    }
  });
  checks.push([hooked.length > 0, `Claude Code hooks in ${hooked[0] ?? settingsFiles[0]}`]);

  checks.push([tryGit(['config', '--get', 'alias.why'], root) !== null, 'git alias `git why`']);
  checks.push([tryGit(['config', '--get', 'notes.rewriteRef'], root) === NOTES_REF, `notes.rewriteRef = ${NOTES_REF}`]);

  const dir = gitDir(root);
  const postCommit = dir ? join(dir, 'hooks', 'post-commit') : '';
  checks.push([!!postCommit && existsSync(postCommit) && readFileSync(postCommit, 'utf8').includes('askwhy'), 'post-commit hook attaches records']);

  const hasBlock = ['CLAUDE.md', 'CLAUDE.local.md'].some((f) => {
    const p = join(root, f);
    return existsSync(p) && readFileSync(p, 'utf8').includes('## askwhy');
  });
  checks.push([hasBlock, 'CLAUDE.md or CLAUDE.local.md asks the agent for a `why` block']);

  const notes = tryGit(['notes', `--ref=${NOTES_REF}`, 'list'], root);
  const noteCount = notes ? notes.split('\n').filter(Boolean).length : 0;
  const pending = readPending(root).filter((r) => !r.commit).length;

  for (const [ok, label] of checks) process.stdout.write(`${ok ? 'ok  ' : 'MISS'} ${label}\n`);
  process.stdout.write(`\n${noteCount} commit(s) with records, ${pending} pending record(s)\n`);
  const missing = checks.filter(([ok]) => !ok).length;
  if (missing) process.stdout.write(`\nrun \`askwhy init\` to fix ${missing} item(s)\n`);
  return missing ? 1 : 0;
}
