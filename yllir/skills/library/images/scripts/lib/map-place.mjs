// Places the files of a finished map job next to its campaign document, writes
// the sidecar of the map, and prepares the draft of the document with a map block.
// The block sits between the markers `<!-- yllir:map -->` and `<!-- /yllir:map -->`,
// which the engine reads as text without new facts. The master-only block is
// never read for the block and never changed.

import fs from 'node:fs';
import path from 'node:path';
import { MASTER_MARKER } from '../../../../../scripts/lib/public-text.mjs';
import { fail, isDir, isFile, readCampaign, renderSidecar, safeRelative, slugify } from './image-job.mjs';

const JOB_ID = /^[a-z0-9][a-z0-9-]*$/;
const THIRD_PARTY = 'agent-sprite-forge@72fa5ad92d79b811acff464da32c8f3b1caa010f';
const DEFAULT_CELL = 64;
const OPEN_MARKER = '<!-- yllir:map -->';
const CLOSE_MARKER = '<!-- /yllir:map -->';
const REQUIRED_FILES = [
  'job.json',
  'fit/background.png',
  'grid/map-grid.png',
  'map.uvtt',
  'tiled/map.tmj',
  'preview/preview.html',
  'nav/nav-report.json',
];
const LABELS = {
  it: { heading: 'Mappa', withoutGrid: 'Senza griglia', preview: 'Anteprima navigabile', tabletop: 'Tavolo virtuale' },
  en: { heading: 'Map', withoutGrid: 'Without grid', preview: 'Interactive preview', tabletop: 'Virtual tabletop' },
};

function isMasterLine(line) {
  return line.trimEnd() === MASTER_MARKER;
}

function trimBlankEnd(lines) {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') end--;
  return lines.slice(0, end);
}

function trimBlankStart(lines) {
  let start = 0;
  while (start < lines.length && lines[start].trim() === '') start++;
  return lines.slice(start);
}

/**
 * Replaces the map block (from the opening marker line to the closing marker
 * line, both included) or inserts it before the master marker (else at the end).
 * Markers are searched only before the master marker, so a block inside the
 * master-only block is never touched. Exactly one blank line separates the block
 * from the text around it.
 * @param {string} text full document text
 * @param {string[]} blockLines the block, markers included
 * @returns {string|null} the new text ending with a newline, or null when the opening marker has no closing one
 */
export function placeSection(text, blockLines) {
  const lines = text.split('\n');
  const masterIdx = lines.findIndex(isMasterLine);
  const publicEnd = masterIdx >= 0 ? masterIdx : lines.length;
  const open = lines.slice(0, publicEnd).findIndex((line) => line.trimEnd() === OPEN_MARKER);
  let head;
  let tail;
  if (open >= 0) {
    const close = lines.slice(open + 1, publicEnd).findIndex((line) => line.trimEnd() === CLOSE_MARKER);
    if (close < 0) return null;
    head = lines.slice(0, open);
    tail = lines.slice(open + 1 + close + 1);
  } else {
    head = lines.slice(0, publicEnd);
    tail = lines.slice(publicEnd);
  }
  const before = trimBlankEnd(head);
  const after = trimBlankStart(tail);
  const out = [
    ...before,
    ...(before.length > 0 ? [''] : []),
    ...blockLines,
    ...(after.length > 0 ? ['', ...after] : []),
  ];
  const joined = out.join('\n');
  return joined.endsWith('\n') ? joined : `${joined}\n`;
}

function readJson(file) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return { ok: false };
  }
}

/** Checks that every required file of the map job exists; returns a failure or null. */
function missingFile(mapDir) {
  for (const rel of REQUIRED_FILES) {
    if (!isFile(path.join(mapDir, rel))) return fail('missing-file', `map job file missing: ${rel}`);
  }
  if (!isDir(path.join(mapDir, 'tiled', 'images'))) return fail('missing-file', 'map job file missing: tiled/images');
  return null;
}

/**
 * Places a finished map job: copies its files into `<document folder>/img/` with
 * one shared stem, writes the sidecar `<stem>.yaml`, and writes the draft of the
 * document with the map block. Every check, including the draft, runs before the first write.
 * @param {{ root: string, document: string, mapJob: string, imageJob: string,
 *   provider: string, alt: string, review?: string }} args
 * @returns {{ ok: true, files: string[], draft: string } | { ok: false, error: string, message: string }}
 */
export function placeMap({ root, document, mapJob, imageJob, provider, alt, review = '' } = {}) {
  const rootAbs = path.resolve(String(root ?? ''));
  const rel = safeRelative(document);
  if (rel === null) return fail('not-found', `document not found: ${document}`);
  const docAbs = path.join(rootAbs, rel);
  if (!isFile(docAbs)) return fail('not-found', `document not found: ${rel}`);
  const text = fs.readFileSync(docAbs, 'utf8');
  if (!text.split('\n').some((line) => line.startsWith('# '))) {
    return fail('no-title', `${rel} has no title line (# ...), so no draft can be made`);
  }

  if (typeof alt !== 'string' || alt.trim() === '' || /[\]\r\n]/.test(alt)) {
    return fail('bad-alt', 'alt must be non-empty and must not contain ] or a line break');
  }
  if (typeof provider !== 'string' || provider === '') return fail('bad-provider', 'provider is required');

  const campaign = readCampaign(rootAbs);
  if (!campaign.ok) return campaign;
  const language = campaign.config.language?.main === 'it' ? 'it' : 'en';

  if (typeof imageJob !== 'string' || !JOB_ID.test(imageJob)) return fail('not-found', `image job not found: ${imageJob}`);
  const imageJson = path.join(rootAbs, '.campaign', 'state', 'images', imageJob, 'job.json');
  const image = readJson(imageJson);
  if (!isFile(imageJson) || !image.ok) return fail('not-found', `image job not found or unreadable: ${imageJob}`);

  if (typeof mapJob !== 'string' || !JOB_ID.test(mapJob)) return fail('not-found', `map job not found: ${mapJob}`);
  const mapDir = path.join(rootAbs, '.campaign', 'state', 'maps', mapJob);
  if (!isDir(mapDir)) return fail('not-found', `map job not found: ${mapJob}`);
  const missing = missingFile(mapDir);
  if (missing !== null) return missing;

  const job = readJson(path.join(mapDir, 'job.json'));
  const nav = readJson(path.join(mapDir, 'nav', 'nav-report.json'));
  if (!job.ok || !nav.ok) return fail('bad-map-job', `map job ${mapJob} has an unreadable job.json or nav-report.json`);
  if (safeRelative(job.value?.document) !== rel) {
    return fail('wrong-document', `map job ${mapJob} was made for ${job.value?.document}, not ${rel}`);
  }
  const { cols, rows } = job.value;
  const cell = job.value.cell ?? DEFAULT_CELL;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || !Number.isInteger(cell)) {
    return fail('bad-map-job', `map job ${mapJob} has no valid cols, rows and cell`);
  }
  const navReport = nav.value;
  if (!navReport || typeof navReport.status !== 'string' || !Array.isArray(navReport.targets)) {
    return fail('bad-map-job', `map job ${mapJob}: nav-report.json needs a string status and an array of targets`);
  }
  if (navReport.status !== 'pass') {
    return fail('bad-map-job', `map job ${mapJob}: the navigation check did not pass (status ${navReport.status})`);
  }
  const targets = navReport.targets.length;
  const unreachable = navReport.targets.filter((target) => target?.reachable !== true).length;
  if (unreachable > 0) {
    return fail('bad-map-job', `map job ${mapJob}: ${unreachable} target(s) cannot be reached`);
  }

  // The stem is free only when none of its target names exists, so nothing is overwritten.
  const slug = slugify(path.posix.basename(rel, '.md')) || 'image';
  const targetDir = path.join(rootAbs, path.dirname(rel), 'img');
  const relDir = path.posix.join(path.posix.dirname(rel), 'img');
  const stemTaken = (stem) =>
    [`${stem}.png`, `${stem}-grid.png`, `${stem}.uvtt`, `${stem}-preview.html`, `${stem}-tiled`, `${stem}.yaml`].some((name) =>
      fs.existsSync(path.join(targetDir, name)),
    );
  let n = 1;
  let stem = `${slug}-map`;
  while (stemTaken(stem)) {
    n++;
    stem = `${slug}-map-${n}`;
  }

  // The draft is built before any write, so a document it cannot take refuses the whole placement.
  const labels = LABELS[language];
  const block = [
    OPEN_MARKER,
    `## ${labels.heading}`,
    '',
    `![${alt}](img/${stem}-grid.png)`,
    '',
    `[${labels.withoutGrid}](img/${stem}.png) · [${labels.preview}](img/${stem}-preview.html) · ` +
      `[${labels.tabletop}](img/${stem}.uvtt) · [Tiled](img/${stem}-tiled/map.tmj)`,
    CLOSE_MARKER,
  ];
  const draftText = placeSection(text, block);
  if (draftText === null) {
    return fail('bad-section', `${rel} has ${OPEN_MARKER} without ${CLOSE_MARKER} before the master block`);
  }

  // Copies: [source inside the map job, name inside img/].
  const copies = [
    ['fit/background.png', `${stem}.png`],
    ['grid/map-grid.png', `${stem}-grid.png`],
    ['map.uvtt', `${stem}.uvtt`],
    ['preview/preview.html', `${stem}-preview.html`],
    ['tiled/map.tmj', `${stem}-tiled/map.tmj`],
  ];
  const tiledImages = fs.readdirSync(path.join(mapDir, 'tiled', 'images'), { withFileTypes: true });
  for (const entry of tiledImages) {
    if (entry.isFile()) copies.push([`tiled/images/${entry.name}`, `${stem}-tiled/images/${entry.name}`]);
  }

  fs.mkdirSync(path.join(targetDir, `${stem}-tiled`, 'images'), { recursive: true });
  for (const [from, to] of copies) {
    fs.copyFileSync(path.join(mapDir, from), path.join(targetDir, to), fs.constants.COPYFILE_EXCL);
  }

  const sidecarName = `${stem}.yaml`;
  fs.writeFileSync(
    path.join(targetDir, sidecarName),
    renderSidecar({
      provider,
      operation: 'map',
      document: rel,
      effectivePrompt: typeof image.value?.prompt === 'string' ? image.value.prompt : null,
      parameters: {
        cols,
        rows,
        cell,
        third_party: THIRD_PARTY,
        checks: `nav targets ${targets}, unreachable ${unreachable}`,
      },
      review: String(review ?? ''),
    }),
    { flag: 'wx' },
  );

  const draftPath = path.join(rootAbs, '.campaign', 'drafts', rel);
  fs.mkdirSync(path.dirname(draftPath), { recursive: true });
  fs.writeFileSync(draftPath, draftText);

  const files = [...copies.map(([, to]) => `${relDir}/${to}`), `${relDir}/${sidecarName}`].sort();
  return { ok: true, files, draft: rel };
}
