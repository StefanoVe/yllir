#!/usr/bin/env node
// Atlas of a campaign: the manifest and one file per layer, checked and written by
// deterministic rules. The drawing is not here; the agent proposes constraints and this
// script refuses every write that breaks the rules or a locked layer.
// Usage: node atlas.mjs <status|validate|init|write-layer|lock> <root> [args] [--unlock]
// Exit codes: 0 ok, 1 campaign problem (validation errors, refused write, no atlas folder), 2 usage.

import fs from 'node:fs';
import path from 'node:path';
import {
  LAYERS, atlasDir, atlasFolder, readAtlas, validateAtlas, manifestProblems, prefixProblems, writeJson, isPlainObject,
} from './lib/model.mjs';
import { checkWrite, snapshotOf } from './lib/lock.mjs';
import { pendingPlaces } from './lib/pending.mjs';
import { canonicalJson } from './lib/geometry.mjs';
import { buildWorldIndex } from '../../../../scripts/lib/world-graph.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node atlas.mjs <status|validate|init|write-layer|lock> <root> [args] [--unlock]';
const COMMANDS = ['status', 'validate', 'init', 'write-layer', 'lock'];

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

function writeLayer(root, name, candidateFile, unlock) {
  const folder = atlasFolder(root);
  const dir = atlasDir(root);
  if (dir === null) return refuse({ written: false, changed: [], removed: [], added: [], overlaps: [] }, [noAtlasProblem()]);

  const atlas = readAtlas(root);
  const candidate = readJsonArg(candidateFile);
  if (candidate.error) {
    return refuse(
      { written: false, changed: [], removed: [], added: [], overlaps: [] },
      [{ code: 'bad-json', file: candidateFile, path: '', message: candidate.error }],
    );
  }

  const check = checkWrite(atlas.manifest, name, candidate.value, { unlock, current: atlas.layers[name] ?? null });
  const manifest = structuredClone(atlas.manifest ?? {});
  if (isPlainObject(manifest.layers)) {
    if (unlock && (check.changed.length > 0 || check.removed.length > 0)) manifest.layers[name] = { locked: false };
    if (!manifest.layers[name]) manifest.layers[name] = { locked: false };
  }

  const candidateAtlas = { ...atlas, manifest, layers: { ...atlas.layers, [name]: candidate.value } };
  const problems = validateAtlas(root, candidateAtlas, { worldIndex: buildWorldIndex(root) });
  const result = { changed: check.changed, removed: check.removed, added: check.added, overlaps: check.overlaps };
  if (!check.ok || problems.length > 0) {
    return refuse({ written: false, ...result }, problems);
  }

  const layerFile = path.join(dir, `${name}.json`);
  writeJson(layerFile, candidate.value);
  if (canonicalJson(manifest) !== canonicalJson(atlas.manifest)) writeJson(path.join(dir, 'atlas.json'), manifest);
  print({ ok: true, written: path.posix.join(folder, `${name}.json`), ...result, problems: [] });
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
    default:
      if (rest.length !== 2 || !LAYERS.includes(rest[0])) throw new Error(USAGE);
      code = writeLayer(root, rest[0], rest[1], unlock);
  }
  exitWith(code);
}

runCli(main);
