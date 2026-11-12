// Builds image jobs from the public part of a campaign document, and places a
// finished image next to its document with a sidecar and a draft that links it.
// Privacy: nothing from the master-only block, the world seed or a master-only
// folder may reach job.json, because job.json is what an image service reads.

import fs from 'node:fs';
import path from 'node:path';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';
import { isPublicDocument, publicText } from '../../../../../scripts/lib/public-text.mjs';

export const PLACEHOLDER = '{SUBJECT_DESCRIPTION}';
export const MAX_REQUEST = 300;
const OPERATIONS = new Set(['generate', 'remove_background']);
const STYLE_ID = /^[a-z0-9][a-z0-9_-]*$/;
const JOB_ID = /^[a-z0-9][a-z0-9-]*$/;
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp'];
const IMAGE_LINE = /^!\[[^\]]*\]\([^)]*\)\s*$/;
const SAFE_KEY = /^[a-z][a-z0-9_]*$/;
const SECRET_KEY = /key|token|secret|password|auth|env/i;

/**
 * Lowercase ASCII slug: diacritics removed, every run of other characters
 * becomes a single `-`, no leading or trailing `-`.
 * @param {string} text
 * @returns {string}
 */
export function slugify(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Style id that every map job uses, whatever the folder of the document. */
export const MAP_STYLE = 'map';

/** Fixed English request of every map job; C and R are the grid size. */
export function mapRequirement(cols, rows) {
  return (
    'Top-down orthographic battle map seen from directly above, no perspective, even lighting, no text, no labels, ' +
    'no grid lines, no compass, no frame, no characters or creatures. ' +
    `The area is ${cols} squares wide and ${rows} squares tall; ` +
    'walls, doors and exits follow the attached plan when one is attached.'
  );
}

/**
 * Joins the style text and the extra sentences with `. `. The style text ends
 * with a newline in prompt.md, so it is trimmed and its final `.` is removed
 * before the sentences are appended, so the prompt never has `\n.` or `..`.
 * With no sentences, the style text is returned trimmed and unchanged.
 * The sentences are appended as given: the caller removes a trailing `.` from
 * free text (the request).
 */
export function joinPrompt(base, pieces) {
  const parts = pieces.map((piece) => String(piece).trim()).filter((piece) => piece !== '');
  const head = String(base).trimEnd();
  if (parts.length === 0) return head;
  return [head.replace(/\.$/, ''), ...parts].join('. ');
}

function validCells(cells) {
  if (!isPlainObject(cells)) return false;
  const ok = (n) => Number.isInteger(n) && n >= 8 && n <= 60;
  return ok(cells.cols) && ok(cells.rows);
}

/** Map image size: the long side is 1536, the other side follows the grid, multiple of 16, at least 512. */
export function mapSize(cols, rows) {
  const round16 = (n) => Math.round(n / 16) * 16;
  if (cols >= rows) {
    return { width: 1536, height: Math.max(512, round16((1536 * rows) / cols)) };
  }
  return { width: Math.max(512, round16((1536 * cols) / rows)), height: 1536 };
}

function truncateAtWord(text, maxChars) {
  if (text.length <= maxChars) return text;
  let cut = text.slice(0, maxChars);
  const space = cut.lastIndexOf(' ');
  if (space > 0) cut = cut.slice(0, space);
  return cut.trimEnd();
}

/**
 * Plain-text description of a public document body, for the image prompt.
 * Images, links, comments and tables are reduced or removed; headings become
 * plain text; whitespace is collapsed; the result is cut on a word boundary.
 * @param {string} publicMarkdown public body (metadata and master block already removed)
 * @param {number} [maxChars=1500]
 * @returns {string}
 */
export function subjectDescription(publicMarkdown, maxChars = 1500) {
  const text = String(publicMarkdown ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  const lines = text
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('|'))
    .map((line) => line.replace(/^\s*#{1,6}\s+/, ''));
  return truncateAtWord(lines.join(' ').replace(/\s+/g, ' ').trim(), maxChars);
}

export function fail(error, message) {
  return { ok: false, error, message };
}

export function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Normalized campaign-relative path with `/` separators, or null when unsafe. */
export function safeRelative(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    return null;
  }
  return normalized;
}

export function readCampaign(rootAbs) {
  const file = path.join(rootAbs, 'campaign.yaml');
  if (!isFile(file)) return fail('no-campaign', 'campaign.yaml not found in the campaign root');
  const { data, errors } = parseYamlLite(fs.readFileSync(file, 'utf8'));
  if (errors.length > 0 || !isPlainObject(data)) {
    const detail = errors[0] ? ` (line ${errors[0].line}: ${errors[0].message})` : '';
    return fail('bad-campaign', `campaign.yaml is not valid${detail}`);
  }
  return { ok: true, config: data };
}

/** Style id of a document: the `style` of the structure entry whose folder contains it, else `base`. */
function styleFor(rel, config) {
  const structure = Array.isArray(config.structure) ? config.structure : [];
  let best = null;
  for (const entry of structure) {
    if (!isPlainObject(entry) || typeof entry.folder !== 'string') continue;
    const folder = entry.folder.replace(/\\/g, '/').replace(/\/+$/, '');
    if (folder === '' || !rel.startsWith(`${folder}/`)) continue;
    if (best === null || folder.length > best.folder.length) best = { folder, entry };
  }
  if (best !== null && typeof best.entry.style === 'string' && best.entry.style !== '') {
    return best.entry.style;
  }
  return 'base';
}

/**
 * Loads the style of a job: the forced style id when given (map jobs always use `map`),
 * else the style of the document's folder.
 */
function loadStyle(rootAbs, rel, config, forcedStyle = null) {
  const styleId = forcedStyle ?? styleFor(rel, config);
  if (!STYLE_ID.test(styleId)) return fail('bad-style', `style id is not valid: ${styleId}`);
  const dir = path.join(rootAbs, '.campaign', 'styles', styleId);
  const profilePath = path.join(dir, 'profile.yaml');
  const promptPath = path.join(dir, 'prompt.md');
  if (!isDir(dir) || !isFile(profilePath) || !isFile(promptPath)) {
    return fail('no-style', `style ${styleId} is missing profile.yaml or prompt.md under .campaign/styles/`);
  }

  const { data, errors } = parseYamlLite(fs.readFileSync(profilePath, 'utf8'));
  if (errors.length > 0 || !isPlainObject(data)) {
    return fail('bad-style', `style ${styleId}: profile.yaml is not valid`);
  }
  if (data.id !== styleId) return fail('bad-style', `style ${styleId}: profile id must be ${styleId}`);
  if (typeof data.negative !== 'string') return fail('bad-style', `style ${styleId}: negative must be a string`);
  if (!Number.isInteger(data.width) || data.width <= 0) return fail('bad-style', `style ${styleId}: width must be a positive integer`);
  if (!Number.isInteger(data.height) || data.height <= 0) return fail('bad-style', `style ${styleId}: height must be a positive integer`);

  const template = fs.readFileSync(promptPath, 'utf8');
  if (!template.includes(PLACEHOLDER)) {
    return fail('bad-style', `style ${styleId}: prompt.md has no ${PLACEHOLDER} placeholder`);
  }
  return {
    ok: true,
    style: styleId,
    template,
    negative: data.negative,
    width: data.width,
    height: data.height,
  };
}

/**
 * Creates the folder and job.json of one image job. The job reads only the
 * public part of the document; a document that is not public is refused before
 * anything else of it is read.
 * A map job (`purpose: 'map'`) is always a generate job with the style `map`, a
 * fixed top-down map request, a size from the grid (`cells`), and an optional
 * plan (`reference`) that must be a file under `.campaign/state/maps/`.
 * @param {{ root: string, document: string, operation: 'generate'|'remove_background',
 *   request?: string, image?: string|null, seed?: number, purpose?: 'image'|'map',
 *   cells?: {cols: number, rows: number}|null, reference?: string|null }} args
 * @returns {{ ok: true, jobId: string, jobDir: string, job: object } | { ok: false, error: string, message: string }}
 */
export function buildJob({
  root,
  document,
  operation,
  request = '',
  image = null,
  seed,
  purpose = 'image',
  cells = null,
  reference = null,
} = {}) {
  if (!OPERATIONS.has(operation)) return fail('bad-operation', 'operation must be generate or remove_background');
  if (purpose !== 'image' && purpose !== 'map') return fail('bad-purpose', 'purpose must be image or map');
  const isMap = purpose === 'map';
  if (isMap && operation !== 'generate') return fail('bad-operation', 'a map job only supports generate');
  if (isMap && !validCells(cells)) return fail('bad-cells', 'cells must be integers from 8 to 60 for cols and rows');
  const rootAbs = path.resolve(String(root ?? ''));
  const rel = safeRelative(document);
  if (rel === null) return fail('not-found', `document not found: ${document}`);

  const campaign = readCampaign(rootAbs);
  if (!campaign.ok) return campaign;
  const { config } = campaign;

  if (!isPublicDocument(rel, config)) {
    return fail('not-public', `${rel} is not public: its text cannot be sent to an image service`);
  }
  const docAbs = path.join(rootAbs, rel);
  if (!isFile(docAbs)) return fail('not-found', `document not found: ${rel}`);
  const pub = publicText(fs.readFileSync(docAbs, 'utf8'), rel, config);
  if (pub === null) return fail('not-public', `${rel} is not public: its text cannot be sent to an image service`);

  let referencePath = null;
  if (isMap && reference !== null) {
    const mapsRoot = path.join(rootAbs, '.campaign', 'state', 'maps');
    const refAbs = typeof reference === 'string' && path.isAbsolute(reference) ? path.resolve(reference) : null;
    if (refAbs === null || !refAbs.startsWith(`${mapsRoot}${path.sep}`) || !isFile(refAbs)) {
      return fail('bad-reference', 'reference must be an existing file under .campaign/state/maps/');
    }
    referencePath = refAbs;
  }

  if (String(request ?? '').length > MAX_REQUEST) {
    return fail('request-too-long', `request must be at most ${MAX_REQUEST} characters`);
  }
  const note = String(request ?? '').trim();

  let style = null;
  let prompt = '';
  let negative = '';
  let width = 0;
  let height = 0;
  let input = null;
  if (operation === 'generate') {
    const loaded = loadStyle(rootAbs, rel, config, isMap ? MAP_STYLE : null);
    if (!loaded.ok) return loaded;
    style = loaded.style;
    const pieces = [];
    if (note !== '') pieces.push(note.replace(/\.$/, ''));
    if (isMap) pieces.push(mapRequirement(cells.cols, cells.rows));
    prompt = joinPrompt(loaded.template.split(PLACEHOLDER).join(subjectDescription(pub)), pieces);
    negative = loaded.negative;
    width = loaded.width;
    height = loaded.height;
    if (isMap) ({ width, height } = mapSize(cells.cols, cells.rows));
  } else {
    const imageRel = safeRelative(image);
    if (imageRel === null || !isFile(path.join(rootAbs, imageRel))) {
      return fail('no-image', 'remove_background needs an existing image of the campaign (--image)');
    }
    input = path.join(rootAbs, imageRel);
  }

  const kind = isMap ? 'map' : operation === 'generate' ? 'generate' : 'remove-background';
  const base = `${slugify(path.posix.basename(rel, '.md')) || 'image'}-${kind}`;
  const jobsRoot = path.join(rootAbs, '.campaign', 'state', 'images');
  let n = 1;
  while (fs.existsSync(path.join(jobsRoot, `${base}-${n}`))) n++;
  const jobId = `${base}-${n}`;
  const jobDir = path.join(jobsRoot, jobId);

  const job = {
    id: jobId,
    operation,
    document: rel,
    style,
    prompt,
    negative,
    width,
    height,
    seed: Number.isInteger(seed) ? seed : [...jobId].reduce((sum, ch) => sum + ch.charCodeAt(0), 0),
    input,
    purpose,
    reference: referencePath,
  };
  if (isMap) job.cells = { cols: cells.cols, rows: cells.rows };
  fs.mkdirSync(jobDir, { recursive: true });
  fs.writeFileSync(path.join(jobDir, 'job.json'), `${JSON.stringify(job, null, 2)}\n`, { flag: 'wx' });
  return { ok: true, jobId, jobDir, job };
}

function readParameters(jobDir) {
  const runPath = path.join(jobDir, 'run.json');
  if (!isFile(runPath)) return {};
  let run;
  try {
    run = JSON.parse(fs.readFileSync(runPath, 'utf8'));
  } catch {
    return {};
  }
  const params = run?.parameters;
  if (!isPlainObject(params)) return {};
  return Object.fromEntries(Object.entries(params).filter(([key]) => !SECRET_KEY.test(key)));
}

/**
 * The parameters as a YAML block mapping (yaml-lite reads only the empty flow map `{}`).
 * Keys that are not lowercase identifiers are skipped; strings are quoted, numbers and booleans are written as they are.
 */
function renderParameters(obj) {
  const lines = [];
  for (const [key, value] of Object.entries(obj)) {
    if (!SAFE_KEY.test(key)) continue;
    if (typeof value === 'string') lines.push(`  ${key}: ${JSON.stringify(value)}`);
    else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) lines.push(`  ${key}: ${value}`);
  }
  return lines.length === 0 ? ['parameters: {}'] : ['parameters:', ...lines];
}

export function renderSidecar({ provider, operation, document, effectivePrompt, parameters, review }) {
  return [
    `provider: ${JSON.stringify(provider)}`,
    `operation: ${JSON.stringify(operation)}`,
    `document: ${JSON.stringify(document)}`,
    `effective_prompt: ${effectivePrompt === null ? 'null' : JSON.stringify(effectivePrompt)}`,
    'references: []',
    ...renderParameters(parameters),
    `review: ${JSON.stringify(review)}`,
  ].join('\n') + '\n';
}

/** Puts the embed right after the first `# ` line, one blank line before and after. */
function insertEmbed(text, embedLine) {
  const lines = text.split('\n');
  const titleIdx = lines.findIndex((line) => line.startsWith('# '));
  let k = titleIdx + 1;
  while (k < lines.length && lines[k].trim() === '') k++;
  let rest = k < lines.length && IMAGE_LINE.test(lines[k]) ? lines.slice(k + 1) : lines.slice(titleIdx + 1);
  while (rest.length > 0 && rest[0].trim() === '') rest = rest.slice(1);
  const head = lines.slice(0, titleIdx + 1).join('\n');
  if (rest.length === 0) return `${head}\n\n${embedLine}\n`;
  return `${head}\n\n${embedLine}\n\n${rest.join('\n')}`;
}

/**
 * Places a finished image in `<document folder>/img/`, writes its sidecar
 * `<name>.yaml` and, for generate and upload, the draft of the document with
 * the image embedded under its title.
 * @param {{ root: string, document: string, alt: string, jobId?: string|null,
 *   file?: string|null, provider: string, review?: string }} args
 * @returns {{ ok: true, image: string, sidecar: string, draft: string|null } | { ok: false, error: string, message: string }}
 */
export function placeImage({ root, document, alt, jobId = null, file = null, provider, review = '' } = {}) {
  const hasJob = jobId !== null && jobId !== undefined;
  const hasFile = file !== null && file !== undefined;
  if (hasJob === hasFile) return fail('bad-source', 'give exactly one of jobId or file');
  if (typeof alt !== 'string' || alt.trim() === '' || /[\]\r\n]/.test(alt)) {
    return fail('bad-alt', 'alt must be non-empty and must not contain ] or a line break');
  }
  const rootAbs = path.resolve(String(root ?? ''));
  const rel = safeRelative(document);
  if (rel === null) return fail('not-found', `document not found: ${document}`);
  const docAbs = path.join(rootAbs, rel);
  if (!isFile(docAbs)) return fail('not-found', `document not found: ${rel}`);

  const slug = slugify(path.posix.basename(rel, '.md')) || 'image';
  let source;
  let ext;
  let base;
  let operation;
  let effectivePrompt;
  let parameters;
  if (hasJob) {
    if (typeof provider !== 'string' || provider === '') return fail('bad-provider', 'provider is required');
    if (typeof jobId !== 'string' || !JOB_ID.test(jobId)) return fail('not-found', `job not found: ${jobId}`);
    const jobDir = path.join(rootAbs, '.campaign', 'state', 'images', jobId);
    if (!isDir(jobDir)) return fail('not-found', `job not found: ${jobId}`);
    const resultPath = path.join(jobDir, 'result.png');
    if (!isFile(resultPath)) return fail('no-result', `job ${jobId} has no result.png`);
    let job;
    try {
      job = JSON.parse(fs.readFileSync(path.join(jobDir, 'job.json'), 'utf8'));
    } catch {
      return fail('not-found', `job ${jobId} has no readable job.json`);
    }
    if (!OPERATIONS.has(job?.operation)) return fail('not-found', `job ${jobId} has no valid operation`);
    operation = job.operation;
    effectivePrompt = typeof job.prompt === 'string' ? job.prompt : null;
    parameters = readParameters(jobDir);
    source = resultPath;
    ext = '.png';
    base = operation === 'remove_background' ? `${slug}-no-background` : slug;
  } else {
    if (provider !== 'upload') return fail('bad-provider', 'a file can only be placed with provider upload');
    if (typeof file !== 'string' || !path.isAbsolute(file)) return fail('bad-source', 'file must be an absolute path');
    ext = path.extname(file).toLowerCase();
    if (!IMAGE_EXT.includes(ext)) return fail('bad-format', 'file must be .png, .jpg, .jpeg or .webp');
    if (!isFile(file)) return fail('not-found', `file not found: ${file}`);
    source = file;
    operation = 'upload';
    effectivePrompt = null;
    parameters = {};
    base = slug;
  }

  const text = fs.readFileSync(docAbs, 'utf8');
  if (!text.split('\n').some((line) => line.startsWith('# '))) {
    return fail('no-title', `${rel} has no title line (# ...), so no draft can be made`);
  }

  const targetDir = path.join(rootAbs, path.dirname(rel), 'img');
  const relDir = path.posix.join(path.posix.dirname(rel), 'img');
  fs.mkdirSync(targetDir, { recursive: true });

  // A stem is free only when no image and no sidecar uses it, so a sidecar is never overwritten.
  const stemTaken = (stem) => [...IMAGE_EXT, '.yaml'].some((e) => fs.existsSync(path.join(targetDir, `${stem}${e}`)));
  let n = 1;
  let stem = base;
  for (;;) {
    stem = n === 1 ? base : `${base}-${n}`;
    if (stemTaken(stem)) {
      n++;
      continue;
    }
    try {
      fs.copyFileSync(source, path.join(targetDir, `${stem}${ext}`), fs.constants.COPYFILE_EXCL);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      n++;
    }
  }
  const imageName = `${stem}${ext}`;
  const sidecarName = `${stem}.yaml`;
  fs.writeFileSync(
    path.join(targetDir, sidecarName),
    renderSidecar({
      provider,
      operation,
      document: rel,
      effectivePrompt,
      parameters,
      review: String(review ?? ''),
    }),
    { flag: 'wx' },
  );

  let draft = null;
  if (operation !== 'remove_background') {
    const draftPath = path.join(rootAbs, '.campaign', 'drafts', rel);
    fs.mkdirSync(path.dirname(draftPath), { recursive: true });
    fs.writeFileSync(draftPath, insertEmbed(text, `![${alt}](img/${imageName})`));
    draft = rel;
  }
  return { ok: true, image: `${relDir}/${imageName}`, sidecar: `${relDir}/${sidecarName}`, draft };
}
