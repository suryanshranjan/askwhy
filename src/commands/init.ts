// `askwhy init`: wire the current repo up.
//  - Claude Code hooks in .claude/settings.json (project scope, opt-in per repo)
//  - git alias `git why`
//  - notes.rewriteRef so rebase/amend carry refs/notes/why
//  - post-commit hook that attaches pending records
//  - the `why:` instruction block for the agent (CLAUDE.md section)

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
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

export function installAgentBlock(root: string, local = false, name?: string): string {
  const file = join(root, name ?? (local ? 'CLAUDE.local.md' : 'CLAUDE.md'));
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (local && !name) excludeLocally(root, 'CLAUDE.local.md');
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
  if (!args.includes('--no-codex') && codexPresent()) {
    const file = installCodexHooks(root, `${baseCommand()} hook codex`, local);
    process.stdout.write(`codex hooks: ${file}\n  trust them once in Codex with /hooks (project .codex/ must be trusted)\n`);
    if (!local) process.stdout.write(`${installAgentBlock(root, false, 'AGENTS.md')}\n`);
    else process.stdout.write('  --local: AGENTS.md left alone, so Codex records will have no `why` until it is added\n');
  }
  for (const line of installGit(root)) process.stdout.write(`${line}\n`);
  process.stdout.write(`${installAgentBlock(root, local)}\n`);
  process.stdout.write('\nNext: edit something with your agent, commit, then run `git why <file>`.\n');
  return 0;
}

function codexPresent(): boolean {
  return existsSync(join(homedir(), '.codex'));
}

// Codex reads project hooks from <repo>/.codex/hooks.json (same shape as
// Claude Code's). With --local the file is kept out of git via info/exclude.
export function installCodexHooks(root: string, command: string, local: boolean): string {
  const dir = join(root, '.codex');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, 'hooks.json');
  let cfg: Settings = {};
  if (existsSync(file)) {
    try {
      cfg = JSON.parse(readFileSync(file, 'utf8')) as Settings;
    } catch {
      throw new Error(`${file} is not valid JSON; fix it and re-run`);
    }
  }
  cfg.hooks ??= {};
  for (const event of ['UserPromptSubmit', 'PostToolUse', 'Stop'] as const) {
    const list = (cfg.hooks[event] ??= []);
    if (list.some((e) => e.hooks.some((h) => h.command.includes('hook codex')))) continue;
    list.push({ hooks: [{ type: 'command', command, timeout: 20 }] });
  }
  writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  if (local) excludeLocally(root, '.codex/hooks.json');
  return file;
}

function excludeLocally(root: string, pattern: string): void {
  const dir = gitDir(root);
  if (!dir) return;
  const file = join(dir, 'info', 'exclude');
  const body = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (body.split('\n').includes(pattern)) return;
  mkdirSync(join(dir, 'info'), { recursive: true });
  writeFileSync(file, body.replace(/\s*$/, body ? '\n' : '') + pattern + '\n', 'utf8');
}
