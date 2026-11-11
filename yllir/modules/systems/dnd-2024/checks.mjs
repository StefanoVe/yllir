// Deterministic arithmetic checks for D&D 2024 creature sheets.
// Receives the raw cell text of the Characteristics table, keyed by adapter field id.
// Returns [{ code, field, message }]. No rule tables: only the formulas below.

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const CR_FRACTIONS = { '1/8': 0.125, '1/4': 0.25, '1/2': 0.5 };
const ABILITY_RE = /^(\d+)(?:\s*\(\s*([+−-])\s*(\d+)\s*\))?$/;
const AC_RE = /^(\d+)(?:\s*\(([^()]*)\))?$/;
const HP_RE = /^(\d+)(?:\s*\(\s*(\d+)d(\d+)(?:\s*([+−-])\s*(\d+))?\s*\))?$/;
const PROFICIENCY_RE = /^\+?(\d+)$/;

function signed(sign, digits) {
  const value = Number(digits);
  return sign === '+' ? value : -value;
}

function inRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

// Returns the numeric CR, or null when the text is not a valid CR.
function parseCr(text) {
  if (text === '0') return 0;
  if (Object.hasOwn(CR_FRACTIONS, text)) return CR_FRACTIONS[text];
  if (/^\d+$/.test(text)) {
    const value = Number(text);
    return inRange(value, 1, 30) ? value : null;
  }
  return null;
}

function checkAbility(field, text, errors) {
  const match = ABILITY_RE.exec(text);
  const score = match ? Number(match[1]) : NaN;
  if (!match || !inRange(score, 1, 30)) {
    errors.push({ code: 'bad-value', field, message: `${field}: "${text}" is not an ability score from 1 to 30` });
    return;
  }
  if (match[2] !== undefined) {
    const written = signed(match[2], match[3]);
    const expected = Math.floor((score - 10) / 2);
    if (written !== expected) {
      errors.push({ code: 'bad-modifier', field, message: `${field}: modifier written ${written} but score ${score} gives ${expected}` });
    }
  }
}

function checkAc(field, text, errors) {
  const match = AC_RE.exec(text);
  if (!match || !inRange(Number(match[1]), 1, 30)) {
    errors.push({ code: 'bad-value', field, message: `${field}: "${text}" is not an armor class from 1 to 30` });
  }
}

function checkHp(field, text, errors) {
  const match = HP_RE.exec(text);
  const average = match ? Number(match[1]) : NaN;
  if (!match || !Number.isInteger(average) || average < 1) {
    errors.push({ code: 'bad-value', field, message: `${field}: "${text}" is not a positive hit point value` });
    return;
  }
  if (match[2] !== undefined) {
    const dice = { count: Number(match[2]), sides: Number(match[3]) };
    const bonus = match[4] !== undefined ? signed(match[4], match[5]) : 0;
    const expected = Math.floor(dice.count * (dice.sides + 1) / 2) + bonus;
    if (average !== expected) {
      errors.push({ code: 'bad-hp-average', field, message: `${field}: average ${average} but ${dice.count}d${dice.sides} gives ${expected}` });
    }
  }
}

function checkProficiency(text, cr, errors) {
  const match = PROFICIENCY_RE.exec(text);
  if (!match) {
    errors.push({ code: 'bad-value', field: 'proficiency_bonus', message: `proficiency_bonus: "${text}" is not a bonus such as +2` });
    return;
  }
  if (cr === null) return;
  const written = Number(match[1]);
  const expected = cr < 1 ? 2 : 2 + Math.floor((cr - 1) / 4);
  if (written !== expected) {
    errors.push({ code: 'bad-proficiency', field: 'proficiency_bonus', message: `proficiency_bonus: +${written} but challenge rating gives +${expected}` });
  }
}

export function checkCreature(fields) {
  const errors = [];
  for (const field of ABILITIES) {
    if (fields[field] !== undefined) checkAbility(field, String(fields[field]).trim(), errors);
  }
  if (fields.ac !== undefined) checkAc('ac', String(fields.ac).trim(), errors);
  if (fields.hp !== undefined) checkHp('hp', String(fields.hp).trim(), errors);

  let cr = null;
  if (fields.cr !== undefined) {
    const text = String(fields.cr).trim();
    cr = parseCr(text);
    if (cr === null) errors.push({ code: 'bad-value', field: 'cr', message: `cr: "${text}" is not a challenge rating` });
  }
  if (fields.proficiency_bonus !== undefined) checkProficiency(String(fields.proficiency_bonus).trim(), cr, errors);
  return errors;
}
