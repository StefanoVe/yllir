// Says whether each sheet is usable at the table: the required sections exist and
// have text, a place opens with an italic paragraph, a vendor has stock rows, and
// the public text is long enough. Deterministic: it reports the gaps; it never
// writes and never judges the content. The master-only block is never read as text.

import fs from 'node:fs';
import path from 'node:path';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';
import { parseFrontmatter } from '../../../../../scripts/lib/frontmatter.mjs';
import { analyzeMarkdown } from '../../../../../scripts/lib/zones.mjs';

const TEMPLATES = new Set(['npc', 'vendor', 'enemy', 'creature', 'place']);

// Section keys that must exist and have text, per template. A creature's
// statistics sentence is fixed, so its statistics are never a gap.
const REQUIRED = {
  npc: ['role', 'appearance', 'table'],
  vendor: ['role', 'appearance', 'table', 'stock'],
  enemy: ['nature', 'statistics'],
  creature: ['nature'],
  place: ['description'],
};

// Section headings per campaign language. Other languages use the English ones.
const HEADINGS = {
  it: {
    role: 'Ruolo',
    appearance: 'Aspetto e modi',
    table: 'Al tavolo',
    stock: 'Assortimento',
    nature: 'Natura',
    statistics: 'Statistiche',
    description: 'Descrizione',
  },
  en: {
    role: 'Role',
    appearance: 'Appearance and manner',
    table: 'At the table',
    stock: 'Stock',
    nature: 'Nature',
    statistics: 'Statistics',
    description: 'Description',
  },
};

// Headings of a place description, accepted in any language.
const DESCRIPTION_HEADINGS = new Set(['Descrizione', 'Description']);

// Headings of the to-define section, accepted in any language and left out of the length count.
const TODEFINE_HEADINGS = new Set(['Da definire', 'To define']);

// Placeholder sentences, compared without case and without the trailing dot.
const PLACEHOLDERS = new Set(['da definire', 'to be defined']);

const THIN_LIMIT = 120;

/**
 * @param {string} campaignRoot absolute path to the campaign folder
 * @param {{ files: string[], base?: string|null }} options files relative to `base`,
 *   which is a folder relative to the campaign root (the root itself when absent)
 * @returns {{ sheets: Array<{ file: string, template: string|null, status: string, gaps: Array<{code: string, section: string, message: string}> }> }}
 * @throws {Error} when a file or the base folder is outside the root, or a file cannot be read
 */
export function sheetGaps(campaignRoot, { files, base = null } = {}) {
  const baseRel = base ?? '.';
  const baseAbs = path.resolve(campaignRoot, baseRel);
  if (!isInside(campaignRoot, baseAbs)) {
    throw new Error(`base folder is outside the campaign root: ${baseRel}`);
  }

  const language = readLanguage(campaignRoot);
  const headings = HEADINGS[language] ?? HEADINGS.en;

  const sheets = files.map((file) => {
    const abs = path.resolve(baseAbs, file);
    if (!isInside(campaignRoot, abs)) {
      throw new Error(`file is outside the campaign root: ${file}`);
    }
    let text;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch (err) {
      if (err?.code === 'ENOENT') throw new Error(`file does not exist: ${file}`);
      throw new Error(`file could not be read: ${file}`);
    }
    return checkSheet(file, text, headings);
  });

  return { sheets };
}

function isInside(root, abs) {
  return abs === root || abs.startsWith(root + path.sep);
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

/** Runs every rule on one sheet. */
function checkSheet(file, text, headings) {
  const { data, body, bodyStartLine } = parseFrontmatter(text);
  const { lines } = analyzeMarkdown(body, bodyStartLine);

  const template = templateOf(data, lines);
  if (template === null) {
    return { file, template: null, status: 'not-applicable', gaps: [] };
  }

  const gaps = [];
  const add = (code, section, message) => gaps.push({ code, section, message });
  const sections = readSections(lines);

  for (const key of REQUIRED[template]) {
    const heading = headings[key];
    const section = sections.find((s) => s.name === heading);
    if (!section) {
      add('missing-section', key, `section "${heading}" is missing`);
      continue;
    }
    if (key === 'stock') {
      const gap = stockGap(section, heading);
      if (gap) add(gap.code, key, gap.message);
    } else if (isEmpty(section.lines)) {
      add('empty-section', key, `section "${heading}" has no text`);
    }
  }

  if (template === 'place') {
    const section = sections.find((s) => s.name === headings.description);
    if (section && !hasItalicOpening(lines, section.start)) {
      add('no-opening', 'description', `section "${headings.description}" has no italic opening paragraph`);
    }
  }

  const total = publicLength(lines);
  if (total < THIN_LIMIT) {
    add('thin-sheet', 'sheet', `public text has ${total} characters, at least ${THIN_LIMIT} are needed`);
  }

  return { file, template, status: gaps.length === 0 ? 'usable' : 'to-complete', gaps };
}

/** The template of the sheet, or null when it is not one of the handled sheets. */
function templateOf(data, lines) {
  if (data && Object.hasOwn(data, 'template')) {
    return typeof data.template === 'string' && TEMPLATES.has(data.template) ? data.template : null;
  }
  // No template: a place is a file with a title and a description section.
  const hasTitle = lines.some((l) => isPublicHeading(l, 1));
  const hasDescription = lines.some(
    (l) => isPublicHeading(l, 2) && DESCRIPTION_HEADINGS.has(l.headingText),
  );
  return hasTitle && hasDescription ? 'place' : null;
}

function isPublicHeading(line, level) {
  return !line.inMaster && line.block === 'heading' && line.level === level;
}

/** Each `##` section outside the master block, with its content lines and its heading index. */
function readSections(lines) {
  const sections = [];
  let current = null;
  lines.forEach((line, index) => {
    if (line.inMaster || line.block.startsWith('master-')) return;
    if (line.block === 'heading') {
      if (line.level === 2) {
        current = { name: line.headingText, start: index, lines: [] };
        sections.push(current);
      } else if (line.level === 1) {
        current = null;
      }
      return;
    }
    if (current && line.block !== 'blank' && line.block !== 'comment') {
      current.lines.push(line);
    }
  });
  return sections;
}

/** True when the section holds no text, or only the placeholder sentence. */
function isEmpty(sectionLines) {
  if (sectionLines.length === 0) return true;
  const text = sectionLines.map((l) => l.text.trim()).join(' ');
  return PLACEHOLDERS.has(normalizePlaceholder(text));
}

function normalizePlaceholder(text) {
  return text.trim().replace(/\.$/, '').trim().toLowerCase();
}

/** A gap in a stock section: a table with no item row, or no text at all. */
function stockGap(section, heading) {
  const tables = section.lines.filter((l) => l.block === 'table');
  if (tables.length > 0) {
    // The first table line is the header; separator lines are not items.
    const rows = tables.slice(1).filter((l) => !isSeparator(l.text));
    return rows.length === 0
      ? { code: 'empty-stock', message: `table of section "${heading}" has no item row` }
      : null;
  }
  return isEmpty(section.lines)
    ? { code: 'empty-section', message: `section "${heading}" has no text` }
    : null;
}

function isSeparator(text) {
  let row = text.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|')) row = row.slice(0, -1);
  return row.split('|').every((cell) => /^\s*:?-+:?\s*$/.test(cell));
}

function isItalicLine(line) {
  const text = line.text.trim();
  return text.length >= 2 && text.startsWith('_') && text.endsWith('_');
}

/**
 * The italic opening paragraph sits before the section (under the title) or at its start.
 * @param {object[]} lines all lines of the body
 * @param {number} start index of the section heading in `lines`
 */
function hasItalicOpening(lines, start) {
  const before = lines
    .slice(0, start)
    .some((l) => !l.inMaster && !l.block.startsWith('master-') && isItalicLine(l));
  if (before) return true;

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.inMaster || line.block.startsWith('master-')) continue;
    if (line.block === 'heading' && line.level <= 2) return false;
    if (line.block === 'blank' || line.block === 'comment' || line.block === 'heading') continue;
    return isItalicLine(line);
  }
  return false;
}

/** Characters of the public text: no master block, no title, no headings, no to-define section. */
function publicLength(lines) {
  let total = 0;
  let skipping = false;
  for (const line of lines) {
    if (line.inMaster || line.block.startsWith('master-')) continue;
    if (line.block === 'heading') {
      if (line.level === 1) skipping = false;
      else if (line.level === 2) skipping = TODEFINE_HEADINGS.has(line.headingText);
      continue;
    }
    if (skipping || line.block === 'blank' || line.block === 'comment') continue;
    total += line.text.trim().length;
  }
  return total;
}
