#!/usr/bin/env node
// Atlas of a campaign: the manifest and one file per layer, checked and written by
// deterministic rules. The drawing is not here; the agent proposes constraints and this
// script refuses every write that breaks the rules or a locked layer.
// Usage: node atlas.mjs <status|validate|init|write-layer|lock|generate-terrain|preview> <root> [args] [--unlock]
// Exit codes: 0 ok, 1 campaign problem (validation errors, refused write, no atlas folder), 2 usage.

import fs from 'node:fs';
import path from 'node:path';
import {
  LAYERS, atlasDir, atlasFolder, readAtlas, validateAtlas, manifestProblems, prefixProblems, writeJson, isPlainObject,
} from './lib/model.mjs';
import { checkWrite, snapshotOf } from './lib/lock.mjs';
import { pendingPlaces } from './lib/pending.mjs';
import { canonicalJson } from './lib/geometry.mjs';
import { generateTerrain } from './lib/terrain.mjs';
import { generateRelief } from './lib/relief.mjs';
import { generateBiomes } from './lib/biomes.mjs';
import { generateWater } from './lib/water.mjs';
import { generatePolitical } from './lib/political.mjs';
import { generateRoutes } from './lib/routes.mjs';
import { renderPreview } from './lib/preview.mjs';
import { buildWorldIndex } from '../../../../scripts/lib/world-graph.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node atlas.mjs <status|validate|init|write-layer|lock|generate <layer>|generate-terrain|preview> <root> [args] [--unlock]';
const COMMANDS = ['status', 'validate', 'init', 'write-layer', 'lock', 'generate', 'generate-terrain', 'preview'];
// The generator of each layer. Every generator is pure: constraints, seed and the other layers in, features and problems out.
const GENERATORS = {
  terrain: generateTerrain,
  relief: generateRelief,
  biomes: generateBiomes,
  water: generateWater,
  political: generatePolitical,
  routes: generateRoutes,
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
  const layers = {};
  for (const name of LAYERS) {
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

function init(root, scopeFile) {
  const folder = atlasFolder(root);
  const dir = atlasDir(root);
  if (dir === null) return refuse({ written: false }, [noAtlasProblem()]);

  const read = readJsonArg(scopeFile);
  if (read.error) {
    return refuse({ written: false }, [{ code: 'bad-json', file: scopeFile, path: '', message: read.error }]);
  }
  const input = isPlainObject(read.value) ? read.value : {};
  const manifest = {
    schema: 1,
    scope: input.scope,
    canvas: input.canvas,
    seed: input.seed,
    style: input.style,
    layers: {},
  };
  const problems = prefixProblems(folder, manifestProblems(manifest));
  if (problems.length > 0) return refuse({ written: false }, problems);

  const file = path.join(dir, 'atlas.json');
  if (fs.existsSync(file)) {
    return refuse({ written: false }, [{ code: 'atlas-exists', file: path.posix.join(folder, 'atlas.json'), path: '', message: 'atlas.json already exists' }]);
  }
  fs.mkdirSync(dir, { recursive: true });
  writeJson(file, manifest);
  print({ ok: true, written: path.posix.join(folder, 'atlas.json'), problems: [] });
  return 0;
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
  const current = atlas.layers[name];
  if (current === undefined) {
    return refuse(empty, [{ code: 'missing-layer', file: relative, path: '', message: `${name}.json must hold the constraints first` }]);
  }
  const manifestErrors = atlas.manifest === undefined ? [] : manifestProblems(atlas.manifest);
  if (!isPlainObject(atlas.manifest) || manifestErrors.length > 0) {
    return refuse(empty, manifestErrors.length > 0 ? prefixProblems(folder, manifestErrors) : [{ code: 'bad-manifest', file: path.posix.join(folder, 'atlas.json'), path: '', message: 'atlas.json is missing or invalid' }]);
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
function previewCommand(root) {
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
  print({ ok: true, file: PREVIEW_FILE });
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
  const [command, rootArg, ...rest] = argv.filter((arg) => arg !== '--unlock');
  if (!COMMANDS.includes(command) || !rootArg) throw new Error(USAGE);
  if (unlock && command !== 'write-layer') throw new Error(USAGE);
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
      code = previewCommand(root);
      break;
    default:
      if (rest.length !== 2 || !LAYERS.includes(rest[0])) throw new Error(USAGE);
      code = writeLayer(root, rest[0], rest[1], unlock);
  }
  exitWith(code);
}

runCli(main);
