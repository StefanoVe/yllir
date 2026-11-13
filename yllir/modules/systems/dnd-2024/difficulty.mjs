// Encounter difficulty of the D&D 2024 adapter: the XP of a fight against the budgets of the
// party (D&D 2024 has no group-size multiplier, so the XP is the plain sum).
// Pure functions: no I/O, no dice. The tables are read from the adapter object (loaded by
// adapter.mjs from adapter.yaml), never copied here. Input is never mutated, and bad input
// returns { ok: false } instead of throwing.
//
// rateEncounter(adapter, { party, enemies }) where party is a list of character levels and
// enemies a list of { cr, count }. Returns { ok: true, xp, budgets, band } or
// { ok: false, error: { code, message } }. Error codes: empty-party, bad-level, bad-cr,
// bad-count, no-difficulty-rules (the adapter has no tables for the party's levels or CRs).

import { parseCr } from './checks.mjs';

const BANDS = ['low', 'moderate', 'high'];
// Canonical text of the CR values that parseCr returns as fractions.
const CR_TEXT = { 0: '0', 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' };

const isMapping = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isLevel = (value) => Number.isInteger(value) && value >= 1 && value <= 20;
const isCount = (value) => Number.isInteger(value) && value >= 1;

function fail(code, message) {
  return { ok: false, error: { code, message } };
}

function crText(value) {
  return Object.hasOwn(CR_TEXT, value) ? CR_TEXT[value] : String(value);
}

/**
 * Rates one encounter against the party's XP budgets.
 * @param {object} adapter loaded adapter with difficulty.budget_per_character and difficulty.cr_xp
 * @param {{ party: number[], enemies: { cr: string, count: number }[] }} input
 * @returns {{ ok: true, xp: number, budgets: { low: number, moderate: number, high: number }, band: string } | { ok: false, error: { code: string, message: string } }}
 */
export function rateEncounter(adapter, input) {
  const budgetTable = adapter?.difficulty?.budget_per_character;
  const xpTable = adapter?.difficulty?.cr_xp;
  if (!isMapping(budgetTable) || !isMapping(xpTable)) {
    return fail('no-difficulty-rules', 'the adapter has no difficulty tables');
  }
  const party = input?.party;
  if (!Array.isArray(party) || party.length === 0) {
    return fail('empty-party', 'the party has no characters');
  }

  const budgets = { low: 0, moderate: 0, high: 0 };
  for (const level of party) {
    if (!isLevel(level)) return fail('bad-level', 'a character level must be a whole number from 1 to 20');
    const row = Object.hasOwn(budgetTable, String(level)) ? budgetTable[String(level)] : null;
    if (!isMapping(row)) return fail('no-difficulty-rules', `the adapter has no budget for level ${level}`);
    for (const band of BANDS) budgets[band] += row[band];
  }

  const enemies = input?.enemies ?? [];
  if (!Array.isArray(enemies)) return fail('bad-count', 'the enemies must be a list');
  let xp = 0;
  for (const enemy of enemies) {
    const value = typeof enemy?.cr === 'string' ? parseCr(enemy.cr) : null;
    if (value === null) return fail('bad-cr', 'an enemy challenge rating is not a value from 0 to 30');
    const key = crText(value);
    if (!Object.hasOwn(xpTable, key)) return fail('bad-cr', `challenge rating ${key} has no XP in the adapter`);
    if (!isCount(enemy.count)) return fail('bad-count', 'an enemy count must be a positive whole number');
    xp += enemy.count * xpTable[key];
  }

  let band;
  if (xp * 2 < budgets.low) band = 'trivial';
  else if (xp <= budgets.low) band = 'low';
  else if (xp <= budgets.moderate) band = 'moderate';
  else if (xp <= budgets.high) band = 'high';
  else band = 'beyond';

  return { ok: true, xp, budgets, band };
}
