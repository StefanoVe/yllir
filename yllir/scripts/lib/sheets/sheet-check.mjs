// Checks NPC, vendor, enemy and creature sheets against the sheet model:
// frontmatter, title, section names and order, the stock table of vendors, the
// statistics phrase of creatures, and the master-only block. Deterministic: it
// reports what does not match the model; it does not judge the content.

import fs from 'node:fs';
import path from 'node:path';
import { parseYamlLite } from '../yaml-lite.mjs';
import { parseFrontmatter } from '../frontmatter.mjs';
import { analyzeMarkdown } from '../zones.mjs';
import { validateStatisticsTables } from '../statistics-tables.mjs';
import {
  readStructure,
  listCanonicalSheets,
  buildSubjectIndex,
  compareStrings,
} from '../subjects.mjs';

// One model per template. `order` is the order of the sections in the sheet,
// `required` the subset that must be present and have text.
const MODELS = {
  npc: {
    order: ['role', 'appearance', 'table', 'statistics', 'stock', 'todefine'],
    required: ['role', 'appearance', 'table'],
  },
  vendor: {
    order: [
      'role',
      'appearance',
      'table',
      'statistics',
      'stock',
      'haggling',
      'exceptions',
      'todefine',
    ],
    required: ['role', 'appearance', 'table', 'stock'],
  },
  enemy: {
    order: ['nature', 'statistics', 'loot', 'todefine'],
    required: ['nature', 'statistics'],
  },
  creature: {
    order: ['nature', 'statistics', 'loot', 'todefine'],
    required: ['nature', 'statistics'],
  },
};

const SHEET_TEMPLATES = new Set(Object.keys(MODELS));

// Section names per campaign language. Other languages skip the section checks.
const HEADINGS = {
  it: {
    role: 'Ruolo',
    appearance: 'Aspetto e modi',
    table: 'Al tavolo',
    statistics: 'Statistiche',
    stock: 'Assortimento',
    haggling: 'Trattare',
    exceptions: 'Deroghe',
    nature: 'Natura',
    loot: 'Bottino',
    todefine: 'Da definire',
  },
  en: {
    role: 'Role',
    appearance: 'Appearance and manner',
    table: 'At the table',
    statistics: 'Statistics',
    stock: 'Stock',
    haggling: 'Haggling',
    exceptions: 'Exceptions',
    nature: 'Nature',
    loot: 'Loot',
    todefine: 'To define',
  },
};

// Columns of the stock table, in order.
const STOCK_COLUMNS = {
  it: ['Oggetto', 'Prezzo', 'Nota'],
  en: ['Item', 'Price', 'Note'],
};

// The phrase a creature without statistics must carry in its Statistics section.
const NO_STATISTICS_PHRASE = {
  it: 'Nessuna statistica: non combatte',
  en: 'No statistics: it does not fight',
};

// Analyzer messages that belong to the master-only block rules.
const MASTER_MESSAGES = new Set([
  'more than one master block',
  'master block closed but never opened',
  'master block is not closed',
  'content after master block',
  'master block must start with ## Master',
  'only ### or lower headings allowed in master block',
]);

/**
 * @param {string} campaignRoot absolute path to the campaign folder
 * @param {{ files?: string[]|null }} [options] when `files` is an array, only those sheets are checked
 * @returns {{ checked: string[], skipped: string[], errors: Array<{code: string, file: string, message: string}> }}
 */
export function checkSheets(campaignRoot, { files = null } = {}) {
  const { structure, errors: configErrors } = readStructure(campaignRoot);
  if (structure === null) {
    return {
      checked: [],
      skipped: [],
      errors: configErrors.map((e) => ({ code: 'config', file: e.file, message: e.message })),
    };
  }

  const language = readLanguage(campaignRoot);
  const places = new Set(
    buildSubjectIndex(campaignRoot)
      .subjects.filter((subject) => subject.type === 'places')
      .map((subject) => subject.id),
  );

  const candidates = new Set();
  for (const category of structure) {
    if (category.type !== 'subjects' || typeof category.folder !== 'string') continue;
    for (const rel of listCanonicalSheets(campaignRoot, category.folder)) candidates.add(rel);
  }

  const filter = Array.isArray(files) ? new Set(files.map(normalizeRel)) : null;
  const checked = new Set();
  const skipped = new Set();
  const errors = [];

  if (filter) {
    for (const rel of filter) {
      if (!candidates.has(rel)) skipped.add(rel);
    }
  }

  for (const rel of [...candidates].sort(compareStrings)) {
    if (filter && !filter.has(rel)) continue;

    let text;
    try {
      text = fs.readFileSync(path.join(campaignRoot, rel), 'utf8');
    } catch {
      checked.add(rel);
      errors.push({ code: 'unreadable', file: rel, message: 'file could not be read' });
      continue;
    }

    // A file with no valid frontmatter has no template, so it is checked with the
    // npc model (and reported as missing its id) rather than skipped.
    const parsed = parseFrontmatter(text);
    if (parsed.data !== null && !SHEET_TEMPLATES.has(parsed.data.template)) {
      skipped.add(rel);
      continue;
    }
    const template = parsed.data === null ? 'npc' : parsed.data.template;

    checked.add(rel);
    errors.push(...checkSheet(rel, text, language, places, template));
  }

  errors.sort(
    (a, b) =>
      compareStrings(a.file, b.file) ||
      compareStrings(a.code, b.code) ||
      compareStrings(a.message, b.message),
  );

  return {
    checked: [...checked].sort(compareStrings),
    skipped: [...skipped].sort(compareStrings),
    errors,
  };
}

/** Campaign language from campaign.yaml, `en` when missing. */
function readLanguage(campaignRoot) {
  let text;
  try {
    text = fs.readFileSync(path.join(campaignRoot, 'campaign.yaml'), 'utf8');
  } catch {
    return 'en';
  }
  const { data } = parseYamlLite(text);
  const main = data?.language?.main;
  return typeof main === 'string' && main !== '' ? main : 'en';
}

function normalizeRel(p) {
  return path.posix.normalize(String(p));
}

/** Runs every rule on one sheet and returns its errors. */
function checkSheet(rel, text, language, places, template) {
  const errors = [];
  const add = (code, message) => errors.push({ code, file: rel, message });

  const { data, body, bodyStartLine } = parseFrontmatter(text);
  const fm = data ?? {};

  if (typeof fm.id !== 'string' || fm.id === '') {
    add('missing-id', 'frontmatter has no id');
  }
  if (data !== null) {
    if (!Array.isArray(fm.location)) {
      add('invalid-location', 'location must be a list of place ids');
    } else {
      for (const item of fm.location) {
        const id = String(item);
        if (!places.has(id)) add('unknown-location', `location "${id}" is not a place id`);
      }
    }
    if (fm.aliases !== undefined && !Array.isArray(fm.aliases)) {
      add('invalid-aliases', 'aliases must be a list');
    }
  }

  const { lines, errors: zoneErrors } = analyzeMarkdown(body, bodyStartLine);
  for (const zoneError of zoneErrors) {
    if (MASTER_MESSAGES.has(zoneError.message)) {
      add('master-block', `${zoneError.message} (line ${zoneError.line})`);
    }
  }

  const expectedTitle = path.posix.basename(rel, '.md');
  const titles = lines.filter((l) => !l.inMaster && l.block === 'heading' && l.level === 1);
  if (titles.length !== 1) {
    add('title', `expected exactly one # title, found ${titles.length}`);
  } else if (titles[0].headingText !== expectedTitle) {
    add('title', `title "${titles[0].headingText}" differs from file name "${expectedTitle}"`);
  }

  if (HEADINGS[language]) {
    checkSections(lines, template, language, add);
  }

  return errors;
}

function checkSections(lines, template, language, add) {
  const model = MODELS[template];
  const headings = HEADINGS[language];
  const order = model.order.map((key) => headings[key]);
  const required = model.required.map((key) => headings[key]);

  // Each `##` section outside the master block, with the lines it contains.
  const sections = [];
  let current = null;
  for (const line of lines) {
    if (line.inMaster || line.block === 'blank') continue;
    if (line.block === 'comment') {
      if (current?.name === headings.statistics) current.lines.push(line);
      continue;
    }
    if (line.block.startsWith('master-')) continue;
    if (line.block === 'heading') {
      if (line.level === 2) {
        current = { name: line.headingText, lines: [] };
        sections.push(current);
      } else if (line.level === 1) {
        current = null;
      } else if (line.level >= 3 && current?.name === headings.statistics) {
        current.lines.push(line);
      }
      continue;
    }
    if (current) current.lines.push(line);
  }

  const known = [];
  for (const section of sections) {
    const index = order.indexOf(section.name);
    if (index < 0) {
      add('section-unknown', `unknown section "${section.name}"`);
      continue;
    }
    known.push({ name: section.name, index });
    if (required.includes(section.name) && section.lines.length === 0) {
      add('section-empty', `section "${section.name}" has no text`);
    }
  }

  for (const name of required) {
    if (!sections.some((section) => section.name === name)) {
      add('section-missing', `missing section "${name}"`);
    }
  }

  for (let i = 1; i < known.length; i++) {
    if (known[i].index <= known[i - 1].index) {
      add('section-order', `section "${known[i].name}" is out of order`);
      break;
    }
  }

  const stock = sections.find((section) => section.name === headings.stock);
  if (template === 'vendor' && stock) {
    checkStockTable(stock, language, add);
  }

  const statistics = sections.find((section) => section.name === headings.statistics);
  if (template === 'creature' && statistics && NO_STATISTICS_PHRASE[language]) {
    const phrase = NO_STATISTICS_PHRASE[language];
    const flat = statistics.lines
      .map((line) => line.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!flat.includes(phrase)) {
      add('creature-statistics', `the Statistics section of a creature must say "${phrase}"`);
    }
  }
  if (statistics && template !== 'creature') {
    const content = statistics.lines.map((line) => line.text).join('\n');
    const validation = validateStatisticsTables(content, language);
    if (!validation.ok) add('statistics-table', validation.reason ?? `section "${statistics.name}" must use the localized statistics tables`);
  }
}

/** The first table of the Stock section must have exactly the three columns, in order. */
function checkStockTable(stock, language, add) {
  const columns = STOCK_COLUMNS[language];
  const header = stock.lines.find((line) => line.block === 'table');
  if (!header) {
    add('stock-table', `section "${stock.name}" has no table`);
    return;
  }
  const cells = splitRow(header.text).map(fold);
  const expected = columns.map(fold);
  const matches = cells.length === expected.length && expected.every((c, i) => cells[i] === c);
  if (!matches) {
    add('stock-table', `table columns must be ${columns.join(', ')}`);
  }
}

/** Cells of a Markdown table row, without the outer pipes. */
function splitRow(text) {
  let row = text.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|')) row = row.slice(0, -1);
  return row.split('|');
}

function fold(value) {
  return String(value).trim().toLowerCase();
}
