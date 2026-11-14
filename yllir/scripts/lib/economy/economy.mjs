// Economy of a campaign: the economy document (metadata id `economia`), the
// price text of vendor stock rows and notice rewards, and the deterministic
// checks that compare them. Only the public part of a sheet is read, so the
// master-only block never changes a price. No model is used: the agent judges
// the content, this file reports what does not match the rules.

import fs from 'node:fs';
import path from 'node:path';
import { parseYamlLite } from '../yaml-lite.mjs';
import { parseFrontmatter } from '../frontmatter.mjs';
import { foldForm } from '../fold.mjs';
import { publicBody } from '../public-text.mjs';
import { buildWorldIndex } from '../world-graph.mjs';
import { readStructure, listCanonicalSheets, compareStrings } from '../subjects.mjs';

const ECONOMY_ID = 'economia';
const EPS = 1e-9;

// Section and column names per campaign language. Both languages are accepted
// in every campaign; the campaign language is tried first.
const SECTIONS = {
  currencies: { it: 'Valute', en: 'Currencies' },
  categories: { it: 'Prezzi base', en: 'Base prices' },
  wages: { it: 'Salari', en: 'Wages' },
  variations: { it: 'Variazioni per luogo', en: 'Variations by place' },
  stock: { it: 'Assortimento', en: 'Stock' },
  exceptions: { it: 'Deroghe', en: 'Exceptions' },
  reward: { it: 'Premio', en: 'Reward' },
};

const COLUMNS = {
  currencies: { it: ['Valuta', 'Equivalenza', 'Nota'], en: ['Currency', 'Equivalence', 'Note'] },
  categories: { it: ['Categoria', 'Minimo', 'Massimo', 'Unità'], en: ['Category', 'Minimum', 'Maximum', 'Unit'] },
  wages: { it: ['Mestiere', 'Paga', 'Periodo'], en: ['Trade', 'Pay', 'Period'] },
  variations: { it: ['Luogo', 'Fattore', 'Motivo'], en: ['Place', 'Factor', 'Reason'] },
  stock: { it: ['Oggetto', 'Prezzo', 'Nota'], en: ['Item', 'Price', 'Note'] },
};

const UNIT_WORDS = new Set(['unità di conto', 'unit of account'].map((s) => foldForm(s)));
const NO_REWARD = new Set(['nessun premio', 'no reward'].map((s) => foldForm(s)));

// <number> <word> pairs. The number may not follow a digit, dot or comma, so
// `0,5 scudi` is not read as `5 scudi`.
const PAIR_RE = /(?<![\d.,])(\d+(?:\.\d+)?)\s+(\p{L}+)/gu;

/**
 * Folds a currency word for matching: lowercase, no diacritics, one trailing
 * `s` removed when longer than 3 letters, then one trailing vowel when longer
 * than 3 letters. So `scudo`, `scudi` and `Scudi` match, and `gas` is not shortened.
 * @param {string} s
 * @returns {string}
 */
export function norm(s) {
  let x = foldForm(String(s));
  if (x.length > 3 && x.endsWith('s')) x = x.slice(0, -1);
  if (x.length > 3 && /[aeiou]$/.test(x)) x = x.slice(0, -1);
  return x;
}

/**
 * Campaign-relative path of the economy document (metadata `id: economia`), or null.
 * @param {string} root absolute path of the campaign
 * @returns {string|null}
 */
export function findEconomyDocument(root) {
  for (const rel of listAllSheets(root)) {
    const text = readText(root, rel);
    if (text === null) continue;
    if (parseFrontmatter(text).data?.id === ECONOMY_ID) return rel;
  }
  return null;
}

/**
 * Reads the economy document from its public text.
 * @param {string} markdown full file content
 * @param {string} [lang] campaign language, `it` or `en`
 * @returns {{ unit: string|null, currencies: object[], categories: object[], wages: object[], variations: object[], errors: Array<{code: string, message: string}> }}
 */
export function parseEconomy(markdown, lang = 'it') {
  const errors = [];
  const report = (code, message) => errors.push({ code, message });
  const sections = readSections(publicBody(String(markdown)));

  // Currencies
  const currencyRows = [];
  const currencyLines = sectionTable(sections, 'currencies', lang, report);
  if (currencyLines) {
    for (const cells of currencyLines) {
      const forms = cells[0].split(/\s*\/\s*/).map((f) => f.trim()).filter(Boolean);
      if (forms.length === 0) {
        report('economy-currency', 'a currency row has no name');
        continue;
      }
      const eq = cells[1].trim();
      const row = { name: forms[0], forms, unit: false, eq: null, resolved: undefined, busy: false };
      if (UNIT_WORDS.has(foldForm(eq))) {
        row.unit = true;
      } else {
        const m = /^(\d+(?:\.\d+)?)\s+(.+)$/.exec(eq);
        if (m) row.eq = { number: Number(m[1]), word: m[2].trim() };
        else report('economy-currency', `equivalence of "${row.name}" must be "<number> <currency>" or "unit of account": "${eq}"`);
      }
      currencyRows.push(row);
    }
  }

  const unitRows = currencyRows.filter((c) => c.unit);
  if (currencyLines && unitRows.length !== 1) {
    report('economy-currency', `exactly one currency must be the unit of account, found ${unitRows.length}`);
  }
  const unit = unitRows.length === 1 ? unitRows[0] : null;

  const lookup = (word) => findCurrency(currencyRows, word);

  const toUnitOf = (c) => {
    if (c.resolved !== undefined) return c.resolved;
    if (c.busy) {
      report('economy-currency', `"${c.name}" is part of an equivalence cycle`);
      return null;
    }
    if (c.unit) return (c.resolved = 1);
    if (c.eq === null) return (c.resolved = null);
    c.busy = true;
    const target = lookup(c.eq.word);
    let value = null;
    if (!target) {
      report('economy-currency', `"${c.name}" is worth an unknown currency "${c.eq.word}"`);
    } else {
      const base = toUnitOf(target);
      value = base === null ? null : c.eq.number * base;
    }
    c.busy = false;
    return (c.resolved = value);
  };
  for (const c of currencyRows) toUnitOf(c);

  const currencies = currencyRows.map((c) => ({ name: c.name, forms: c.forms, toUnit: c.resolved ?? null }));
  const unitName = unit ? unit.name : null;

  const economy = { unit: unitName, currencies, categories: [], wages: [], variations: [], errors };
  // Base prices
  const categoryLines = sectionTable(sections, 'categories', lang, report);
  if (categoryLines) {
    for (const cells of categoryLines) {
      const name = cells[0].trim();
      if (name === '') {
        report('economy-table', 'a base price row has no category');
        continue;
      }
      const min = parseNumber(cells[1]);
      const max = parseNumber(cells[2]);
      if (min === null) report('economy-range', `Minimo of "${name}" is not a number: "${cells[1].trim()}"`);
      if (max === null) report('economy-range', `Massimo of "${name}" is not a number: "${cells[2].trim()}"`);
      if (min !== null && max !== null && min > max) {
        report('economy-range', `Minimo of "${name}" (${min}) is above Massimo (${max})`);
      }
      const word = cells[3].trim();
      const cur = findCurrency(currencies, word);
      if (!cur) report('economy-currency', `the unit of "${name}" is not a known currency: "${word}"`);
      const rate = cur ? cur.toUnit : null;
      economy.categories.push({
        name,
        min,
        max,
        unit: cur ? cur.name : word,
        minInUnit: min !== null && rate !== null ? round(min * rate) : null,
        maxInUnit: max !== null && rate !== null ? round(max * rate) : null,
      });
    }
  }

  // Wages
  const wageLines = sectionTable(sections, 'wages', lang, report);
  if (wageLines) {
    for (const cells of wageLines) {
      const pay = cells[1].trim();
      economy.wages.push({
        trade: cells[0].trim(),
        pay,
        period: cells[2].trim(),
        value: parsePrice(pay, economy).value,
      });
    }
  }

  // Variations by place
  const variationLines = sectionTable(sections, 'variations', lang, report);
  if (variationLines) {
    for (const cells of variationLines) {
      const place = cells[0].trim();
      const factor = parsePositive(cells[1]);
      if (factor === null) {
        report('economy-place', `Fattore of "${place}" must be a positive number: "${cells[1].trim()}"`);
      }
      economy.variations.push({ place, factor, reason: cells[2].trim() });
    }
  }

  return economy;
}

/**
 * Reads the price text of one cell: every `<number> <currency>` pair is
 * converted to the reference unit and added. Parentheses are ignored.
 * @param {string} text
 * @param {{ currencies: object[] }} economy result of parseEconomy
 * @returns {{ value: number|null, unknown: string[] }}
 *   value is null when the text has no matching pair; unknown lists the
 *   currency words that match no currency or cannot be converted.
 */
export function parsePrice(text, economy) {
  const stripped = String(text ?? '').replace(/\([^)]*\)/g, ' ');
  const unknown = [];
  let total = null;
  for (const m of stripped.matchAll(PAIR_RE)) {
    const amount = Number(m[1]);
    const word = m[2];
    const cur = findCurrency(economy?.currencies ?? [], word);
    if (!cur || cur.toUnit === null) {
      if (!unknown.includes(word)) unknown.push(word);
      continue;
    }
    total = (total ?? 0) + amount * cur.toUnit;
  }
  return { value: total === null ? null : round(total), unknown };
}

/**
 * Checks the economy document: its tables, its ranges and currencies, and
 * that every variation names a place of the campaign.
 * @param {string} root absolute path of the campaign
 * @param {string} rel campaign-relative path of the economy document
 * @returns {{ errors: Array<{file: string, code: string, message: string}> }}
 */
export function checkEconomyDocument(root, rel) {
  const text = readText(root, rel);
  if (text === null) {
    return { errors: [{ file: rel, code: 'economy-table', message: 'economy document could not be read' }] };
  }
  const economy = parseEconomy(text, readLanguage(root));
  const errors = economy.errors.map((e) => ({ file: rel, code: e.code, message: e.message }));

  const places = new Set(buildWorldIndex(root).subjects.map((s) => s.id));
  for (const variation of economy.variations) {
    if (!places.has(variation.place)) {
      errors.push({
        file: rel,
        code: 'economy-place',
        message: `"${variation.place}" in the variations is not an id of the campaign`,
      });
    }
  }
  return { errors: sortErrors(errors) };
}

/**
 * Checks the prices of the given vendor and notice sheets against the economy.
 * Other files are ignored. Without an economy document there are no price checks.
 * @param {string} root absolute path of the campaign
 * @param {{ files?: string[] }} [options] campaign-relative paths
 * @returns {{ errors: Array<{file: string, code: string, message: string}> }}
 */
export function checkSheetPrices(root, { files = [] } = {}) {
  const ctx = priceContext(root);
  if (ctx === null) return { errors: [] };

  const errors = [];
  for (const rel of [...new Set(files.map(normalizeRel))].sort(compareStrings)) {
    const analysis = analyzeSheet(root, rel, ctx);
    if (analysis === null) continue;
    for (const row of analysis.rows) {
      if (row.status === 'unknown-currency') {
        errors.push({ file: rel, code: 'economy-currency', message: unknownMessage(row) });
      } else if (row.status === 'out-of-range') {
        errors.push({ file: rel, code: 'economy-price', message: outOfRangeMessage(row, ctx.economy.unit) });
      }
    }
  }
  return { errors: sortErrors(errors) };
}

/**
 * Lists the price rows that are out of range, have an unknown currency, or
 * match no category (`query prices`).
 * @param {string} root absolute path of the campaign
 * @returns {{ economy: 'missing'|'present', results: object[] }}
 */
export function priceReport(root) {
  const ctx = priceContext(root);
  if (ctx === null) return { economy: 'missing', results: [] };

  const results = [];
  for (const rel of listAllSheets(root)) {
    const analysis = analyzeSheet(root, rel, ctx);
    if (analysis === null) continue;
    for (const row of analysis.rows) {
      if (row.status === null) continue;
      results.push({
        file: rel,
        id: analysis.id,
        item: row.item,
        price: row.value,
        status: row.status,
        range: row.range,
        unit: ctx.economy.unit,
      });
    }
  }
  results.sort((a, b) => compareStrings(a.file, b.file) || compareStrings(a.item, b.item));
  return { economy: 'present', results };
}

// ---------------------------------------------------------------------------
// Sheets

/**
 * Proposed price of an item in the master's scale. The item's value in the game's
 * smallest coin is compared with the reference food's value in that same coin, and
 * the ratio is applied to the reference food's price in the economy document.
 * Reads the economy document only; no model is used.
 * @param {string} root campaign folder
 * @param {{ referenceValue: unknown, referenceLabels?: string[], systemValue: unknown }} input
 *   referenceValue: value of the reference food in the smallest coin (adapter economy.reference_value);
 *   referenceLabels: the reference food's names in the adapter (it and en);
 *   systemValue: the item's value in the same smallest coin.
 * @returns {object} status `ok` with the proposal, or a status and a message explaining why none was made
 */
export function priceProposal(root, { referenceValue, referenceLabels = [], systemValue }) {
  const rel = findEconomyDocument(root);
  if (rel === null) {
    return { status: 'no-economy', message: 'the campaign has no economy document (metadata id economia)' };
  }
  if (!isPositiveNumber(referenceValue)) {
    return { status: 'no-reference-value', message: 'the game system does not give a value for the reference food' };
  }
  if (!isPositiveNumber(systemValue)) {
    return { status: 'bad-system-value', message: `the value of the item must be a positive number, got ${String(systemValue)}` };
  }

  const economy = parseEconomy(readText(root, rel), readLanguage(root));
  const labels = new Set(referenceLabels.filter((label) => typeof label === 'string').map((label) => foldForm(label)));
  const row = economy.categories.find((category) => labels.has(foldForm(category.name)));
  if (row === undefined) {
    return { status: 'no-reference-row', message: 'the economy document has no base price row for the reference food' };
  }
  if (row.minInUnit === null || row.maxInUnit === null || row.min === null || row.max === null) {
    return { status: 'no-reference-row', message: `the base price row "${row.name}" has no usable range` };
  }

  const ratio = systemValue / referenceValue;
  const referencePrice = (row.min + row.max) / 2;
  const referencePriceInUnit = (row.minInUnit + row.maxInUnit) / 2;
  return {
    status: 'ok',
    systemValue,
    referenceValue,
    referenceCategory: row.name,
    referencePrice,
    unit: row.unit,
    proposed: round2(ratio * referencePrice),
    unitOfAccount: economy.unit,
    proposedInUnitOfAccount: round(ratio * referencePriceInUnit),
  };
}

function isPositiveNumber(x) {
  return typeof x === 'number' && Number.isFinite(x) && x > 0;
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

/** Economy, world places and the campaign language, or null without an economy document. */
function priceContext(root) {
  const rel = findEconomyDocument(root);
  if (rel === null) return null;
  const lang = readLanguage(root);
  const economy = parseEconomy(readText(root, rel), lang);
  const subjects = buildWorldIndex(root).subjects;
  const byId = new Map(subjects.map((s) => [s.id, s]));
  const factors = new Map();
  for (const v of economy.variations) {
    if (v.factor !== null && !factors.has(v.place)) factors.set(v.place, v.factor);
  }
  return { economy, lang, byId, factors };
}

/**
 * Price rows of one vendor or notice sheet, or null when the file is neither.
 * Each row: { item, value, unknown, status, category, range, excepted }.
 */
function analyzeSheet(root, rel, ctx) {
  const text = readText(root, rel);
  if (text === null) return null;
  const { data } = parseFrontmatter(text);
  const template = data?.template;
  if (template !== 'vendor' && template !== 'notice') return null;

  const id = typeof data?.id === 'string' && data.id !== '' ? data.id : path.posix.basename(rel, '.md');
  const sections = readSections(publicBody(text));
  const { economy } = ctx;

  if (template === 'notice') {
    const rewardLines = sectionLines(sections, 'reward', ctx.lang);
    if (rewardLines === null) return { id, rows: [] };
    const reward = rewardLines.map((l) => l.trim()).filter(Boolean).join(' ');
    if (reward === '' || NO_REWARD.has(foldForm(reward.replace(/\.$/, '')))) return { id, rows: [] };
    if (!/\d/.test(reward.replace(/\([^)]*\)/g, ' '))) return { id, rows: [] };
    const p = parsePrice(reward, economy);
    const status = p.unknown.length > 0 || p.value === null ? 'unknown-currency' : null;
    return {
      id,
      rows: [{ item: reward, value: p.value, unknown: p.unknown, status, category: null, range: null, excepted: false, kind: 'reward' }],
    };
  }

  const lines = sectionTable(sections, 'stock', ctx.lang, null);
  if (lines === null) return { id, rows: [] };
  const exceptionLines = sectionLines(sections, 'exceptions', ctx.lang) ?? [];
  const exceptionsText = foldForm(exceptionLines.join(' '));
  const factor = placeFactor(data.location, ctx);

  const rows = [];
  for (const cells of lines) {
    const item = cells[0].trim();
    if (item === '') continue;
    const priceText = cells[1] ?? '';
    const p = parsePrice(priceText, economy);
    const hasDigit = /\d/.test(priceText.replace(/\([^)]*\)/g, ' '));
    const category = matchCategory(item, economy.categories);
    const range =
      category && category.minInUnit !== null && category.maxInUnit !== null
        ? [round(category.minInUnit * factor), round(category.maxInUnit * factor)]
        : null;
    const excepted = exceptionsText.includes(foldForm(item));

    let status = null;
    if (p.unknown.length > 0 || (p.value === null && hasDigit)) {
      status = 'unknown-currency';
    } else if (p.value === null) {
      status = category ? null : 'unmatched';
    } else if (!category) {
      status = 'unmatched';
    } else if (range && (p.value < range[0] - EPS || p.value > range[1] + EPS) && !excepted) {
      status = 'out-of-range';
    }
    rows.push({
      item,
      priceText,
      value: p.value,
      unknown: p.unknown,
      status,
      category: category ? category.name : null,
      range,
      excepted,
      kind: 'stock',
    });
  }
  return { id, rows };
}

/** Factor of the vendor's place: its first location, then its parents (nearest first). */
function placeFactor(location, ctx) {
  if (!Array.isArray(location) || location.length === 0) return 1;
  const queue = [String(location[0])];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const id = queue.shift();
    if (ctx.factors.has(id)) return ctx.factors.get(id);
    const subject = ctx.byId.get(id);
    if (!subject) continue;
    for (const parent of subject.location) {
      const key = String(parent);
      if (!seen.has(key)) {
        seen.add(key);
        queue.push(key);
      }
    }
  }
  return 1;
}

/** The category whose folded name is found in the item as whole words; the longest name wins. */
function matchCategory(item, categories) {
  const folded = foldForm(item);
  let best = null;
  for (const category of categories) {
    const name = foldForm(category.name);
    if (name === '') continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(name)}($|[^\\p{L}\\p{N}])`, 'u');
    if (re.test(folded) && (best === null || name.length > foldForm(best.name).length)) best = category;
  }
  return best;
}

function unknownMessage(row) {
  const what = row.kind === 'reward' ? `reward "${row.item}"` : `price of "${row.item}"`;
  const words = row.unknown.length > 0 ? row.unknown.join(', ') : row.priceText ?? row.item;
  return `${what} names an unknown currency: ${words}`;
}

function outOfRangeMessage(row, unit) {
  const [lo, hi] = row.range;
  return `"${row.item}" costs ${row.value} ${unit}, outside the range ${lo}-${hi} ${unit}`;
}

// ---------------------------------------------------------------------------
// Markdown and table helpers

/** Sections of a public body: `## Name` to the next `##` (or `#`). */
function readSections(body) {
  const sections = [];
  let current = null;
  for (const line of String(body).split(/\r?\n/)) {
    const m = /^##\s+(.*?)\s*#*\s*$/.exec(line);
    if (m) {
      current = { name: foldForm(m[1]), lines: [] };
      sections.push(current);
      continue;
    }
    if (/^#\s/.test(line)) {
      current = null;
      continue;
    }
    if (current) current.lines.push(line);
  }
  return sections;
}

/** Lines of a section named in either language (campaign language first), or null. */
function sectionLines(sections, key, lang) {
  const names = SECTIONS[key];
  for (const name of orderedLangs(names, lang)) {
    const found = sections.find((s) => s.name === foldForm(names[name]));
    if (found) return found.lines;
  }
  return null;
}

/**
 * Rows of the first table of a section, as arrays of cell texts. Reports, when
 * given a reporter, a missing section, a section with no table and a table with
 * the wrong columns; returns null in those cases.
 */
function sectionTable(sections, key, lang, report) {
  const names = SECTIONS[key];
  const lines = sectionLines(sections, key, lang);
  const label = names[lang] ?? names.en;
  if (lines === null) {
    if (report) report('economy-table', `missing section "${label}"`);
    return null;
  }
  const table = firstTable(lines);
  if (table === null) {
    if (report) report('economy-table', `section "${label}" has no table`);
    return null;
  }
  if (!COLUMNS[key]) return table.rows;
  const header = table.header.map(foldForm);
  const ok = orderedLangs(COLUMNS[key], lang).some((l) => {
    const expected = COLUMNS[key][l].map(foldForm);
    return expected.length === header.length && expected.every((c, i) => c === header[i]);
  });
  if (!ok) {
    if (report) report('economy-table', `table of "${label}" must have the columns ${COLUMNS[key][lang].join(', ')}`);
    return null;
  }
  return table.rows;
}

/** First Markdown table of some lines: its header cells and its data rows. */
function firstTable(lines) {
  const start = lines.findIndex((l) => l.trim().startsWith('|'));
  if (start < 0 || start + 1 >= lines.length) return null;
  const separator = splitRow(lines[start + 1]);
  if (!separator.every((c) => /^:?-+:?$/.test(c.trim()))) return null;
  const rows = [];
  for (let i = start + 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
    const cells = splitRow(lines[i]);
    while (cells.length < 3) cells.push('');
    if (cells.every((c) => c.trim() === '')) continue;
    rows.push(cells);
  }
  return { header: splitRow(lines[start]), rows };
}

/** Cells of a Markdown table row, without the outer pipes. */
function splitRow(text) {
  let row = text.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|')) row = row.slice(0, -1);
  return row.split('|').map((c) => c.trim());
}

function orderedLangs(names, lang) {
  const other = lang === 'it' ? 'en' : 'it';
  return [lang, other].filter((l) => names[l] !== undefined);
}

/** Currency matching a word, by the folded form. */
function findCurrency(currencies, word) {
  const key = norm(word);
  for (const c of currencies) {
    if (c.forms.some((f) => norm(f) === key)) return c;
  }
  return null;
}

/** Strictly numeric cell (`.` decimal): a non-negative number, or null. */
function parseNumber(text) {
  const t = String(text ?? '').trim();
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

function parsePositive(text) {
  const n = parseNumber(text);
  return n !== null && n > 0 ? n : null;
}

function round(x) {
  return Math.round(x * 1e6) / 1e6;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeRel(p) {
  return path.posix.normalize(String(p).split(path.sep).join('/'));
}

function sortErrors(errors) {
  return [...errors].sort(
    (a, b) => compareStrings(a.file, b.file) || compareStrings(a.code, b.code) || compareStrings(a.message, b.message),
  );
}

// ---------------------------------------------------------------------------
// Campaign files

/** Every canonical sheet of every structure category, sorted. */
function listAllSheets(root) {
  const { structure } = readStructure(root);
  if (structure === null) return [];
  const files = new Set();
  for (const category of structure) {
    if (typeof category.folder !== 'string') continue;
    for (const rel of listCanonicalSheets(root, category.folder)) files.add(rel);
  }
  return [...files].sort(compareStrings);
}

function readText(root, rel) {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf8');
  } catch {
    return null;
  }
}

/** Campaign language from campaign.yaml, `en` when missing. */
function readLanguage(root) {
  const text = readText(root, 'campaign.yaml');
  if (text === null) return 'en';
  const { data } = parseYamlLite(text);
  const main = data?.language?.main;
  return typeof main === 'string' && main !== '' ? main : 'en';
}
