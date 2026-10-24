import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCommand, summariseOutput } from '../src/proof.js';

test('classifies common verification commands', () => {
  const cases: Array<[string, string]> = [
    ['npm test', 'test'],
    ['npm --prefix Backend run test:unit', 'test'],
    ['npx vitest run src/foo.test.ts', 'test'],
    ['cd Backend && npm run build && npm test', 'test'],
    ['npm --prefix Frontend run typecheck', 'typecheck'],
    ['npx tsc -p tsconfig.json --noEmit', 'typecheck'],
    ['npm --prefix Frontend run lint', 'lint'],
    ['npm --prefix Frontend run build', 'build'],
    ['npm --prefix Backend run prisma:migrate:deploy', 'migrate'],
    ['sudo -E docker compose -f docker-compose.prod.yml up -d --build --no-deps frontend', 'deploy'],
    ['git status', 'other'],
    ['sed -n 1,40p src/app.ts', 'other'],
  ];
  for (const [cmd, kind] of cases) assert.equal(classifyCommand(cmd), kind, cmd);
});

test('summarises jest, vitest, mocha, cargo and tsc output', () => {
  assert.equal(summariseOutput('...\nTests:       1 failed, 46 passed, 47 total\nTime: 3s', 1), '1 failed, 46 passed, 47 total');
  assert.equal(summariseOutput('✓ src/a.test.ts (3)\n Test Files  1 passed (1)\n      Tests  3 passed (3)\n', 0), '3 passed (3)');
  assert.equal(summariseOutput('\n  12 passing (240ms)\n', 0), '12 passing (240ms)');
  assert.equal(summariseOutput('test result: ok. 8 passed; 0 failed; 0 ignored', 0), '8 passed; 0 failed; 0 ignored');
  assert.equal(summariseOutput('src/x.ts(3,5): error TS2322\nFound 1 error.', 2), 'Found 1 error');
});

test('falls back to last line, then exit code', () => {
  assert.equal(summariseOutput('\u001b[32mdone\u001b[0m\n', 0), 'done');
  assert.equal(summariseOutput('', 0), 'exit 0');
  assert.equal(summariseOutput('', null), 'no exit code');
  assert.equal(summariseOutput('   \n', 3), 'exit 3');
});
