// Checks the player character sheets of a campaign (the files of a master-only
// category whose folder is Giocatori or Players): the sections and their order,
// no master block, the plot-integration hooks (each with its four labelled items
// and a valid status), and the optional `level` metadata (a positive integer).
// Labels are Italian for an `it` campaign and English for any other language.
// Deterministic: it reports what does not match the form; it does not judge the content.

import fs from 'node:fs';
import path from 'node:path';
import { parseYamlLite } from '../yaml-lite.mjs';
import { parseFrontmatter } from '../frontmatter.mjs';
import { MASTER_MARKER } from '../public-text.mjs';
import { readStructure, listCanonicalSheets, compareStrings } from '../subjects.mjs';

const FOLDER_NAMES = new Set(['Giocatori', 'Players']);

const LABELS = {
  it: {
    sections: { sheet: 'Scheda', integration: 'Integrazione con la trama', background: 'Background', questions: 'Domande aperte', originals: 'Originali' },
    items: { hook: 'Gancio', trigger: 'Innesco', stakes: 'Posta', status: 'Stato' },
    statuses: ['pronto', 'da proporre'],
  },
  en: {
    sections: { sheet: 'Sheet', integration: 'Plot integration', background: 'Background', questions: 'Open questions', originals: 'Originals' },
    items: { hook: 'Hook', trigger: 'Trigger', stakes: 'Stakes', status: 'Status' },
    statuses: ['ready', 'to propose'],
  },
};

// Order of the sections (content-format.md 4.13): Scheda and Integrazione are required,
// then the optional Background, Domande aperte and Originali, in that order.
const SECTION_ORDER = ['sheet', 'integration', 'background', 'questions', 'originals'];
const REQUIRED = new Set(['sheet', 'integration']);

const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*$/;
const FENCE_RE = /^\s*```/;
const ITEM_RE = /^\s*[-*]\s+([^:]+?)\s*:\s*(.*?)\s*$/;
const LEVEL_RE = /^[1-9][0-9]*$/;

function readLanguage(root) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, 'campaign.yaml'), 'utf8');
  } catch {
    return 'en';
  }
  const main = parseYamlLite(text).data?.language?.main;
  return typeof main === 'string' && main !== '' ? main : 'en';
}

function normalizeRel(item) {
  return path.posix.normalize(String(item).split(path.sep).join('/')).replace(/^\.\//, '');
}

/** Lines of the body (after the metadata block), with 1-based file line numbers and fence flags. */
function bodyLines(text, bodyStartLine) {
  const out = [];
  let inFence = false;
  text.split('\n').forEach((raw, index) => {
    const line = index + 1;
    if (line < bodyStartLine) return;
    const value = raw.replace(/\r$/, '');
    let code = false;
    if (FENCE_RE.test(value)) {
      inFence = !inFence;
      code = true;
    } else if (inFence) {
      code = true;
    }
    out.push({ text: value, line, code });
  });
  return out;
}

/** Headings outside fenced code, with their level and text. */
function headingsOf(lines) {
  const out = [];
  lines.forEach((entry, index) => {
    if (entry.code) return;
    const match = HEADING_RE.exec(entry.text);
    if (match) {
      out.push({ index, level: match[1].length, text: match[2].trim(), line: entry.line });
    }
  });
  return out;
}

/** Section key of a `##` heading text in the campaign language, or null. */
function sectionKey(text, labels) {
  const folded = text.toLowerCase();
  for (const key of SECTION_ORDER) {
    if (labels.sections[key].toLowerCase() === folded) return key;
  }
  return null;
}

/**
 * Checks the hooks of the integration section: each `###` under it has the four
 * labelled items, each with text, a valid status, and no label repeated.
 */
function checkHooks(lines, headings, sectionFrom, sectionTo, labels, add) {
  const hooks = headings.filter((h) => h.level === 3 && h.index > sectionFrom && h.index < sectionTo);
  for (const [position, hook] of hooks.entries()) {
    const from = hook.index + 1;
    const next = headings.find((h, p) => p > headings.indexOf(hook) && h.level <= 3);
    const to = next ? next.index : lines.length;
    const items = new Map();
    for (let i = from; i < to; i++) {
      if (lines[i].code) continue;
      const match = ITEM_RE.exec(lines[i].text);
      if (!match) continue;
      const label = match[1].trim();
      if (items.has(label)) {
        add('pc-hook', lines[i].line, `hook "${hook.text}" repeats the item ${label}`);
        continue;
      }
      items.set(label, { value: match[2], line: lines[i].line });
    }

    const name = hook.text === '' ? `hook ${position + 1}` : `hook "${hook.text}"`;
    for (const key of ['hook', 'trigger', 'stakes', 'status']) {
      const label = labels.items[key];
      const item = items.get(label);
      if (!item) {
        add('pc-hook', hook.line, `${name} has no ${label} item`);
        continue;
      }
      if (item.value === '') {
        add('pc-hook', item.line, `${name}: ${label} is empty`);
      } else if (key === 'status' && !labels.statuses.includes(item.value.toLowerCase())) {
        add('pc-hook', item.line, `${name}: ${label} must be ${labels.statuses.map((s) => `"${s}"`).join(' or ')}, not "${item.value}"`);
      }
    }
  }
}

/**
 * Checks one player character file.
 * @param {string} text full file content
 * @param {string} lang campaign language; 'it' selects Italian labels, anything else English
 * @returns {Array<{ line: number, code: string, message: string }>}
 */
export function checkPlayerSheet(text, lang) {
  const labels = LABELS[lang === 'it' ? 'it' : 'en'];
  const { data, bodyStartLine } = parseFrontmatter(text);
  const lines = bodyLines(text, bodyStartLine);
  const errors = [];
  const add = (code, line, message) => errors.push({ line, code, message: `line ${line}: ${message}` });

  const master = lines.find((entry) => !entry.code && entry.text.includes(MASTER_MARKER));
  if (master) {
    add('pc-master-block', master.line, 'a player character file has no master block: the whole file is private');
  }

  const headings = headingsOf(lines);
  const sections = [];
  for (const heading of headings) {
    if (heading.level !== 2) continue;
    const key = sectionKey(heading.text, labels);
    if (key === null) {
      add('pc-sections', heading.line, `unknown section "## ${heading.text}"`);
      continue;
    }
    sections.push({ key, ...heading });
  }

  for (const key of SECTION_ORDER) {
    if (REQUIRED.has(key) && !sections.some((s) => s.key === key)) {
      add('pc-sections', 1, `missing section "## ${labels.sections[key]}"`);
    }
  }
  for (let i = 1; i < sections.length; i++) {
    const prev = sections[i - 1];
    const cur = sections[i];
    if (SECTION_ORDER.indexOf(cur.key) <= SECTION_ORDER.indexOf(prev.key)) {
      add('pc-sections', cur.line, `"## ${cur.text}" must come before "## ${prev.text}" and appear once`);
    }
  }

  const integration = sections.find((s) => s.key === 'integration');
  if (integration) {
    const next = headings.find((h) => h.index > integration.index && h.level <= 2);
    const sectionTo = next ? next.index : lines.length;
    checkHooks(lines, headings, integration.index, sectionTo, labels, add);
  }

  const level = data?.level;
  if (level !== undefined && !LEVEL_RE.test(String(level))) {
    add('pc-level', 1, `level must be a positive integer, not "${level}"`);
  }

  return errors;
}

/**
 * Checks the player character sheets of a campaign.
 * @param {string} root absolute path to the campaign folder
 * @param {{ files?: string[]|null }} [options] campaign-relative paths to check; all player sheets when omitted
 * @returns {{ errors: Array<{ file: string, code: string, message: string }> }}
 */
export function checkPlayerSheets(root, { files = null } = {}) {
  const { structure, errors: configErrors } = readStructure(root);
  if (structure === null) {
    return { errors: configErrors.map((e) => ({ file: e.file, code: 'config', message: e.message })) };
  }

  const folders = structure
    .filter((entry) => entry.type === 'master-only' && typeof entry.folder === 'string')
    .map((entry) => path.posix.normalize(entry.folder).replace(/\/+$/, ''))
    .filter((folder) => FOLDER_NAMES.has(path.posix.basename(folder)));
  const inFolder = (rel) => folders.some((folder) => rel.startsWith(`${folder}/`) && rel.endsWith('.md'));

  let candidates;
  if (Array.isArray(files)) {
    candidates = files.map(normalizeRel).filter(inFolder);
  } else {
    candidates = folders.flatMap((folder) => listCanonicalSheets(root, folder));
  }
  candidates = [...new Set(candidates)].sort(compareStrings);

  const lang = readLanguage(root);
  const errors = [];
  for (const file of candidates) {
    let text;
    try {
      text = fs.readFileSync(path.join(root, file), 'utf8');
    } catch {
      continue;
    }
    for (const entry of checkPlayerSheet(text, lang)) {
      errors.push({ file, code: entry.code, message: entry.message });
    }
  }
  return { errors };
}
