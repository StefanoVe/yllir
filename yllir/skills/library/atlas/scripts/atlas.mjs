#!/usr/bin/env node
// Atlas of a campaign, painted-base method: a base picture (base.png, no text on it), a land mask
// (land.png) and data (atlas.json, labels.json). The CLI does the mechanics: picture intake, crops
// for the image providers, candidate composition and checks, lock flags, labels validation, and the
// exports. The assistant judges what to draw and what to write.
// Usage: node atlas.mjs <command> <campaign root> [args]. Every file argument is relative to the
// current folder or absolute. Output is JSON on stdout and ends with the line `exit: <code>`.
// Exit codes: 0 ok, 1 refused or campaign problem (nothing written), 2 usage.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import {
  atlasFolder, atlasDir, readAtlas, validateAtlas, manifestProblems, labelsProblems, prefixProblems,
  writeJson, isPlainObject,
} from './lib/model.mjs';
import { ensureAtlasSetup, planAtlasSetup } from './lib/setup.mjs';
import { decodePng, encodePngRgba, newImage, sha256Of, writePngFile } from './lib/image.mjs';
import { imageInfo, MAX_IMAGE_BYTES } from './lib/image-info.mjs';
import {
  loadBase, gridView, cropForProvider, composeCandidate, verifyCandidate, deriveLand, acceptCandidate, maskPreview,
} from './lib/ops.mjs';
import { computeTerritories, territoryAreaPixels } from './lib/territory.mjs';
import { setLock } from './lib/lock.mjs';
import { pendingPlaces } from './lib/pending.mjs';
import { listStyles, loadStyle, resolveStyleId } from './lib/styles.mjs';
import { exportAtlas } from './lib/export.mjs';
import { renderPreview } from './lib/preview.mjs';
import { sampleSea, setSea } from './lib/sea.mjs';
import { buildWorldIndex } from '../../../../scripts/lib/world-graph.mjs';
import { parseYamlLite } from '../../../../scripts/lib/yaml-lite.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = [
  'usage: node atlas.mjs <command> <campaign root> [args]',
  '  status | validate | places | styles',
  '  init <root> <scope.json> [--base <image>] [--sea-color #hex] [--tolerance n]',
  '          [--water-at x,y]... [--clear-waters]',
  '  base-set <root> <image> [--sea-color #hex] [--tolerance n] [--water-at x,y]... [--clear-waters]',
  '  grid <root> --box x0,y0,x1,y1 [--out png]',
  '  crop <root> --box x0,y0,x1,y1 [--out png]',
  '  compose <root> --raw png --box x0,y0,x1,y1 [--mode land|box|mask] [--mask png] [--margin n]',
  '          [--zone x0,y0,x1,y1]... [--restore x0,y0,x1,y1]... [--no-color-match] [--out png]',
  '  verify <root> --after png --box x0,y0,x1,y1 [--out png]',
  '  land <root> [--from png] [--box x0,y0,x1,y1] [--sea-color #hex] [--tolerance n] [--unlock] [--out png]',
  '          [--water-at x,y]... [--clear-waters]',
  '  territories <root> [--out png]',
  '  accept <root> --candidate png --box x0,y0,x1,y1 [--extend] [--unlock]',
  '  lock <root> base|land|all',
  '  lock <root> release base|land|all --unlock',
  '  labels-write <root> <candidate.json>',
  '  render <root> [--audience master|players] [--open] [--data-dir path]',
  '  preview <root> [--open] [--data-dir path]',
  '  set-style <root> <id|auto>',
  '  sea-sample <root> --out png',
  '  sea-set <root> --candidate png',
  '  report <root> [--placed id,id] [--ask "question"|none]',
].join('\n');

const COMMANDS = [
  'status', 'validate', 'init', 'base-set', 'places', 'grid', 'crop', 'compose', 'verify', 'land', 'territories',
  'accept', 'lock', 'labels-write', 'render', 'preview', 'styles', 'set-style', 'sea-sample', 'sea-set', 'report',
];
/** Number of positional arguments after <command> <root>: [min, max]. */
const ARITY = { init: [1, 1], 'base-set': [1, 1], 'labels-write': [1, 1], 'set-style': [1, 1], lock: [1, 2] };
/** The options each command accepts. Any other option is a usage error. */
const COMMAND_OPTIONS = {
  init: ['--base', '--sea-color', '--tolerance', '--water-at', '--clear-waters'],
  'base-set': ['--sea-color', '--tolerance', '--water-at', '--clear-waters'],
  grid: ['--box', '--out'],
  crop: ['--box', '--out'],
  compose: ['--raw', '--box', '--mode', '--mask', '--margin', '--zone', '--restore', '--no-color-match', '--out'],
  verify: ['--after', '--box', '--out'],
  land: ['--from', '--box', '--sea-color', '--tolerance', '--unlock', '--out', '--water-at', '--clear-waters'],
  territories: ['--out'],
  accept: ['--candidate', '--box', '--extend', '--unlock'],
  lock: ['--unlock'],
  render: ['--audience', '--data-dir', '--open'],
  preview: ['--data-dir', '--open'],
  'sea-sample': ['--out'],
  'sea-set': ['--candidate'],
  report: ['--placed', '--ask'],
};
const VALUE_OPTIONS = new Set([
  '--base', '--sea-color', '--tolerance', '--box', '--out', '--raw', '--mode', '--mask', '--margin', '--zone',
  '--restore', '--from', '--candidate', '--after', '--placed', '--ask', '--audience', '--data-dir', '--water-at',
]);
const REPEATABLE = new Set(['--zone', '--restore', '--water-at']);
const FLAG_OPTIONS = new Set(['--extend', '--unlock', '--open', '--no-color-match', '--clear-waters']);
const AUDIENCES = ['master', 'players'];
const LOCK_TARGETS = ['base', 'land', 'all'];
const LOCKABLE_NAMES = ['base', 'land'];
const ZERO_HASH = '0'.repeat(64);
const CANVAS_PLACEHOLDER = { width: 1024, height: 1024 };
const MIN_SIDE = 16;
/** A port or a pier may sit this far (in pixels) from the land. */
const PORT_REACH = 12;
const WATERSIDE_KINDS = ['port', 'pier'];
const WORK_DIR = '.campaign/cache/atlas/work';
const REPORT_FILE = '.campaign/state/atlas/report.txt';
const CONFIG_FILE = 'campaign.yaml';

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** Prints a refusal with its problems. Nothing has been written when this is used. */
function refuse(extra, problems) {
  print({ ok: false, ...extra, problems });
  return 1;
}

function usageError(reason) {
  return new Error(`${reason}\n${USAGE}`);
}

/** Reads a JSON file argument: { value } or { error }. */
function readJsonArg(file) {
  try {
    return { value: JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) };
  } catch (err) {
    return { error: `${file} is not valid JSON: ${err.message}` };
  }
}

/** Parses argv: positional arguments, value options (repeatable ones as lists), flags, and the names seen. */
function parseArgv(argv) {
  const positional = [];
  const values = {};
  const lists = { '--zone': [], '--restore': [], '--water-at': [] };
  const flags = new Set();
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    seen.add(arg);
    if (FLAG_OPTIONS.has(arg)) {
      flags.add(arg);
    } else if (VALUE_OPTIONS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw usageError(`${arg} needs a value`);
      i++;
      if (REPEATABLE.has(arg)) lists[arg].push(value);
      else values[arg] = value;
    } else {
      throw usageError(`unknown option ${arg}`);
    }
  }
  return { positional, values, lists, flags, seen };
}

function wholeNumber(value, name) {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw usageError(`${name} must be a whole number`);
  return Number(value);
}

/** A box given as x0,y0,x1,y1 (whole numbers). */
function parseBox(value, name) {
  const match = /^(-?\d+),(-?\d+),(-?\d+),(-?\d+)$/.exec(value);
  if (!match) throw usageError(`${name} must be x0,y0,x1,y1 with whole numbers`);
  const [x0, y0, x1, y1] = match.slice(1).map(Number);
  return { x0, y0, x1, y1 };
}

/** A canvas point given as x,y (whole numbers, not negative). */
function parsePoint(value, name) {
  const match = /^(\d+),(\d+)$/.exec(value);
  if (!match) throw usageError(`${name} must be x,y with whole numbers`);
  return [Number(match[1]), Number(match[2])];
}

/** The --water-at points, in the order given. */
function waterPointsOf(list) {
  return list.map((value) => parsePoint(value, '--water-at'));
}

/** The --water-at points, or undefined when none was given (so that nothing is written for them). */
function waterPointsOptional(list) {
  return list.length === 0 ? undefined : waterPointsOf(list);
}

function requiredBox(values, name = '--box') {
  if (values[name] === undefined) throw usageError(`${name} is required`);
  return parseBox(values[name], name);
}

function parseHex(value) {
  const match = /^#([0-9a-fA-F]{6})$/.exec(value ?? '');
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The file name of an entry of the manifest (base or land), or the default. */
function fileOf(entry, fallback) {
  return typeof entry?.file === 'string' && entry.file !== '' ? path.basename(entry.file) : fallback;
}

/** Canvas of a manifest when its sides are usable for positions, otherwise null. */
function canvasOf(manifest) {
  const canvas = manifest?.canvas;
  if (!isPlainObject(canvas)) return null;
  const ok = [canvas.width, canvas.height].every((n) => Number.isInteger(n) && n >= MIN_SIDE);
  return ok ? { width: canvas.width, height: canvas.height } : null;
}

/** The parsed campaign.yaml, or null when it is missing or does not parse. */
function readCampaignConfig(root) {
  try {
    return parseYamlLite(fs.readFileSync(path.join(root, CONFIG_FILE), 'utf8')).data;
  } catch {
    return null;
  }
}

/**
 * Opens a file with the system viewer, detached; never fails the caller. False when no viewer started.
 */
function openFile(file) {
  try {
    let child;
    if (process.platform === 'darwin') {
      child = spawn('open', [file], { detached: true, stdio: 'ignore' });
    } else if (process.platform === 'win32') {
      child = spawn('cmd', ['/c', 'start', '""', file], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true });
    } else {
      child = spawn('xdg-open', [file], { detached: true, stdio: 'ignore' });
    }
    child.on('error', () => {}); // a missing viewer is reported through opened: false
    child.unref();
    return child.pid !== undefined;
  } catch {
    return false;
  }
}

/** Converts a picture to PNG with the macOS sips tool, or null when that tool is not available. */
function convertWithSips(source) {
  let dir = null;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-atlas-'));
    const out = path.join(dir, 'picture.png');
    execFileSync('sips', ['-s', 'format', 'png', source, '--out', out], { stdio: 'ignore' });
    return fs.readFileSync(out);
  } catch {
    return null;
  } finally {
    if (dir !== null) fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Reads a picture for the base: at most MAX_IMAGE_BYTES, PNG decoded directly, JPEG and WebP converted
 * with sips when it is available. Nothing is written.
 * @returns {{ ok: true, image: object, png: Buffer, width: number, height: number, sha256: string } | { ok: false, code: string, message: string }}
 */
function intakeImage(file) {
  const source = path.resolve(file);
  const fail = (code, message) => ({ ok: false, code, message });
  let size;
  try {
    size = fs.statSync(source).size;
  } catch {
    return fail('bad-image', 'the picture cannot be read');
  }
  if (size > MAX_IMAGE_BYTES) return fail('image-too-large', `the picture is larger than ${MAX_IMAGE_BYTES} bytes`);
  let bytes;
  try {
    bytes = fs.readFileSync(source);
  } catch {
    return fail('bad-image', 'the picture cannot be read');
  }
  const info = imageInfo(bytes);
  if (info === null) return fail('bad-image', 'the picture is not a PNG, JPEG or WebP file with a readable size');
  if (info.format !== 'png') {
    const converted = convertWithSips(source);
    if (converted === null) return fail('unsupported-image', 'convert the picture to PNG first');
    bytes = converted;
  }
  let image;
  try {
    image = decodePng(bytes);
  } catch (err) {
    return fail('bad-image', `the picture cannot be decoded as PNG: ${err.message}`);
  }
  const png = encodePngRgba(image);
  return { ok: true, image, png, width: image.width, height: image.height, sha256: sha256Of(png) };
}

/** Removes the files of a failed init, the ones this call created. */
function removeFiles(files) {
  for (const file of files) fs.rmSync(file, { force: true });
}

// ---------------------------------------------------------------- status, validate

function statusCommand(root) {
  const folder = atlasFolder(root);
  const atlas = readAtlas(root);
  const worldIndex = buildWorldIndex(root);
  const dir = atlas.dir;
  const manifest = isPlainObject(atlas.manifest) ? atlas.manifest : null;
  const present = (name) => dir !== null && fs.existsSync(path.join(dir, name));
  const baseFile = fileOf(manifest?.base, 'base.png');
  const landFile = fileOf(manifest?.land, 'land.png');
  const base = manifest?.base && manifest.canvas && present(baseFile)
    ? { file: baseFile, width: manifest.canvas.width, height: manifest.canvas.height, sha256: manifest.base.sha256 ?? null }
    : null;
  print({
    folder,
    exists: dir !== null && fs.existsSync(path.join(dir, 'atlas.json')),
    layers: {
      terrain: { present: present(baseFile), locked: manifest?.base?.locked === true },
      land: { present: present(landFile), locked: manifest?.land?.locked === true },
    },
    base,
    problems: validateAtlas(root, atlas, { worldIndex }),
    pending: folder === null ? [] : pendingPlaces(root, atlas, worldIndex),
  });
  return folder === null ? 1 : 0;
}

function validateCommand(root) {
  const problems = validateAtlas(root, readAtlas(root), { worldIndex: buildWorldIndex(root) });
  print({ ok: problems.length === 0, problems });
  return problems.length === 0 ? 0 : 1;
}

// ---------------------------------------------------------------- init, base-set

/**
 * Creates the atlas: the campaign set up for it, the folder, base.png (when a picture is given), atlas.json
 * and land.png. Every check runs before the first write; a refused init changes nothing.
 */
function initCommand(root, scopeFile, options) {
  const read = readJsonArg(scopeFile);
  if (read.error) return refuse({}, [{ code: 'bad-json', file: scopeFile, path: '', message: read.error }]);
  const plan = planAtlasSetup(root);
  if (plan.errors.length > 0) return refuse({}, plan.errors);

  const folder = plan.folder;
  const dir = path.join(root, folder);
  const file = path.join(dir, 'atlas.json');
  const relative = path.posix.join(folder, 'atlas.json');
  if (fs.existsSync(file)) {
    return refuse({}, [{ code: 'atlas-exists', file: relative, path: '', message: 'atlas.json already exists' }]);
  }

  const input = isPlainObject(read.value) ? read.value : {};
  const draft = { version: 2, scope: input.scope, style: 'auto', canvas: CANVAS_PLACEHOLDER };
  const draftProblems = prefixProblems(folder, manifestProblems(draft));
  if (draftProblems.length > 0) return refuse({}, draftProblems);

  let picture = null;
  if (options.base !== undefined) {
    picture = intakeImage(options.base);
    if (!picture.ok) {
      print({ ok: false, code: picture.code, message: picture.message });
      return 1;
    }
  }

  if (picture === null && options.waterPoints !== undefined) {
    return refuse({}, [{ code: 'no-base', file: relative, path: '', message: '--water-at samples the base picture: give --base' }]);
  }

  const manifest = picture === null
    ? draft
    : {
      ...draft,
      canvas: { width: picture.width, height: picture.height },
      base: { file: 'base.png', sha256: picture.sha256, locked: false },
      land: { file: 'land.png', sha256: ZERO_HASH, locked: false },
    };
  const finalProblems = prefixProblems(folder, manifestProblems(manifest));
  if (finalProblems.length > 0) return refuse({}, finalProblems);

  const setup = ensureAtlasSetup(root);
  if (!setup.ok) return refuse({ categoryAdded: setup.categoryAdded }, setup.errors);

  fs.mkdirSync(dir, { recursive: true });
  const created = [file];
  let land = null;
  if (picture !== null) {
    const basePath = path.join(dir, 'base.png');
    const landPath = path.join(dir, 'land.png');
    fs.writeFileSync(basePath, picture.png);
    created.push(basePath, landPath);
    writeJson(file, manifest);
    land = deriveLand(root, {
      seaColor: options.seaColor,
      tolerance: options.tolerance,
      waterPoints: options.waterPoints,
      clearWaters: options.clearWaters,
    });
    if (!land.ok) {
      removeFiles(created);
      return refuse({ categoryAdded: setup.categoryAdded }, [{ code: land.code, file: relative, path: '', message: land.message }]);
    }
  } else {
    writeJson(file, manifest);
  }

  print({
    ok: true,
    written: relative,
    categoryAdded: setup.categoryAdded,
    moduleEnabled: setup.moduleEnabled,
    base: picture === null ? null : { file: 'base.png', width: picture.width, height: picture.height, sha256: picture.sha256 },
    land: land === null ? null : {
      landPixels: land.landPixels, seaColor: land.seaColor, tolerance: land.tolerance, waters: land.waters,
    },
    problems: [],
  });
  return 0;
}

/**
 * Puts a picture on base.png (only when the base and the land are not locked) and rebuilds land.png
 * at the picture's size, so a picture of a new size is accepted. All or nothing: a refused base-set
 * changes nothing, because base.png, land.png and atlas.json are restored to what they were.
 */
function baseSetCommand(root, imageArg, options) {
  const dir = atlasDir(root);
  if (dir === null) return refuse({}, [{ code: 'no-atlas', file: 'campaign.yaml', path: 'structure', message: 'campaign.yaml declares no atlas folder' }]);
  const folder = atlasFolder(root);
  const relative = path.posix.join(folder, 'atlas.json');
  const { manifest } = readAtlas(root);
  if (!isPlainObject(manifest)) {
    return refuse({}, [{ code: 'no-atlas', file: relative, path: '', message: 'atlas.json is missing or invalid; run init first' }]);
  }
  if (manifest.base?.locked === true || manifest.land?.locked === true) {
    return refuse({ code: 'base-locked' }, [{ code: 'base-locked', file: relative, path: '', message: 'the base or the land is locked; the master must unlock it first' }]);
  }

  const picture = intakeImage(imageArg);
  if (!picture.ok) {
    print({ ok: false, code: picture.code, message: picture.message });
    return 1;
  }
  const next = {
    ...manifest,
    canvas: { width: picture.width, height: picture.height },
    base: { file: 'base.png', sha256: picture.sha256, locked: false },
    land: { ...(isPlainObject(manifest.land) ? manifest.land : {}), file: 'land.png', sha256: ZERO_HASH, locked: false },
  };
  const problems = prefixProblems(folder, manifestProblems(next));
  if (problems.length > 0) return refuse({}, problems);

  const kept = ['base.png', 'land.png', 'atlas.json'].map((name) => {
    const file = path.join(dir, name);
    return { file, bytes: fs.existsSync(file) ? fs.readFileSync(file) : null };
  });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'base.png'), picture.png);
  writeJson(path.join(dir, 'atlas.json'), next);
  const land = deriveLand(root, {
    seaColor: options.seaColor,
    tolerance: options.tolerance,
    waterPoints: options.waterPoints,
    clearWaters: options.clearWaters,
  });
  if (!land.ok) {
    for (const { file, bytes } of kept) {
      if (bytes === null) fs.rmSync(file, { force: true });
      else fs.writeFileSync(file, bytes);
    }
    return refuse({}, [{ code: land.code, file: relative, path: '', message: land.message }]);
  }
  print({
    ok: true,
    base: { file: 'base.png', width: picture.width, height: picture.height, sha256: picture.sha256 },
    land: { landPixels: land.landPixels, seaColor: land.seaColor, tolerance: land.tolerance, waters: land.waters },
    problems: [],
  });
  return 0;
}

// ---------------------------------------------------------------- places, labels

/** Where each placed place is on the map, keyed by place id, from labels.places. */
function placementsOf(labels) {
  const byPlace = new Map();
  for (const item of Array.isArray(labels?.places) ? labels.places : []) {
    if (isPlainObject(item) && typeof item.place === 'string') {
      byPlace.set(item.place, { at: [item.x, item.y], icon: item.kind ?? null });
    }
  }
  return byPlace;
}

function parentPlaceOf(file, placeByFile) {
  let dir = path.posix.dirname(file);
  while (dir !== '.' && dir !== '') {
    const candidate = `${dir}/${path.posix.basename(dir)}.md`;
    if (candidate !== file && placeByFile.has(candidate)) return placeByFile.get(candidate);
    dir = path.posix.dirname(dir);
  }
  return null;
}

/** Every place of the world with its parent (from the folders) and whether it is on the map. */
function placesCommand(root) {
  const worldIndex = buildWorldIndex(root);
  const atlas = readAtlas(root);
  const placed = placementsOf(atlas.labels);
  const sheets = worldIndex.subjects
    .filter((s) => s.kind === 'place')
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const placeByFile = new Map(sheets.map((s) => [s.file, s.id]));
  const list = sheets.map((sheet) => {
    const placement = placed.get(sheet.id);
    return {
      id: sheet.id,
      title: sheet.title,
      file: sheet.file,
      parent: parentPlaceOf(sheet.file, placeByFile),
      placed: placement !== undefined,
      at: placement?.at ?? null,
      icon: placement?.icon ?? null,
    };
  });
  const scope = isPlainObject(atlas.manifest) && isPlainObject(atlas.manifest.scope) ? atlas.manifest.scope : null;
  print({ places: list, scope });
  return 0;
}

/** Whether the canvas pixel (x, y) is land; a port or a pier may also be within PORT_REACH pixels of land. */
function onLand(loaded, x, y, kind) {
  const { width, height } = loaded.base;
  const land = loaded.land.data;
  const px = Math.min(Math.max(Math.floor(x), 0), width - 1);
  const py = Math.min(Math.max(Math.floor(y), 0), height - 1);
  if (land[py * width + px] === 1) return true;
  if (!WATERSIDE_KINDS.includes(kind)) return false;
  for (let dy = -PORT_REACH; dy <= PORT_REACH; dy++) {
    for (let dx = -PORT_REACH; dx <= PORT_REACH; dx++) {
      if (dx * dx + dy * dy > PORT_REACH * PORT_REACH) continue;
      const qx = px + dx;
      const qy = py + dy;
      if (qx >= 0 && qy >= 0 && qx < width && qy < height && land[qy * width + qx] === 1) return true;
    }
  }
  return false;
}

/** Validates a candidate labels.json, then writes it into the atlas folder. Nothing is written on failure. */
function labelsWriteCommand(root, candidateFile) {
  const dir = atlasDir(root);
  if (dir === null) return refuse({}, [{ code: 'no-atlas', file: 'campaign.yaml', path: 'structure', message: 'campaign.yaml declares no atlas folder' }]);
  const folder = atlasFolder(root);
  const relative = path.posix.join(folder, 'labels.json');
  const read = readJsonArg(candidateFile);
  if (read.error) return refuse({}, [{ code: 'bad-json', file: candidateFile, path: '', message: read.error }]);
  const labels = read.value;
  const atlas = readAtlas(root);
  if (!isPlainObject(atlas.manifest)) {
    return refuse({}, [{ code: 'no-atlas', file: path.posix.join(folder, 'atlas.json'), path: '', message: 'atlas.json is missing or invalid; run init first' }]);
  }

  const problems = prefixProblems(folder, labelsProblems(labels, {
    canvas: canvasOf(atlas.manifest),
    worldIndex: buildWorldIndex(root),
  }));
  const places = isPlainObject(labels) && Array.isArray(labels.places) ? labels.places : [];
  if (problems.length === 0 && places.length > 0) {
    const loaded = loadBase(root);
    if (!loaded.ok) {
      problems.push({ code: loaded.code, file: path.posix.join(folder, 'atlas.json'), path: '', message: loaded.message });
    } else if (loaded.land === null) {
      problems.push({ code: 'no-land', file: path.posix.join(folder, 'land.png'), path: '', message: 'land.png is missing; run init or base-set first' });
    } else {
      places.forEach((item, i) => {
        if (!isPlainObject(item) || typeof item.x !== 'number' || typeof item.y !== 'number') return;
        if (!onLand(loaded, item.x, item.y, item.kind)) {
          problems.push({
            code: 'place-not-on-land',
            file: relative,
            path: `places[${i}]`,
            message: `${item.place} at ${item.x},${item.y} is not on land${WATERSIDE_KINDS.includes(item.kind) ? ` (a ${item.kind} may be ${PORT_REACH} pixels from land)` : ''}`,
          });
        }
      });
    }
  }
  if (problems.length > 0) return refuse({}, problems);

  writeJson(path.join(dir, 'labels.json'), labels);
  const count = (group) => (Array.isArray(labels[group]) ? labels[group].length : 0);
  print({
    ok: true,
    written: {
      file: relative,
      lands: count('lands'),
      regions: count('regions'),
      nature: count('nature'),
      places: count('places'),
      territories: count('territories'),
    },
    problems: [],
  });
  return 0;
}

// ---------------------------------------------------------------- picture operations

/** Prints an operation result and returns its exit code (0 when ok). */
function printResult(result) {
  print(result);
  return result.ok ? 0 : 1;
}

/**
 * Runs a sea operation and prints its result with `extra` fields. A known error (one with a code) is
 * printed as a refusal and exits 1, nothing written; any other error is left to the CLI (exit 2).
 */
function seaCommand(operation, extra = {}) {
  let result;
  try {
    result = operation();
  } catch (err) {
    if (!err.code) throw err;
    print({ ok: false, code: err.code, message: err.message });
    return 1;
  }
  print({ ok: true, ...extra, ...result });
  return 0;
}

function territoriesCommand(root, outArg) {
  const loaded = loadBase(root);
  if (!loaded.ok) return printResult(loaded);
  if (loaded.land === null) return printResult({ ok: false, code: 'no-land', message: 'the atlas has no land.png; run init or base-set first' });
  const atlas = readAtlas(root);
  const territories = Array.isArray(atlas.labels?.territories) ? atlas.labels.territories : [];
  for (const item of territories) {
    if (!isPlainObject(item) || parseHex(item.color) === null) {
      return printResult({ ok: false, code: 'bad-label', message: 'every territory needs a color #rrggbb' });
    }
  }
  let masks;
  try {
    masks = computeTerritories(loaded.land, territories);
  } catch (err) {
    return printResult({ ok: false, code: 'bad-territory', message: err.message });
  }

  // The base darkened by 40%, each territory painted in its colour at 45% opacity, nothing else.
  const { base } = loaded;
  const image = newImage(base.width, base.height);
  const n = base.width * base.height;
  for (let p = 0; p < n; p++) {
    for (let c = 0; c < 3; c++) image.data[p * 4 + c] = Math.round(base.data[p * 4 + c] * 0.6);
    image.data[p * 4 + 3] = 255;
  }
  for (const item of territories) {
    const rgb = parseHex(item.color);
    const mask = masks.get(item.id);
    for (let p = 0; p < n; p++) {
      if (!mask.data[p]) continue;
      for (let c = 0; c < 3; c++) {
        image.data[p * 4 + c] = Math.round(image.data[p * 4 + c] * 0.55 + rgb[c] * 0.45);
      }
    }
  }
  const out = outArg ? path.resolve(outArg) : path.join(root, WORK_DIR, 'territories.png');
  writePngFile(out, image);
  const areas = Object.fromEntries(territories.map((item) => [item.id, territoryAreaPixels(masks.get(item.id))]));
  print({ ok: true, out, areas });
  return 0;
}

// ---------------------------------------------------------------- lock, styles, report

/** Sets (or, with release, clears) the lock flags of base and land. Locking records the file hashes. */
function lockCommand(root, target, release, unlock) {
  const dir = atlasDir(root);
  if (dir === null) return refuse({}, [{ code: 'no-atlas', file: 'campaign.yaml', path: 'structure', message: 'campaign.yaml declares no atlas folder' }]);
  const folder = atlasFolder(root);
  const relative = path.posix.join(folder, 'atlas.json');
  const { manifest } = readAtlas(root);
  if (!isPlainObject(manifest)) return refuse({}, [{ code: 'no-atlas', file: relative, path: '', message: 'atlas.json is missing or invalid' }]);
  const names = target === 'all' ? [...LOCKABLE_NAMES] : [target];

  if (release) {
    if (!unlock) throw usageError('releasing a lock needs --unlock, which only the master can ask for');
    const next = setLock(manifest, names, false);
    const problems = prefixProblems(folder, manifestProblems(next));
    if (problems.length > 0) return refuse({}, problems);
    writeJson(path.join(dir, 'atlas.json'), next);
    print({ ok: true, released: names, problems: [] });
    return 0;
  }

  const missing = names.filter((name) => !isPlainObject(manifest[name]));
  if (missing.length > 0) {
    return refuse({}, missing.map((name) => ({ code: 'missing-item', file: relative, path: name, message: `${name} does not exist yet` })));
  }
  const files = {};
  for (const name of names) {
    const file = path.join(dir, fileOf(manifest[name], `${name}.png`));
    if (!fs.existsSync(file)) {
      return refuse({}, [{ code: 'missing-file', file: path.posix.join(folder, path.basename(file)), path: name, message: `${path.basename(file)} is missing` }]);
    }
    files[name] = file;
  }
  const next = setLock(manifest, names, true);
  for (const name of names) next[name].sha256 = sha256Of(fs.readFileSync(files[name]));
  const problems = prefixProblems(folder, manifestProblems(next));
  if (problems.length > 0) return refuse({}, problems);
  writeJson(path.join(dir, 'atlas.json'), next);
  print({ ok: true, locked: names, problems: [] });
  return 0;
}

function stylesCommand(root) {
  const { manifest } = readAtlas(root);
  const styles = listStyles().map((style) => ({ id: style.id, names: style.names }));
  try {
    const current = resolveStyleId({
      atlasStyle: isPlainObject(manifest) ? manifest.style : undefined,
      campaignConfig: readCampaignConfig(root),
    });
    print({ ok: true, styles, current });
    return 0;
  } catch (err) {
    return refuse({ styles }, [{ code: err.code ?? 'bad-adapter', file: CONFIG_FILE, path: 'system', message: err.message }]);
  }
}

/** Writes the style of the atlas into atlas.json. `auto` leaves the choice to the adapter and the default. */
function setStyleCommand(root, id) {
  const dir = atlasDir(root);
  if (dir === null) return refuse({ style: id }, [{ code: 'no-atlas', file: 'campaign.yaml', path: 'structure', message: 'campaign.yaml declares no atlas folder' }]);
  const folder = atlasFolder(root);
  const relative = path.posix.join(folder, 'atlas.json');
  if (id !== 'auto') {
    try {
      loadStyle(id);
    } catch (err) {
      return refuse({ style: id }, [{ code: err.code ?? 'invalid-style', file: relative, path: 'style', message: err.message }]);
    }
  }
  const { manifest } = readAtlas(root);
  if (!isPlainObject(manifest)) return refuse({ style: id }, [{ code: 'bad-manifest', file: relative, path: '', message: 'atlas.json is missing or invalid' }]);
  const next = { ...manifest, style: id };
  const problems = prefixProblems(folder, manifestProblems(next));
  if (problems.length > 0) return refuse({ style: id }, problems);
  writeJson(path.join(dir, 'atlas.json'), next);
  print({ ok: true, style: id, problems: [] });
  return 0;
}

/** Writes the report the update mode reads: the places put on the map and the question for the master. */
function reportCommand(root, placedArg, askArg) {
  const placed = (placedArg ?? '').split(',').map((id) => id.trim()).filter((id) => id !== '');
  const ask = askArg === undefined || askArg.trim() === '' || askArg === 'none' ? null : askArg;
  const file = path.join(root, REPORT_FILE);
  const content = placed.length === 0 && ask === null
    ? 'nothing\n'
    : `placed: ${placed.length > 0 ? placed.join(',') : 'none'}\nask: ${ask ?? 'none'}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  print({ ok: true, file: REPORT_FILE, content });
  return 0;
}

// ---------------------------------------------------------------- render, preview

async function renderCommand(root, { audience, open, dataDir }) {
  const result = exportAtlas(root, { audience });
  if (!result.ok) {
    print({ ok: false, dir: null, stats: null, checks: result.checks, problems: result.problems });
    return 1;
  }
  const preview = await renderPreview(root, dataDir === undefined ? {} : { dataDir });
  const problems = preview.ok
    ? result.problems
    : [...result.problems, ...(preview.problems ?? [{ code: 'preview-failed', file: null, path: '', message: 'the preview picture could not be made' }])];
  const out = { ok: preview.ok, dir: result.dir, stats: result.stats, checks: result.checks, problems, preview };
  if (open) out.opened = openFile(path.resolve(root, result.dir, 'index.html'));
  print(out);
  return preview.ok ? 0 : 1;
}

async function previewCommand(root, { open, dataDir }) {
  const result = await renderPreview(root, dataDir === undefined ? {} : { dataDir });
  const out = { ...result };
  if (open && result.ok) out.opened = openFile(path.resolve(root, result.out));
  print(out);
  return result.ok ? 0 : 1;
}

// ---------------------------------------------------------------- dispatch

async function main() {
  const { positional, values, lists, flags, seen } = parseArgv(process.argv.slice(2));
  const [command, rootArg, ...rest] = positional;
  if (!command || !COMMANDS.includes(command)) throw usageError(`unknown command ${command ?? ''}`.trim());
  if (!rootArg) throw usageError('the campaign root is missing');
  const [min, max] = ARITY[command] ?? [0, 0];
  if (rest.length < min || rest.length > max) throw usageError(`${command} takes ${min === max ? min : `${min} to ${max}`} argument(s) after the root`);
  const allowed = COMMAND_OPTIONS[command] ?? [];
  for (const name of seen) {
    if (!allowed.includes(name)) throw usageError(`${name} is not an option of ${command}`);
  }
  const root = path.resolve(rootArg);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw usageError(`${rootArg} is not a folder`);

  const outOf = () => values['--out'];
  let code;
  switch (command) {
    case 'status':
      code = statusCommand(root);
      break;
    case 'validate':
      code = validateCommand(root);
      break;
    case 'init':
      code = initCommand(root, rest[0], {
        base: values['--base'],
        seaColor: values['--sea-color'],
        tolerance: wholeNumber(values['--tolerance'], '--tolerance'),
        waterPoints: waterPointsOptional(lists['--water-at']),
        clearWaters: flags.has('--clear-waters'),
      });
      break;
    case 'base-set':
      code = baseSetCommand(root, rest[0], {
        seaColor: values['--sea-color'],
        tolerance: wholeNumber(values['--tolerance'], '--tolerance'),
        waterPoints: waterPointsOptional(lists['--water-at']),
        clearWaters: flags.has('--clear-waters'),
      });
      break;
    case 'places':
      code = placesCommand(root);
      break;
    case 'grid':
      code = printResult(gridView(root, requiredBox(values), outOf()));
      break;
    case 'crop':
      code = printResult(cropForProvider(root, requiredBox(values), outOf()));
      break;
    case 'compose': {
      if (values['--raw'] === undefined) throw usageError('--raw is required');
      const mode = values['--mode'] ?? 'land';
      code = printResult(composeCandidate(root, {
        rawPath: path.resolve(values['--raw']),
        box: requiredBox(values),
        mode,
        maskPath: values['--mask'] === undefined ? undefined : path.resolve(values['--mask']),
        margin: wholeNumber(values['--margin'], '--margin'),
        zones: lists['--zone'].map((z) => parseBox(z, '--zone')),
        restores: lists['--restore'].map((r) => parseBox(r, '--restore')),
        colorMatch: !flags.has('--no-color-match'),
        outPath: outOf() === undefined ? undefined : path.resolve(outOf()),
      }));
      break;
    }
    case 'verify':
      if (values['--after'] === undefined) throw usageError('--after is required');
      code = printResult(verifyCandidate(root, {
        candidatePath: path.resolve(values['--after']),
        box: requiredBox(values),
        outPath: outOf() === undefined ? undefined : path.resolve(outOf()),
      }));
      break;
    case 'land': {
      const result = deriveLand(root, {
        from: values['--from'] === undefined ? undefined : path.resolve(values['--from']),
        box: values['--box'] === undefined ? undefined : parseBox(values['--box'], '--box'),
        seaColor: values['--sea-color'],
        tolerance: wholeNumber(values['--tolerance'], '--tolerance'),
        unlock: flags.has('--unlock'),
        waterPoints: waterPointsOptional(lists['--water-at']),
        clearWaters: flags.has('--clear-waters'),
      });
      if (!result.ok) {
        code = printResult(result);
        break;
      }
      const preview = maskPreview(root, outOf() === undefined ? path.join(root, WORK_DIR, 'land.png') : path.resolve(outOf()));
      code = printResult(preview.ok ? { ...result, preview: preview.out } : { ok: false, code: preview.code ?? 'preview-failed', message: preview.message ?? 'the land mask picture could not be written' });
      break;
    }
    case 'territories':
      code = territoriesCommand(root, outOf());
      break;
    case 'accept':
      if (values['--candidate'] === undefined) throw usageError('--candidate is required');
      code = printResult(acceptCandidate(root, {
        candidatePath: path.resolve(values['--candidate']),
        box: requiredBox(values),
        extend: flags.has('--extend'),
        unlock: flags.has('--unlock'),
      }));
      break;
    case 'lock': {
      const release = rest[0] === 'release';
      const target = release ? rest[1] : rest[0];
      if (!LOCK_TARGETS.includes(target)) throw usageError(`lock target must be base, land or all`);
      if (flags.has('--unlock') && !release) throw usageError('--unlock is only used with lock release');
      code = lockCommand(root, target, release, flags.has('--unlock'));
      break;
    }
    case 'labels-write':
      code = labelsWriteCommand(root, rest[0]);
      break;
    case 'render': {
      const audience = values['--audience'] ?? 'master';
      if (!AUDIENCES.includes(audience)) throw usageError('--audience must be master or players');
      code = await renderCommand(root, {
        audience,
        open: flags.has('--open'),
        dataDir: values['--data-dir'] === undefined ? undefined : path.resolve(values['--data-dir']),
      });
      break;
    }
    case 'preview':
      code = await previewCommand(root, {
        open: flags.has('--open'),
        dataDir: values['--data-dir'] === undefined ? undefined : path.resolve(values['--data-dir']),
      });
      break;
    case 'styles':
      code = stylesCommand(root);
      break;
    case 'set-style':
      code = setStyleCommand(root, rest[0]);
      break;
    case 'sea-sample':
      if (values['--out'] === undefined) throw usageError('--out is required');
      code = seaCommand(() => sampleSea(root, path.resolve(values['--out'])), { out: path.resolve(values['--out']) });
      break;
    case 'sea-set':
      if (values['--candidate'] === undefined) throw usageError('--candidate is required');
      code = seaCommand(() => setSea(root, path.resolve(values['--candidate'])));
      break;
    case 'report':
      code = reportCommand(root, values['--placed'], values['--ask']);
      break;
    default:
      throw usageError(`unknown command ${command}`);
  }
  exitWith(code);
}

runCli(main);
