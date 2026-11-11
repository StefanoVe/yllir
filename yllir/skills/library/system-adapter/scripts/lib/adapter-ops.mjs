import { pathToFileURL } from 'node:url';
import { parseFrontmatter } from '../../../../../scripts/lib/frontmatter.mjs';

const LANGUAGES = new Set(['it', 'en']);
const MASTER_MARKER = '<!-- master -->';
const CHARACTERISTICS = { it: 'Caratteristiche', en: 'Characteristics' };
// Optional creature fields that a Characteristics table may name, by language.
const OPTIONAL_CREATURE_LABELS = {
  it: { sfida: 'cr', 'bonus competenza': 'proficiency_bonus' },
  en: { challenge: 'cr', cr: 'cr', 'proficiency bonus': 'proficiency_bonus' },
};

function error(code, message) { return { code, message }; }

function languageError(lang) {
  return LANGUAGES.has(lang) ? null : error('unsupported-language', `unsupported language: ${lang}`);
}

function publicBody(markdown) {
  const { body } = parseFrontmatter(String(markdown));
  const marker = body.indexOf(MASTER_MARKER);
  return marker >= 0 ? body.slice(0, marker) : body;
}

function headingLines(text) {
  return [...text.matchAll(/^##[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)].map((match) => ({
    title: match[1].trim(), start: match.index, end: match.index + match[0].length,
  }));
}

function section(text, title) {
  const headings = headingLines(text);
  const found = headings.find((heading) => heading.title === title);
  if (!found) return null;
  const next = headings.find((heading) => heading.start > found.start);
  const end = next ? next.start : text.length;
  return text.slice(found.end, end).replace(/^\r?\n/, '');
}

function hasWholeLabel(text, label) {
  const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(text);
}

// Rows of the table under a `### title` subsection, as { label, value } from the first two cells.
function characteristicRows(statistics, title) {
  const lines = statistics.split(/\r?\n/);
  const start = lines.findIndex((line) => {
    const match = /^###[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
    return match !== null && match[1].trim() === title;
  });
  if (start < 0) return [];
  const rows = [];
  let header = true;
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}[ \t]/.test(line)) break;
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    if (header) { header = false; continue; }
    if (cells.length >= 2) rows.push({ label: cells[0], value: cells[1] });
  }
  return rows;
}

// Maps table labels to adapter field ids (case-insensitive, trimmed). Raw cell text is kept.
function characteristicFields(adapter, rows, lang) {
  const labelToField = new Map();
  for (const field of adapter.creature_sheet?.required ?? []) {
    const label = field[`label_${lang}`];
    if (typeof label === 'string') labelToField.set(label.trim().toLowerCase(), field.id);
  }
  for (const [label, id] of Object.entries(OPTIONAL_CREATURE_LABELS[lang] ?? {})) {
    if (!labelToField.has(label)) labelToField.set(label, id);
  }
  const fields = {};
  for (const row of rows) {
    const id = labelToField.get(row.label.trim().toLowerCase());
    if (id !== undefined && fields[id] === undefined) fields[id] = row.value;
  }
  return fields;
}

// Runs the adapter's own arithmetic checks, if the adapter declares a checks file.
async function arithmeticErrors(adapter, statistics, lang) {
  if (!adapter.checksPath) return [];
  let checks;
  try {
    checks = await import(pathToFileURL(adapter.checksPath).href);
  } catch (err) {
    return [error('checks-unavailable', `adapter checks could not be loaded: ${err.message}`)];
  }
  if (typeof checks.checkCreature !== 'function') return [error('checks-unavailable', 'adapter checks do not export checkCreature')];
  const rows = characteristicRows(statistics, CHARACTERISTICS[lang]);
  const fields = characteristicFields(adapter, rows, lang);
  return checks.checkCreature(fields).map((entry) => error(entry.code, entry.message));
}

export async function validateSheet(adapter, kind, markdown, lang) {
  const errors = [];
  const langIssue = languageError(lang);
  if (langIssue) return { ok: false, errors: [langIssue] };
  if (kind !== 'creature' && kind !== 'item') return { ok: false, errors: [error('bad-kind', `unsupported sheet kind: ${kind}`)] };

  const body = publicBody(markdown);
  const headings = adapter.headings ?? {};
  if (kind === 'creature') {
    const parsed = parseFrontmatter(String(markdown));
    const noncombat = parsed.data?.template === 'creature';
    const statistics = section(body, headings.statistics?.[lang] ?? '');
    if (statistics === null) {
      errors.push(error('missing-section', `missing section: ${headings.statistics?.[lang] ?? 'statistics'}`));
    } else if (!noncombat) {
      for (const field of adapter.creature_sheet?.required ?? []) {
        const label = field[`label_${lang}`];
        if (typeof label !== 'string' || !hasWholeLabel(statistics, label)) {
          errors.push(error('missing-field', `missing field: ${field.id}`));
        }
      }
      errors.push(...await arithmeticErrors(adapter, statistics, lang));
    }
  } else {
    for (const key of ['description', 'effects']) {
      const title = headings[key]?.[lang] ?? '';
      if (section(body, title) === null) errors.push(error('missing-section', `missing section: ${title || key}`));
    }
  }
  return { ok: errors.length === 0, errors };
}

export function cardFields(adapter, markdown, lang) {
  const errors = [];
  const langIssue = languageError(lang);
  if (langIssue) return { ok: false, errors: [langIssue], fields: {} };
  const fields = {};
  const allowed = adapter.item_sheet?.printable_fields ?? [];
  const body = publicBody(markdown);
  const titleMatch = /^#[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(body);
  const briefTitle = adapter.headings?.brief?.[lang] ?? (lang === 'it' ? 'In breve' : 'In brief');
  const brief = briefTitle ? section(body, briefTitle) : null;
  const description = brief === null
    ? section(body, adapter.headings?.description?.[lang] ?? '')
    : brief;

  for (const name of allowed) {
    if (name === 'title' && titleMatch) fields.title = titleMatch[1].trim();
    else if (name === 'description' && description !== null) fields.description = description.trim();
    else errors.push(error('missing-field', `missing printable field: ${name}`));
  }
  return { ok: errors.length === 0, errors, fields };
}

export function progressionEvent(adapter, event) {
  if (adapter.progression?.method !== 'milestone') {
    return { ok: true, milestone: false, reason: 'adapter-has-no-milestones' };
  }
  if (event?.declared_by_master !== true) {
    return { ok: true, milestone: false, reason: 'not-declared-by-master' };
  }
  if (event?.kind !== 'milestone') {
    return { ok: true, milestone: false, reason: 'not-a-milestone' };
  }
  return { ok: true, milestone: true };
}
