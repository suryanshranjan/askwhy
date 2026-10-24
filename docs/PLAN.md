# gitwhy v1 plan

Approved 2026-10-24. Working name `gitwhy` (npm `why` was taken). Three weeks, Claude Code + Codex only.

## Context

Every change a coding agent makes carries five facts that today die with the chat window: the prompt, the decision and its reason, the alternatives it rejected, whether it actually verified the change, and what the change cost. Only the code survives.

Research (2026-10-24) established:

- The pain is loud and unowned. "Comprehension debt" 532 HN points; Stack Overflow 2026 (30k devs): 78.7% need attribution to trust AI code, 6.6% trust it for important decisions; PR review time +441% (Faros). Anthropic's RCT: AI-assisted devs understood their code 17% less.
- Attribution ("AI wrote this line") is commoditised: Cursor Blame, Git AI (team hired into OpenAI, Sep 2026), Entire `blame`, Cursor's Agent Trace spec. The "why" layer is empty: nobody ships decision + rejected alternatives + evidence + cost per hunk, cross-agent, rendered on GitHub. The closest attempt (Casefile) has 3 stars.
- What gets paid for: PR review (CodeRabbit $15M ARR, Greptile eight figures) and observability (Langfuse acquired, Braintrust ~$800M). Memory and context tools are free-tier funnels.
- The shape of the winners (superpowers 304k, graphify 134k, claude-mem 103k, RTK 84k): one command, no account, rides the agent's own hooks, multi-agent from day one, local and deterministic, produces a screenshot. Claude-Code-only tools stall under ~30k stars.
- Vendor-proof by construction: cross-agent and cross-forge, and the price field exposes what flat-rate plans hide.
- Risks on record: the "why" is the agent's self-narration (gameable, sometimes wrong); attribution through squash-merge needs forge cooperation; the vendor window is 12–18 months.

## Product

One ledger, three views: `git why` (intent per hunk), receipt (proof per change), price (cost per change).

Free: local CLI, git-notes storage, all three views, all agents.
Paid, later: hosted layer rendering the same data on GitHub/GitLab PR hunks, review-bot integration, compliance export ("which production changes were AI-written"), team cost dashboards.

## Data model

One record per agent turn that edited files, attached to the commit as a git note on `refs/notes/why`.

```
version: 1
agent:    { name: claude-code | codex, model, session_id, turn_id }
prompt:   { text (redacted), hash, ts }
hunks:    [ { path, old_range, new_range, content_hash } ]
why:      { decision, reason, rejected: [ { option, reason } ], source: agent | user | none }
proof:    [ { cmd, exit, ts, after_edit, kind: test|build|lint|typecheck|migrate|deploy|other, summary } ]
price:    { usd, input_tokens, output_tokens, cache_read_tokens, turns }
trace:    Agent Trace v0.1 block (conversation id, contributor type, model_id)
```

Rules: deterministic fields (hunks, proof, price, trace) come only from hooks, transcripts and git. Narrative fields (why, rejected) carry `source` and are never faked. Missing is shown as missing. Emit an Agent Trace block so we ride the spec instead of fighting it.

## Capture

Claude Code (primary):

- `UserPromptSubmit`: prompt text + hash, session_id.
- `PostToolUse` on `Edit|Write|MultiEdit|NotebookEdit`: path, old/new string → hunk ranges + content hash. For Bash-driven edits, diff the working tree before/after `Bash` (fallback).
- `PostToolUse` on `Bash`: command, exit code, stdout tail → proof candidates, classified.
- `Stop`: close the turn. Read `transcript_path` for usage fields → price. Parse the `why:` block the agent was asked to emit. Write the pending record.
- git `post-commit` (installed by `gitwhy init`): attach pending records to the commit as a note; re-map hunks to the committed diff.

Codex (secondary): `UserPromptSubmit`, `PostToolUse`. Edits arrive as `apply_patch` V4A patch strings → parse to hunks. Usage from `codex exec --json` `turn.completed.usage`; price from a local model price table.

Cursor and Gemini CLI: v2.

## The "why" without an LLM in the loop

`gitwhy init` installs a short instruction block (Claude Code: a skill; Codex: AGENTS.md section) asking the agent, at the end of any turn that edited files, to emit a fenced `why:` block (decision, reason, rejected alternatives). The Stop hook parses it. If absent, `why.source = none` and `git why` says "no recorded intent". Strict mode (opt-in) blocks the Stop until the block is present. gitwhy itself never calls a model.

## Storage and git behaviour

- Notes on `refs/notes/why`. `gitwhy init` sets `notes.rewriteRef` so rebase and amend carry notes, and installs `post-commit`.
- Pending (uncommitted) records in `.git/why/pending.jsonl`; attached on commit; `gitwhy pending` lists orphans.
- Squash-merge on hosted forges: documented limitation in v1; the hosted tier re-attaches by content hash.
- Redaction: prompts pass a secret scanner (keys, tokens, `.env` values) before storage; `gitwhy config redact` for custom patterns.

## CLI

```
gitwhy init              detect agents, install hooks, notes ref, git alias
git why <path>[:<line>]  intent for the hunk covering a line (default: last change to file)
gitwhy receipt [sha]     proof for a commit or the pending turn
gitwhy price [--since]   cost per change, per session, per agent; $/merged-line
gitwhy pending           records waiting for a commit
gitwhy export            Agent Trace JSON for a range
gitwhy doctor            hooks installed? notes ref ok? agents detected?
```

Plain text output, `--json` everywhere. No daemon. No network.

## Stack

TypeScript, Node ≥ 20, one npm package (`npx gitwhy init`). Zero runtime dependencies; hooks are JSON-over-stdin scripts. A Rust/Go binary is a v2 option if install friction shows.

## Weeks

1. Record schema; Claude Code hooks (prompt, edit, bash, stop); pending store; `gitwhy doctor`; `gitwhy init` for Claude Code. Dogfood on BarterNow daily.
2. Notes writer + post-commit; `git why`; `gitwhy receipt`; proof classifier; redaction; the `why:` instruction block and parser.
3. `gitwhy price`; Codex capture; `gitwhy export`; README with the three screenshots; launch.

## Out of v1

Hosted/GitHub rendering, Cursor and Gemini capture, cross-agent session handoff, compaction-ledger injection (v2, falls out of the records), any LLM summarisation.

## Verification

- Unit: hunk mapping from `old_string`/`new_string` to line ranges on real diffs; V4A patch parser; proof classifier against ~50 real commands; redaction fixtures.
- Integration: run Claude Code headless (`claude -p --output-format json --bare`) on a fixture repo with hooks installed. Assert one record per edited file; proof attached when a test ran after the edit; `why.source = none` when no block emitted; note present after commit; `git why` prints it.
- Dogfood: installed on BarterNow for all three weeks. Weekly: `git why` answers a real "why is this here" question in under 10 seconds; the ledger survives a compaction and a `/clear`.
- Launch gate: three true screenshots (a `git why` answer, a receipt that caught "tests pass" with no run, a `gitwhy price` table); install to first `git why` under 2 minutes on a clean machine.

## Launch

X and Reddit with the three screenshots; README leads with `git why`. Target the "comprehension debt" conversation, not the token conversation. Multi-agent in the headline.

## Decisions

- Name: `gitwhy` (npm free as of 2026-10-24). GitHub handle to confirm.
- Language: TypeScript.
- License: Apache-2.0 for the CLI; hosted tier closed.
- Repo public from the first commit.
