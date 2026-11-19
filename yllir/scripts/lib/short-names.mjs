// Finds abbreviated names in campaign text: a word that is only one word of a
// multi-word subject name (for example "Teodo" for the subject "Teodo Marr"),
// written where the full name should be. Deterministic: it reports candidates;
// judging them is left to the author and the agent. Nothing here blocks a batch.

import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from './frontmatter.mjs';
import { analyzeMarkdown } from './zones.mjs';
import { foldText } from './fold.mjs';
import { compareStrings } from './subjects.mjs';

// Blocks that carry no prose: fences, master markers, blank lines (as in mentions.mjs),
// plus code, diagrams and HTML comments.
const SKIPPED_BLOCKS = new Set([
  'blank',
  'fence-open',
  'fence-close',
  'master-open',
  'master-close',
  'code',
  'mermaid',
  'comment',
]);

const MIN_WORD_LETTERS = 3;
const WORD = /[\p{L}\p{N}]+/gu;
const WORD_CHAR = /[\p{L}\p{N}]/u;
// Text before a word that makes it the first word of a sentence: only opening
// quotes, dashes, underscores, emphasis or quote markers before it on the line,
// or a sentence end (. ! ? :) followed by spaces and those openers.
const LINE_START = /^[\s"'«“‘„\-_*>]*$/u;
const AFTER_SENTENCE_END = /[.!?:]\s+[\s"'«“‘„\-_*>]*$/u;

const tablesCache = new WeakMap();

/**
 * Finds the abbreviated names of one document.
 * @param {string} text full file content, with frontmatter
 * @param {{ subjects: object[] }} index result of buildSubjectIndex
 * @param {{ selfId?: string }} [options] id of the document's own subject: it is never a candidate
 * @returns {{ line: number, text: string, word: string, subjects: { id: string, title: string }[] }[]}
 *   line is 1-based in the file; text is the trimmed line; word is the word as written;
 *   subjects are the candidate subjects (without selfId), sorted by id.
 */
export function findShortNames(text, index, { selfId } = {}) {
  const tables = tablesFor(index);
  const { body, bodyStartLine } = parseFrontmatter(text);
  const { lines } = analyzeMarkdown(body, bodyStartLine);

  const found = [];
  for (const line of lines) {
    if (SKIPPED_BLOCKS.has(line.block) || line.block === 'heading') continue;
    found.push(...scanLine(line, tables, selfId));
  }
  return found;
}

/**
 * Finds the abbreviated names of several documents of a campaign.
 * @param {string} root absolute path to the campaign folder (used when readText is not given)
 * @param {{ subjects: object[] }} index result of buildSubjectIndex
 * @param {string[]} files campaign-relative posix paths
 * @param {{ readText?: (rel: string) => string }} [options] reads one file; defaults to fs under root
 * @returns {{ file: string, line: number, text: string, word: string, subjects: { id: string, title: string }[] }[]}
 *   sorted by file, then line. The selfId of each file is its frontmatter id.
 */
export function findShortNamesInFiles(root, index, files, { readText } = {}) {
  const found = [];
  for (const file of files) {
    const text = readText ? readText(file) : fs.readFileSync(path.join(root, file), 'utf8');
    const selfId = selfIdOf(text);
    for (const hit of findShortNames(text, index, { selfId })) {
      found.push({ file, ...hit });
    }
  }
  return found.sort((a, b) => compareStrings(a.file, b.file) || a.line - b.line);
}

function selfIdOf(text) {
  const id = parseFrontmatter(text).data?.id;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Lookup tables of one subject index, built once per index object:
 * - words: folded word (at least 3 letters) of a multi-word form -> Set of subject ids
 * - complete: folded complete forms of every subject, of any number of words
 * - titles: subject id -> title
 */
function tablesFor(index) {
  const cached = tablesCache.get(index);
  if (cached) return cached;

  const words = new Map();
  const complete = new Set();
  const titles = new Map();
  for (const subject of index.subjects) {
    const title = subject.forms.find((form) => form.kind === 'title')?.text ?? subject.id;
    titles.set(subject.id, title);
    for (const form of subject.forms) {
      complete.add(form.folded);
      const parts = wordsOf(form.folded);
      if (parts.length < 2) continue;
      for (const part of parts) {
        if ([...part].length < MIN_WORD_LETTERS) continue;
        if (!words.has(part)) words.set(part, new Set());
        words.get(part).add(subject.id);
      }
    }
  }
  const tables = { words, complete, completeForms: [...complete], titles };
  tablesCache.set(index, tables);
  return tables;
}

/** The words of a folded text: runs of letters and numbers. */
function wordsOf(folded) {
  return folded.match(WORD) ?? [];
}

/** Reports the candidate words of one line (already known to be prose). */
function scanLine(line, tables, selfId) {
  const { folded, map } = foldText(line.text);
  const covered = coveredRanges(folded, tables.completeForms);
  const found = [];

  for (const match of folded.matchAll(WORD)) {
    const word = match[0];
    const start = match.index;
    const end = start + word.length;
    if (covered.some((range) => start < range.end && range.start < end)) continue;

    const ids = tables.words.get(word);
    if (!ids) continue;
    if (tables.complete.has(word)) continue; // a real mention of another subject
    if (inCodeSpan(line, map[start])) continue;
    if (!startsWithUppercase(line.text, map[start])) continue;
    if (atSentenceStart(folded.slice(0, start))) continue;

    const subjects = [...ids]
      .filter((id) => id !== selfId)
      .sort(compareStrings)
      .map((id) => ({ id, title: tables.titles.get(id) }));
    if (subjects.length === 0) continue;

    const lastOrigin = map[end - 1];
    const endOrigin = lastOrigin + charLength(line.text, lastOrigin);
    found.push({
      line: line.line,
      text: line.text.trim(),
      word: line.text.slice(map[start], endOrigin),
      subjects,
    });
  }
  return found;
}

/** Folded [start, end) ranges of every whole-word occurrence of a complete form. */
function coveredRanges(folded, forms) {
  const ranges = [];
  for (const needle of forms) {
    let from = 0;
    for (;;) {
      const start = folded.indexOf(needle, from);
      if (start < 0) break;
      const end = start + needle.length;
      if (isWholeWord(folded, start, end)) ranges.push({ start, end });
      from = start + 1;
    }
  }
  return ranges;
}

/** True when folded[start, end) is not glued to a letter or number on either side. */
function isWholeWord(folded, start, end) {
  const before = start > 0 ? folded[start - 1] : '';
  const after = end < folded.length ? folded[end] : '';
  return !isWordChar(before) && !isWordChar(after);
}

function isWordChar(ch) {
  return ch !== '' && WORD_CHAR.test(ch);
}

/** True when the original character at `index` lies inside an inline code span of the line. */
function inCodeSpan(line, index) {
  return line.spans.some((span) => span.kind === 'code' && span.start <= index && index < span.end);
}

/** True when the original character at `index` is an uppercase letter. */
function startsWithUppercase(text, index) {
  return /^\p{Lu}/u.test(String.fromCodePoint(text.codePointAt(index)));
}

/** True when the folded text before a word leaves it at the start of a sentence. */
function atSentenceStart(prefix) {
  return LINE_START.test(prefix) || AFTER_SENTENCE_END.test(prefix);
}

function charLength(text, index) {
  return String.fromCodePoint(text.codePointAt(index)).length;
}
