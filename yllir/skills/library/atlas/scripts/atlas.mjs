#!/usr/bin/env node
// Atlas of a campaign: the manifest and one file per layer, checked and written by
// deterministic rules. The drawing is not here; the agent proposes constraints and this
// script refuses every write that breaks the rules or a locked layer.
// Usage: node atlas.mjs <status|validate|init|places|write-layer|lock|generate <layer>|generate-terrain|preview|render|styles|set-style> <root> [args] [--unlock] [--open] [--audience master|players]
// Exit codes: 0 ok, 1 campaign problem (validation errors, refused write, no atlas folder), 2 usage.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  LAYERS, SCOPE_KINDS, atlasDir, atlasFolder, readAtlas, validateAtlas, manifestProblems, prefixProblems, writeJson,
  isPlainObject, isUrbanScope, layersForScope,
} from './lib/model.mjs';
import { ensureAtlasSetup, planAtlasSetup, defaultCanvasFor, DEFAULT_STYLE } from './lib/setup.mjs';
import { exportAtlas } from './lib/export.mjs';
import { listStyles, loadStyle, resolveStyleId } from './lib/styles.mjs';
import { checkWrite, snapshotOf } from './lib/lock.mjs';
import { pendingPlaces } from './lib/pending.mjs';
import { canonicalJson } from './lib/geometry.mjs';
import { generateTerrain } from './lib/terrain.mjs';
import { generateRelief } from './lib/relief.mjs';
import { generateBiomes } from './lib/biomes.mjs';
import { generateWater } from './lib/water.mjs';
import { generatePolitical } from './lib/political.mjs';
import { generateRoutes } from './lib/routes.mjs';
import { generateGround } from './lib/urban/ground.mjs';
import { generateGreen } from './lib/urban/green.mjs';
import { generateWalls } from './lib/urban/walls.mjs';
import { generateStreets } from './lib/urban/streets.mjs';
import { generateBlocks } from './lib/urban/blocks.mjs';
import { generateDistricts } from './lib/urban/districts.mjs';
import { renderPreview } from './lib/preview.mjs';
import { buildWorldIndex } from '../../../../scripts/lib/world-graph.mjs';
import { parseYamlLite } from '../../../../scripts/lib/yaml-lite.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node atlas.mjs <status|validate|init|places|write-layer|lock|generate <layer>|generate-terrain|preview|render|styles|set-style> <root> [args] [--unlock] [--open] [--audience master|players]';
const COMMANDS = ['status', 'validate', 'init', 'places', 'write-layer', 'lock', 'generate', 'generate-terrain', 'preview', 'render', 'styles', 'set-style'];
const AUDIENCES = ['master', 'players'];
// The generator of each layer. Every generator is pure: constraints, seed and the other layers in, features and problems out.
const GENERATORS = {
  terrain: generateTerrain,
  relief: generateRelief,
  biomes: generateBiomes,
  water: generateWater,
  political: generatePolitical,
  routes: generateRoutes,
  ground: generateGround,
  green: generateGreen,
  walls: generateWalls,
  streets: generateStreets,
  blocks: generateBlocks,
  districts: generateDistricts,
};
const PREVIEW_FILE = '.campaign/cache/atlas/preview.png';

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** Prints a refusal and returns the exit code of a campaign problem. Nothing is written. */
function refuse(extra, problems) {
  print({ ok: false, ...extra, problems });
  return 1;
}

function readJsonArg(file) {
  try {
    return { value: JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) };
  } catch (err) {
    return { error: `${file} is not valid JSON: ${err.message}` };
  }
}

function noAtlasProblem() {
  return { code: 'no-atlas', file: 'campaign.yaml', path: 'structure', message: 'campaign.yaml declares no atlas folder' };
}

function status(root) {
  const folder = atlasFolder(root);
  const atlas = readAtlas(root);
  const worldIndex = buildWorldIndex(root);
  const dir = atlasDir(root);
  const scopeKind = atlas.manifest?.scope?.kind;
  // With a manifest of a known scope, only the layers of that scope are listed.
  const names = isPlainObject(atlas.manifest) && SCOPE_KINDS.includes(scopeKind) ? layersForScope(scopeKind) : LAYERS;
  const layers = {};
  for (const name of names) {
    const features = atlas.layers[name]?.features;
    layers[name] = {
      present: dir !== null && fs.existsSync(path.join(dir, `${name}.json`)),
      locked: atlas.manifest?.layers?.[name]?.locked === true,
      features: Array.isArray(features) ? features.length : 0,
    };
  }
  print({
    folder,
    exists: dir !== null && fs.existsSync(path.join(dir, 'atlas.json')),
    layers,
    problems: validateAtlas(root, atlas, { worldIndex }),
    pending: pendingPlaces(root, atlas, worldIndex),
  });
  return folder === null ? 1 : 0;
}

function validate(root) {
  const problems = validateAtlas(root, readAtlas(root), { worldIndex: buildWorldIndex(root) });
  print({ ok: problems.length === 0, problems });
  return problems.length === 0 ? 0 : 1;
}

/**
 * Creates atlas.json. Missing seed, canvas and style get their defaults. The campaign is set up for the
 * atlas (category and module, see lib/setup.mjs) only after the scope passed every check, so a refused
 * init changes nothing. An existing atlas.json is refused first, with campaign.yaml untouched.
 */
function init(root, scopeFile) {
  const none = { written: false, categoryAdded: false, moduleEnabled: false };
  const read = readJsonArg(scopeFile);
  if (read.error) {
    return refuse(none, [{ code: 'bad-json', file: scopeFile, path: '', message: read.error }]);
  }
  const plan = planAtlasSetup(root);
  if (plan.errors.length > 0) return refuse(none, plan.errors);

  const { folder } = plan;
  const dir = path.join(root, folder);
  const file = path.join(dir, 'atlas.json');
  if (fs.existsSync(file)) {
    return refuse(none, [{ code: 'atlas-exists', file: path.posix.join(folder, 'atlas.json'), path: '', message: 'atlas.json already exists' }]);
  }

  const input = isPlainObject(read.value) ? read.value : {};
  const manifest = {
    schema: 1,
    scope: input.scope,
    canvas: input.canvas ?? defaultCanvasFor(input.scope?.kind),
    seed: input.seed ?? plan.seed,
    style: input.style ?? DEFAULT_STYLE,
    layers: {},
  };
  const problems = prefixProblems(folder, manifestProblems(manifest));
  if (problems.length > 0) return refuse(none, problems);

  const setup = ensureAtlasSetup(root);
  if (!setup.ok) return refuse({ ...none, categoryAdded: setup.categoryAdded }, setup.errors);

  fs.mkdirSync(dir, { recursive: true });
  writeJson(file, manifest);
  print({
    ok: true,
    written: path.posix.join(folder, 'atlas.json'),
    categoryAdded: setup.categoryAdded,
    moduleEnabled: setup.moduleEnabled,
    problems: [],
  });
  return 0;
}

/** The place whose sheet is named like the folder of `file` (A/B/B.md for A/B/C.md), searched upwards. */
function parentPlaceOf(file, placeByFile) {
  let dir = path.posix.dirname(file);
  while (dir !== '.' && dir !== '') {
    const candidate = `${dir}/${path.posix.basename(dir)}.md`;
    if (candidate !== file && placeByFile.has(candidate)) return placeByFile.get(candidate);
    dir = path.posix.dirname(dir);
  }
  return null;
}

/**
 * Lists every place of the world with its parent (from the folders), whether it is placed on the map and
 * where. Works without an atlas folder: then every place is listed as not placed, and scope is null.
 */
function places(root) {
  const worldIndex = buildWorldIndex(root);
  const atlas = readAtlas(root);
  const placed = placementsOf(atlas);
  const sheets = worldIndex.subjects.filter((s) => s.kind === 'place').sort((a, b) => compareText(a.file, b.file));
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

/**
 * Where each placed place is, and its icon, keyed by place id. A geographic atlas counts its places layer;
 * an urban one counts its buildings (at and kind) and its districts (no point, icon district).
 */
function placementsOf(atlas) {
  const featuresOf = (name) => (Array.isArray(atlas.layers[name]?.features) ? atlas.layers[name].features.filter(isPlainObject) : []);
  const byPlace = new Map();
  if (isUrbanScope(atlas.manifest?.scope?.kind)) {
    for (const feature of featuresOf('buildings')) {
      if (typeof feature.place === 'string') {
        byPlace.set(feature.place, { at: Array.isArray(feature.at) ? feature.at : null, icon: feature.kind ?? null });
      }
    }
    for (const feature of featuresOf('districts')) {
      if (typeof feature.place === 'string' && !byPlace.has(feature.place)) byPlace.set(feature.place, { at: null, icon: 'district' });
    }
    return byPlace;
  }
  for (const feature of featuresOf('places')) {
    byPlace.set(feature.place, { at: Array.isArray(feature.at) ? feature.at : null, icon: feature.icon ?? null });
  }
  return byPlace;
}

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Opens a file with the system viewer, detached, and never fails the caller. Returns false when no
 * viewer could be started.
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
    child.on('error', () => {}); // a missing viewer is reported through opened: false, never as a crash
    child.unref();
    return child.pid !== undefined;
  } catch {
    return false;
  }
}

/**
 * The one write path of a layer: checkWrite and the whole-atlas validation, then the file and the manifest.
 * Nothing is written when either refuses. Prints the result and returns the exit code.
 * @param {object} [options.extra] fields added to the printed result (for example the feature count)
 */
function writeCandidate(root, name, value, { unlock = false, extra = {} } = {}) {
  const folder = atlasFolder(root);
  const dir = atlasDir(root);
  const empty = { written: false, changed: [], removed: [], added: [], overlaps: [], ...extra };
  if (dir === null) return refuse(empty, [noAtlasProblem()]);

  const atlas = readAtlas(root);
  const check = checkWrite(atlas.manifest, name, value, { unlock, current: atlas.layers[name] ?? null });
  const manifest = structuredClone(atlas.manifest ?? {});
  if (isPlainObject(manifest.layers)) {
    if (unlock && (check.changed.length > 0 || check.removed.length > 0)) manifest.layers[name] = { locked: false };
    if (!manifest.layers[name]) manifest.layers[name] = { locked: false };
  }

  const candidateAtlas = { ...atlas, manifest, layers: { ...atlas.layers, [name]: value } };
  const problems = validateAtlas(root, candidateAtlas, { worldIndex: buildWorldIndex(root) });
  const result = { changed: check.changed, removed: check.removed, added: check.added, overlaps: check.overlaps, ...extra };
  if (!check.ok || problems.length > 0) {
    return refuse({ written: false, ...result }, problems);
  }

  const layerFile = path.join(dir, `${name}.json`);
  writeJson(layerFile, value);
  if (canonicalJson(manifest) !== canonicalJson(atlas.manifest)) writeJson(path.join(dir, 'atlas.json'), manifest);
  print({ ok: true, written: path.posix.join(folder, `${name}.json`), ...result, problems: [] });
  return 0;
}

function writeLayer(root, name, candidateFile, unlock) {
  if (atlasDir(root) === null) {
    return refuse({ written: false, changed: [], removed: [], added: [], overlaps: [] }, [noAtlasProblem()]);
  }
  const candidate = readJsonArg(candidateFile);
  if (candidate.error) {
    return refuse(
      { written: false, changed: [], removed: [], added: [], overlaps: [] },
      [{ code: 'bad-json', file: candidateFile, path: '', message: candidate.error }],
    );
  }
  return writeCandidate(root, name, candidate.value, { unlock });
}

/**
 * Generates one layer from the constraints in its file. When the layer is locked, the locked
 * features are kept and only the constraints after the lock add features. The result goes through
 * writeCandidate; a problem refuses the whole write.
 */
function generateCommand(root, name) {
  const folder = atlasFolder(root);
  const dir = atlasDir(root);
  const empty = { written: false, changed: [], removed: [], added: [], overlaps: [], features: 0 };
  if (dir === null) return refuse(empty, [noAtlasProblem()]);

  const atlas = readAtlas(root);
  const relative = path.posix.join(folder, `${name}.json`);
  const manifestErrors = atlas.manifest === undefined ? [] : manifestProblems(atlas.manifest);
  if (!isPlainObject(atlas.manifest) || manifestErrors.length > 0) {
    return refuse(empty, manifestErrors.length > 0 ? prefixProblems(folder, manifestErrors) : [{ code: 'bad-manifest', file: path.posix.join(folder, 'atlas.json'), path: '', message: 'atlas.json is missing or invalid' }]);
  }
  // The manifest is valid here, so its scope kind is known: the layer must belong to that scale.
  const scopeKind = atlas.manifest.scope.kind;
  if (!layersForScope(scopeKind).includes(name)) {
    return refuse(empty, [{ code: 'wrong-scale-layer', file: relative, path: 'scope.kind', message: `${name} is not a layer of a ${scopeKind} atlas` }]);
  }
  const current = atlas.layers[name];
  if (current === undefined) {
    return refuse(empty, [{ code: 'missing-layer', file: relative, path: '', message: `${name}.json must hold the constraints first` }]);
  }

  const constraints = Array.isArray(current.constraints) ? current.constraints : [];
  const constraintProblems = validateAtlas(
    root,
    { ...atlas, layers: { ...atlas.layers, [name]: { layer: name, constraints, features: [] } } },
    { worldIndex: buildWorldIndex(root) },
  ).filter((p) => p.file === relative && p.path.startsWith('constraints'));
  if (constraintProblems.length > 0) return refuse(empty, constraintProblems);

  const entry = atlas.manifest.layers?.[name];
  const locked = entry?.locked === true && isPlainObject(entry.snapshot) && Array.isArray(entry.snapshot.constraints)
    ? {
      features: (Array.isArray(current.features) ? current.features : []).filter(isPlainObject),
      constraintCount: entry.snapshot.constraints.length,
    }
    : null;

  const { features, problems } = GENERATORS[name]({
    canvas: atlas.manifest.canvas,
    seed: atlas.manifest.seed,
    constraints,
    layers: atlas.layers,
    locked,
  });
  if (problems.length > 0) return refuse(empty, prefixProblems(folder, problems));
  return writeCandidate(root, name, { layer: name, constraints, features }, { extra: { features: features.length } });
}

/** Writes the PNG preview of the atlas under the campaign cache. Nothing in the atlas changes. */
function previewCommand(root, { open = false } = {}) {
  const folder = atlasFolder(root);
  if (folder === null) return refuse({ file: null }, [noAtlasProblem()]);
  const atlas = readAtlas(root);
  const errors = atlas.manifest === undefined ? [] : manifestProblems(atlas.manifest);
  if (!isPlainObject(atlas.manifest) || errors.length > 0) {
    return refuse({ file: null }, errors.length > 0 ? prefixProblems(folder, errors) : [{ code: 'bad-manifest', file: path.posix.join(folder, 'atlas.json'), path: '', message: 'atlas.json is missing or invalid' }]);
  }
  const file = path.join(root, PREVIEW_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderPreview({ canvas: atlas.manifest.canvas, layers: atlas.layers }));
  if (open) {
    print({ ok: true, file: PREVIEW_FILE, opened: openFile(file) });
  } else {
    print({ ok: true, file: PREVIEW_FILE });
  }
  return 0;
}

/** The parsed campaign.yaml, or null when it is missing or does not parse (the style then has no adapter). */
function readCampaignConfig(root) {
  try {
    return parseYamlLite(fs.readFileSync(path.join(root, 'campaign.yaml'), 'utf8')).data;
  } catch {
    return null;
  }
}

/**
 * Exports the atlas for one audience (see lib/export.mjs). Prints the result; exits 1 when the export is
 * refused. With `open`, the built index.html is opened with the system viewer after a successful build.
 */
function renderCommand(root, { audience = 'master', open = false } = {}) {
  const result = exportAtlas(root, { audience });
  if (!result.ok) {
    print({ ok: false, dir: null, stats: null, checks: result.checks, problems: result.problems });
    return 1;
  }
  const out = { ok: true, dir: result.dir, stats: result.stats, checks: result.checks, problems: [] };
  if (open) out.opened = openFile(path.join(root, result.dir, 'index.html'));
  print(out);
  return 0;
}

/** Prints the installed and listed styles, and the one the atlas uses now. Writes nothing. */
function stylesCommand(root) {
  const atlas = readAtlas(root);
  try {
    const current = resolveStyleId({
      atlasStyle: isPlainObject(atlas.manifest) ? atlas.manifest.style : undefined,
      campaignConfig: readCampaignConfig(root),
    });
    print({ styles: listStyles(), current });
    return 0;
  } catch (err) {
    return refuse({ styles: listStyles() }, [{ code: err.code ?? 'bad-adapter', file: 'campaign.yaml', path: 'system', message: err.message }]);
  }
}

/**
 * Sets the style of the atlas in atlas.json. Only that file is written: no layer changes. `auto` leaves
 * the choice to the game-system adapter and the default; any other id must be installed.
 */
function setStyleCommand(root, id) {
  const folder = atlasFolder(root);
  const dir = atlasDir(root);
  const empty = { written: false, style: id };
  if (dir === null) return refuse(empty, [noAtlasProblem()]);
  if (id !== 'auto') {
    try {
      loadStyle(id);
    } catch (err) {
      return refuse(empty, [{ code: err.code ?? 'invalid-style', file: path.posix.join(folder, 'atlas.json'), path: 'style', message: err.message }]);
    }
  }
  const atlas = readAtlas(root);
  if (!isPlainObject(atlas.manifest)) {
    return refuse(empty, [{ code: 'bad-manifest', file: path.posix.join(folder, 'atlas.json'), path: '', message: 'atlas.json is missing or invalid' }]);
  }
  const manifest = { ...structuredClone(atlas.manifest), style: id };
  const problems = prefixProblems(folder, manifestProblems(manifest));
  if (problems.length > 0) return refuse(empty, problems);
  writeJson(path.join(dir, 'atlas.json'), manifest);
  print({ ok: true, style: id, problems: [] });
  return 0;
}

function lockLayer(root, name) {
  const folder = atlasFolder(root);
  const dir = atlasDir(root);
  if (dir === null) return refuse({ layer: name }, [noAtlasProblem()]);

  const atlas = readAtlas(root);
  const file = `${name}.json`;
  const relative = path.posix.join(folder, file);
  const problems = validateAtlas(root, atlas, { worldIndex: buildWorldIndex(root) })
    .filter((p) => p.file === relative);
  if (!fs.existsSync(path.join(dir, file))) {
    problems.unshift({ code: 'missing-layer', file: relative, path: '', message: `${file} does not exist` });
  }
  if (atlas.manifest === undefined || atlas.manifest === null) {
    problems.push({ code: 'bad-manifest', file: path.posix.join(folder, 'atlas.json'), path: '', message: 'atlas.json is missing or invalid' });
  }
  if (problems.length > 0) return refuse({ layer: name }, problems);

  const manifest = structuredClone(atlas.manifest);
  if (!isPlainObject(manifest.layers)) manifest.layers = {};
  manifest.layers[name] = { locked: true, snapshot: snapshotOf(atlas.layers[name]) };
  writeJson(path.join(dir, 'atlas.json'), manifest);
  print({ ok: true, layer: name, features: atlas.layers[name].features.length, problems: [] });
  return 0;
}

function main() {
  const argv = process.argv.slice(2);
  const unlock = argv.includes('--unlock');
  const open = argv.includes('--open');
  let audience = null;
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--unlock' || argv[i] === '--open') continue;
    if (argv[i] === '--audience') {
      audience = argv[++i] ?? null;
      if (audience === null) throw new Error(USAGE);
      continue;
    }
    args.push(argv[i]);
  }
  const [command, rootArg, ...rest] = args;
  if (!COMMANDS.includes(command) || !rootArg) throw new Error(USAGE);
  if (unlock && command !== 'write-layer') throw new Error(USAGE);
  if (open && command !== 'preview' && command !== 'render') throw new Error(USAGE);
  if (audience !== null && (command !== 'render' || !AUDIENCES.includes(audience))) throw new Error(USAGE);
  const root = path.resolve(rootArg);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(USAGE);

  let code;
  switch (command) {
    case 'status':
    case 'validate':
      if (rest.length !== 0) throw new Error(USAGE);
      code = command === 'status' ? status(root) : validate(root);
      break;
    case 'init':
      if (rest.length !== 1) throw new Error(USAGE);
      code = init(root, rest[0]);
      break;
    case 'places':
      if (rest.length !== 0) throw new Error(USAGE);
      code = places(root);
      break;
    case 'lock':
      if (rest.length !== 1 || !LAYERS.includes(rest[0])) throw new Error(USAGE);
      code = lockLayer(root, rest[0]);
      break;
    case 'generate':
      if (rest.length !== 1 || !Object.hasOwn(GENERATORS, rest[0])) throw new Error(USAGE);
      code = generateCommand(root, rest[0]);
      break;
    case 'generate-terrain':
      if (rest.length !== 0) throw new Error(USAGE);
      code = generateCommand(root, 'terrain');
      break;
    case 'preview':
      if (rest.length !== 0) throw new Error(USAGE);
      code = previewCommand(root, { open });
      break;
    case 'render':
      if (rest.length !== 0) throw new Error(USAGE);
      code = renderCommand(root, { audience: audience ?? 'master', open });
      break;
    case 'styles':
      if (rest.length !== 0) throw new Error(USAGE);
      code = stylesCommand(root);
      break;
    case 'set-style':
      if (rest.length !== 1) throw new Error(USAGE);
      code = setStyleCommand(root, rest[0]);
      break;
    default:
      if (rest.length !== 2 || !LAYERS.includes(rest[0])) throw new Error(USAGE);
      code = writeLayer(root, rest[0], rest[1], unlock);
  }
  exitWith(code);
}

runCli(main);
