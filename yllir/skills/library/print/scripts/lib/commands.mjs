// The four commands of the print CLI as plain functions. Each returns { code, value }: the
// code is 0 when the work was done, 1 for a domain refusal, and the value is printed as JSON.
// Usage errors (2) are decided by the CLI before these functions are called.

import fs from 'node:fs';
import path from 'node:path';
import { listSheets } from '../../../../../scripts/lib/subjects.mjs';
import { collectCards, toPrintCard, selectCards, loadCardImages, buildJob, writeJob, characterCategory, REASONS } from './cards.mjs';
import { readCampaignConfig, readPrintSettings, entryUrl } from './settings.mjs';
import { buildSheetsPdf, DEFAULT_CREATION_DATE } from './sheets.mjs';
import { renderCardPng } from './node-card.mjs';
import { setPrintState } from './print-state.mjs';
import { PRINT_CACHE_DIR } from './paths.mjs';

export const KEEP_SHEETS = 5;
const SHEETS_PATTERN = /^sheets-[0-9TZ]+\.pdf$/;

/** Reads the campaign and its print settings, or returns the reason it cannot. */
export function loadSettings(root) {
  const config = readCampaignConfig(root);
  if (!config.ok) return { ok: false, message: config.message };
  return { ok: true, settings: readPrintSettings(config.config) };
}

/** `list`: every card with its print state, plus the resolved settings. */
export function listCommand(root) {
  const loaded = loadSettings(root);
  if (!loaded.ok) return { code: 1, value: { ok: false, errors: [{ code: 'config', message: loaded.message }] } };
  const { settings } = loaded;
  const { records, errors } = collectCards(root, settings);
  if (errors.length > 0) return { code: 1, value: { ok: false, errors } };
  return {
    code: 0,
    value: {
      cards: records.map(toPrintCard),
      renderer: settings.renderer,
      format: settings.format,
      cmyk: settings.cmyk,
      baseUrl: settings.baseUrl,
      warnings: settings.warnings,
    },
  };
}

/** `state`: changes the print state through the write cycle. */
export async function stateCommand(root, id, state) {
  const result = await setPrintState(root, id, state);
  return { code: result.ok ? 0 : 1, value: result };
}

/**
 * `render-card`. `photoshop` only writes the job file (the assistant drives Photoshop).
 * `node` and `auto` draw the face PNG; an existing face is kept unless `overwrite` is set.
 */
export function renderCardCommand(root, { id, renderer = 'auto', overwrite = false }) {
  const loaded = loadSettings(root);
  if (!loaded.ok) return { code: 1, value: { ok: false, errors: [{ code: 'config', message: loaded.message }] } };
  const { settings } = loaded;
  const { records, errors } = collectCards(root, settings);
  if (errors.length > 0) return { code: 1, value: { ok: false, errors } };
  const matches = records.filter((record) => record.id === id);
  if (matches.length === 0) return { code: 1, value: { ok: false, error: REASONS.notFound, message: `no card with id ${id}` } };
  if (matches.length > 1) return { code: 1, value: { ok: false, error: REASONS.duplicateId, message: `more than one card has id ${id}` } };
  const [record] = matches;
  if (record.reason !== null) return { code: 1, value: { ok: false, id, error: record.reason } };

  if (renderer === 'photoshop') {
    const job = buildJob(record, settings);
    const jobFile = writeJob(root, job);
    return { code: 0, value: { ok: true, id, renderer: 'photoshop', job: jobFile, data: job } };
  }

  const faceRel = path.posix.join(path.posix.dirname(record.path), 'img', `${record.base}.png`);
  const faceFull = path.join(root, faceRel);
  if (fs.existsSync(faceFull) && !overwrite) {
    return {
      code: 1,
      value: { ok: false, id, error: 'exists', file: faceRel, message: 'the card image already exists; the master must say whether to replace it' },
    };
  }
  const { png, truncated } = renderCardPng({ id: record.id, title: record.title, text: record.text });
  fs.mkdirSync(path.dirname(faceFull), { recursive: true });
  const temp = `${faceFull}.${process.pid}.tmp`;
  fs.writeFileSync(temp, png);
  fs.renameSync(temp, faceFull);
  const warnings = [];
  if (truncated) warnings.push({ code: 'text-truncated', message: 'the text was cut to fit the card face' });
  if (record.illustration) warnings.push({ code: 'illustration-not-used', message: 'the Node renderer draws no illustration' });
  return { code: 0, value: { ok: true, id, renderer: 'node', file: faceRel, warnings } };
}

/** The clock of a run: YLLIR_NOW when set (for reproducible runs), else the current time. */
export function clockFromEnv(env = process.env) {
  if (env.YLLIR_NOW === undefined || env.YLLIR_NOW === '') {
    return { now: new Date(), creationDate: DEFAULT_CREATION_DATE };
  }
  const fixed = new Date(env.YLLIR_NOW);
  if (Number.isNaN(fixed.getTime())) throw new Error('YLLIR_NOW is not a date');
  return { now: fixed, creationDate: fixed };
}

/** File-name stamp of a run: YYYYMMDDTHHMMSSZ in UTC. */
export function stampOf(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
}

/** Keeps the newest `keep` sheet files of the print cache and removes the rest. */
export function pruneSheets(dir, keep = KEEP_SHEETS) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((name) => SHEETS_PATTERN.test(name)).sort().reverse();
  const removed = files.slice(keep);
  for (const name of removed) fs.unlinkSync(path.join(dir, name));
  return removed;
}

/** Copies per personal card: the number of sheets in the characters category (at least 1). */
export function personalCopiesOf(root, structure) {
  const folder = characterCategory(structure);
  if (folder === null) return 1;
  return Math.max(1, listSheets(root, folder).length);
}

/**
 * `sheets`: the printable PDF of the selected cards.
 * @param {string} root
 * @param {object} options
 * @param {string[]|null} options.ids
 * @param {'5x7'|'a4'|undefined} options.format overrides the campaign setting
 * @param {Record<string, number>} options.copies explicit copies per id
 * @param {boolean|undefined} options.cmyk overrides the campaign setting
 * @param {{ now: Date, creationDate: Date }} options.clock
 */
export async function sheetsCommand(root, { ids = null, format, copies = {}, cmyk, clock }) {
  const loaded = loadSettings(root);
  if (!loaded.ok) {
    return { code: 1, value: { ok: false, file: null, fileUrl: null, pages: 0, excluded: [], warnings: [], errors: [{ code: 'config', message: loaded.message }] } };
  }
  const { settings } = loaded;
  const effective = {
    format: format ?? settings.format,
    cmyk: cmyk ?? settings.cmyk,
  };
  const { records, errors } = collectCards(root, settings);
  if (errors.length > 0) {
    return { code: 1, value: { ok: false, file: null, fileUrl: null, pages: 0, excluded: [], warnings: settings.warnings, errors } };
  }

  const personalCopies = personalCopiesOf(root, settings.structure);
  const { selected, excluded } = selectCards({ records, ids, copies, personalCopies });
  const warnings = [...settings.warnings];
  const items = [];
  for (const { record, copies: count } of selected) {
    const images = loadCardImages(root, record);
    if (images.faceOlderThanSheet) {
      warnings.push({ code: 'card-image-older-than-sheet', message: `the image of ${record.id} is older than its sheet; render the card again` });
    }
    items.push({
      id: record.id,
      title: record.title,
      text: record.text,
      qrUrl: entryUrl(settings.baseUrl, record.id),
      face: images.face,
      illustration: images.illustration,
      copies: count,
    });
  }
  items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  if (items.length === 0) {
    return { code: 1, value: { ok: false, file: null, fileUrl: null, pages: 0, excluded, warnings } };
  }

  const built = await buildSheetsPdf({
    items,
    format: effective.format,
    cmyk: effective.cmyk,
    encyclopediaTitle: settings.encyclopediaTitle,
    language: settings.language,
    creationDate: clock.creationDate,
  });
  const name = `sheets-${stampOf(clock.now)}.pdf`;
  const dir = path.join(root, PRINT_CACHE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, name);
  const temp = `${full}.${process.pid}.tmp`;
  fs.writeFileSync(temp, built.bytes);
  fs.renameSync(temp, full);
  pruneSheets(dir);
  warnings.push(...built.warnings);

  return {
    code: 0,
    value: {
      ok: true,
      file: `${PRINT_CACHE_DIR}/${name}`,
      fileUrl: null,
      pages: built.pages,
      excluded,
      warnings,
      format: effective.format,
      cmyk: effective.cmyk,
      index: built.index,
    },
  };
}
