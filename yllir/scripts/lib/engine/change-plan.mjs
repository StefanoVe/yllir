// Census of everything in a campaign that refers to one subject: its links, its
// unlinked mentions, the frontmatter fields that hold its id and its homonyms.
// Used before a rename, merge, split or deletion so that no reference is
// forgotten. It is read-only: it writes nothing. Documents of a chronicle
// category are reported with history: true, because later operations never
// rewrite them.

import fs from 'node:fs';
import path from 'node:path';
import { buildSubjectIndex, readStructure, listCanonicalSheets, compareStrings } from '../subjects.mjs';
import { scanMentions, isSameSheet, resolveLinkTarget } from '../mentions.mjs';
import { parseFrontmatter } from '../frontmatter.mjs';
import { analyzeMarkdown } from '../zones.mjs';
import { foldForm } from '../fold.mjs';

// Mention states that are links, not mentions: they are reported as links instead.
const LINKED_STATES = new Set(['linked', 'linked-elsewhere']);

/**
 * @param {string} root absolute path to the campaign folder
 * @param {string} subjectId the `id` of the subject sheet
 * @returns {object} the census, or { ok: false, errors } for an unknown id
 */
export function changePlan(root, subjectId) {
  const index = buildSubjectIndex(root);
  const subject = index.subjects.find((candidate) => candidate.id === subjectId);
  if (subject === undefined) {
    return {
      ok: false,
      errors: [{ code: 'unknown-subject', message: `unknown subject id "${subjectId}"` }],
    };
  }

  const { structure } = readStructure(root);
  const categories = structure ?? [];
  const typeOf = categoryTypeOf(categories);
  const isHistory = (file) => typeOf(file) === 'chronicle';
  const documents = campaignDocuments(root, categories, typeOf);

  const titleForm = subject.forms.find((form) => form.kind === 'title');
  return {
    ok: true,
    subject: {
      id: subject.id,
      sheet: subject.sheet,
      title: titleForm === undefined ? subject.sheet : titleForm.text,
      forms: subject.forms.map((form) => form.text),
    },
    links: linksTo(root, subject, documents, isHistory),
    mentions: mentionsOf(root, index, subject, isHistory),
    fields: fieldsHolding(root, subject, documents, isHistory),
    homonyms: index.homonyms
      .filter((group) => group.subjects.includes(subject.id))
      .map((group) => ({ folded: group.folded, subjects: [...group.subjects] })),
    errors: [],
  };
}

/**
 * Every campaign document: the sheets of every category except `external`
 * (read-only originals of another campaign). Campaign-relative, sorted, once each.
 */
function campaignDocuments(root, structure, typeOf) {
  const found = new Set();
  for (const category of structure) {
    if (typeof category.folder !== 'string') continue;
    for (const rel of listCanonicalSheets(root, category.folder)) {
      if (typeOf(rel) !== 'external') found.add(rel);
    }
  }
  return [...found].sort(compareStrings);
}

/** Every markdown link of a document with frontmatter whose target is the subject's sheet. */
function linksTo(root, subject, documents, isHistory) {
  const links = [];
  for (const file of documents) {
    const { data, body, bodyStartLine } = parseFrontmatter(readText(root, file));
    if (data === null) continue;
    const { lines } = analyzeMarkdown(body, bodyStartLine);
    for (const line of lines) {
      for (const span of line.spans) {
        if (span.kind !== 'link') continue;
        const target = resolveLinkTarget(span.target, file, root);
        if (!isSameSheet(target, subject, root)) continue;
        links.push({
          file,
          line: line.line,
          text: line.text.slice(span.labelStart, span.labelEnd),
          target: span.target,
          history: isHistory(file),
        });
      }
    }
  }
  return links;
}

/** Every not-linked mention of one of the subject's forms, from the existing mention scan. */
function mentionsOf(root, index, subject, isHistory) {
  const { occurrences } = scanMentions(root, index);
  const mentions = [];
  for (const occurrence of occurrences) {
    if (LINKED_STATES.has(occurrence.state)) continue;
    const ids = occurrence.candidates ?? [occurrence.subject];
    if (!ids.includes(subject.id)) continue;
    const matched = subject.forms.find((form) => form.folded === foldForm(occurrence.text));
    mentions.push({
      file: occurrence.file,
      line: occurrence.line,
      form: matched === undefined ? occurrence.text : matched.text,
      state: occurrence.state,
      history: isHistory(occurrence.file),
    });
  }
  return mentions;
}

/** Every top-level frontmatter field of another document that holds the subject id. */
function fieldsHolding(root, subject, documents, isHistory) {
  const fields = [];
  for (const file of documents) {
    if (file === subject.sheet || subject.paths?.includes(file)) continue;
    const { data } = parseFrontmatter(readText(root, file));
    if (data === null) continue;
    for (const key of Object.keys(data).sort(compareStrings)) {
      if (holdsId(data[key], subject.id)) {
        fields.push({ file, field: key, history: isHistory(file) });
      }
    }
  }
  return fields;
}

/** True when a value (a string, or a list or mapping of them) holds the id as a whole token. */
function holdsId(value, id) {
  if (typeof value === 'string') {
    return value === id || value.split(/[\s,;[\]]+/).includes(id);
  }
  if (Array.isArray(value)) return value.some((item) => holdsId(item, id));
  if (value !== null && typeof value === 'object') return Object.values(value).some((item) => holdsId(item, id));
  return false;
}

/**
 * Decides the category type of a campaign-relative path: the category with the
 * longest folder that is a prefix of it. Null when no category holds the path.
 * @returns {(rel: string) => string|null}
 */
function categoryTypeOf(structure) {
  const categories = structure
    .filter((entry) => typeof entry.folder === 'string')
    .map((entry) => {
      const folder = path.posix.normalize(entry.folder).replace(/\/+$/, '');
      const prefix = folder === '.' || folder === '' ? '' : `${folder}/`;
      return { type: entry.type, prefix };
    });
  return (rel) => {
    let best = null;
    for (const category of categories) {
      if (rel.startsWith(category.prefix) && (best === null || category.prefix.length > best.prefix.length)) {
        best = category;
      }
    }
    return best === null ? null : best.type;
  };
}

function readText(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}
