// Deterministic arithmetic checks for Fabula Ultima character and NPC sheets.
// Receives the cell text of the sheet tables, keyed by adapter field id, and returns [{ code, field, message }].
// No rule tables and no dice: attributes are die sizes (d6, d8, d10, d12) and the formulas below are the only numbers.
// checkSceneCheck validates the heading of a scene check ("DES + INT DL 10" or "VIG + VOL contrapposta") in Italian or English.
// Pure functions: no randomness and no file access.

const DIE_SIZES = [6, 8, 10, 12];
const WHOLE_NUMBER_RE = /^(\d+)(?![\d])/;
const CRISIS_RE = /\((?:crisi|crisis)\s+(\d+)\)/i;

/**
 * Size of an attribute die: "d8" gives 8. Anything other than d6, d8, d10 or d12 gives null.
 * @param {string} text cell text
 * @returns {number | null}
 */
export function dieSize(text) {
  const key = String(text ?? '').trim().toLowerCase();
  const match = /^d(6|8|10|12)$/.exec(key);
  return match ? Number(match[1]) : null;
}

/**
 * Multiplier of an NPC rank: soldier 1, elite 2, champion N 2 to 6 (N, not the factor). Null for anything else.
 * @param {string} text cell text
 * @returns {number | null}
 */
export function rankMultiplier(text) {
  const name = String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (name === 'soldier' || name === 'soldato') return 1;
  if (name === 'elite' || name === 'élite') return 2;
  const match = /^(?:champion|campione)\s*(?:\((\d+)\)|(\d+))$/.exec(name);
  if (!match) return null;
  const n = Number(match[1] ?? match[2]);
  return n >= 2 && n <= 6 ? n : null;
}

/**
 * The attribute die after `steps` statuses each lowered it one step (d12, d10, d8, d6), never below d6.
 * @param {string} text the die, such as "d10"
 * @param {number} steps whole number, 0 or more
 * @returns {string | null} the die as text, such as "d8"; null when the die or the steps are invalid
 */
export function effectiveDie(text, steps) {
  const size = dieSize(text);
  if (size === null || !Number.isInteger(steps) || steps < 0) return null;
  const index = Math.max(0, DIE_SIZES.indexOf(size) - steps);
  return `d${DIE_SIZES[index]}`;
}

// Player character formulas.
export function pcMaxHp({ level, mig, bonus = 0 }) {
  return mig * 5 + level + bonus;
}

export function pcMaxMp({ level, wlp, bonus = 0 }) {
  return wlp * 5 + level + bonus;
}

export function pcMaxIp({ bonus = 0 } = {}) {
  return 6 + bonus;
}

export function crisisThreshold(maxHp) {
  return Math.floor(maxHp / 2);
}

export function magicDefense({ ins, bonus = 0 }) {
  return ins + bonus;
}

export function companionHp({ skillLevel, companionMig, level }) {
  return skillLevel * companionMig + Math.floor(level / 2);
}

export function craftingMaxCost(highestLevel) {
  return highestLevel * 60;
}

export function clockSections({ total, difficulty }) {
  if (total < difficulty) return 0;
  return 1 + Math.floor((total - difficulty) / 3);
}

// NPC formulas.
export function npcBaseHp({ level, mig }) {
  return 2 * level + 5 * mig;
}

export function npcBaseMp({ level, wlp }) {
  return level + 5 * wlp;
}

export function npcAccuracyBonus(level) {
  return Math.floor(level / 10);
}

export function npcDamageBonus(level) {
  return 5 * Math.floor(level / 20);
}

// Trimmed text of a cell, or undefined when the field is not in the input.
function cell(fields, field) {
  if (fields[field] === undefined || fields[field] === null) return undefined;
  return String(fields[field]).trim();
}

// The leading whole number of a cell ("70 (crisis 35)" gives 70), or null when it is missing or 0.
function wholeNumber(text) {
  const match = WHOLE_NUMBER_RE.exec(text);
  const value = match ? Number(match[1]) : 0;
  return value > 0 ? value : null;
}

/**
 * Checks the arithmetic of one NPC sheet. A missing field skips every check that needs it.
 * Values above the minimum are always accepted: skills and equipment add to them.
 * @param {Record<string, string | number>} fields cell text keyed by adapter field id
 * @param {string} [statistics] ignored; kept for the signature shared with the other adapters
 * @returns {Array<{ code: string, field: string, message: string }>} empty when the sheet is fine
 */
export function checkCreature(fields, statistics = '') {
  const errors = [];

  // Attribute dice: only valid sizes are kept in `dice`.
  const dice = {};
  for (const field of ['dex', 'ins', 'mig', 'wlp']) {
    const text = cell(fields, field);
    if (text === undefined) continue;
    const size = dieSize(text);
    if (size === null) {
      errors.push({ code: 'bad-value', field, message: `${field}: "${text}" is not a die size d6, d8, d10 or d12` });
    } else {
      dice[field] = size;
    }
  }

  // Level: a whole number from 1 to 60.
  let level = null;
  const levelText = cell(fields, 'level');
  if (levelText !== undefined) {
    const value = Number(levelText);
    if (/^\d+$/.test(levelText) && value >= 1 && value <= 60) {
      level = value;
    } else {
      errors.push({ code: 'bad-value', field: 'level', message: `level: "${levelText}" is not a level from 1 to 60` });
    }
  }

  // Rank: its multiplier, or null when the rank is not valid.
  let multiplier = null;
  const rankText = cell(fields, 'rank');
  if (rankText !== undefined) {
    multiplier = rankMultiplier(rankText);
    if (multiplier === null) {
      errors.push({ code: 'bad-value', field: 'rank', message: `rank: "${rankText}" is not a rank: soldier, elite or champion 2 to 6` });
    }
  }

  // Numeric cells: the leading whole number, positive.
  const numbers = {};
  for (const field of ['hp', 'mp', 'def', 'mdef']) {
    const text = cell(fields, field);
    if (text === undefined) continue;
    const value = wholeNumber(text);
    if (value === null) {
      errors.push({ code: 'bad-value', field, message: `${field}: "${text}" is not a positive whole number` });
    } else {
      numbers[field] = value;
    }
  }

  // Crisis written in the hp cell must be half of the hit points, rounded down.
  const hpText = cell(fields, 'hp');
  if (hpText !== undefined && numbers.hp !== undefined) {
    const crisis = CRISIS_RE.exec(hpText);
    const expected = Math.floor(numbers.hp / 2);
    if (crisis && Number(crisis[1]) !== expected) {
      errors.push({
        code: 'bad-crisis',
        field: 'hp',
        message: `hp: crisis written ${Number(crisis[1])} but half of ${numbers.hp} is ${expected}`,
      });
    }
  }

  // Minimum hit points: base for level and MIG, times the rank multiplier.
  if (level !== null && dice.mig !== undefined && multiplier !== null && numbers.hp !== undefined) {
    const minimum = npcBaseHp({ level, mig: dice.mig }) * multiplier;
    if (numbers.hp < minimum) {
      errors.push({
        code: 'bad-hp',
        field: 'hp',
        message: `hp: ${numbers.hp} is below ${minimum}, the hit points of a level ${level} ${rankText} with MIG d${dice.mig}`,
      });
    }
  }

  // Minimum magic points: base for level and WLP.
  if (level !== null && dice.wlp !== undefined && numbers.mp !== undefined) {
    const minimum = npcBaseMp({ level, wlp: dice.wlp });
    if (numbers.mp < minimum) {
      errors.push({
        code: 'bad-mp',
        field: 'mp',
        message: `mp: ${numbers.mp} is below ${minimum}, the magic points of a level ${level} creature with WLP d${dice.wlp}`,
      });
    }
  }

  // Magic defense is never below INS. Defense (def) is not compared: armor can fix it.
  if (dice.ins !== undefined && numbers.mdef !== undefined && numbers.mdef < dice.ins) {
    errors.push({ code: 'bad-defense', field: 'mdef', message: `mdef: ${numbers.mdef} is below INS d${dice.ins}` });
  }

  return errors;
}

const SCENE_ATTRIBUTES = {
  it: ['DES', 'INT', 'VIG', 'VOL'],
  en: ['DEX', 'INS', 'MIG', 'WLP'],
};
const SCENE_DL = [7, 10, 13, 16];
const SCENE_EXAMPLE = {
  it: '"DES + INT DL 10" or "VIG + VOL contrapposta"',
  en: '"DEX + INS DL 10" or "MIG + WLP opposed"',
};
const SCENE_DL_RE = /^([^+]+?)\s*\+\s*([^+]+?)\s+DL\s+(\d+)$/i;
const SCENE_OPPOSED_RE = {
  it: /^([^+]+?)\s*\+\s*([^+]+?)\s+contrapposta$/i,
  en: /^([^+]+?)\s*\+\s*([^+]+?)\s+opposed$/i,
};

/**
 * Checks the heading of one scene check: "<A> + <B> DL <n>" with n 7, 10, 13 or 16, or "<A> + <B> contrapposta" (it)
 * or "<A> + <B> opposed" (en). Attribute names are case-insensitive and must be the campaign language's names.
 * @param {string} value the heading text
 * @param {string} lang 'it' or 'en'; anything else is treated as 'en'
 * @returns {Array<{ code: string, message: string }>} empty when the check is valid, otherwise one bad-check entry
 */
export function checkSceneCheck(value, lang) {
  const language = lang === 'it' ? 'it' : 'en';
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  const fail = (reason) => [{
    code: 'bad-check',
    message: `"${text}" is not a Fabula Ultima check${reason ? `: ${reason}` : ''}; write ${SCENE_EXAMPLE[language]}`,
  }];

  const dl = SCENE_DL_RE.exec(text);
  const match = dl ?? SCENE_OPPOSED_RE[language].exec(text);
  if (!match) return fail('');

  for (const name of [match[1].trim(), match[2].trim()]) {
    if (!SCENE_ATTRIBUTES[language].includes(name.toUpperCase())) return fail(`"${name}" is not an attribute`);
  }
  if (dl && !SCENE_DL.includes(Number(dl[3]))) return fail('the DL must be 7, 10, 13 or 16');
  return [];
}
