// Conservative migration and validation helpers for statistics tables.
import { analyzeMarkdown } from './zones.mjs';

const HEADINGS = { it: 'Statistiche', en: 'Statistics' };
const LABELS = {
  it: {
    characteristics: 'Caratteristiche', actions: 'Attacchi e capacità', equipment: 'Equipaggiamento',
    characteristic: ['Caratteristica', 'Valore'], action: ['Attacco o capacità', 'Dettagli'], item: ['Oggetto', 'Dettagli'],
  },
  en: {
    characteristics: 'Characteristics', actions: 'Attacks and abilities', equipment: 'Equipment',
    characteristic: ['Characteristic', 'Value'], action: ['Attack or ability', 'Details'], item: ['Item', 'Details'],
  },
};
const ATTRIBUTE_LABELS = new Set([
  'ac', 'ca', 'armor class', 'classe armatura', 'hp', 'pf', 'hit points', 'punti ferita',
  'speed', 'velocità', 'velocita', 'str', 'for', 'forza', 'dex', 'des', 'destrezza',
  'con', 'cos', 'costituzione', 'int', 'intelligenza', 'wis', 'sag', 'saggezza',
  'cha', 'car', 'carisma', 'initiative', 'iniziativa', 'proficiency bonus', 'bonus competenza',
  'saving throws', 'tiri salvezza', 'skills', 'abilità', 'abilita', 'senses', 'sensi',
  'resistances', 'resistenze', 'immunities', 'immunità', 'immunita', 'challenge', 'sfida', 'cr',
]);

export function inspectStatisticsTables(markdown, language = 'en') {
  const text = String(markdown);
  const sections = findStatisticsSections(text, language);
  const tables = [];
  const sectionInfo = sections.map((range) => ({ ...range, source: text.slice(range.start, range.end) }));
  let pending = false;
  for (const range of sections) {
    const source = text.slice(range.start, range.end);
    if (!source.trim() || isPlaceholder(source) || isNoncombatSentence(source)) continue;
    const parsed = parseStatistics(source, language);
    if (parsed.status === 'compliant') continue;
    const item = { start: range.start, end: range.end, source, classification: parsed.status === 'convertible' ? 'stats' : 'ambiguous' };
    if (parsed.reason) item.reason = parsed.reason;
    tables.push(item);
    if (item.classification === 'ambiguous') pending = true;
  }
  return { status: pending ? 'pending' : tables.length ? 'convertible' : 'none', tables, sections: sectionInfo, markdown: text };
}

export function convertStatisticsTables(markdown, language = 'en') {
  const text = String(markdown);
  const inspection = inspectStatisticsTables(text, language);
  let result = text;
  const convertible = inspection.tables.filter((item) => item.classification === 'stats').sort((a, b) => b.start - a.start);
  for (const item of convertible) {
    const parsed = parseStatistics(item.source, language);
    result = result.slice(0, item.start) + render(parsed.rows, language, item.source) + result.slice(item.end);
  }
  return {
    markdown: result,
    status: inspection.status === 'none' ? 'none' : inspection.status === 'pending' ? 'pending' : 'converted',
    convertedCount: convertible.length,
    pending: inspection.tables.filter((item) => item.classification === 'ambiguous').map(({ source, classification, reason }) => ({ source, classification, reason })),
  };
}

/** Reports whether every row in a non-placeholder statistics block uses the required table form. */
export function validateStatisticsTables(source, language = 'en', { allowNoncombat = false } = {}) {
  const text = String(source);
  if (isPlaceholder(text) || (allowNoncombat && isNoncombatSentence(text))) return { ok: true, reason: null };
  const parsed = parseStatistics(text, language);
  return { ok: parsed.status === 'compliant', reason: parsed.reason ?? null };
}

/**
 * Number of data rows in the actions table (### Attacchi e capacità / ### Attacks and abilities)
 * of a Statistics section's text (the text under ## Statistics, without the ## heading).
 * The header row and the separator row (| --- | --- |) are not counted. 0 when there is no such table.
 */
export function actionRowCount(source, language = 'en') {
  const actions = (LABELS[language] ?? LABELS.en).actions;
  const { lines } = analyzeMarkdown(String(source));
  let inActions = false;
  const tableLines = [];
  for (const line of lines) {
    if (line.inMaster) continue;
    if (line.block === 'heading' && line.level <= 3) {
      if (inActions) break;
      inActions = line.level === 3 && line.headingText === actions;
      continue;
    }
    if (inActions && line.block === 'table') tableLines.push(line.text);
  }
  const dataLines = tableLines.slice(1).filter((text) => !/^\s*\|?\s*:?-{3,}/.test(text));
  return Math.max(0, dataLines.length);
}

export function findStatisticsSections(text, language) {
  const { lines } = analyzeMarkdown(text);
  const offsets = [];
  let offset = 0;
  for (const line of text.split(/(?<=\n)/)) { offsets.push(offset); offset += line.length; }
  const target = HEADINGS[language] ?? HEADINGS.en;
  const ranges = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.inMaster || line.block !== 'heading' || line.level !== 2 || line.headingText !== target) continue;
    const start = offsets[i + 1] ?? text.length;
    let end = text.length;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      if (next.inMaster || next.block.startsWith('master-')) { end = offsets[j]; break; }
      if (next.block === 'heading' && next.level === 2) { end = offsets[j]; break; }
    }
    ranges.push({ start, end });
  }
  return ranges;
}

function parseStatistics(source, language) {
  const labels = LABELS[language] ?? LABELS.en;
  const { lines } = analyzeMarkdown(source);
  const groups = new Map();
  let group = null;
  let headed = false;
  let sawContent = false;
  for (const line of lines) {
    if (line.inMaster || line.block.startsWith('master-') || line.block === 'blank') continue;
    if (line.block === 'comment') return { status: 'ambiguous', reason: 'statistics comments need review' };
    if (line.block === 'heading' && line.level === 3) {
      group = Object.keys(labels).find((key) => ['characteristics', 'actions', 'equipment'].includes(key) && line.headingText === labels[key]) ?? null;
      headed = Boolean(group);
      if (group && !groups.has(group)) groups.set(group, []);
      else if (group) return { status: 'ambiguous', reason: 'duplicate statistics subsection' };
      else return { status: 'ambiguous', reason: 'unrecognized statistics subsection' };
      continue;
    }
    sawContent = true;
    if (line.block !== 'table' && line.block !== 'list' && line.block !== 'paragraph') return { status: 'ambiguous', reason: 'unsupported statistics content' };
    if (!group) {
      const row = parseLabelLine(line.text);
      if (!row) return { status: 'ambiguous', reason: 'statistics prose or an unlabelled row needs interpretation' };
      const classified = headed ? group : classify(row.label);
      if (!classified) return { status: 'ambiguous', reason: `unrecognized statistic label: ${row.label}` };
      if (!groups.has(classified)) groups.set(classified, []);
      groups.get(classified).push(row);
    } else if (line.block === 'table') {
      if (!headed) return { status: 'ambiguous', reason: 'statistics tables need a recognized subsection heading' };
      groups.get(group).push({ tableLine: line.text });
    } else {
      const row = parseLabelLine(line.text);
      if (!row) return { status: 'ambiguous', reason: 'statistics prose or an unlabelled row needs interpretation' };
      const classified = headed ? group : classify(row.label);
      if (!classified) return { status: 'ambiguous', reason: `unrecognized statistic label: ${row.label}` };
      if (!groups.has(classified)) groups.set(classified, []);
      groups.get(classified).push(row);
    }
  }
  if (!sawContent) return { status: 'ambiguous', reason: 'statistics section is empty' };
  const rows = [];
  const anyTable = [...groups.values()].some((entries) => entries.some((entry) => entry.tableLine));
  const anyLegacy = [...groups.values()].some((entries) => entries.some((entry) => !entry.tableLine));
  if (anyTable && anyLegacy) return { status: 'ambiguous', reason: 'mixed existing tables and labelled rows need interpretation' };
  for (const [key, entries] of groups) {
    if (entries.some((entry) => entry.tableLine)) {
      if (entries.some((entry) => !entry.tableLine)) return { status: 'ambiguous', reason: 'mixed table and labelled rows need interpretation' };
      const expected = key === 'characteristics' ? labels.characteristic : key === 'actions' ? labels.action : labels.item;
      if (!isValidTable(entries, expected)) return { status: 'ambiguous', reason: 'existing statistics table has an invalid header or row' };
      continue;
    }
    for (const entry of entries) rows.push({ group: key, ...entry });
  }
  return { status: rows.length ? 'convertible' : 'compliant', rows };
}

function parseLabelLine(line) {
  const cleaned = line.trim().replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '');
  const match = /^([^:–—]{1,60})\s*(?::|–|—)\s*(.+)$/.exec(cleaned);
  if (!match) return null;
  return { label: match[1].trim(), value: match[2].trim() };
}

function classify(label) {
  const normalized = label.trim().toLowerCase().replace(/\s+/g, ' ');
  if (ATTRIBUTE_LABELS.has(normalized)) return 'characteristics';
  if (/^(attack|attacks|attacco|attacchi|ability|abilities|capacità|capacita|trait|traits|tratto|tratti|action|actions|azione|azioni)(\s|$)/i.test(label)) return 'actions';
  if (/^(equipment|equipaggiamento|item|items|oggetto|oggetti|gear|weapon|weapons|arma|armi)(\s|$)/i.test(label)) return 'equipment';
  return null;
}

function isValidTable(entries, expected) {
  const cells = entries.map(({ tableLine }) => tableLine).filter(Boolean).map(splitRow);
  if (cells.length < 2 || cells[0].length !== 2 || cells[1].length !== 2) return false;
  if (fold(cells[0][0]) !== fold(expected[0]) || fold(cells[0][1]) !== fold(expected[1])) return false;
  if (!cells[1].every((cell) => /^:?-{3,}:?$/.test(cell))) return false;
  return cells.slice(2).every((row) => row.length === 2);
}

function render(rows, language, original = '') {
  const labels = LABELS[language] ?? LABELS.en;
  const headers = { characteristics: labels.characteristic, actions: labels.action, equipment: labels.item };
  const groups = ['characteristics', 'actions', 'equipment'];
  const tables = groups.map((group) => {
    const items = rows.filter((row) => row.group === group);
    if (!items.length) return '';
    return `### ${labels[group]}\n\n| ${headers[group][0]} | ${headers[group][1]} |\n| --- | --- |\n${items.map((row) => `| ${escapeCell(row.label)} | ${escapeCell(row.value)} |`).join('\n')}`;
  }).filter(Boolean).join('\n\n');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const leading = /^(?:(?:\r?\n)[ \t]*)+/.exec(original)?.[0] ?? '';
  const trailing = /(?:(?:\r?\n)[ \t]*)+$/.exec(original)?.[0] ?? '';
  const middle = original.slice(leading.length, original.length - trailing.length);
  const prefix = leading || eol.repeat(2);
  const suffix = trailing || eol;
  return prefix + (tables ? tables.replace(/\n/g, eol) : middle) + suffix;
}

function splitRow(line) {
  let value = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let current = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '|' && (i === 0 || value[i - 1] !== '\\')) { cells.push(current.trim()); current = ''; }
    else current += value[i];
  }
  cells.push(current.trim());
  return cells;
}
function escapeCell(value) { return String(value).replace(/(^|[^\\])\|/g, '$1\\|'); }
function fold(value) { return String(value).trim().toLowerCase(); }
function isPlaceholder(source) { return /^(?:da definire\.|to be defined\.)$/i.test(source.trim()); }
function isNoncombatSentence(source) { return /^(?:nessuna statistica: non combatte\.|no statistics: it does not fight\.)$/i.test(source.trim()); }
