#!/usr/bin/env node
// Runs one new-campaign case end to end: creates an empty folder, runs the
// new-campaign process with `claude -p` (the master's answers are in the case
// prompt), grades what the agent left in the folder against the case's
// expected values, and appends one JSON line per run to
// testbench/results/<case>.jsonl.
//
// Usage: node testbench/runners/run-new-campaign-case.mjs <caseDir> [--runs N] [--model haiku] [--keep] [--agent claude]
//        node testbench/runners/run-new-campaign-case.mjs <caseDir> --grade-only <dir>
// --grade-only grades a kept folder again without running the agent, prints the
// record and does not append it to the results file. With --keep, the agent's
// final message and cost are saved beside the kept folder as <dir>.run.json so that
// --grade-only can reproduce the record. An optional top-level `seed` mapping in
// case.yaml (name, language, register, world, description) makes each run start
// from a campaign already created by init-campaign.mjs, so the case is a resume.
// Exit codes: 0 every run passes; 1 some run fails; 2 the case cannot be used.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  REPO_ROOT,
  appendResult,
  instructionsHash,
  listFiles,
  loadYamlMapping,
  parseCommonArgs,
  prepareEmpty,
  printSummary,
  recordHeader,
  runAgent,
} from './lib/case-common.mjs';
import { validateConfig } from '../../yllir/scripts/lib/config.mjs';
import { checkFingerprints } from '../../yllir/scripts/lib/instructions.mjs';
import { checkLinks } from '../../yllir/scripts/lib/links/check-links.mjs';
import { parseFrontmatter } from '../../yllir/scripts/lib/frontmatter.mjs';
import { analyzeMarkdown } from '../../yllir/scripts/lib/zones.mjs';

const USAGE =
  'usage: node testbench/runners/run-new-campaign-case.mjs <caseDir> [--runs N] [--model haiku] [--keep] [--agent claude] [--grade-only <dir>]';
const AGENT_TIMEOUT_MS = 1800000;
const LEXICON = path.join(REPO_ROOT, 'yllir', 'skills', 'core', 'yllir', 'lexicon.md');
const AGENT_FILE = '.campaign/instructions/agent.md';
const CUSTOMIZATIONS_FILE = '.campaign/customizations.md';
const REVIEW_FILE = '.campaign/state/write/review.json';
const TOP_LEVEL_FIXED = ['campaign.yaml', 'CLAUDE.md', 'AGENTS.md'];
// Non-line blocks whose text is not prose: never scanned for proper nouns.
const NON_PROSE_BLOCKS = new Set(['fence-open', 'fence-close', 'code', 'mermaid', 'comment', 'master-open', 'master-close']);

function loadCase(caseDir) {
  const data = loadYamlMapping(path.join(caseDir, 'case.yaml'));
  for (const field of ['case', 'prompt']) {
    if (typeof data[field] !== 'string') throw new Error(`case.yaml: ${field} missing`);
  }
  if (data.expected === null || typeof data.expected !== 'object' || Array.isArray(data.expected)) {
    throw new Error('case.yaml: expected must be a mapping');
  }
  const e = data.expected;
  for (const field of ['name', 'language', 'register', 'world', 'world_file', 'version_message']) {
    if (typeof e[field] !== 'string') throw new Error(`case.yaml: expected.${field} missing`);
  }
  for (const field of ['premise_words', 'allowed_proper_nouns']) {
    if (!Array.isArray(e[field])) throw new Error(`case.yaml: expected.${field} must be a list`);
  }
  if (data.seed !== undefined) {
    if (data.seed === null || typeof data.seed !== 'object' || Array.isArray(data.seed)) {
      throw new Error('case.yaml: seed must be a mapping');
    }
    for (const [key, value] of Object.entries(data.seed)) {
      if (typeof value !== 'string') throw new Error(`case.yaml: seed.${key} must be a string`);
    }
  }
  return data;
}

/** The init-campaign.mjs flags for the seed values that are present, in a fixed order. */
const SEED_FLAGS = [
  ['name', '--name'],
  ['language', '--language'],
  ['register', '--register'],
  ['world', '--world'],
  ['description', '--description'],
];

/** Creates the seed campaign in dir with the framework's init script. Throws when it is refused. */
function applySeed(dir, seed) {
  const args = [path.join(REPO_ROOT, 'yllir', 'skills', 'core', 'new-campaign', 'scripts', 'init-campaign.mjs'), dir];
  for (const [key, flag] of SEED_FLAGS) {
    if (seed[key] !== undefined) args.push(flag, seed[key]);
  }
  try {
    execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const output = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim();
    throw new Error(`seed: init-campaign.mjs failed (exit ${err.status}): ${output}`);
  }
}

/** The files that define the process under test: skills, agents, templates, hooks and scripts (no tests). */
function instructionFiles() {
  const yllir = path.join(REPO_ROOT, 'yllir');
  const files = ['skills', 'agents', 'templates', 'hooks'].flatMap((dir) => listFiles(path.join(yllir, dir)));
  files.push(...listFiles(path.join(yllir, 'scripts'), { scriptsOnly: true }));
  return [...new Set(files)].filter((file) => !path.basename(file).startsWith('.'));
}

/** Reads a file as text, or returns null when it is missing. */
function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Runs git in dir and returns stdout. Throws when git fails. */
function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * The words the master must never see, from the "Never say" section of lexicon.md.
 * The parenthetical examples and the description «terminal command names» are not words.
 */
function neverSayWords() {
  const text = readText(LEXICON);
  if (text === null) throw new Error(`cannot read ${LEXICON}`);
  const start = text.indexOf('## Never say');
  if (start < 0) throw new Error('lexicon.md: "Never say" section missing');
  const rest = text.slice(start + '## Never say'.length);
  const next = rest.search(/^## /m);
  const section = (next < 0 ? rest : rest.slice(0, next)).trim();
  const paragraph = section.split('\n\n')[0].replace(/\([^)]*\)/g, '');
  const list = paragraph.slice(paragraph.indexOf(':') + 1).replace(/\.\s*$/, '');
  const words = list
    .split(',')
    .map((item) => item.trim().replace(/^and\s+/, '').trim())
    .filter((item) => item !== '' && !/terminal command/i.test(item));
  if (words.length === 0) throw new Error('lexicon.md: no words in "Never say"');
  return words;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when word occurs in text as a whole word, case-insensitive. */
function containsWord(text, word) {
  return new RegExp(`(?<![\\p{L}\\p{N}_-])${escapeRegExp(word)}(?![\\p{L}\\p{N}_-])`, 'iu').test(text);
}

/**
 * Capitalised words that are not the first word of a sentence, line or list item,
 * and that are neither allowed nor in the case prompt. The word pattern is the one
 * of the brief, with a Unicode-aware start boundary instead of the ASCII \b.
 */
function inventedProperNouns(prose, allowed, prompt) {
  const invented = new Set();
  for (const line of prose) {
    const stripped = line.replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, '');
    for (const match of stripped.matchAll(/(?<![\p{L}\p{N}])\p{Lu}\p{Ll}+/gu)) {
      // Text before the word, without markup and spaces: empty or ending a sentence means first word.
      const before = stripped.slice(0, match.index).replace(/[\s_*«»"'“”(\[>]+$/u, '');
      if (before === '' || /[.!?…]$/.test(before)) continue;
      const word = match[0];
      if (allowed.has(word) || prompt.includes(word)) continue;
      invented.add(word);
    }
  }
  return [...invented];
}

/** Grades the world document (check B2): frontmatter, headings, italic line, premise words, proper nouns. */
function gradeWorldDocument(dir, expected, prompt) {
  const reasons = [];
  const text = readText(path.join(dir, expected.world_file));
  if (text === null) return { ok: false, reasons: [`${expected.world_file} does not exist`] };

  const fm = parseFrontmatter(text);
  if (fm.data === null || fm.data.id !== 'selvaria') reasons.push(`frontmatter id is ${fm.data ? fm.data.id : 'missing'}`);
  if (fm.errors.length > 0) reasons.push(`frontmatter errors: ${fm.errors.map((e) => e.message).join('; ')}`);

  const { lines } = analyzeMarkdown(fm.body, fm.bodyStartLine);
  const h1 = lines.filter((l) => l.block === 'heading' && l.level === 1);
  if (h1.length !== 1 || h1[0].headingText !== expected.world) {
    reasons.push(`level-1 headings: ${h1.map((l) => l.headingText).join(' | ') || 'none'} (want exactly ${expected.world})`);
  }
  if (!lines.some((l) => l.block === 'heading' && l.level === 2)) reasons.push('no level-2 heading');

  const italic = /^(?:_[^_\s](?:[^_]*[^_\s])?_|\*[^*\s](?:[^*]*[^*\s])?\*)$/;
  if (!lines.some((l) => l.block === 'paragraph' && italic.test(l.text.trim()))) {
    reasons.push('no italic paragraph line');
  }

  const bodyLower = fm.body.toLowerCase();
  const missingWords = expected.premise_words.filter((w) => !bodyLower.includes(String(w).toLowerCase()));
  if (missingWords.length > 0) reasons.push(`premise words missing: ${missingWords.join(', ')}`);

  const prose = lines.filter((l) => !NON_PROSE_BLOCKS.has(l.block)).map((l) => l.text);
  const allowed = new Set(expected.allowed_proper_nouns.map(String));
  const invented = inventedProperNouns(prose, allowed, prompt);
  if (invented.length > 0) reasons.push(`invented proper nouns: ${invented.join(', ')}`);

  return { ok: reasons.length === 0, reasons };
}

/** Runs git in dir without throwing: the result, or null on failure. */
function tryGit(dir, args) {
  try {
    return git(dir, args);
  } catch {
    return null;
  }
}

/**
 * Grades the folder left by the agent. Checks B1 to B8 as defined in the brief;
 * a check that cannot run counts as failed, with its reason in failures.
 */
function gradeCase({ caseData, dir, report }) {
  const expected = caseData.expected;
  const checks = {};
  const failures = [];
  const record = (id, ok, reasons) => {
    checks[id] = ok === true;
    if (!ok) failures.push(`${id} ${reasons.length > 0 ? reasons.join('; ') : 'failed'}`);
  };

  // B1 settings.
  {
    const reasons = [];
    const config = validateConfig(dir);
    if (!config.ok) reasons.push(`validateConfig: ${[...config.errors].map((e) => e.message).join('; ')}`);
    const c = config.config ?? {};
    const want = [
      ['campaign.name', c.campaign?.name, expected.name],
      ['language.main', c.language?.main, expected.language],
      ['prose.register', c.prose?.register, expected.register],
      ['system.adapter', c.system?.adapter, 'none'],
    ];
    for (const [key, got, value] of want) {
      if (got !== value) reasons.push(`${key} is ${got} (want ${value})`);
    }
    if (c.campaign?.world !== undefined && c.campaign.world !== expected.world) {
      reasons.push(`campaign.world is ${c.campaign.world} (want ${expected.world} or absent)`);
    }
    record('B1', reasons.length === 0, reasons);
  }

  // B2 world document.
  {
    const world = gradeWorldDocument(dir, expected, caseData.prompt);
    record('B2', world.ok, world.reasons);
  }

  // B3 instructions.
  {
    const reasons = [];
    for (const file of ['CLAUDE.md', 'AGENTS.md']) {
      const text = readText(path.join(dir, file));
      if (text === null) reasons.push(`${file} missing`);
      else if (!text.includes(AGENT_FILE)) reasons.push(`${file} does not contain ${AGENT_FILE}`);
    }
    if (readText(path.join(dir, AGENT_FILE)) === null) reasons.push(`${AGENT_FILE} missing`);
    try {
      const fingerprints = checkFingerprints(dir);
      if (!fingerprints.ok) {
        reasons.push(`fingerprints: ${fingerprints.missing_version_file ? 'version file missing' : `changed ${fingerprints.changed.join(', ')}`}`);
      }
    } catch (err) {
      reasons.push(`checkFingerprints threw: ${err.message}`);
    }
    if (!fs.existsSync(path.join(dir, CUSTOMIZATIONS_FILE))) reasons.push(`${CUSTOMIZATIONS_FILE} missing`);
    record('B3', reasons.length === 0, reasons);
  }

  // B4 saved version.
  {
    const reasons = [];
    const count = Number(tryGit(dir, ['rev-list', '--count', 'HEAD'])?.trim());
    if (!(count >= 1)) reasons.push('no commit');
    const status = tryGit(dir, ['status', '--porcelain']);
    if (status === null) reasons.push('git status failed');
    else if (status.trim() !== '') reasons.push(`git status not empty: ${status.trim().split('\n').join(' | ')}`);
    const subject = tryGit(dir, ['log', '-1', '--format=%s']);
    const message = tryGit(dir, ['log', '-1', '--format=%B']);
    if (message === null || subject === null) {
      reasons.push('no newest commit message');
    } else {
      if (subject.trimEnd() !== expected.version_message) {
        reasons.push(`newest commit subject is «${subject.trimEnd()}» (want «${expected.version_message}»)`);
      }
      if (!message.includes('Yllir-Kind: framework')) reasons.push('newest commit lacks Yllir-Kind: framework');
    }
    record('B4', reasons.length === 0, reasons);
  }

  // B5 links.
  {
    const reasons = [];
    try {
      const links = checkLinks(dir);
      if (links.errors.length > 0) {
        reasons.push(`${links.errors.length} link errors: ${links.errors.map((e) => `${e.file}:${e.line} ${e.message}`).join('; ')}`);
      }
    } catch (err) {
      reasons.push(`checkLinks threw: ${err.message}`);
    }
    record('B5', reasons.length === 0, reasons);
  }

  // B6 plain words in the final message: no never-say word, no backtick, no version-code-like token.
  let neverSayFound = null;
  let technicalFound = null;
  {
    if (report === null || report === undefined) {
      record('B6', false, ['no final message']);
    } else {
      neverSayFound = neverSayWords().filter((word) => containsWord(report, word));
      const hashes = [...report.matchAll(/(?<![\p{L}\p{N}])[0-9a-f]{7,40}(?![\p{L}\p{N}])/gu)]
        .map((m) => m[0])
        .filter((token) => /\d/.test(token) && /\p{L}/u.test(token));
      technicalFound = [...(report.includes('`') ? ['backtick'] : []), ...hashes];
      const reasons = [];
      if (neverSayFound.length > 0) reasons.push(`never-say words: ${neverSayFound.join(', ')}`);
      if (technicalFound.length > 0) reasons.push(`technical tokens: ${technicalFound.join(', ')}`);
      record('B6', reasons.length === 0, reasons);
    }
  }

  // B7 nothing extra.
  {
    const reasons = [];
    const worldFile = expected.world_file;
    const worldTop = worldFile.split('/')[0];
    const worldDir = path.dirname(worldFile);
    const allowedTop = [...TOP_LEVEL_FIXED, worldTop];
    const top = fs.readdirSync(dir).filter((name) => !name.startsWith('.'));
    const extra = top.filter((name) => !allowedTop.includes(name));
    if (extra.length > 0) reasons.push(`extra top-level entries: ${extra.join(', ')}`);
    const inWorld = fs.existsSync(path.join(dir, worldDir)) ? fs.readdirSync(path.join(dir, worldDir)).sort() : null;
    const want = [path.basename(worldFile)];
    if (inWorld === null) reasons.push(`${worldDir}/ missing`);
    else if (JSON.stringify(inWorld) !== JSON.stringify(want)) reasons.push(`${worldDir}/ holds ${inWorld.join(', ')} (want only ${want[0]})`);
    record('B7', reasons.length === 0, reasons);
  }

  // B8 independent review.
  {
    const reasons = [];
    const text = readText(path.join(dir, REVIEW_FILE));
    if (text === null) {
      reasons.push(`${REVIEW_FILE} missing`);
    } else {
      try {
        const outcome = JSON.parse(text).outcome;
        if (outcome !== 'APPLY') reasons.push(`review outcome is ${outcome}`);
      } catch {
        reasons.push(`${REVIEW_FILE} is not JSON`);
      }
    }
    record('B8', reasons.length === 0, reasons);
  }

  return { checks, pass: Object.values(checks).every(Boolean), failures, neverSayFound, technicalFound };
}

/** Builds the JSONL record of one run. header is recordHeader(opts): the agent and the model. */
function makeRecord({ caseName, run, date, header, hash, permissionMode, agentFailure, agent, graded, copy }) {
  const failures = [...(agentFailure ? [`agent error: ${agentFailure}`] : []), ...graded.failures];
  const record = {
    case: caseName,
    run,
    date,
    ...header,
    instructions_hash: hash,
    permission_mode: permissionMode ?? null,
    pass: graded.pass && !agentFailure,
    checks: graded.checks,
    failures,
    never_say_found: graded.neverSayFound,
    technical_found: graded.technicalFound,
    report: agent ? agent.report : null,
    cost_usd: agent ? agent.cost_usd : null,
    duration_ms: agent ? agent.duration_ms : null,
    num_turns: agent ? agent.num_turns : null,
    denied: agent?.denied ?? [],
    tool_calls: agent?.tool_calls ?? null,
  };
  if (copy !== undefined) record.copy = copy;
  return record;
}

/** The record without the long report text, for the console. */
function consoleView(record) {
  const { report, ...rest } = record;
  return rest;
}

function main() {
  const argv = process.argv.slice(2);
  const opts = parseCommonArgs(argv, USAGE, { valueOptions: ['--grade-only'] });
  const caseData = loadCase(opts.caseDir);
  const hash = instructionsHash(instructionFiles());
  const gradeOnly = opts.values['--grade-only'];
  const header = recordHeader({ agent: opts.agent, modelLabel: opts.modelLabel });

  if (gradeOnly !== undefined) {
    const dir = path.resolve(gradeOnly);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`--grade-only: ${dir} is not a folder`);
    const saved = readText(`${dir}.run.json`);
    const agent = saved === null ? null : JSON.parse(saved);
    const graded = gradeCase({ caseData, dir, report: agent ? agent.report : null });
    const record = makeRecord({
      caseName: caseData.case,
      run: 1,
      date: new Date().toISOString(),
      header,
      hash,
      permissionMode: agent ? agent.permission_mode : null,
      agentFailure: null,
      agent,
      graded,
      copy: dir,
    });
    record.grade_only = true;
    console.log(JSON.stringify(consoleView(record)));
    process.exitCode = printSummary([record], opts.modelLabel, hash, opts.agent) === 1 ? 0 : 1;
    return;
  }

  const summaries = [];
  for (let i = 1; i <= opts.runs; i++) {
    const dir = prepareEmpty();
    const date = new Date().toISOString();
    let record;
    try {
      if (caseData.seed !== undefined) applySeed(dir, caseData.seed);
      const agent = runAgent({
        agent: opts.agent,
        cwd: dir,
        prompt: caseData.prompt,
        model: opts.model,
        modelGiven: opts.modelGiven,
        timeoutMs: AGENT_TIMEOUT_MS,
      });
      const graded = gradeCase({ caseData, dir, report: agent.ok ? agent.report : null });
      record = makeRecord({
        caseName: caseData.case,
        run: i,
        date,
        header,
        hash,
        permissionMode: agent.permission_mode,
        agentFailure: agent.ok ? null : agent.error,
        agent: agent.ok ? agent : null,
        graded,
        copy: opts.keep ? dir : undefined,
      });
      if (opts.keep) {
        fs.writeFileSync(
          `${dir}.run.json`,
          JSON.stringify({ report: agent.report, cost_usd: agent.cost_usd, duration_ms: agent.duration_ms, num_turns: agent.num_turns, denied: agent.denied, tool_calls: agent.tool_calls, permission_mode: agent.permission_mode }),
        );
      }
    } finally {
      if (opts.keep) {
        console.log(`kept run ${i}: ${dir}`);
      } else {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
    appendResult(caseData.case, record);
    console.log(JSON.stringify(consoleView(record)));
    summaries.push(record);
  }

  const passed = printSummary(summaries, opts.modelLabel, hash, opts.agent);
  process.exitCode = passed === summaries.length ? 0 : 1;
}

try {
  main();
} catch (err) {
  console.error(`run-new-campaign-case: ${err.message}`);
  process.exitCode = 2;
}
