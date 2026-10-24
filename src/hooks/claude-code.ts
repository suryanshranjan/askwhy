// Claude Code hook handler. Invoked as `askwhy hook claude-code` with the
// hook's JSON on stdin. Never throws out to Claude Code: a failure here must
// not interrupt the user's session, so errors go to a log file and exit 0.

import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mapEditAfter, wholeFile, sha256 } from '../hunks.js';
import { classifyCommand, summariseOutput } from '../proof.js';
import { redact } from '../redact.js';
import { fileAtHead, repoRoot, stateDir, toRepoPath } from '../git.js';
import { upsertPending } from '../pending.js';
import { clearTurn, loadOrStartTurn, loadTurn, saveTurn } from '../turn.js';
import { parseWhyBlock } from '../whyblock.js';
import { usageSince } from '../transcript.js';
import type { Hunk, Proof, Record } from '../record.js';

interface HookInput {
  session_id: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name: string;
  prompt?: string;
  tool_name?: string;
  tool_use_id?: string;
  tool_input?: {
    file_path?: string;
    old_string?: string;
    new_string?: string;
    content?: string;
    command?: string;
    edits?: Array<{ old_string: string; new_string: string }>;
  };
  tool_response?: {
    stdout?: string;
    stderr?: string;
    interrupted?: boolean;
    bashEditDiff?: { changedFiles?: string[] };
  };
  error?: string;
  last_assistant_message?: string;
  stop_hook_active?: boolean;
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function now(): string {
  return new Date().toISOString();
}

function log(cwd: string, msg: string): void {
  try {
    const dir = stateDir(cwd);
    if (dir) appendFileSync(join(dir, 'hooks.log'), `${now()} ${msg}\n`, 'utf8');
  } catch {
    // nothing left to do
  }
}

function readFile(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  } catch {
    return null;
  }
}

function absPath(cwd: string, p: string): string {
  return isAbsolute(p) ? p : resolve(cwd, p);
}

function agentOf(input: HookInput) {
  return { name: 'claude-code' as const, session_id: input.session_id };
}

export function handleClaudeCode(input: HookInput): void {
  const cwd = input.cwd ?? process.cwd();
  const root = repoRoot(cwd);
  if (!root) return; // not a git repo: nothing to record
  try {
    switch (input.hook_event_name) {
      case 'UserPromptSubmit':
        return onPrompt(root, input);
      case 'PostToolUse':
        return onPostToolUse(root, input);
      case 'PostToolUseFailure':
        return onToolFailure(root, input);
      case 'Stop':
        return onStop(root, input);
      default:
        return;
    }
  } catch (err) {
    log(root, `${input.hook_event_name} failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  }
}

function onPrompt(root: string, input: HookInput): void {
  // A new prompt starts a new turn. If the previous turn never reached Stop
  // (interrupted), flush it first so its hunks are not lost.
  const previous = loadTurn(root, input.session_id);
  if (previous && previous.hunks.length > 0) upsertPending(root, previous);
  const rec = loadOrStartTurn(root, agentOf(input));
  const fresh: Record = { ...rec, id: previous ? randomUUID() : rec.id, hunks: [], proof: [], price: null };
  const text = input.prompt ?? '';
  fresh.prompt = { text: redact(text), hash: sha256(text), ts: now() };
  fresh.why = { decision: '', reason: '', rejected: [], source: 'none' };
  saveTurn(root, fresh);
}

function onPostToolUse(root: string, input: HookInput): void {
  const tool = input.tool_name ?? '';
  if (EDIT_TOOLS.has(tool)) return onEdit(root, input, tool);
  if (tool === 'Bash') return onBash(root, input, 0);
}

function onEdit(root: string, input: HookInput, tool: string): void {
  const file = input.tool_input?.file_path;
  if (!file) return;
  const abs = absPath(root, file);
  const after = readFile(abs);
  if (after === null) return;
  const path = toRepoPath(root, abs);
  const rec = loadOrStartTurn(root, agentOf(input));
  const ts = now();
  const hunks: Hunk[] = [];

  if (tool === 'Edit' && input.tool_input?.old_string !== undefined) {
    const m = mapEditAfter(after, input.tool_input.old_string, input.tool_input.new_string ?? '');
    hunks.push({ path, ...m, tool, ts });
  } else if (tool === 'MultiEdit' && input.tool_input?.edits) {
    for (const e of input.tool_input.edits) {
      const m = mapEditAfter(after, e.old_string, e.new_string);
      hunks.push({ path, ...m, tool, ts });
    }
  } else {
    // Write / NotebookEdit: whole-file hunk against HEAD
    const m = wholeFile(after, fileAtHead(root, path));
    hunks.push({ path, ...m, tool, ts });
  }
  rec.hunks.push(...hunks);
  saveTurn(root, rec);
}

function onBash(root: string, input: HookInput, exit: number | null): void {
  const cmd = input.tool_input?.command ?? '';
  if (!cmd) return;
  const rec = loadOrStartTurn(root, agentOf(input));
  const ts = now();
  const out = `${input.tool_response?.stdout ?? ''}\n${input.tool_response?.stderr ?? ''}`;
  const proof: Proof = {
    cmd: redact(cmd).slice(0, 500),
    exit,
    ts,
    after_edit: rec.hunks.length > 0,
    kind: classifyCommand(cmd),
    summary: redact(summariseOutput(out, exit)),
  };
  rec.proof.push(proof);

  // Files changed by the command itself (sed, scripts): whole-file hunks.
  for (const changed of input.tool_response?.bashEditDiff?.changedFiles ?? []) {
    const abs = absPath(root, changed);
    const after = readFile(abs);
    if (after === null) continue;
    const path = toRepoPath(root, abs);
    rec.hunks.push({ path, ...wholeFile(after, fileAtHead(root, path)), tool: 'bash-diff', ts });
  }
  saveTurn(root, rec);
}

function onToolFailure(root: string, input: HookInput): void {
  if (input.tool_name !== 'Bash') return;
  const m = /Exit code (\d+)/.exec(input.error ?? '');
  const exit = m ? Number(m[1]) : null;
  const failed: HookInput = {
    ...input,
    tool_response: { stdout: '', stderr: input.error ?? '' },
  };
  onBash(root, failed, exit);
}

function onStop(root: string, input: HookInput): void {
  const rec = loadTurn(root, input.session_id);
  if (!rec) return;
  if (input.last_assistant_message) {
    const why = parseWhyBlock(input.last_assistant_message);
    if (why) rec.why = why;
  }
  if (input.transcript_path) {
    const usage = usageSince(input.transcript_path, rec.prompt?.ts ?? null, root);
    if (usage) {
      rec.price = usage.price;
      if (usage.model) {
        rec.agent.model = usage.model;
        rec.trace.model_id = usage.model;
      }
    }
  }
  if (rec.hunks.length > 0) {
    upsertPending(root, rec);
    clearTurn(root, input.session_id);
  } else {
    // keep the prompt around: a later edit in the same turn (after a stop
    // hook continuation) still belongs to it
    saveTurn(root, rec);
  }
}

export function readStdinJson(): HookInput | null {
  try {
    const raw = readFileSync(0, 'utf8');
    return raw.trim() ? (JSON.parse(raw) as HookInput) : null;
  } catch {
    return null;
  }
}
