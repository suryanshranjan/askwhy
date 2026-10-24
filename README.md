# askwhy

Ask why any line exists. Provenance for agent-written code, for Git.

`git blame` tells you who. For every change a coding agent makes, askwhy keeps five facts next to the code, in git notes:

- **why**: the decision and the reason
- **rejected**: the alternatives the agent considered and dropped
- **prompt**: what you asked, which agent, which model
- **proof**: what was verified after the edit, with exit codes, or that nothing was
- **price**: what the change cost

Real output from the first run on a production codebase (Claude Code, Opus 5.5):

```
$ git why Backend/src/modules/common/services/phone.util.js:5
Backend/src/modules/common/services/phone.util.js:5-13  (5b1ca075)
  why      added `0091` to the existing prefix list in the regex instead of adding a separate check
  because  smallest change; a number with a `0091` prefix is always 14 digits, so it can't be confused with the `+91`, `91` or `0` forms
  rejected leaving the old `'00919876543210' → null` assertion (it contradicts the requested behaviour and would fail)
  prompt   "In Backend/src/modules/common/services/phone.util.js, make normalizeIndianPhone also accept the internation..."
  agent    claude-code · claude-opus-5-5
  proof    nothing ran
  price    $0.32 · 145k tokens · 3 turns

$ askwhy receipt HEAD
· UNVERIFIED  5b1ca075  ·  claude-code · claude-opus-5-5
  files    Backend/src/modules/common/services/phone.util.js, Backend/tests/phone.util.test.js
  ran      nothing
  verdict  no test/build/lint/typecheck ran after the last edit
```

Local only. No daemon, no network, no model calls. Records are deterministic where they can be (hunks, proof, price, trace) and marked as the agent's own account where they are not (why, rejected).

## How it works

1. `askwhy init` installs hooks into the agent (Claude Code `.claude/settings.json`, Codex `.codex/hooks.json`), a `post-commit` git hook, the `git why` alias, and a short instruction asking the agent to end edit turns with a fenced `why` block.
2. During a turn the hooks record the prompt (secrets redacted), every edit as line ranges plus a content hash, every shell command with its exit code and a one-line summary, and the agent's `why` block.
3. Token usage comes from the agent's own transcript and is priced from a built-in table (override in `.git/why/prices.json`). Unknown models stay unpriced; nothing is estimated.
4. On commit, pending records for the committed files move into a note on `refs/notes/why`. `git why` uses `git blame` to find the commit that last touched a line, then the record whose hunk covers it.

## Install

Not on npm yet. From a checkout:

```
npm install && npm run build
cd /path/to/your/repo
node /path/to/askwhy/dist/cli.js init            # or --local to keep config out of git
```

Codex: trust the new hooks once with `/hooks` inside Codex.

## Commands

```
askwhy init [--local] [--no-codex]   install hooks, notes ref, git alias, agent instruction
git why <path>[:<line>] [--json]     intent for the hunk covering a line, or a file's history
askwhy receipt [sha|pending]         what was verified after the edit; exit 3 if a claim was not backed
askwhy price [--since 7d] [--by commit|agent|session|file]
                                     cost per change and $ per line that actually landed
askwhy pending                       records waiting for a commit
askwhy export [--since 7d]           Agent Trace v0.1 JSON, with why/proof/price in metadata
askwhy doctor                        is this repo wired up?
```

## Status

Pre-alpha.

- Claude Code: verified end to end on a real repo (capture, commit, `git why`, `receipt`, `price`, `export`).
- Codex: implemented from the documented hook format and the real rollout log format; not yet verified against a live Codex session.
- Not yet: Cursor and Gemini CLI, hosted PR view, npm package.

## License

Apache-2.0
