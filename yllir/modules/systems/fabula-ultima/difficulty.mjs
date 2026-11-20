// Encounter difficulty of the Fabula Ultima adapter: the band of a fight against the party, from the
// levels of the characters and the level and rank of each enemy.
// Pure functions: no I/O, no dice. The table (same level and fewer enemies = easy; 5 levels above and the
// same number = normal; 10 levels above and more enemies = hard) comes from the adapter's level_offsets,
// never copied here. An elite counts as 2 soldiers and a champion N as N soldiers.
// Combining the level band and the count band by taking the harder one is a choice of Yllir, not a rule of the game.
// Input is never mutated, and bad input returns { ok: false } instead of throwing.
//
// rateEncounter(adapter, { party, enemies }) where party is a list of character levels and enemies a list
// of { level, rank, count } with level and rank as text from the sheet. Returns { ok: true, band, xp: null,
// budgets: null, detail } or { ok: false, error: { code, message } }. Error codes: no-difficulty-rules,
// empty-party, bad-level, bad-count, bad-rank, no-enemies.

import { rankMultiplier } from './checks.mjs';

const isMapping = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isLevel = (value) => Number.isInteger(value) && value >= 1 && value <= 60;

function fail(code, message) {
  return { ok: false, error: { code, message } };
}

/**
 * Rates one encounter against the party: the band of the level difference and the band of the number of enemies.
 * @param {object} adapter loaded adapter with difficulty.level_offsets (band name to number)
 * @param {{ party: number[], enemies: { level: string, rank: string, count: number }[] }} input
 * @returns {{ ok: true, band: string, xp: null, budgets: null, detail: object } | { ok: false, error: { code: string, message: string } }}
 */
export function rateEncounter(adapter, input) {
  const offsets = adapter?.difficulty?.level_offsets;
  if (!isMapping(offsets)) {
    return fail('no-difficulty-rules', 'the adapter has no difficulty table (level_offsets)');
  }
  const bands = Object.keys(offsets);
  if (bands.length === 0 || bands.some((band) => typeof offsets[band] !== 'number')) {
    return fail('no-difficulty-rules', 'the difficulty table must map each band to a number');
  }

  const party = input?.party;
  if (!Array.isArray(party) || party.length === 0) {
    return fail('empty-party', 'the party has no characters');
  }
  for (const level of party) {
    if (!isLevel(level)) return fail('bad-level', 'a character level must be a whole number from 1 to 60');
  }

  const enemies = input?.enemies;
  if (!Array.isArray(enemies) || enemies.length === 0) {
    return fail('no-enemies', 'the encounter has no enemies');
  }

  let weight = 0;
  let levelWeight = 0;
  for (const enemy of enemies) {
    const count = enemy?.count;
    if (!Number.isInteger(count) || count < 1) {
      return fail('bad-count', 'an enemy count must be a positive whole number');
    }
    const levelText = String(enemy?.level ?? '');
    if (!/^\d+$/.test(levelText) || !isLevel(Number(levelText))) {
      return fail('bad-level', `enemy level "${levelText}" is not a level from 1 to 60`);
    }
    const multiplier = rankMultiplier(enemy?.rank);
    if (multiplier === null) {
      return fail('bad-rank', `enemy rank "${String(enemy?.rank ?? '')}" is not a rank: soldier, elite or champion 2 to 6`);
    }
    weight += multiplier * count;
    levelWeight += Number(levelText) * multiplier * count;
  }

  const partySize = party.length;
  const partyLevel = Math.floor(party.reduce((sum, level) => sum + level, 0) / partySize);
  const enemyLevel = Math.floor(levelWeight / weight);
  const offset = enemyLevel - partyLevel;

  // The last band whose offset is at or below the difference; the first band when none is.
  let levelBand = bands[0];
  for (const band of bands) {
    if (offsets[band] <= offset) levelBand = band;
  }

  let countBand;
  if (weight < partySize) countBand = bands[0];
  else if (weight === partySize) countBand = bands[Math.min(1, bands.length - 1)];
  else countBand = bands[Math.min(2, bands.length - 1)];

  const band = bands.indexOf(levelBand) >= bands.indexOf(countBand) ? levelBand : countBand;

  return {
    ok: true,
    band,
    xp: null,
    budgets: null,
    detail: { partyLevel, partySize, enemyLevel, offset, levelBand, weight, countBand },
  };
}
