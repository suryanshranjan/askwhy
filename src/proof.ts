// Classify a shell command as a kind of verification and summarise its output.
// Rules only, no model. Unknown commands are 'other' and still recorded.

import type { ProofKind } from './record.js';

interface Rule {
  kind: ProofKind;
  pattern: RegExp;
}

// Order matters: first match wins. Patterns look at the whole command line,
// so "npm run build && npm test" classifies as test (the last gate).
const RULES: Rule[] = [
  { kind: 'test', pattern: /\b(vitest|jest|mocha|pytest|py\.test|cargo test|go test|npm test|pnpm test|yarn test|bun test|phpunit|rspec|dotnet test|playwright test|cypress run|node --test|run test\b|test:[a-z-]+)/ },
  { kind: 'typecheck', pattern: /\b(tsc\b|typecheck|mypy|pyright|flow check)\b/ },
  { kind: 'lint', pattern: /\b(eslint|ruff|flake8|pylint|clippy|golangci-lint|rubocop|biome (check|lint)|run lint\b|pnpm lint|yarn lint|lint:[a-z-]+)/ },
  { kind: 'build', pattern: /\b(run build\b|pnpm build|yarn build|next build|vite build|cargo build|go build|docker (compose )?build|mvn package|gradle build|make\b)/ },
  { kind: 'migrate', pattern: /\b(prisma migrate|prisma:migrate|alembic upgrade|rails db:migrate|knex migrate|sequelize db:migrate|migrate:deploy|migrate:dev|drizzle-kit (push|migrate))\b/ },
  { kind: 'deploy', pattern: /\b(docker compose .*up|kubectl apply|helm (install|upgrade)|vercel( --prod)?|fly deploy|gh workflow run|terraform apply|ssh .*(deploy|compose))\b/ },
];

export function classifyCommand(cmd: string): ProofKind {
  const flat = cmd.replace(/\s+/g, ' ').trim();
  for (const rule of RULES) {
    if (rule.pattern.test(flat)) return rule.kind;
  }
  return 'other';
}

// Pull a one-line summary out of command output. Prefers test-runner totals,
// falls back to the last non-empty line.
export function summariseOutput(output: string, exit: number | null): string {
  const text = output.replace(/\u001b\[[0-9;]*m/g, ''); // strip ANSI
  // node --test spec reporter: "ℹ tests 12 / ℹ pass 12 / ℹ fail 0"
  const nodePass = /ℹ pass (\d+)/.exec(text);
  const nodeFail = /ℹ fail (\d+)/.exec(text);
  if (nodePass && nodeFail) return `${nodePass[1]} passed, ${nodeFail[1]} failed`;
  const tapPass = /^# pass (\d+)/m.exec(text);
  const tapFail = /^# fail (\d+)/m.exec(text);
  if (tapPass && tapFail) return `${tapPass[1]} passed, ${tapFail[1]} failed`;
  const patterns: RegExp[] = [
    /Tests:\s+(.+)/, // jest: "Tests: 1 failed, 46 passed, 47 total"
    /\bTests\s+(\d+ (?:passed|failed)[^\n]*)/, // vitest: "Tests  3 passed (3)" (skip the "Test Files" line)
    /(\d+ passed(?:, \d+ failed)?(?:, \d+ skipped)?[^\n]*)/, // pytest-ish
    /(\d+ passing(?:\s*\(\S+\))?(?:\n\s*\d+ failing)?)/, // mocha
    /(ok\s+\d+|not ok\s+\d+)[^\n]*/, // node --test TAP
    /(test result: \w+\. \d+ passed; \d+ failed[^\n]*)/, // cargo
    /(\d+ error\(s\)|Found \d+ errors?)[^\n]*/, // tsc
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return (m[1] ?? m[0]).trim().slice(0, 160);
  }
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines.length ? lines[lines.length - 1] : '';
  if (last) return last.slice(0, 160);
  return exit === 0 ? 'exit 0' : exit === null ? 'no exit code' : `exit ${exit}`;
}

// Drop a leading `cd <dir> &&` so the receipt shows the command that mattered.
export function displayCommand(cmd: string): string {
  return cmd.replace(/^\s*cd\s+("[^"]*"|'[^']*'|\S+)\s*(&&|;)\s*/, '').trim();
}
