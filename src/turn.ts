// In-progress turn state: one JSON file per session under <gitdir>/why/turns/.
// A turn opens at UserPromptSubmit and closes at Stop; if it edited files it
// becomes a pending record, otherwise it is discarded.

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RECORD_VERSION, emptyWhy, type AgentInfo, type Record } from './record.js';
import { stateDir } from './git.js';

function turnsDir(cwd: string): string | null {
  const dir = stateDir(cwd);
  if (!dir) return null;
  const turns = join(dir, 'turns');
  if (!existsSync(turns)) mkdirSync(turns, { recursive: true });
  return turns;
}

function turnFile(cwd: string, sessionId: string): string | null {
  const dir = turnsDir(cwd);
  return dir ? join(dir, `${sessionId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`) : null;
}

export function newTurn(agent: AgentInfo): Record {
  return {
    version: RECORD_VERSION,
    id: randomUUID(),
    agent: { ...agent, turn_id: agent.turn_id ?? randomUUID() },
    prompt: null,
    hunks: [],
    why: emptyWhy(),
    proof: [],
    price: null,
    trace: {
      conversation_id: agent.session_id,
      contributor: 'ai',
      model_id: agent.model,
      tool: agent.name,
    },
  };
}

export function loadTurn(cwd: string, sessionId: string): Record | null {
  const file = turnFile(cwd, sessionId);
  if (!file || !existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record;
  } catch {
    return null;
  }
}

// Load the open turn or start one. Hooks can fire without a prompt event
// (resumed sessions), so a missing turn is never an error.
export function loadOrStartTurn(cwd: string, agent: AgentInfo): Record {
  return loadTurn(cwd, agent.session_id) ?? newTurn(agent);
}

export function saveTurn(cwd: string, rec: Record): void {
  const file = turnFile(cwd, rec.agent.session_id);
  if (!file) throw new Error('not inside a git repository');
  writeFileSync(file, JSON.stringify(rec), 'utf8');
}

export function clearTurn(cwd: string, sessionId: string): void {
  const file = turnFile(cwd, sessionId);
  if (file && existsSync(file)) unlinkSync(file);
}
