// Antigravity (Google's agent IDE) adapter. Its hooks carry no tool
// arguments (PostToolUse only sends a step index), but every conversation
// keeps a JSONL transcript with the user input, each tool call's arguments
// and each command's exit code. So askwhy installs a single Stop hook and,
// when it fires, replays the new transcript steps through the same handler
// Claude Code and Codex use. A cursor per conversation remembers how far it
// got, so each step is recorded once.

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { repoRoot, stateDir } from '../git.js';
import { handleHook, type HookInput } from './core.js';
import type { Why } from '../record.js';

export interface AntigravityInput {
  conversationId?: string;
  transcriptPath?: string;
  workspacePaths?: string[];
  modelName?: string;
  terminationReason?: string;
}

interface Step {
  step_index: number;
  source?: string;
  type?: string;
  status?: string;
  created_at?: string;
  content?: string;
  exit_code?: number;
  tool_calls?: { name: string; args: { [k: string]: unknown } }[];
}

const PRODUCTS = ['antigravity-ide', 'antigravity', 'antigravity-cli'];

export function handleAntigravity(input: AntigravityInput, cwd = process.cwd()): void {
  const conv = input.conversationId;
  if (!conv) return;
  const root = repoRoot(input.workspacePaths?.[0] ?? cwd) ?? repoRoot(cwd);
  if (!root) return;
  const transcript = transcriptFor(conv, input.transcriptPath);
  if (!transcript) return;
  const cursorFile = join(stateDir(root) ?? join(root, '.git', 'why'), 'antigravity', `${conv}.json`);
  const done = readCursor(cursorFile);
  const steps = readSteps(transcript).filter((s) => s.step_index > done);
  if (steps.length === 0) return;
  const last = replay(root, conv, steps, input);
  mkdirSync(dirname(cursorFile), { recursive: true });
  writeFileSync(cursorFile, JSON.stringify({ step_index: last }), 'utf8');
}

// Exported for tests: turn transcript steps into the hook events askwhy
// already understands, then close the turn.
export function replay(root: string, conv: string, steps: Step[], input: AntigravityInput = {}): number {
  const model = input.modelName && input.modelName !== 'auto' ? input.modelName : undefined;
  const base = { agent: 'antigravity' as const, session_id: conv, cwd: root, model };
  const queue: { name: string; args: { [k: string]: unknown } }[] = [];
  const background = backgroundResults(steps);
  const descriptions: string[] = [];
  let lastMessage = '';
  let prev = 0;
  const stamp = (s: Step): string => {
    // created_at has 1s resolution; keep events strictly ordered
    prev = Math.max(prev + 1, Date.parse(s.created_at ?? '') || 0);
    return new Date(prev).toISOString();
  };

  let open = false; // a turn has started and not been closed
  const close = (): void => {
    if (!open) return;
    prev += 1;
    handleHook({
      ...base,
      ts: new Date(prev).toISOString(),
      hook_event_name: 'Stop',
      last_assistant_message: lastMessage,
      why_fallback: fromDescriptions(descriptions),
    });
    open = false;
  };

  for (const s of steps) {
    const ts = stamp(s);
    if (s.type === 'USER_INPUT') {
      close(); // one conversation holds many turns; each user message ends the previous one
      queue.length = 0;
      descriptions.length = 0;
      lastMessage = '';
      handleHook({ ...base, ts, hook_event_name: 'UserPromptSubmit', prompt: userRequest(s.content ?? '') });
      open = true;
      continue;
    }
    open = true;
    if (s.type === 'PLANNER_RESPONSE') {
      if (s.content) lastMessage = s.content;
      // results belong to the planner step just before them; a call whose
      // result never got logged must not shift every later pairing
      queue.splice(0, queue.length, ...(s.tool_calls ?? []));
      continue;
    }
    if (s.source !== 'MODEL') continue;
    const call = queue.shift();
    if (!call || (RESULT_TYPE[call.name] && RESULT_TYPE[call.name] !== s.type)) continue;
    const ev = toolEvent(root, call, s, background);
    if (!ev) continue;
    if (typeof call.args.Description === 'string' && call.args.Description) descriptions.push(call.args.Description);
    handleHook({ ...base, ts, hook_event_name: 'PostToolUse', ...ev });
  }

  close();
  return steps[steps.length - 1].step_index;
}

const RESULT_TYPE: { [tool: string]: string } = {
  run_command: 'RUN_COMMAND',
  write_to_file: 'CODE_ACTION',
  replace_file_content: 'CODE_ACTION',
  multi_replace_file_content: 'CODE_ACTION',
  view_file: 'VIEW_FILE',
  list_dir: 'LIST_DIRECTORY',
  grep_search: 'GREP_SEARCH',
};

// A long command runs as a background task: its RUN_COMMAND step says
// "running as a background task with task id: X", and a later system message
// says 'Task id "X" finished with result: The command exited with code N'.
function backgroundResults(steps: Step[]): Map<string, { exit: number | null; out: string }> {
  const done = new Map<string, { exit: number | null; out: string }>();
  for (const s of steps) {
    const m = /Task id "([^"]+)" finished with result:\s*([\s\S]*)/.exec(s.content ?? '');
    if (!m) continue;
    const code = /exited with code (-?\d+)/.exec(m[2]);
    done.set(m[1], { exit: code ? Number(code[1]) : null, out: m[2] });
  }
  return done;
}

function toolEvent(
  root: string,
  call: { name: string; args: { [k: string]: unknown } },
  s: Step,
  background: Map<string, { exit: number | null; out: string }>,
): Partial<HookInput> | null {
  const a = call.args;
  if (call.name === 'run_command') {
    const cmd = str(a.CommandLine);
    if (!cmd) return null;
    let exit = typeof s.exit_code === 'number' ? s.exit_code : undefined;
    let out = commandOutput(s.content ?? '');
    const task = /background task with task id:\s*(\S+)/.exec(s.content ?? '');
    const result = task ? background.get(task[1]) : undefined;
    if (result) {
      exit = result.exit ?? undefined;
      out = commandOutput(result.out);
    }
    return { tool_name: 'run_command', tool_input: { command: cmd }, tool_response: { output: out, exit_code: exit } };
  }
  if (s.status && s.status !== 'DONE') return null; // edit failed: nothing landed
  const file = str(a.TargetFile);
  if (!file || !insideRepo(root, file)) return null; // e.g. plan artifacts in the agent's own folder
  if (call.name === 'write_to_file') return { tool_name: call.name, tool_input: { file_path: file } };
  if (call.name === 'replace_file_content') {
    return {
      tool_name: call.name,
      tool_input: { file_path: file, old_string: str(a.TargetContent), new_string: str(a.ReplacementContent) },
    };
  }
  if (call.name === 'multi_replace_file_content') {
    const chunks = parseChunks(a.ReplacementChunks);
    return {
      tool_name: call.name,
      tool_input: {
        file_path: file,
        edits: chunks.map((c) => ({ old_string: str(c.TargetContent), new_string: str(c.ReplacementContent) })),
      },
    };
  }
  return null;
}

function parseChunks(v: unknown): { TargetContent?: unknown; ReplacementContent?: unknown }[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

// "<USER_REQUEST>\n...\n</USER_REQUEST>\n<ADDITIONAL_METADATA>..." -> the request.
// Approving a plan sends an empty request with the approval text before it.
export function userRequest(content: string): string {
  const m = /<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/.exec(content);
  if (!m) return content.trim();
  return m[1] || content.slice(0, m.index).trim();
}

// Drop the timing header and "The command exited with code N." preamble.
function commandOutput(content: string): string {
  const i = content.indexOf('Output:');
  const body = i >= 0 ? content.slice(i + 'Output:'.length) : content;
  return body
    .replace(/^\s+/gm, (m) => m.replace(/\t/g, ''))
    .replace(/\n?Terminal ID: \d+\s*$/, '') // appended by Antigravity, not command output
    .trim();
}

// Antigravity asks the model for a Description on every edit; with no why
// block, those are the agent's own account of the change.
function fromDescriptions(ds: string[]): Why | undefined {
  const unique = [...new Set(ds.map((d) => d.trim()).filter(Boolean))];
  if (unique.length === 0) return undefined;
  return { decision: unique[0], reason: unique.slice(1).join('; '), rejected: [], source: 'agent' };
}

function insideRepo(root: string, file: string): boolean {
  const real = (p: string): string => {
    try {
      return realpathSync.native(p);
    } catch {
      return p;
    }
  };
  const rel = relative(real(root), real(file));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function transcriptFor(conv: string, given?: string): string | null {
  const candidates: string[] = [];
  if (given) {
    candidates.push(given.replace(/transcript\.jsonl$/, 'transcript_full.jsonl'), given);
  }
  for (const p of PRODUCTS) {
    const logs = join(homedir(), '.gemini', p, 'brain', conv, '.system_generated', 'logs');
    candidates.push(join(logs, 'transcript_full.jsonl'), join(logs, 'transcript.jsonl'));
  }
  return candidates.find((c) => existsSync(c)) ?? null;
}

function readSteps(path: string): Step[] {
  const out: Step[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const s = JSON.parse(line) as Step;
      if (typeof s.step_index === 'number') out.push(s);
    } catch {
      // a line still being written
    }
  }
  return out.sort((a, b) => a.step_index - b.step_index);
}

function readCursor(file: string): number {
  try {
    return (JSON.parse(readFileSync(file, 'utf8')) as { step_index: number }).step_index;
  } catch {
    return -1;
  }
}
