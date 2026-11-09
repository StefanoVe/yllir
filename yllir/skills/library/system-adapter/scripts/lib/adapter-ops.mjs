import { parseFrontmatter } from '../../../../../scripts/lib/frontmatter.mjs';

const LANGUAGES = new Set(['it', 'en']);
const MASTER_MARKER = '<!-- master -->';

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

export function validateSheet(adapter, kind, markdown, lang) {
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
  const description = section(body, adapter.headings?.description?.[lang] ?? '');

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
