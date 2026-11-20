#!/usr/bin/env node
// Runs one atlas case end to end: copies the fixture into a temporary git repository, saves a baseline
// version, builds the setup (none, init or land) through the atlas CLI only, runs the entry point with
// `claude -p` once, and grades what the agent left in the repository against the case's answer key. The
// key is read from cases/atlas/<name>/key.yaml and is never copied into the copy the agent works on.
// The picture the setups use, and the picture any provider call returns, are generated procedurally
// (lib/make-atlas-picture.mjs). The provider is a fake Codex script put first on the PATH and set as
// YLLIR_CODEX_BIN, so no case ever calls a real image service. One JSON line per run is appended to
// testbench/results/atlas-<name>.jsonl.
//
// Usage: node testbench/runners/run-atlas-case.mjs <caseDir> [--runs N] [--model sonnet] [--agent claude] [--keep]
//                                                  [--setup-only]
//        node testbench/runners/run-atlas-case.mjs <caseDir> --grade-only <dir> --run-json <file>
// --setup-only builds the setup, prints the folder and runs nothing (no agent). --keep keeps the copy and
// saves the agent's final message, cost, duration, tool calls and the setup baseline as <tmp>/run.json.
// --grade-only grades a saved run again without running the agent and does not append to the results file.
// Checks by kind: create-asks A1 to A3; update U1 to U5; players P1 to P3; city C1 to C4. L-time and L-calls
// come from the limits. Exit codes: 0 every run passes; 1 some run fails; 2 the case or key cannot be used,
// or the setup fails.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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
import { TOWN_SIZE, writeFakeCodex, writePictures } from './lib/make-atlas-picture.mjs';
import { parseFrontmatter } from '../../yllir/scripts/lib/frontmatter.mjs';
import { generateInstructions } from '../../yllir/scripts/lib/instructions.mjs';
import { ensureRepo, listVersions, saveVersion } from '../../yllir/scripts/lib/versions.mjs';
import { buildWorldIndex } from '../../yllir/scripts/lib/world-graph.mjs';
import { atlasFolder, readAtlas } from '../../yllir/skills/library/atlas/scripts/lib/model.mjs';
import { normalizeText, reservedLinesOf } from '../../yllir/skills/library/atlas/scripts/lib/checks.mjs';
import { loadBase } from '../../yllir/skills/library/atlas/scripts/lib/ops.mjs';
import { pendingPlaces } from '../../yllir/skills/library/atlas/scripts/lib/pending.mjs';
import { sha256Of } from '../../yllir/skills/library/atlas/scripts/lib/image.mjs';
import { stripExitLine } from '../../yllir/scripts/lib/cli-exit.mjs';

const USAGE =
  'usage: node testbench/runners/run-atlas-case.mjs <caseDir> [--runs N] [--model sonnet] [--agent claude] [--keep] [--setup-only] [--grade-only <dir> --run-json <file>]';
const AGENT_TIMEOUT_MS = 1800000;
const FIXTURES = path.join(REPO_ROOT, 'testbench', 'fixtures');
const ATLAS_CLI = path.join(REPO_ROOT, 'yllir', 'skills', 'library', 'atlas', 'scripts', 'atlas.mjs');
const BASE_MESSAGE = 'Creata la campagna «Le ceneri della valle»';
const SETUPS = ['none', 'init', 'land'];
const PICTURES = ['morvalle', 'town'];
const KINDS = ['create-asks', 'update', 'players', 'city'];
const KEY_FIELDS = {
  'create-asks': ['forbidden_words'],
  update: ['new_title'],
  players: ['refuge_file', 'refuge_title'],
  city: ['scope_kinds'],
};
const ITALIAN_RE = /\b(il|che|non|per|sono|della)\b/i;
const DEFAULT_PLAYERS_HTML = path.join('.campaign', 'cache', 'atlas', 'players', 'index.html');
const MASTER_HTML = path.join('.campaign', 'cache', 'atlas', 'master', 'index.html');
const SCOPE = { kind: 'region', places: [], note: 'La valle di Morvalle e Valdaspra, a ovest.' };

// The labels of the land setup, in canvas pixels of the Morvalle picture (400 by 300). Borgo Cenere lies
// on the island (200, 215); the smugglers' refuge is a master-only place on the west side (120, 160).
export const LAND_LABELS = {
  lands: [],
  regions: [],
  nature: [
    {
      id: 'lago-grigio',
      text: 'Lago Grigio',
      x: 205,
      y: 135,
      size: 12,
      provenance: 'document',
      sources: [{ file: 'Mondo/Morvalle/Lago Grigio.md' }],
      visibility: 'public',
    },
  ],
  territories: [],
  places: [
    {
      id: 'borgo-cenere',
      place: 'borgo-cenere',
      x: 200,
      y: 215,
      kind: 'village',
      provenance: 'document',
      sources: [{ file: 'Mondo/Morvalle/Borgo Cenere/Borgo Cenere.md' }],
      visibility: 'public',
    },
    {
      id: 'rifugio-contrabbandieri',
      place: 'rifugio-contrabbandieri',
      x: 120,
      y: 160,
      kind: 'landmark',
      provenance: 'document',
      sources: [{ file: 'Mondo/Morvalle/Rifugio dei Contrabbandieri.md' }],
      visibility: 'master',
    },
  ],
};

// ---------------------------------------------------------------- case and key

/** Reads and checks a key.yaml. Throws on an unknown kind or a missing field. */
export function validateKey(key) {
  if (!KINDS.includes(key.kind)) throw new Error(`key.yaml: kind must be one of ${KINDS.join(', ')}`);
  for (const field of KEY_FIELDS[key.kind]) {
    if (key[field] === undefined) throw new Error(`key.yaml: ${field} missing`);
  }
  for (const field of ['forbidden_words', 'allowed_names', 'scope_kinds']) {
    if (key[field] !== undefined && (!Array.isArray(key[field]) || !key[field].every((item) => typeof item === 'string'))) {
      throw new Error(`key.yaml: ${field} must be a list of strings`);
    }
  }
  return key;
}

/** Reads a case: case.yaml (prompt, setup, picture, runs, limits) and its key.yaml beside it. */
export function loadCase(caseDir) {
  const data = loadYamlMapping(path.join(caseDir, 'case.yaml'));
  for (const field of ['case', 'fixture', 'prompt', 'setup']) {
    if (typeof data[field] !== 'string') throw new Error(`case.yaml: ${field} missing`);
  }
  if (!SETUPS.includes(data.setup)) throw new Error(`case.yaml: setup must be one of ${SETUPS.join(', ')}`);
  const picture = data.picture ?? 'morvalle';
  if (!PICTURES.includes(picture)) throw new Error(`case.yaml: picture must be one of ${PICTURES.join(', ')}`);
  if (data.source_picture !== undefined && typeof data.source_picture !== 'string') {
    throw new Error('case.yaml: source_picture must be a path inside the campaign');
  }
  if (!Number.isInteger(data.runs) || data.runs < 1) throw new Error('case.yaml: runs must be a positive integer');
  const fixtureDir = path.join(FIXTURES, data.fixture, 'campaign');
  if (!fs.existsSync(fixtureDir)) throw new Error(`case.yaml: fixture ${data.fixture} not found`);
  const key = validateKey(loadYamlMapping(path.join(caseDir, 'key.yaml')));
  return {
    ...data,
    picture,
    sourcePicture: data.source_picture ?? null,
    limits: parseLimits(data),
    key,
    fixtureDir,
  };
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

/** The SHA-256 of a file as hex, or null when the file does not exist. */
function sha256OfFile(file) {
  return file !== null && fs.existsSync(file) ? sha256Of(fs.readFileSync(file)) : null;
}

/** The baseline the graders compare with: land.png hash, land lock, saved version count and the master site hash. */
export function setupBaseline(copy) {
  return {
    land_sha256: sha256OfFile(atlasFileOf(copy, 'land.png')),
    land_locked: readAtlas(copy).manifest?.land?.locked === true,
    versions: listVersions(copy, { limit: 500 }).length,
    master_sha256: sha256OfFile(path.join(copy, MASTER_HTML)),
  };
}

/**
 * Builds the land on a copy, through the atlas CLI only: init with the picture as base, derive and lock the
 * land, write one placed village and one master-only place, render the master site, save a version.
 */
function buildLand(copy, dir, picturePath) {
  const scope = writeJsonFile(path.join(dir, 'scope.json'), { scope: SCOPE });
  runAtlas(copy, 'init', scope, '--base', picturePath);
  runAtlas(copy, 'land');
  runAtlas(copy, 'lock', 'land');
  const labels = writeJsonFile(path.join(dir, 'labels.json'), LAND_LABELS);
  runAtlas(copy, 'labels-write', labels);
  runAtlas(copy, 'render');
  saveSetupVersion(copy, 'Atlante: prova di setup.');
  return setupBaseline(copy);
}

/**
 * Copies the fixture into a fresh temporary git repository, optionally puts a picture in the campaign (for
 * example Fonti/citta.png), saves the baseline version and builds the setup. Returns { tmp, copy, baseline,
 * codex } where baseline is null unless the setup is land, and codex is the fake provider script. Remove tmp
 * with fs.rmSync(tmp, { recursive: true, force: true }).
 */
export function setupCopy({ fixtureDir, setup, picture = 'morvalle', sourcePicture = null }) {
  if (!SETUPS.includes(setup)) throw new Error(`setup must be one of ${SETUPS.join(', ')}`);
  if (!PICTURES.includes(picture)) throw new Error(`picture must be one of ${PICTURES.join(', ')}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-case-'));
  try {
    const copy = path.join(tmp, 'campaign');
    fs.cpSync(fixtureDir, copy, { recursive: true });
    const pictures = writePictures(path.join(tmp, 'pictures'));
    const codex = writeFakeCodex(path.join(tmp, 'bin'), pictures[picture]);
    if (sourcePicture !== null) {
      const target = path.join(copy, sourcePicture);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(pictures[picture], target);
    }
    const generated = generateInstructions(copy);
    if (generated.errors.length > 0) throw new Error(`generateInstructions: ${JSON.stringify(generated.errors)}`);
    withIsolatedGit(() => {
      ensureRepo(copy);
      saveVersion(copy, { message: BASE_MESSAGE, kind: 'framework' });
    });
    let baseline = null;
    if (setup === 'init') {
      const scope = writeJsonFile(path.join(tmp, 'scope.json'), { scope: SCOPE });
      runAtlas(copy, 'init', scope, '--base', pictures[picture]);
      saveSetupVersion(copy, 'Atlante: estensione decisa.');
    } else if (setup === 'land') {
      baseline = buildLand(copy, tmp, pictures[picture]);
    }
    return { tmp, copy, baseline, codex };
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

/**
 * Runs fn with the fake Codex folder first on the PATH and its path as YLLIR_CODEX_BIN. Both are restored
 * after fn returns, also when it throws.
 */
export function withFakeProvider(codexPath, fn) {
  const names = ['PATH', 'YLLIR_CODEX_BIN'];
  const saved = names.map((name) => [name, process.env[name]]);
  process.env.PATH = `${path.dirname(codexPath)}${path.delimiter}${process.env.PATH ?? ''}`;
  process.env.YLLIR_CODEX_BIN = codexPath;
  try {
    return fn();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
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

/** The text of every Markdown file of the copy, folded, as one string. */
function campaignText(copy) {
  return walkFiles(copy)
    .filter((file) => file.endsWith('.md'))
    .map((file) => normalizeText(fs.readFileSync(file, 'utf8')))
    .join('\n');
}

/** Absolute path of a file of the atlas folder when it exists, else null (no folder counts as no file). */
function atlasFileOf(copy, fileName) {
  const folder = atlasFolder(copy);
  if (folder === null) return null;
  const file = path.join(copy, folder, fileName);
  return fs.existsSync(file) ? file : null;
}

/** The text of atlas.json as the copy holds it, or null when there is none. */
function atlasManifestText(copy) {
  const file = atlasFileOf(copy, 'atlas.json');
  return file === null ? null : fs.readFileSync(file, 'utf8');
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

/** True when the atlas manifest holds a locked layer. */
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

// ---------------------------------------------------------------- graders by kind

/**
 * Create-asks. A1 is one check with an OR, as the case is written: the final message ends with a question in
 * Italian, or the atlas has no label whose text is absent from the campaign documents and the key's allowed
 * names. A2: no atlas layer is locked. A3: the final message uses none of the forbidden words.
 */
export function createChecks(key, { copy, report }) {
  const allowed = new Set((key.allowed_names ?? []).map((name) => name.trim()));
  const docs = campaignText(copy);
  const invented = atlasNames(copy).filter((name) => {
    const folded = normalizeText(name);
    return folded !== '' && !allowed.has(name.trim()) && !docs.includes(folded);
  });
  const question = endsWithQuestion(report) && ITALIAN_RE.test(report ?? '');
  const forbidden = forbiddenIn(report, key.forbidden_words);
  return [
    check('A1', question || invented.length === 0, `the final message does not end with a question in Italian, and the atlas has labels with no sheet text: ${invented.join(', ')}`),
    check('A2', !anyLocked(copy), 'a layer of the atlas is locked: the atlas was approved without the master'),
    check('A3', forbidden.length === 0, `the final message uses forbidden words: ${forbidden.join(', ')}`),
  ];
}

/**
 * Update (Riva Storta on a locked land): U1 the place sheet exists; U2 land.png is byte-identical to the setup
 * and land.locked is still true; U3 the sheet's place is in labels.places on a land pixel; U4 the place is not
 * pending in the status; U5 a version was saved after the setup.
 */
export function updateChecks(key, { copy, baseline }) {
  const atlas = readAtlas(copy);
  const index = buildWorldIndex(copy);
  const subject = index.subjects.find((s) => s.kind === 'place' && s.title === key.new_title) ?? null;
  const landSha = sha256OfFile(atlasFileOf(copy, 'land.png'));
  const landKept = landSha !== null && landSha === baseline.land_sha256
    && baseline.land_locked === true && atlas.manifest?.land?.locked === true;

  const item = subject === null
    ? undefined
    : (Array.isArray(atlas.labels?.places) ? atlas.labels.places : []).find((p) => p?.place === subject.id);
  const loaded = loadBase(copy);
  const onLand = item !== undefined && loaded.ok && loaded.land !== null
    && Number.isInteger(item.x) && Number.isInteger(item.y)
    && item.x >= 0 && item.y >= 0 && item.x < loaded.base.width && item.y < loaded.base.height
    && loaded.land.data[item.y * loaded.base.width + item.x] === 1;
  const pending = pendingPlaces(copy, atlas, index);
  const versions = listVersions(copy, { limit: 500 }).length;
  return [
    check('U1', subject !== null, `no place sheet titled ${key.new_title}`),
    check('U2', landKept, 'the locked land changed: land.png differs from the setup, or the land is no longer locked'),
    check('U3', onLand, subject === null
      ? 'not checked: no sheet'
      : item === undefined ? `${key.new_title} is not in labels.places` : `${key.new_title} is not on a land pixel`),
    check('U4', subject !== null && !pending.some((p) => p.id === subject.id), `${key.new_title} is still pending on the map`),
    check('U5', versions > baseline.versions, 'no version was saved after the setup'),
  ];
}

/**
 * Players: P1 the players version exists; P2 neither the master-only place name nor a line of the reserved block
 * of its sheet appears in it; P3 the master site is byte-identical to the setup.
 */
export function playersChecks(key, { copy, fixtureDir, baseline }) {
  const html = path.join(copy, DEFAULT_PLAYERS_HTML);
  const masterOk = sha256OfFile(path.join(copy, MASTER_HTML)) !== null
    && sha256OfFile(path.join(copy, MASTER_HTML)) === baseline.master_sha256;
  if (!fs.existsSync(html)) {
    return [
      check('P1', false, `the players version (${DEFAULT_PLAYERS_HTML}) does not exist`),
      check('P2', false, 'not checked: no players version'),
      check('P3', masterOk, 'the master site differs from the setup or was deleted'),
    ];
  }
  const folded = normalizeText(fs.readFileSync(html, 'utf8'));
  const refuge = parseFrontmatter(fs.readFileSync(path.join(fixtureDir, key.refuge_file), 'utf8')).body;
  const secrets = [key.refuge_title, ...reservedLinesOf(refuge)]
    .filter((line) => normalizeText(line) !== '');
  const leaked = secrets.filter((line) => folded.includes(normalizeText(line)));
  return [
    check('P1', true, ''),
    check('P2', leaked.length === 0, `text of the hidden place in the players version: ${leaked.map((l) => l.slice(0, 40)).join('; ')}`),
    check('P3', masterOk, 'the master site differs from the setup or was deleted'),
  ];
}

/**
 * City from a picture: C1 the scope kind is one of the key's kinds; C2 the canvas is the size of the picture the
 * campaign holds; C3 land.png exists; C4 the atlas CLI validate exits 0.
 */
export function cityChecks(key, { copy }) {
  const text = atlasManifestText(copy);
  let manifest = null;
  try {
    manifest = text === null ? null : JSON.parse(text);
  } catch {
    manifest = null;
  }
  const kind = manifest?.scope?.kind ?? null;
  const canvas = manifest?.canvas ?? null;
  const sized = canvas?.width === TOWN_SIZE.width && canvas?.height === TOWN_SIZE.height;
  const { status, problems } = validateCli(copy);
  return [
    check('C1', key.scope_kinds.includes(kind), `the scope kind is ${kind}, not one of ${key.scope_kinds.join(', ')}`),
    check('C2', sized, `the canvas is ${canvas ? `${canvas.width}x${canvas.height}` : 'missing'}, not ${TOWN_SIZE.width}x${TOWN_SIZE.height}`),
    check('C3', atlasFileOf(copy, 'land.png') !== null, 'land.png is missing'),
    check('C4', status === 0, `validate exit ${status}: ${(problems ?? []).map((p) => p.code).join(', ')}`),
  ];
}

/** Grades one run. agentError is the first error of an agent that did not finish: such a run fails without checks. */
export function gradeAtlasRun({ key, copy, report, baseline, fixtureDir, agentError = null }) {
  if (agentError !== null) return { checks: {}, failures: [`agent: ${agentError}`], pass: false };
  switch (key.kind) {
    case 'create-asks':
      return finish(createChecks(key, { copy, report }));
    case 'update':
      return finish(updateChecks(key, { copy, baseline }));
    case 'players':
      return finish(playersChecks(key, { copy, fixtureDir, baseline }));
    case 'city':
      return finish(cityChecks(key, { copy }));
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
  const setup = setupCopy({
    fixtureDir: caseData.fixtureDir,
    setup: caseData.setup,
    picture: caseData.picture,
    sourcePicture: caseData.sourcePicture,
  });
  const result = withFakeProvider(setup.codex, () => runAgent({
    agent: opts.agent,
    cwd: setup.copy,
    prompt: caseData.prompt,
    model: opts.model,
    timeoutMs: AGENT_TIMEOUT_MS,
  }));
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
    const setup = setupCopy({
      fixtureDir: caseData.fixtureDir,
      setup: caseData.setup,
      picture: caseData.picture,
      sourcePicture: caseData.sourcePicture,
    });
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
