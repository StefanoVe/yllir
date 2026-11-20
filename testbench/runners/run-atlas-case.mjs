#!/usr/bin/env node
// Runs one atlas case end to end: copies the atlas fixture into a temporary git repository, saves a
// baseline version, builds the atlas (setup: none, init or land) through the atlas CLI only, runs the
// entry point with `claude -p` once, and grades what the agent left in the repository against the
// case's answer key. The key is read from cases/atlas/<name>/key.yaml and is never copied into the
// copy the agent works on. One JSON line per run is appended to testbench/results/atlas-<name>.jsonl.
//
// Usage: node testbench/runners/run-atlas-case.mjs <caseDir> [--runs N] [--model sonnet] [--agent claude] [--keep]
//                                                  [--setup-only]
//        node testbench/runners/run-atlas-case.mjs <caseDir> --grade-only <dir> --run-json <file>
// --setup-only builds the setup, prints the folder and runs nothing (no agent). --keep keeps the copy
// and saves the agent's final message, cost, duration and tool calls as <tmp>/run.json. --grade-only
// grades a saved run again without running the agent and does not append to the results file.
// Checks by kind: create-asks A1 to A4, and A5 and A6 when the key sets expect_scope_kind or
// forbidden_layer_files (no agent-built atlas is needed); update U1 to U4; players P1 to P4;
// urban-building B1 and B2; urban-players P1 to P3 (the urban players version, the secret sentence and the
// master buildings). L-time and L-calls come from the limits. Exit codes: 0 every run passes; 1 some run fails; 2 the case
// or key cannot be used, or the setup fails.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  REPO_ROOT,
  appendResult,
  applyLimits,
  instructionsHash,
  listFiles,
  loadYamlMapping,
  parseCommonArgs,
  parseLimits,
  printSummary,
  recordHeader,
  runAgent,
} from './lib/case-common.mjs';
import { generateInstructions } from '../../yllir/scripts/lib/instructions.mjs';
import { ensureRepo, listVersions, saveVersion } from '../../yllir/scripts/lib/versions.mjs';
import { parseFrontmatter } from '../../yllir/scripts/lib/frontmatter.mjs';
import { buildWorldIndex } from '../../yllir/scripts/lib/world-graph.mjs';
import { atlasFolder, readAtlas, validateAtlas } from '../../yllir/skills/library/atlas/scripts/lib/model.mjs';
import { canonicalJson, isUsablePolygon, pointInPolygon } from '../../yllir/skills/library/atlas/scripts/lib/geometry.mjs';
import { normalizeText, reservedLinesOf } from '../../yllir/skills/library/atlas/scripts/lib/checks.mjs';
import { stripExitLine } from '../../yllir/scripts/lib/cli-exit.mjs';

const USAGE =
  'usage: node testbench/runners/run-atlas-case.mjs <caseDir> [--runs N] [--model sonnet] [--agent claude] [--keep] [--setup-only] [--grade-only <dir> --run-json <file>]';
const AGENT_TIMEOUT_MS = 1800000;
const FIXTURES = path.join(REPO_ROOT, 'testbench', 'fixtures');
const ATLAS_CLI = path.join(REPO_ROOT, 'yllir', 'skills', 'library', 'atlas', 'scripts', 'atlas.mjs');
const BASE_MESSAGE = 'Creata la campagna «Le ceneri della valle»';
const SETUPS = ['none', 'init', 'land'];
const KINDS = ['create-asks', 'update', 'players', 'urban-building', 'urban-players'];
const KEY_FIELDS = {
  'create-asks': ['forbidden_words'],
  update: ['new_title', 'lake_id', 'region_place'],
  players: ['refuge_file', 'refuge_title', 'well_title', 'borgo_well', 'borgo_place', 'valdaspra_well', 'valdaspra_place'],
  'urban-building': ['place_id', 'homonym_id', 'building_kind', 'validate_problem'],
  'urban-players': ['secret_sentence', 'master_building_ids'],
};
const PLAYERS_DATA_RE = /<script type="application\/json" id="atlas-data">([\s\S]*?)<\/script>/;
const ITALIAN_RE = /\b(il|che|non|per|sono|della)\b/i;
const DEFAULT_PLAYERS_HTML = '.campaign/cache/atlas/players/index.html';
const TEXT_FILE_RE = /\.(html?|json|js|mjs|css|svg|txt|md|xml)$/i;

// The setup of the land. The canvas is 4000 by 3000; y grows to the south. Morvalle is the valley
// (region disk 2000,1400 radius 700); Valdaspra lies west of it (region 700,1400 radius 450); Lago Grigio
// lies south of Borgo Cenere (lake 2000,1900 radius 200). No sea is drawn: the documents name none.
export const LAND_TERRAIN = [
  { kind: 'landmass', id: 'valle-terra', center: [2000, 1500], radius: [1800, 1300], roughness: 0.6, provenance: 'agent-choice', sources: [], note: 'Terra della valle, scelta dall\'agente.' },
  { kind: 'region', place: 'morvalle', at: [2000, 1400], radius: 700, provenance: 'document', sources: [{ file: 'Mondo/Morvalle/Morvalle.md', section: 'Descrizione' }] },
  { kind: 'region', place: 'valdaspra', at: [700, 1400], radius: 450, provenance: 'document', sources: [{ file: 'Mondo/Valdaspra/Valdaspra.md', section: 'Descrizione' }] },
  { kind: 'lake', id: 'lago-grigio', at: [2000, 1900], radius: 200, roughness: 0.3, provenance: 'document', sources: [{ file: 'Mondo/Morvalle/Lago Grigio.md', section: 'Descrizione' }] },
];

// Every existing place of the fixture, placed inside its region. The hidden refuge is master-only.
export const LAND_PLACES = [
  { place: 'morvalle', at: [2000, 1250], icon: 'landmark', sheet: 'Mondo/Morvalle/Morvalle.md' },
  { place: 'borgo-cenere', at: [2000, 1450], icon: 'town', sheet: 'Mondo/Morvalle/Borgo Cenere/Borgo Cenere.md' },
  { place: 'torre-dell-ascia', at: [2080, 1400], icon: 'landmark', sheet: 'Mondo/Morvalle/Borgo Cenere/Torre dell’Ascia.md' },
  { place: 'pozzo-di-narem', at: [2350, 1250], icon: 'landmark', sheet: 'Mondo/Morvalle/Pozzo di Nàrem.md' },
  { place: 'lago-grigio', at: [2000, 1650], icon: 'landmark', sheet: 'Mondo/Morvalle/Lago Grigio.md' },
  { place: 'pozzo-vecchio-borgo', at: [1950, 1480], icon: 'landmark', sheet: 'Mondo/Morvalle/Borgo Cenere/Pozzo Vecchio.md' },
  { place: 'rifugio-contrabbandieri', at: [1850, 1650], icon: 'landmark', visibility: 'master', sheet: 'Mondo/Morvalle/Rifugio dei Contrabbandieri.md' },
  { place: 'valdaspra', at: [700, 1400], icon: 'village', sheet: 'Mondo/Valdaspra/Valdaspra.md' },
  { place: 'pozzo-vecchio-valdaspra', at: [650, 1450], icon: 'ruin', sheet: 'Mondo/Valdaspra/Pozzo Vecchio.md' },
];

// ---------------------------------------------------------------- case and key

/** Reads and checks a key.yaml. Throws on an unknown kind or a missing field. */
export function validateKey(key) {
  if (!KINDS.includes(key.kind)) throw new Error(`key.yaml: kind must be one of ${KINDS.join(', ')}`);
  for (const field of KEY_FIELDS[key.kind]) {
    if (key[field] === undefined) throw new Error(`key.yaml: ${field} missing`);
  }
  if (key.forbidden_words !== undefined && !Array.isArray(key.forbidden_words)) {
    throw new Error('key.yaml: forbidden_words must be a list');
  }
  if (key.expect_scope_kind !== undefined && typeof key.expect_scope_kind !== 'string') {
    throw new Error('key.yaml: expect_scope_kind must be a string');
  }
  if (key.forbidden_layer_files !== undefined && !Array.isArray(key.forbidden_layer_files)) {
    throw new Error('key.yaml: forbidden_layer_files must be a list');
  }
  if (key.master_building_ids !== undefined && !Array.isArray(key.master_building_ids)) {
    throw new Error('key.yaml: master_building_ids must be a list');
  }
  return key;
}

/** Reads a case: case.yaml (prompt, setup, runs, limits) and its key.yaml beside it. */
export function loadCase(caseDir) {
  const data = loadYamlMapping(path.join(caseDir, 'case.yaml'));
  for (const field of ['case', 'fixture', 'prompt', 'setup']) {
    if (typeof data[field] !== 'string') throw new Error(`case.yaml: ${field} missing`);
  }
  if (!SETUPS.includes(data.setup)) throw new Error(`case.yaml: setup must be one of ${SETUPS.join(', ')}`);
  if (!Number.isInteger(data.runs) || data.runs < 1) throw new Error('case.yaml: runs must be a positive integer');
  const fixtureDir = path.join(FIXTURES, data.fixture, 'campaign');
  if (!fs.existsSync(fixtureDir)) throw new Error(`case.yaml: fixture ${data.fixture} not found`);
  const key = validateKey(loadYamlMapping(path.join(caseDir, 'key.yaml')));
  return { ...data, limits: parseLimits(data), key, fixtureDir };
}

// ---------------------------------------------------------------- setup

/** Runs the atlas CLI on a copy. Throws with its output when the command refuses (exit code other than 0). */
function runAtlas(copy, command, ...args) {
  const res = spawnSync(process.execPath, [ATLAS_CLI, command, copy, ...args], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`atlas ${command} exited ${res.status}: ${res.stdout || res.stderr}`);
  return res.stdout;
}

function writeJsonFile(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

/** Runs a function with git's global and system configuration switched off, then restores the environment. */
function withIsolatedGit(fn) {
  const names = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'];
  const saved = names.map((name) => [name, process.env[name]]);
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  try {
    return fn();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function saveSetupVersion(copy, message) {
  const saved = withIsolatedGit(() => saveVersion(copy, { message, kind: 'framework' }));
  if (!saved.saved) throw new Error(`setup: the version "${message}" was not saved`);
}

/**
 * Builds the atlas of the land on a copy, through the atlas CLI only: the scope, the terrain (written,
 * generated, locked), the places and the master site. Then saves a version and returns the baseline the
 * update grader compares with: the canonical terrain features, the terrain snapshot and the version count.
 */
function buildLand(copy, dir) {
  const scope = writeJsonFile(path.join(dir, 'scope.json'), {
    scope: { kind: 'region', places: ['morvalle', 'valdaspra'], note: 'La valle di Morvalle e Valdaspra, a ovest.' },
  });
  runAtlas(copy, 'init', scope);
  const terrain = writeJsonFile(path.join(dir, 'terrain.json'), { layer: 'terrain', constraints: LAND_TERRAIN, features: [] });
  runAtlas(copy, 'write-layer', 'terrain', terrain);
  runAtlas(copy, 'generate', 'terrain');
  runAtlas(copy, 'lock', 'terrain');
  const places = writeJsonFile(path.join(dir, 'places.json'), {
    layer: 'places',
    constraints: [],
    features: LAND_PLACES.map((p) => ({
      id: p.place,
      place: p.place,
      at: p.at,
      icon: p.icon,
      provenance: 'agent-choice',
      visibility: p.visibility ?? 'public',
      sources: [],
    })),
  });
  runAtlas(copy, 'write-layer', 'places', places);
  runAtlas(copy, 'render');
  saveSetupVersion(copy, 'Atlante: prova di setup.');
  return landBaseline(copy);
}

/** The baseline of the land: canonical terrain features, canonical snapshot and the saved version count. */
export function landBaseline(copy) {
  const atlas = readAtlas(copy);
  return {
    terrain: canonicalJson(atlas.layers.terrain?.features ?? null),
    snapshot: canonicalJson(atlas.manifest?.layers?.terrain?.snapshot?.features ?? null),
    versions: listVersions(copy, { limit: 500 }).length,
  };
}

/**
 * Copies the fixture into a fresh temporary git repository, saves the baseline version and builds the
 * setup of the case (none, init or land). Returns { tmp, copy, baseline } where baseline is null unless
 * the setup is land. Remove tmp with fs.rmSync(tmp, { recursive: true, force: true }).
 */
export function setupCopy({ fixtureDir, setup }) {
  if (!SETUPS.includes(setup)) throw new Error(`setup must be one of ${SETUPS.join(', ')}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-case-'));
  try {
    const copy = path.join(tmp, 'campaign');
    fs.cpSync(fixtureDir, copy, { recursive: true });
    const generated = generateInstructions(copy);
    if (generated.errors.length > 0) throw new Error(`generateInstructions: ${JSON.stringify(generated.errors)}`);
    withIsolatedGit(() => {
      ensureRepo(copy);
      saveVersion(copy, { message: BASE_MESSAGE, kind: 'framework' });
    });
    let baseline = null;
    if (setup === 'init') {
      const scope = writeJsonFile(path.join(tmp, 'scope.json'), {
        scope: { kind: 'region', places: ['morvalle', 'valdaspra'], note: 'La valle di Morvalle e Valdaspra, a ovest.' },
      });
      runAtlas(copy, 'init', scope);
      saveSetupVersion(copy, 'Atlante: estensione decisa.');
    } else if (setup === 'land') {
      baseline = buildLand(copy, tmp);
    }
    return { tmp, copy, baseline };
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

// ---------------------------------------------------------------- reading the copy

/** Every file of a folder, recursively, as absolute paths; .git and .campaign are skipped. */
function walkFiles(root) {
  const found = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === '.campaign') continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...walkFiles(full));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

function titleOf(text) {
  const line = parseFrontmatter(text).body.split('\n').find((item) => /^# /.test(item));
  return line === undefined ? null : line.slice(2).trim();
}

/** The first heading of every Markdown sheet of the copy. */
export function sheetTitles(copy) {
  const titles = new Set();
  for (const file of walkFiles(copy)) {
    if (!file.endsWith('.md')) continue;
    const title = titleOf(fs.readFileSync(file, 'utf8'));
    if (title) titles.add(title);
  }
  return titles;
}

/** The sheet whose first heading is the title: { file, id } or null. */
function sheetByTitle(copy, title) {
  for (const file of walkFiles(copy)) {
    if (!file.endsWith('.md')) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (titleOf(text) !== title) continue;
    const data = parseFrontmatter(text).data ?? {};
    return { file: path.relative(copy, file).split(path.sep).join('/'), id: data.id ?? null };
  }
  return null;
}

/** The atlas manifest text as the copy holds it, or null when the campaign has no atlas folder or file. */
function atlasManifestText(copy) {
  return atlasFileText(copy, 'atlas.json');
}

/** Absolute path of a file of the atlas folder when it exists, else null (no folder counts as no file). */
function atlasFileOf(copy, fileName) {
  const folder = atlasFolder(copy);
  if (folder === null) return null;
  const file = path.join(copy, folder, fileName);
  return fs.existsSync(file) ? file : null;
}

/** The text of a file of the atlas folder, or null when it does not exist. */
function atlasFileText(copy, fileName) {
  const file = atlasFileOf(copy, fileName);
  return file === null ? null : fs.readFileSync(file, 'utf8');
}

/** The features of an atlas layer file: [] when the file is missing or not a feature list. */
function layerFeaturesOf(copy, layer) {
  const text = atlasFileText(copy, `${layer}.json`);
  if (text === null) return [];
  try {
    const features = JSON.parse(text).features;
    return Array.isArray(features) ? features : [];
  } catch {
    return [];
  }
}

/** Every value of a key "name" or "text" in a parsed JSON value. */
function namesIn(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) namesIn(item, out);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if ((key === 'name' || key === 'text') && typeof item === 'string') out.push(item);
      else namesIn(item, out);
    }
  }
  return out;
}

/** The names and label texts of every JSON file of the atlas folder. */
export function atlasNames(copy) {
  const folder = atlasFolder(copy);
  if (folder === null) return [];
  const dir = path.join(copy, folder);
  if (!fs.existsSync(dir)) return [];
  const names = [];
  for (const file of listFiles(dir)) {
    if (!file.endsWith('.json')) continue;
    namesIn(JSON.parse(fs.readFileSync(file, 'utf8')), names);
  }
  return names;
}

/** The atlas exists and holds a locked layer: true when a locked: true appears in its manifest. */
function anyLocked(copy) {
  const text = atlasManifestText(copy);
  return text !== null && /"locked"\s*:\s*true/.test(text);
}

// ---------------------------------------------------------------- grading helpers

function check(id, ok, reason) {
  return { id, ok: ok === true, reason };
}

/** The checks of one run as { checks, failures, pass }. A run with no checks never passes. */
function finish(list) {
  const checks = {};
  const failures = [];
  for (const item of list) {
    checks[item.id] = item.ok;
    if (!item.ok) failures.push(`${item.id} ${item.reason}`);
  }
  return { checks, failures, pass: list.length > 0 && failures.length === 0 };
}

/** True when the final message ends on a question (a question mark is the last visible character). */
export function endsWithQuestion(report) {
  return typeof report === 'string' && /\?\s*$/.test(report.trim());
}

/** The forbidden words of the key that appear in the text as whole words, any case. */
export function forbiddenIn(text, words) {
  if (typeof text !== 'string') return [];
  return words.filter((word) => new RegExp(`\\b${word}\\b`, 'i').test(text));
}

const centroid = (points) => [
  points.reduce((sum, p) => sum + p[0], 0) / points.length,
  points.reduce((sum, p) => sum + p[1], 0) / points.length,
];

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---------------------------------------------------------------- graders by kind

/**
 * Create-asks: A1 to A4, after the single turn. A5 (the manifest scope kind) and A6 (no layer file of the
 * forbidden list) run only when the key sets expect_scope_kind or forbidden_layer_files. With no manifest
 * A5 passes, and with no atlas folder A6 passes: the agent may only have asked a question.
 */
export function createChecks(key, { copy, report }) {
  const titles = sheetTitles(copy);
  const unknown = atlasNames(copy).filter((name) => !titles.has(name.trim()));
  const forbidden = forbiddenIn(report, key.forbidden_words);
  const list = [
    check('A1', endsWithQuestion(report) && ITALIAN_RE.test(report ?? ''), 'the final message does not end with a question in Italian'),
    check('A2', !anyLocked(copy), 'a layer of the atlas is locked: the land was approved without the master'),
    check('A3', unknown.length === 0, `names or label texts with no sheet: ${unknown.join(', ')}`),
    check('A4', forbidden.length === 0, `the final message uses forbidden words: ${forbidden.join(', ')}`),
  ];
  if (key.expect_scope_kind !== undefined) list.push(scopeKindCheck(copy, key.expect_scope_kind));
  if (key.forbidden_layer_files !== undefined) list.push(forbiddenLayersCheck(copy, key.forbidden_layer_files));
  return list;
}

/** A5: the manifest's scope.kind equals the expected kind. No manifest passes. */
function scopeKindCheck(copy, expected) {
  const text = atlasManifestText(copy);
  if (text === null) return check('A5', true, '');
  let kind = null;
  try {
    kind = JSON.parse(text).scope?.kind ?? null;
  } catch {
    kind = null;
  }
  return check('A5', kind === expected, `the manifest scope kind is ${kind}, not ${expected}`);
}

/** A6: none of the forbidden layer files exists in the atlas folder. */
function forbiddenLayersCheck(copy, forbidden) {
  const present = forbidden.filter((fileName) => atlasFileOf(copy, fileName) !== null);
  return check('A6', present.length === 0, `layer files that must not exist: ${present.join(', ')}`);
}

/** The lake of the land (the terrain features of type lake) and the land polygons: { lakes, land }. */
function terrainShapes(atlas) {
  const features = Array.isArray(atlas.layers.terrain?.features) ? atlas.layers.terrain.features : [];
  const usable = (f) => isUsablePolygon(f.polygon);
  return {
    lakes: features.filter((f) => f.type === 'lake' && usable(f)).map((f) => f.polygon),
    land: features.filter((f) => f.type === 'land' && usable(f)).map((f) => f.polygon),
    regions: (Array.isArray(atlas.layers.terrain?.constraints) ? atlas.layers.terrain.constraints : [])
      .filter((c) => c.kind === 'region'),
  };
}

/** Riva Storta: a locked land, the places and the question: U1 to U4. */
export function updateChecks(key, { copy, report, baseline }) {
  const sheet = sheetByTitle(copy, key.new_title);
  const after = readAtlas(copy);
  const problems = validateAtlas(copy, after, { worldIndex: buildWorldIndex(copy) });
  const lockedChanged = problems.filter((p) => p.code === 'locked-layer-changed');
  const snapshotNow = canonicalJson(after.manifest?.layers?.terrain?.snapshot?.features ?? null);
  const terrainNow = canonicalJson(after.layers.terrain?.features ?? null);
  const landKept = lockedChanged.length === 0 && snapshotNow === baseline.snapshot && terrainNow === baseline.terrain;

  const feature = sheet?.id ? (after.layers.places?.features ?? []).find((f) => f.place === sheet.id) : undefined;
  const shapes = terrainShapes(after);
  const asked = endsWithQuestion(report) && new RegExp(key.new_title, 'i').test(report ?? '');
  let placed = false;
  let why = 'the place is not on land, or not south of the lake, or not inside the Morvalle region';
  if (feature !== undefined) {
    const onLand = shapes.land.some((polygon) => pointInPolygon(feature.at, polygon));
    let inside = false;
    if (shapes.lakes.length > 0) {
      const lakeCentre = centroid(shapes.lakes.flat());
      inside = feature.at[1] > lakeCentre[1];
    } else {
      const region = shapes.regions.find((r) => r.place === key.region_place);
      inside = region !== undefined && distance(feature.at, region.at) <= region.radius;
    }
    placed = onLand && inside;
  }
  const u3 = feature === undefined ? asked : placed;
  return [
    check('U1', sheet !== null, `no sheet titled ${key.new_title}`),
    check('U2', landKept, 'the locked land changed: a locked feature, the terrain or its snapshot differs from the setup'),
    check('U3', u3, feature === undefined
      ? `${key.new_title} is not in the places layer and the final message does not ask about it`
      : why),
    check('U4', listVersions(copy, { limit: 500 }).length > baseline.versions, 'no version was saved after the setup'),
  ];
}

/** The players' export: P1 to P4, after the single turn. */
export function playersChecks(key, { copy, fixtureDir }) {
  const dir = path.join(copy, '.campaign', 'cache', 'atlas');
  const html = path.join(dir, 'players', 'index.html');
  if (!fs.existsSync(html)) {
    return [
      check('P1', false, 'the players version (.campaign/cache/atlas/players/index.html) does not exist'),
      check('P2', false, 'not checked: no players version'),
      check('P3', false, 'not checked: no players version'),
      check('P4', fs.existsSync(path.join(dir, 'master', 'index.html')), 'the master site was deleted'),
    ];
  }
  const text = fs.readFileSync(html, 'utf8');
  const folded = normalizeText(text);

  const refuge = parseFrontmatter(fs.readFileSync(path.join(fixtureDir, key.refuge_file), 'utf8')).body;
  const secrets = [key.refuge_title, ...reservedLinesOf(refuge)];
  const leaked = secrets.filter((line) => folded.includes(normalizeText(line)));

  const match = PLAYERS_DATA_RE.exec(text);
  let data = null;
  try {
    data = match ? JSON.parse(match[1]) : null;
  } catch {
    data = null;
  }
  const places = Array.isArray(data?.places) ? data.places : [];
  const wells = places.filter((p) => p.title === key.well_title);
  const ids = wells.map((p) => p.id).sort();
  const expected = [key.borgo_well, key.valdaspra_well].sort();
  const at = (id) => places.find((p) => p.id === id)?.at;
  const [bw, vw, bp, vp] = [at(key.borgo_well), at(key.valdaspra_well), at(key.borgo_place), at(key.valdaspra_place)];
  const placed = ids.length === 2 && ids.every((id, i) => id === expected[i])
    && [bw, vw, bp, vp].every(Array.isArray)
    && distance(bw, bp) < distance(bw, vp)
    && distance(vw, vp) < distance(vw, bp);

  return [
    check('P1', true, ''),
    check('P2', leaked.length === 0, `text of the hidden refuge in the players version: ${leaked.map((l) => l.slice(0, 40)).join('; ')}`),
    check('P3', placed, `the two ${key.well_title} places are not both there, or not each in its own region`),
    check('P4', fs.existsSync(path.join(dir, 'master', 'index.html')), 'the master site was deleted'),
  ];
}

/** The atlas CLI validate on the copy: its exit status and the problems it printed (null when unreadable). */
function validateCli(copy) {
  const res = spawnSync(process.execPath, [ATLAS_CLI, 'validate', copy], { encoding: 'utf8' });
  let problems = null;
  try {
    problems = JSON.parse(stripExitLine(res.stdout ?? '')).problems ?? null;
  } catch {
    problems = null;
  }
  return { status: res.status, problems };
}

/**
 * Urban building: B1 the buildings feature whose id is the place has the right kind and is not the homonym;
 * B2 validate exits 0 and holds no building problem of the key for that id. Both fail when there is no
 * buildings layer, since nothing was placed to check.
 */
export function urbanBuildingChecks(key, { copy }) {
  const hasLayer = atlasFileOf(copy, 'buildings.json') !== null;
  const feature = layerFeaturesOf(copy, 'buildings').find((f) => f?.id === key.place_id);
  let b1 = 'the buildings layer does not exist';
  if (hasLayer) {
    b1 = `no building ${key.place_id}`;
    if (feature !== undefined) {
      if (feature.kind !== key.building_kind) b1 = `${key.place_id} has kind ${feature.kind}, not ${key.building_kind}`;
      else if (feature.place === key.homonym_id) b1 = `${key.place_id} is placed as the homonym ${key.homonym_id}`;
      else b1 = null;
    }
  }
  const { status, problems } = validateCli(copy);
  const hit = (problems ?? []).filter((p) => p.code === key.validate_problem && String(p.message).includes(key.place_id));
  const b2Ok = hasLayer && status === 0 && problems !== null && hit.length === 0;
  return [
    check('B1', b1 === null, b1 ?? ''),
    check('B2', b2Ok, !hasLayer ? 'the buildings layer does not exist'
      : `validate exit ${status}; ${key.validate_problem} problems for ${key.place_id}: ${hit.length}`),
  ];
}

/**
 * Urban players: the same export as playersChecks, with P1 (the players version exists), P2 (the master
 * sentence is in no text file of the export) and P3 (no master building id is in any text file of it).
 */
export function urbanPlayersChecks(key, { copy }) {
  const html = path.join(copy, key.players_html ?? DEFAULT_PLAYERS_HTML);
  if (!fs.existsSync(html)) {
    return [
      check('P1', false, `the players version (${key.players_html ?? DEFAULT_PLAYERS_HTML}) does not exist`),
      check('P2', false, 'not checked: no players version'),
      check('P3', false, 'not checked: no players version'),
    ];
  }
  const texts = listFiles(path.dirname(html))
    .filter((file) => TEXT_FILE_RE.test(file))
    .map((file) => normalizeText(fs.readFileSync(file, 'utf8')));
  const sentence = normalizeText(key.secret_sentence);
  const sentenceLeaked = texts.some((text) => text.includes(sentence));
  const idIn = (id) => new RegExp(`(?<![\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);
  const leakedIds = key.master_building_ids.filter((id) => texts.some((text) => idIn(id).test(text)));
  return [
    check('P1', true, ''),
    check('P2', !sentenceLeaked, 'the master sentence is in the players version'),
    check('P3', leakedIds.length === 0, `master buildings in the players version: ${leakedIds.join(', ')}`),
  ];
}

/** Grades one run. agentError is the first error of an agent that did not finish: such a run fails without checks. */
export function gradeAtlasRun({ key, copy, report, baseline, fixtureDir, agentError = null }) {
  if (agentError !== null) return { checks: {}, failures: [`agent: ${agentError}`], pass: false };
  switch (key.kind) {
    case 'create-asks':
      return finish(createChecks(key, { copy, report }));
    case 'update':
      return finish(updateChecks(key, { copy, report, baseline }));
    case 'players':
      return finish(playersChecks(key, { copy, fixtureDir }));
    case 'urban-building':
      return finish(urbanBuildingChecks(key, { copy }));
    case 'urban-players':
      return finish(urbanPlayersChecks(key, { copy }));
    default:
      throw new Error(`unknown kind ${key.kind}`);
  }
}

// ---------------------------------------------------------------- the run

/** The files that define what is under test: the atlas skill and scripts, the core entry instructions and the engine scripts. */
function instructionFiles() {
  const atlas = path.join(REPO_ROOT, 'yllir', 'skills', 'library', 'atlas');
  return [
    path.join(atlas, 'SKILL.md'),
    ...listFiles(path.join(atlas, 'scripts'), { scriptsOnly: true }),
    ...listFiles(path.join(REPO_ROOT, 'yllir', 'skills', 'core', 'yllir')),
    ...listFiles(path.join(REPO_ROOT, 'yllir', 'scripts'), { scriptsOnly: true }),
  ];
}

function sumOf(values) {
  return values.every((value) => typeof value === 'number') ? values.reduce((a, b) => a + b, 0) : null;
}

/** Runs one case once. Returns the grade, the agent result, the totals, the baseline and the temporary folder. */
function runOnce(caseData, opts) {
  const setup = setupCopy({ fixtureDir: caseData.fixtureDir, setup: caseData.setup });
  const result = runAgent({
    agent: opts.agent,
    cwd: setup.copy,
    prompt: caseData.prompt,
    model: opts.model,
    timeoutMs: AGENT_TIMEOUT_MS,
  });
  const agentError = result.ok ? null : result.error;
  const graded = gradeAtlasRun({
    key: caseData.key,
    copy: setup.copy,
    report: result.report,
    baseline: setup.baseline,
    fixtureDir: caseData.fixtureDir,
    agentError,
  });
  const totals = {
    duration_ms: sumOf([result.duration_ms]),
    tool_calls: sumOf([result.tool_calls]),
    cost_usd: sumOf([result.cost_usd]),
  };
  return {
    setup,
    graded: applyLimits(graded, caseData.limits, totals),
    result,
    totals,
    agentError,
  };
}

function makeRecord({ caseData, run, hash, opts, graded, result, totals, agentError, copy }) {
  return {
    case: caseData.case,
    run,
    date: new Date().toISOString(),
    ...recordHeader({ agent: opts.agent, modelLabel: opts.modelLabel }),
    instructions: hash,
    permission_mode: result?.permission_mode ?? null,
    kind: caseData.key.kind,
    checks: graded.checks,
    failures: graded.failures,
    pass: graded.pass,
    limits: caseData.limits,
    cost_usd: totals.cost_usd,
    duration_ms: totals.duration_ms,
    tool_calls: totals.tool_calls,
    error: agentError,
    report: result?.report ?? null,
    copy: copy ?? null,
  };
}

function consoleView(record) {
  const { report, ...rest } = record;
  return rest;
}

function resultName(caseData) {
  return `atlas-${caseData.case.split('/')[1]}`;
}

// ---------------------------------------------------------------- main

function main() {
  const argv = process.argv.slice(2);
  const setupOnly = argv.includes('--setup-only');
  const opts = parseCommonArgs(
    argv.filter((arg) => arg !== '--setup-only'),
    USAGE,
    { valueOptions: ['--grade-only', '--run-json'] },
  );
  const caseData = loadCase(opts.caseDir);
  const hash = instructionsHash(instructionFiles());

  const gradeOnly = opts.values['--grade-only'];
  if (gradeOnly !== undefined) {
    const runJson = opts.values['--run-json'];
    if (runJson === undefined) throw new Error(`--grade-only needs --run-json <file>\n${USAGE}`);
    const dir = path.resolve(gradeOnly);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`--grade-only: ${dir} is not a folder`);
    const saved = JSON.parse(fs.readFileSync(path.resolve(runJson), 'utf8'));
    const graded = applyLimits(
      gradeAtlasRun({
        key: caseData.key,
        copy: dir,
        report: saved.report ?? null,
        baseline: saved.baseline ?? null,
        fixtureDir: caseData.fixtureDir,
        agentError: saved.agent_error ?? null,
      }),
      caseData.limits,
      saved.totals,
    );
    const record = makeRecord({
      caseData,
      run: 1,
      hash,
      opts,
      graded,
      result: { report: saved.report ?? null, permission_mode: saved.permission_mode ?? null },
      totals: saved.totals,
      agentError: saved.agent_error ?? null,
      copy: dir,
    });
    console.log(JSON.stringify(consoleView(record)));
    process.exitCode = printSummary([record], opts.modelLabel, hash, opts.agent) === 1 ? 0 : 1;
    return;
  }

  if (setupOnly) {
    const setup = setupCopy({ fixtureDir: caseData.fixtureDir, setup: caseData.setup });
    console.log(setup.copy);
    console.error(`setup: ${caseData.setup}; the folder is kept, no agent was run`);
    process.exitCode = 0;
    return;
  }

  const records = [];
  for (let run = 1; run <= opts.runs; run++) {
    const one = runOnce(caseData, opts);
    const record = makeRecord({
      caseData,
      run,
      hash,
      opts,
      graded: one.graded,
      result: one.result,
      totals: one.totals,
      agentError: one.agentError,
      copy: opts.keep ? one.setup.copy : null,
    });
    if (opts.keep) {
      const runFile = path.join(one.setup.tmp, 'run.json');
      fs.writeFileSync(
        runFile,
        `${JSON.stringify({
          report: one.result.report,
          permission_mode: one.result.permission_mode,
          baseline: one.setup.baseline,
          totals: one.totals,
          agent_error: one.agentError,
        }, null, 2)}\n`,
      );
      console.error(`kept: ${one.setup.copy} (run.json beside it)`);
    } else {
      fs.rmSync(one.setup.tmp, { recursive: true, force: true });
    }
    appendResult(resultName(caseData), record);
    console.log(JSON.stringify(consoleView(record)));
    records.push(record);
  }
  process.exitCode = printSummary(records, opts.modelLabel, hash, opts.agent) === records.length ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 2;
  }
}
