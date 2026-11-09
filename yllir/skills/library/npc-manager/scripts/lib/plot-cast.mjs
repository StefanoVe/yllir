// Checks the characters that plot events declare (`characters: [id, ...]`)
// against the subject sheets, and lists capitalised names in event prose that
// match no subject form (candidates for characters without a sheet). Deterministic:
// the agent judges the candidates.

import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '../../../../../scripts/lib/frontmatter.mjs';
import { analyzeMarkdown } from '../../../../../scripts/lib/zones.mjs';
import { foldForm } from '../../../../../scripts/lib/fold.mjs';
import {
  readStructure,
  listSheets,
  buildSubjectIndex,
  compareStrings,
} from '../../../../../scripts/lib/subjects.mjs';

const CHARACTER_TEMPLATES = new Set(['npc', 'vendor', 'enemy', 'creature']);
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
const UPPER_START = /^\p{Lu}/u;
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * Checks the characters declared by the plot events of a campaign.
 * @param {string} campaignRoot absolute path to the campaign folder
 * @param {{ files?: string[]|null }} [options] files: campaign-relative event paths to check (null: all events)
 * @returns {{ events: number, declared: number, errors: object[], candidates: object[] }}
 */
export function plotCast(campaignRoot, { files = null } = {}) {
  const { structure, errors: configErrors } = readStructure(campaignRoot);
  if (structure === null) {
    return {
      events: 0,
      declared: 0,
      errors: configErrors.map((e) => ({ code: 'campaign-config', file: e.file, message: e.message })),
      candidates: [],
    };
  }

  const index = buildSubjectIndex(campaignRoot);
  const subjectById = new Map();
  for (const subject of index.subjects) {
    subjectById.set(subject.id, {
      template: readTemplate(campaignRoot, subject.sheet),
    });
  }
  const knownForms = index.subjects.flatMap((subject) => subject.forms.map((form) => form.folded));

  const wanted = files === null ? null : new Set(files);
  const events = [];
  const seenFiles = new Set();
  for (const category of structure) {
    if (category.type !== 'plot' || typeof category.folder !== 'string') continue;
    for (const file of listSheets(campaignRoot, category.folder)) {
      if (seenFiles.has(file)) continue;
      seenFiles.add(file);
      if (wanted !== null && !wanted.has(file)) continue;
      const text = readText(campaignRoot, file);
      if (text === null) continue;
      const parsed = parseFrontmatter(text);
      if (!parsed.data || typeof parsed.data.session !== 'string') continue;
      events.push({ file, data: parsed.data, body: parsed.body, bodyStartLine: parsed.bodyStartLine });
    }
  }

  let declared = 0;
  const errors = [];
  const candidates = [];
  const candidateKeys = new Set();

  for (const event of events) {
    if (Object.hasOwn(event.data, 'characters')) {
      const list = event.data.characters;
      if (!Array.isArray(list)) {
        errors.push({ code: 'invalid-characters', file: event.file, message: 'characters must be a list' });
      } else {
        const listed = new Set();
        for (const raw of list) {
          const id = String(raw);
          declared += 1;
          if (listed.has(id)) {
            errors.push({
              code: 'character-duplicate',
              file: event.file,
              message: `character ${id} is listed more than once`,
            });
            continue;
          }
          listed.add(id);
          const subject = subjectById.get(id);
          if (!subject) {
            errors.push({ code: 'character-no-sheet', file: event.file, message: `no sheet for character ${id}` });
          } else if (!CHARACTER_TEMPLATES.has(subject.template)) {
            errors.push({
              code: 'character-not-npc',
              file: event.file,
              message: `${id} is not a character sheet (template: ${subject.template ?? 'none'})`,
            });
          }
        }
      }
    }

    for (const { line, text } of findNames(event.body, event.bodyStartLine)) {
      if (isKnown(text, knownForms)) continue;
      const key = `${event.file}\u0000${line}\u0000${text}`;
      if (candidateKeys.has(key)) continue;
      candidateKeys.add(key);
      candidates.push({ file: event.file, line, text });
    }
  }

  errors.sort(
    (a, b) =>
      compareStrings(a.file, b.file) ||
      compareStrings(a.code, b.code) ||
      compareStrings(a.message, b.message),
  );
  candidates.sort(
    (a, b) => compareStrings(a.file, b.file) || a.line - b.line || compareStrings(a.text, b.text),
  );

  return { events: events.length, declared, errors, candidates };
}

/** Template of a sheet (string) or null when there is none or the sheet cannot be read. */
function readTemplate(campaignRoot, sheet) {
  const text = readText(campaignRoot, sheet);
  if (text === null) return null;
  const { data } = parseFrontmatter(text);
  return data && typeof data.template === 'string' ? data.template : null;
}

/** File content, or null when it cannot be read. */
function readText(campaignRoot, rel) {
  try {
    return fs.readFileSync(path.join(campaignRoot, rel), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Capitalised names in the paragraph and list lines of a body (not in headings,
 * code, comments, tables, quotes or master blocks). A name is a maximal run of
 * 1 to 3 capitalised words separated by single spaces; a single word at the
 * beginning of a sentence is not a name.
 * @returns {{ line: number, text: string }[]}
 */
function findNames(body, bodyStartLine) {
  const { lines } = analyzeMarkdown(body, bodyStartLine);
  const found = [];
  for (const entry of lines) {
    if (entry.inMaster) continue;
    if (entry.block !== 'paragraph' && entry.block !== 'list') continue;

    let content = entry.text;
    if (entry.block === 'list') {
      const marker = LIST_MARKER.exec(content);
      if (marker) content = content.slice(marker[0].length);
    }

    const words = [...content.matchAll(WORD)].map((m) => ({ text: m[0], start: m.index }));
    let i = 0;
    while (i < words.length) {
      if (!UPPER_START.test(words[i].text)) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < words.length && isJoined(content, words[j], words[j + 1])) j++;
      const count = j - i + 1;
      const first = words[i];
      const last = words[j];
      // A maximal run longer than 3 words is not a name.
      if (count <= 3 && !(count === 1 && isSentenceStart(content, first.start))) {
        found.push({
          line: entry.line,
          text: content.slice(first.start, last.start + last.text.length),
        });
      }
      i = j + 1;
    }
  }
  return found;
}

/** True when the next word is capitalised and separated from `word` by exactly one space. */
function isJoined(content, word, next) {
  if (!UPPER_START.test(next.text)) return false;
  return content.slice(word.start + word.text.length, next.start) === ' ';
}

/** True when the word at `start` begins a sentence (line start, or after . ! ? : with optional closing quote). */
function isSentenceStart(content, start) {
  let before = content.slice(0, start).replace(/[\s*_]+$/u, '');
  if (before === '') return true;
  before = before.replace(/[»"”]+$/u, '').replace(/[\s*_]+$/u, '');
  return /[.!?:]$/.test(before);
}

/** True when the name, folded, equals a known form or lies inside a longer one as whole words. */
function isKnown(name, knownForms) {
  const folded = foldForm(name);
  return knownForms.some(
    (form) => form === folded || (form.length > folded.length && containsWord(form, folded)),
  );
}

/** True when `needle` occurs in `haystack` not glued to a letter or digit on either side. */
function containsWord(haystack, needle) {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    const end = at + needle.length;
    const before = at > 0 ? haystack[at - 1] : '';
    const after = end < haystack.length ? haystack[end] : '';
    if (!isWordChar(before) && !isWordChar(after)) return true;
    from = at + 1;
  }
}

function isWordChar(ch) {
  return ch !== '' && LETTER_OR_DIGIT.test(ch);
}
