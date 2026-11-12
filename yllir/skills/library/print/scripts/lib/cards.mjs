// The card model. A card is an object sheet of a category with `cards: true` (an
// announcement is an object with `template: notice`, so it needs no category of its own).
// Only the PUBLIC part of the sheet is used: `## In breve` (English `## In brief`), falling
// back to `## Descrizione` (`## Description`) for legacy sheets. Nothing else of the sheet
// reaches a card, a sheet or a job file.
//
// Images: `img/<base>.png` is the finished card face (the sheet's final image, with the
// source `img/<base>.psd` beside it). `img/<base>.jpg` is an illustration that the vector
// card places in its framed area. `<base>` is the file name lowercased, with separators
// turned into hyphens.

import fs from 'node:fs';
import path from 'node:path';
import { listCanonicalSheets, compareStrings } from '../../../../../scripts/lib/subjects.mjs';
import { parseFrontmatter } from '../../../../../scripts/lib/frontmatter.mjs';
import { publicBody, isPublicDocument } from '../../../../../scripts/lib/public-text.mjs';
import { readRetiredIds } from '../../../../../scripts/lib/engine/retired-ids.mjs';
import { entryUrl } from './settings.mjs';
import { PRINT_CACHE_DIR } from './paths.mjs';

export const PRINT_STATES = Object.freeze(['to-print', 'printed', 'reprint']);
export const SHORT_HEADINGS = Object.freeze(['in breve', 'in brief']);
export const LONG_HEADINGS = Object.freeze(['descrizione', 'description']);
export const FACE_EXTENSION = '.png';
export const ILLUSTRATION_EXTENSIONS = Object.freeze(['.jpg', '.jpeg']);
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const CHARACTER_FOLDERS = /^(giocatori|players|characters|personaggi giocanti)$/i;
const CHARACTER_IDS = Object.freeze(['characters', 'players']);

/** Exclusion reasons, in the order they are checked. */
export const REASONS = Object.freeze({
  noId: 'no-id',
  invalidId: 'invalid-id',
  duplicateId: 'duplicate-id',
  retiredId: 'retired-id',
  masterOnly: 'master-only-category',
  noText: 'no-public-text',
  notFound: 'not-found',
});

/** Categories whose sheets are cards: type objects and `cards: true`. */
export function cardCategories(structure) {
  return structure
    .filter((entry) => entry.cards === true && entry.type === 'objects' && typeof entry.folder === 'string')
    .map((entry) => ({
      id: String(entry.id ?? entry.folder),
      folder: entry.folder.trim().replace(/\\/g, '/').replace(/\/+$/, ''),
    }))
    .filter((category) => category.folder !== '');
}

/** The category of the player characters, when the campaign has one. */
export function characterCategory(structure) {
  const found = structure.find((entry) => {
    if (typeof entry.folder !== 'string') return false;
    if (CHARACTER_IDS.includes(entry.id)) return true;
    return CHARACTER_FOLDERS.test(path.posix.basename(entry.folder.trim().replace(/\/+$/, '')));
  });
  return found ? found.folder.trim().replace(/\/+$/, '') : null;
}

/** Plain words of a Markdown fragment: no links, emphasis, headings or comments. */
export function plainText(markdown) {
  const text = String(markdown)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*/g, '')
    .replace(/`/g, '');
  return text
    .split(/\n\s*\n/)
    .map((block) => block
      .split('\n')
      .map((line) => line
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^\s*>\s?/, '')
        .replace(/^\s*[-+]\s+/, '')
        .replace(/^\s*\d+\.\s+/, '')
        .trim())
      .filter((line) => line !== '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter((paragraph) => paragraph !== '')
    .join('\n\n');
}

/** Body of the level-2 section with one of the given headings, or null when absent. */
export function sectionBody(markdown, headings) {
  const wanted = new Set(headings);
  const lines = String(markdown).split('\n');
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const match = /^##(?!#)\s+(.+?)\s*$/.exec(lines[i]);
    if (!match) continue;
    if (start < 0) {
      if (wanted.has(match[1].trim().toLowerCase())) start = i + 1;
    } else {
      end = i;
      break;
    }
  }
  return start < 0 ? null : lines.slice(start, end).join('\n');
}

/** The public text of a card: `In breve`, else `Descrizione`. */
export function cardText(publicMarkdown) {
  const short = plainText(sectionBody(publicMarkdown, SHORT_HEADINGS) ?? '');
  if (short !== '') return { text: short, source: 'in-breve' };
  const long = plainText(sectionBody(publicMarkdown, LONG_HEADINGS) ?? '');
  if (long !== '') return { text: long, source: 'descrizione' };
  return { text: '', source: null };
}

/** The title: the level-1 heading of the public part. */
export function titleOf(publicMarkdown) {
  for (const line of String(publicMarkdown).split('\n')) {
    const match = /^#(?!#)\s+(.+?)\s*$/.exec(line);
    if (match) return match[1].trim();
  }
  return null;
}

/** Image base name: the file name lowercased, accents removed, separators as hyphens. */
export function imageBase(fileName) {
  const stem = fileName.replace(/\.md$/i, '');
  const base = stem
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base === '' ? 'card' : base;
}

/** The print state of a sheet, or null when absent or not one of the three states. */
export function printStateOf(meta) {
  return PRINT_STATES.includes(meta.print) ? meta.print : null;
}

/** Whether the sheet has a card image of either kind. */
function imageFiles(root, rel, base) {
  const dir = path.join(root, path.posix.dirname(rel), 'img');
  const existing = (name) => {
    const full = path.join(dir, name);
    return fs.existsSync(full) ? path.posix.join(path.posix.dirname(rel), 'img', name) : null;
  };
  return {
    face: existing(`${base}${FACE_EXTENSION}`),
    illustration: ILLUSTRATION_EXTENSIONS.map((ext) => existing(`${base}${ext}`)).find(Boolean) ?? null,
  };
}

/**
 * Reads one card sheet without deciding whether it is printable.
 * @returns {object} the raw record
 */
export function readCardSheet(root, rel, category) {
  const markdown = fs.readFileSync(path.join(root, rel), 'utf8');
  const { data } = parseFrontmatter(markdown);
  const meta = data ?? {};
  const pub = publicBody(markdown);
  const base = imageBase(path.posix.basename(rel));
  const { text, source } = cardText(pub);
  const images = imageFiles(root, rel, base);
  return {
    id: typeof meta.id === 'string' ? meta.id.trim() : '',
    title: titleOf(pub) ?? path.posix.basename(rel, '.md'),
    path: rel,
    category: category.folder,
    base,
    text,
    textSource: source,
    print: printStateOf(meta),
    personal: meta.personal === 'true',
    face: images.face,
    illustration: images.illustration,
    reason: null,
  };
}

/**
 * Lists every card of a campaign, with the reason each one is excluded (null when printable).
 * @param {string} root campaign folder
 * @param {object} settings from readPrintSettings
 * @returns {{ records: object[], errors: Array<{code: string, message: string}> }}
 */
export function collectCards(root, settings) {
  const errors = [];
  const retired = readRetiredIds(root);
  if (!retired.ok) errors.push({ code: 'retired-ids-invalid', message: retired.message });
  const retiredSet = new Set(retired.ok ? retired.ids : []);
  const isMasterOnly = (rel) => !isPublicDocument(rel, { structure: settings.structure });

  const records = [];
  for (const category of cardCategories(settings.structure)) {
    for (const rel of listCanonicalSheets(root, category.folder)) {
      records.push(readCardSheet(root, rel, category));
    }
  }

  const counts = new Map();
  for (const record of records) counts.set(record.id, (counts.get(record.id) ?? 0) + 1);
  for (const record of records) {
    if (record.id === '') record.reason = REASONS.noId;
    else if (!ID_PATTERN.test(record.id)) record.reason = REASONS.invalidId;
    else if (counts.get(record.id) > 1) record.reason = REASONS.duplicateId;
    else if (retiredSet.has(record.id)) record.reason = REASONS.retiredId;
    else if (isMasterOnly(record.path)) record.reason = REASONS.masterOnly;
    else if (record.text === '') record.reason = REASONS.noText;
  }
  records.sort((a, b) => compareStrings(a.id, b.id) || compareStrings(a.path, b.path));
  return { records, errors };
}

/** The entry shown by `list` (PrintCard). */
export function toPrintCard(record) {
  return {
    id: record.id,
    title: record.title,
    path: record.path,
    category: record.category,
    print: record.print,
    hasImage: record.face !== null || record.illustration !== null,
    personal: record.personal,
  };
}

/**
 * Chooses the cards of a sheets run.
 * With ids: exactly those cards. Without: the cards whose print state is to-print or reprint.
 * @param {object} input
 * @param {object[]} input.records from collectCards
 * @param {string[]|null} input.ids
 * @param {Record<string, number>} input.copies explicit copies per id
 * @param {number} input.personalCopies copies for a personal card without an explicit count
 * @returns {{ selected: Array<{ record: object, copies: number }>, excluded: Array<{ id: string, reason: string }> }}
 */
export function selectCards({ records, ids, copies, personalCopies }) {
  const selected = [];
  const excluded = [];
  const copiesOf = (record) => copies[record.id] ?? (record.personal ? personalCopies : 1);

  if (ids !== null) {
    for (const id of [...new Set(ids)]) {
      const matches = records.filter((record) => record.id === id);
      if (matches.length === 0) excluded.push({ id, reason: REASONS.notFound });
      else if (matches.length > 1) excluded.push({ id, reason: REASONS.duplicateId });
      else if (matches[0].reason !== null) excluded.push({ id, reason: matches[0].reason });
      else selected.push({ record: matches[0], copies: copiesOf(matches[0]) });
    }
  } else {
    for (const record of records) {
      if (record.print !== 'to-print' && record.print !== 'reprint') continue;
      if (record.reason !== null) excluded.push({ id: record.id || record.path, reason: record.reason });
      else selected.push({ record, copies: copiesOf(record) });
    }
  }
  return { selected, excluded };
}

/**
 * Reads the image files of a card that the sheets step needs.
 * @returns {{ face: Uint8Array|null, illustration: Uint8Array|null, faceOlderThanSheet: boolean }}
 */
export function loadCardImages(root, record) {
  const read = (rel) => (rel === null ? null : new Uint8Array(fs.readFileSync(path.join(root, rel))));
  let faceOlderThanSheet = false;
  if (record.face !== null) {
    const faceTime = fs.statSync(path.join(root, record.face)).mtimeMs;
    const sheetTime = fs.statSync(path.join(root, record.path)).mtimeMs;
    faceOlderThanSheet = sheetTime > faceTime;
  }
  return { face: read(record.face), illustration: read(record.illustration), faceOlderThanSheet };
}

/**
 * Builds the job file for an external image renderer (the Photoshop route). It contains
 * only the public card data and the output paths; nothing is rendered here.
 * @returns {object} the job, also written to .campaign/cache/print/job-<id>.json
 */
export function buildJob(record, settings) {
  const dir = path.posix.dirname(record.path);
  return {
    id: record.id,
    title: record.title,
    text: record.text,
    illustration: record.illustration,
    size: { format: '5x7', unit: 'in', width: 5, height: 7, dpi: 300, pixels: [1500, 2100] },
    cmyk: settings.cmyk,
    output: {
      png: path.posix.join(dir, 'img', `${record.base}.png`),
      psd: path.posix.join(dir, 'img', `${record.base}.psd`),
    },
    entryUrl: entryUrl(settings.baseUrl, record.id),
  };
}

/** Writes the job file and returns its campaign-relative path. */
export function writeJob(root, job) {
  const rel = `${PRINT_CACHE_DIR}/job-${job.id}.json`;
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `${JSON.stringify(job, null, 2)}\n`);
  return rel;
}

