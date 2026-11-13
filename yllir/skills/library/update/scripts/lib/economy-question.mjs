// economy-v1: the economy question of a campaign that has no economy document.
// The only state kept here is the migration's own answer record,
// .campaign/state/update/economy.json, which holds { "status": "deferred" } once the
// master answered «later». The economy document itself is written by the guided part
// through the write cycle, never by this file.
import fs from 'node:fs';
import path from 'node:path';
import { findEconomyDocument } from '../../../../../scripts/lib/economy/economy.mjs';

export const ECONOMY_STATE = '.campaign/state/update/economy.json';

/**
 * The status of the economy question.
 * present: the campaign has an economy document; deferred: the master said «later»;
 * open: neither, the question must be asked.
 * @param {string} root campaign folder
 * @returns {'present'|'deferred'|'open'}
 */
export function economyStatus(root) {
  if (findEconomyDocument(path.resolve(root)) !== null) return 'present';
  return readDeferred(path.resolve(root)) ? 'deferred' : 'open';
}

/**
 * Records the master's «later». Nothing is written when the campaign already has an
 * economy document: the status is then present and the state file is not needed.
 * @param {string} root campaign folder
 * @returns {{ status: 'present'|'deferred' }}
 */
export function deferEconomy(root) {
  root = path.resolve(root);
  if (findEconomyDocument(root) !== null) return { status: 'present' };
  const file = path.join(root, ECONOMY_STATE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ status: 'deferred' }, null, 2)}\n`, 'utf8');
  return { status: 'deferred' };
}

/** Needed while the question is open. */
export function detectEconomyQuestion(root) {
  return economyStatus(root) === 'open';
}

/**
 * Deterministic part of economy-v1: pending while the question is open, complete when the
 * campaign has an economy document or the master deferred. Nothing is changed.
 * @returns {{ status: 'complete'|'pending', changed: string[], errors: [] }}
 */
export function applyEconomyQuestion(root) {
  const status = economyStatus(root);
  return { status: status === 'open' ? 'pending' : 'complete', changed: [], errors: [] };
}

/**
 * Guided part finished: the question is answered (economy document present) or deferred.
 * @returns {{ status: 'complete'|'pending', errors: Array<{code: string, message: string}> }}
 */
export function completeEconomyQuestion(root) {
  if (economyStatus(root) === 'open') {
    return { status: 'pending', errors: [{ code: 'economy-question-open', message: 'the economy question has no answer yet' }] };
  }
  return { status: 'complete', errors: [] };
}

function readDeferred(root) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(root, ECONOMY_STATE), 'utf8'));
    return value !== null && typeof value === 'object' && value.status === 'deferred';
  } catch {
    return false;
  }
}
