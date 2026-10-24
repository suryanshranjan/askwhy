# askwhy

Ask why any line exists. Provenance for agent-written code, for Git.

Per-hunk provenance for agent-written code. For every change a coding agent makes, askwhy keeps five facts next to the code, in git:

- **why**: the decision and the reason
- **rejected**: the alternatives the agent considered and dropped
- **prompt**: what you asked, which agent, which model
- **proof**: what was verified after the edit, with exit codes, or "claimed, not run"
- **price**: what the change cost

```
$ git why src/payments/retry.ts:42
src/payments/retry.ts:42-67
  why      Chose retry-with-jitter over circuit breaker: upstream is flaky, not down
  rejected circuit breaker (would mask the 5xx we alert on)
  prompt   "make the payout worker survive Razorpay timeouts" · Claude Code · claude-fable-5-1
  proof    npm test · 47 passed · exit 0 · ran after this edit
  price    $1.84 · 38k tokens · 6 turns
```

Local only. No daemon, no network, no model calls. Records are deterministic where they can be (hunks, proof, price, trace) and clearly marked where they are the agent's own account (why, rejected).

## Status

Pre-alpha, Claude Code only, dogfooding on a real repo. Working today:

- `askwhy init [--local]`: Claude Code hooks, `git why` alias, notes ref, post-commit hook, agent instruction block
- capture of prompt, Edit/Write/MultiEdit hunks (line ranges + content hash), Bash-made file changes, every command with exit code and a one-line summary, token usage and price from the transcript, the agent's `why` block
- `askwhy attach` on commit, `git why <path>[:<line>]` via git blame, `askwhy pending`, `askwhy doctor`

Not yet: `receipt` and `price` views, Codex capture, `export`, npm publish. See `docs/PLAN.md`.

## Install (target)

```
npx askwhy init
```

Detects Claude Code and Codex, installs their hooks, adds a `post-commit` git hook, sets up `refs/notes/why`, and adds the `git why` alias.

## Commands (target)

```
askwhy init              detect agents, install hooks, notes ref, git alias
git why <path>[:<line>]  intent for the hunk covering a line
askwhy receipt [sha]     proof for a commit or the pending turn
askwhy price [--since]   cost per change, per session, per agent
askwhy pending           records waiting for a commit
askwhy export            Agent Trace JSON for a range
askwhy doctor            hooks installed? notes ref ok? agents detected?
```

## License

Apache-2.0
