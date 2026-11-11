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

// Scene checks: the value of a `### <Check label>: <value>` heading in a plot event file.
// Accepted forms (whitespace-tolerant; ability and skill names case-insensitive):
//   it: "<Caratteristica> (<Abilità>) CD <n>", "<Caratteristica> CD <n>", "Tiro salvezza su <Caratteristica> CD <n>"
//   en: "<Ability> (<Skill>) DC <n>", "<Ability> DC <n>", "<Ability> saving throw DC <n>"
const SCENE_FORMS = {
  it: { dc: 'CD', example: '"Carisma (Persuasione) CD 13" or "Tiro salvezza su Saggezza CD 13"' },
  en: { dc: 'DC', example: '"Charisma (Persuasion) DC 13" or "Wisdom saving throw DC 13"' },
};
const SCENE_ABILITIES = {
  it: ['Forza', 'Destrezza', 'Costituzione', 'Intelligenza', 'Saggezza', 'Carisma'],
  en: ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'],
};
const SCENE_SKILLS = {
  it: {
    'Acrobazia': 'Destrezza', 'Addestrare Animali': 'Saggezza', 'Arcano': 'Intelligenza', 'Atletica': 'Forza',
    'Furtività': 'Destrezza', 'Indagare': 'Intelligenza', 'Inganno': 'Carisma', 'Intimidire': 'Carisma',
    'Intrattenere': 'Carisma', 'Intuizione': 'Saggezza', 'Medicina': 'Saggezza', 'Natura': 'Intelligenza',
    'Percezione': 'Saggezza', 'Persuasione': 'Carisma', 'Rapidità di Mano': 'Destrezza', 'Religione': 'Intelligenza',
    'Sopravvivenza': 'Saggezza', 'Storia': 'Intelligenza',
  },
  en: {
    'Acrobatics': 'Dexterity', 'Animal Handling': 'Wisdom', 'Arcana': 'Intelligence', 'Athletics': 'Strength',
    'Stealth': 'Dexterity', 'Investigation': 'Intelligence', 'Deception': 'Charisma', 'Intimidation': 'Charisma',
    'Performance': 'Charisma', 'Insight': 'Wisdom', 'Medicine': 'Wisdom', 'Nature': 'Intelligence',
    'Perception': 'Wisdom', 'Persuasion': 'Charisma', 'Sleight of Hand': 'Dexterity', 'Religion': 'Intelligence',
    'Survival': 'Wisdom', 'History': 'Intelligence',
  },
};

function lowerKey(names) {
  return new Map(names.map((name) => [name.toLowerCase(), name]));
}

/**
 * Checks the value of a check heading in a plot event file. Only the form and the names are checked:
 * the skill's default ability is not required (D&D 2024 allows other pairings).
 * @param {string} value text after the colon of the check heading
 * @param {string} lang 'it' or 'en'; any other value is treated as 'en'
 * @returns {Array<{ code: string, message: string }>} empty when the value is a valid check
 */
export function checkSceneCheck(value, lang) {
  const language = lang === 'it' ? 'it' : 'en';
  const forms = SCENE_FORMS[language];
  const text = String(value).trim().replace(/\s+/g, ' ');
  const fail = (reason) => [{
    code: 'bad-check',
    message: `"${text}" is not a D&D 2024 check${reason ? `: ${reason}` : ''}; write ${forms.example}`,
  }];

  const dcMatch = new RegExp(`^(.*?)\\s*\\b${forms.dc}\\s*(\\d+)$`, 'i').exec(text);
  if (!dcMatch) return fail('');
  const dc = Number(dcMatch[2]);
  if (dc < 5 || dc > 30) return fail(`the DC must be from 5 to 30`);

  const prefix = dcMatch[1].trim();
  // Saving throw form: "Tiro salvezza su <Ability>" (it) or "<Ability> saving throw" (en).
  const saveRe = language === 'it' ? /^tiro salvezza su\s+(.+)$/i : /^(.+?)\s+saving throw$/i;
  const save = saveRe.exec(prefix);
  const withSkill = save ? null : /^(.+?)\s*\((.+)\)$/.exec(prefix);
  const abilityText = save ? save[1] : withSkill ? withSkill[1] : prefix;
  const skillText = withSkill ? withSkill[2].trim() : null;

  const abilities = lowerKey(SCENE_ABILITIES[language]);
  if (!abilities.has(abilityText.trim().toLowerCase())) return fail('');
  if (skillText !== null) {
    const skills = lowerKey(Object.keys(SCENE_SKILLS[language]));
    if (!skills.has(skillText.toLowerCase())) return fail(`"${skillText}" is not a skill`);
  }
  return [];
}
