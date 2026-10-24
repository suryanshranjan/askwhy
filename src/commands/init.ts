// `askwhy init`: wire the current repo up.
//  - Claude Code hooks in .claude/settings.json (project scope, opt-in per repo)
//  - git alias `git why`
//  - notes.rewriteRef so rebase/amend carry refs/notes/why
//  - post-commit hook that attaches pending records
//  - the `why:` instruction block for the agent (CLAUDE.md section)

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOTES_REF, git, gitDir, repoRoot, tryGit } from '../git.js';

const EVENTS = ['UserPromptSubmit', 'PostToolUse', 'PostToolUseFailure', 'Stop'] as const;

interface HookEntry {
  matcher?: string;
  hooks: Array<{ type: 'command'; command: string; timeout?: number }>;
}
interface Settings {
  hooks?: Record<string, HookEntry[]>;
  [k: string]: unknown;
}

// How Claude Code should invoke us. A global install exposes `askwhy`; a
// local checkout (dogfooding) points at this very file's compiled sibling.
export function baseCommand(): string {
  const override = process.env.ASKWHY_COMMAND;
  if (override) return override;
  if (process.env.npm_config_global === 'true') return 'askwhy';
  const self = fileURLToPath(import.meta.url); // .../dist/commands/init.js
  const cli = join(self, '..', '..', 'cli.js');
  return `node "${cli.split('\\').join('/')}"`;
}

export function hookCommand(): string {
  return `${baseCommand()} hook claude-code`;
}

const AGENT_BLOCK = `## askwhy

When you finish a turn in which you edited files, end your reply with a fenced \`why\` block so the reason survives next to the code:

\`\`\`why
decision: <what you chose, one line>
reason: <why, one line>
rejected: <alternative you considered> | <why it lost>
\`\`\`

Only state decisions you actually made. Leave out \`rejected\` if nothing was rejected. Do not invent alternatives.
`;

export function installClaudeHooks(root: string, command: string, local = false): string {
  const dir = join(root, '.claude');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, local ? 'settings.local.json' : 'settings.json');
  let settings: Settings = {};
  if (existsSync(file)) {
    try {
      settings = JSON.parse(readFileSync(file, 'utf8')) as Settings;
    } catch {
      throw new Error(`${file} is not valid JSON; fix it and re-run`);
    }
  }
  settings.hooks ??= {};
  for (const event of EVENTS) {
    const list = (settings.hooks[event] ??= []);
    const already = list.some((e) => e.hooks.some((h) => h.command.includes('hook claude-code')));
    if (already) continue;
    const entry: HookEntry = { hooks: [{ type: 'command', command, timeout: 20 }] };
    if (event === 'PostToolUse' || event === 'PostToolUseFailure') entry.matcher = 'Edit|Write|MultiEdit|NotebookEdit|Bash';
    list.push(entry);
  }
  writeFileSync(file, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return file;
}

export function installGit(root: string): string[] {
  const done: string[] = [];
  const base = baseCommand();
  git(['config', 'alias.why', `!${base} why`], root);
  done.push('git alias: git why');
  git(['config', 'notes.rewriteRef', NOTES_REF], root);
  git(['config', '--add', 'notes.displayRef', NOTES_REF], root);
  done.push(`notes: ${NOTES_REF} shown in git log, carried on rebase/amend`);

  const dir = gitDir(root);
  if (dir) {
    const hooksDir = join(dir, 'hooks');
    if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });
    const hook = join(hooksDir, 'post-commit');
    const line = `${base} attach --quiet >/dev/null 2>&1 || true`;
    const marker = '# askwhy';
    let body = existsSync(hook) ? readFileSync(hook, 'utf8') : '#!/bin/sh\n';
    if (!body.includes(marker)) {
      body = body.replace(/\s*$/, '\n') + `${marker}\n${line}\n`;
      writeFileSync(hook, body, 'utf8');
      try {
        chmodSync(hook, 0o755);
      } catch {
        // windows: mode bits are not meaningful
      }
      done.push('git hook: post-commit attaches pending records');
    } else {
      done.push('git hook: post-commit already installed');
    }
  }
  return done;
}

export function installAgentBlock(root: string, local = false): string {
  const file = join(root, local ? 'CLAUDE.local.md' : 'CLAUDE.md');
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (existing.includes('## askwhy')) return `${file} already has the askwhy section`;
  writeFileSync(file, existing.replace(/\s*$/, existing ? '\n\n' : '') + AGENT_BLOCK, 'utf8');
  return `${file}: added the askwhy section`;
}

// `--local` keeps everything out of version control: .claude/settings.local.json
// and CLAUDE.local.md instead of the shared files. Right for trying askwhy on
// a repo you do not own the config of.
export function init(cwd: string, args: string[] = []): number {
  const root = repoRoot(cwd);
  if (!root) {
    process.stderr.write('askwhy init: not inside a git repository\n');
    return 1;
  }
  const local = args.includes('--local');
  const command = hookCommand();
  const settings = installClaudeHooks(root, command, local);
  process.stdout.write(`claude code hooks: ${settings}\n  command: ${command}\n`);
  for (const line of installGit(root)) process.stdout.write(`${line}\n`);
  process.stdout.write(`${installAgentBlock(root, local)}\n`);
  process.stdout.write('\nNext: edit something with Claude Code, commit, then run `git why <file>`.\n');
  return 0;
}
