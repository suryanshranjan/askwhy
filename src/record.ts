// The askwhy record: one per agent turn that edited files.
// Deterministic fields (hunks, proof, price, trace) come only from hooks,
// transcripts and git. Narrative fields (why) carry `source` and are never faked.

export const RECORD_VERSION = 1;

export type AgentName = 'claude-code' | 'codex';

export interface AgentInfo {
  name: AgentName;
  model?: string;
  session_id: string;
  turn_id?: string;
}

export interface PromptInfo {
  text: string; // redacted before storage
  hash: string; // sha256 of the unredacted prompt, so identical prompts match
  ts: string; // ISO-8601
}

export interface Hunk {
  path: string; // repo-relative, forward slashes
  old_range: [number, number] | null; // 1-based inclusive lines before the edit; null for a new file
  new_range: [number, number] | null; // 1-based inclusive lines after the edit; null for a deletion
  content_hash: string; // sha256 of the new content of the hunk
  tool: string; // Edit | Write | MultiEdit | NotebookEdit | apply_patch | bash-diff
  ts: string;
}

export interface Rejected {
  option: string;
  reason: string;
}

export type WhySource = 'agent' | 'user' | 'none';

export interface Why {
  decision: string;
  reason: string;
  rejected: Rejected[];
  source: WhySource;
}

export type ProofKind = 'test' | 'build' | 'lint' | 'typecheck' | 'migrate' | 'deploy' | 'other';

export interface Proof {
  cmd: string;
  exit: number | null; // null when the hook could not read an exit code
  ts: string;
  after_edit: boolean; // ran after the last hunk in this record
  kind: ProofKind;
  summary: string; // short, e.g. "47 passed" or the last stderr line
}

export interface Price {
  usd: number | null; // null when no price table entry for the model
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  turns: number;
}

// Agent Trace v0.1 compatible block, so we interoperate with the spec
// rather than invent a parallel one.
export interface Trace {
  conversation_id: string;
  contributor: 'ai' | 'human' | 'mixed' | 'unknown';
  model_id?: string;
  tool?: string;
}

export interface Record {
  version: typeof RECORD_VERSION;
  id: string; // uuid, stable across pending -> committed
  agent: AgentInfo;
  prompt: PromptInfo | null;
  hunks: Hunk[];
  why: Why;
  proof: Proof[];
  price: Price | null;
  trace: Trace;
  commit?: string; // set once attached to a commit
}

export function emptyWhy(): Why {
  return { decision: '', reason: '', rejected: [], source: 'none' };
}

export function emptyPrice(): Price {
  return {
    usd: null,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    turns: 0,
  };
}
