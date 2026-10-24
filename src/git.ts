// Thin git helpers. Everything shells out to the user's git; no library.

import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

export const NOTES_REF = 'refs/notes/why';

export function git(args: string[], cwd: string, opts: ExecFileSyncOptions = {}): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: [opts.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    ...opts,
  }) as string;
}

export function tryGit(args: string[], cwd: string): string | null {
  try {
    return git(args, cwd).trim();
  } catch {
    return null;
  }
}

export function repoRoot(cwd: string): string | null {
  return tryGit(['rev-parse', '--show-toplevel'], cwd);
}

export function gitDir(cwd: string): string | null {
  const dir = tryGit(['rev-parse', '--git-dir'], cwd);
  return dir ? resolve(cwd, dir) : null;
}

// The hooks directory git will actually run from: honours core.hooksPath and
// worktrees (which share the main repo's hooks).
export function hooksDir(cwd: string): string | null {
  const p = tryGit(['rev-parse', '--git-path', 'hooks'], cwd);
  return p ? resolve(cwd, p) : null;
}

// Where pending (uncommitted) records live: <gitdir>/why/
export function stateDir(cwd: string): string | null {
  const dir = gitDir(cwd);
  if (!dir) return null;
  const state = join(dir, 'why');
  if (!existsSync(state)) mkdirSync(state, { recursive: true });
  return state;
}

// Windows can hand us the same directory as a short (DEVANS~1) and a long
// path; resolve both through the filesystem before comparing.
function canonical(p: string): string {
  try {
    return realpathSync.native(p);
  } catch {
    return resolve(p);
  }
}

export function toRepoPath(root: string, absPath: string): string {
  return relative(canonical(root), canonical(absPath)).split(sep).join('/');
}

export function headSha(cwd: string): string | null {
  return tryGit(['rev-parse', 'HEAD'], cwd);
}

export function fileAtHead(cwd: string, repoPath: string): string | null {
  return tryGit(['show', `HEAD:${repoPath}`], cwd);
}

export function readNote(cwd: string, sha: string): string | null {
  return tryGit(['notes', `--ref=${NOTES_REF}`, 'show', sha], cwd);
}

export function writeNote(cwd: string, sha: string, body: string): void {
  git(['notes', `--ref=${NOTES_REF}`, 'add', '-f', '-F', '-', sha], cwd, { input: body });
}
