#!/usr/bin/env node
// Runs one entry-point case end to end on an existing campaign. The setup is
// deterministic: it copies the morvalle fixture campaign into a temporary folder,
// generates the instructions, saves version 1, changes one card (Teodo Marr) and
// saves version 2. Then `claude -p` runs the entry point with the case prompt
// (the master's message), and the runner grades what the agent left in the folder.
// One JSON line per run is appended to testbench/results/<case>.jsonl.
//
// Usage: node testbench/runners/run-entry-case.mjs <caseDir> [--runs N] [--model haiku] [--keep]
//        node testbench/runners/run-entry-case.mjs <caseDir> --setup-only
//        node testbench/runners/run-entry-case.mjs <caseDir> --grade-only <dir> --run-json <file>
// --setup-only runs the setup, prints the folder, the two versions and the git log,
// and keeps the folder. With --keep, the folder is kept and the agent's final message,
// cost and the setup values are saved beside it as <dir>.run.json; --grade-only with
// --run-json grades a kept folder again without running the agent and does not
// append the record to the results file.
// Exit codes: 0 every run passes; 1 some run fails; 2 the case cannot be used.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  REPO_ROOT,
  appendResult,
  instructionsHash,
  listFiles,
  loadYamlMapping,
  parseCommonArgs,
  printSummary,
  runClaude,
} from './lib/case-common.mjs';
import { generateInstructions } from '../../yllir/scripts/lib/instructions.mjs';
import { ensureRepo, listVersions, saveVersion } from '../../yllir/scripts/lib/versions.mjs';
import { checkLinks } from '../../yllir/scripts/lib/check-links.mjs';
import { listTopics, readSection } from '../../yllir/scripts/lib/topics.mjs';
import { buildSubjectIndex, compareStrings } from '../../yllir/scripts/lib/subjects.mjs';
import { parseFrontmatter } from '../../yllir/scripts/lib/frontmatter.mjs';
import { analyzeMarkdown } from '../../yllir/scripts/lib/zones.mjs';
import { foldForm } from '../../yllir/scripts/lib/fold.mjs';

const USAGE =
  'usage: node testbench/runners/run-entry-case.mjs <caseDir> [--runs N] [--model haiku] [--keep] [--setup-only] [--grade-only <dir> --run-json <file>]';
const ALLOWED_TOOLS = 'Bash(node:*) Bash(mkdir:*) Bash(pwd) Bash(echo:*) Bash(test:*) Bash(cat:*) Read Write Grep Glob Agent Skill';
const AGENT_TIMEOUT_MS = 1800000;
const FIXTURE = path.join(REPO_ROOT, 'testbench', 'fixtures', 'morvalle', 'campaign');
const LEXICON = path.join(REPO_ROOT, 'yllir', 'skills', 'core', 'yllir', 'lexicon.md');
const TEODO = path.join('Personaggi', 'Teodo Marr.md');
const TEODO_OLD = 'Porta sempre con sé la Lanterna di Morvalle, anche quando dorme.';
const TEODO_NEW = 'Porta sempre con sé la Lanterna di Morvalle e una chiave di ferro.';
const V1_MESSAGE = 'Creata la campagna «Le ceneri della valle»';
const V2_MESSAGE = 'Aggiornata la scheda di Teodo Marr';
const REQUIRED_VERSIONS = 2;

// ---------------------------------------------------------------- setup

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

/**
 * Builds a fresh copy of the fixture with two saved versions.
 * Returns { tmp, dir, v1, v2, teodoV1Text }. Throws when the setup cannot be made;
 * the temporary folder is removed in that case.
 */
function setupTwoVersions() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-case-'));
  try {
    const dir = path.join(tmp, 'campaign');
    fs.cpSync(FIXTURE, dir, { recursive: true });
    return withIsolatedGit(() => {
      const generated = generateInstructions(dir);
      if (generated.errors.length > 0) {
        throw new Error(`generateInstructions: ${JSON.stringify(generated.errors)}`);
      }
      ensureRepo(dir);
      const v1 = saveVersion(dir, { message: V1_MESSAGE, kind: 'framework' });
      if (!v1.saved) throw new Error('setup: version 1 was not saved');

      const teodoPath = path.join(dir, TEODO);
      const teodoV1Text = fs.readFileSync(teodoPath, 'utf8');
      if (teodoV1Text.split(TEODO_OLD).length - 1 !== 1) {
        throw new Error(`setup: the line to change is not found exactly once in ${TEODO}`);
      }
      fs.writeFileSync(teodoPath, teodoV1Text.replace(TEODO_OLD, TEODO_NEW));
      const v2 = saveVersion(dir, { message: V2_MESSAGE, kind: 'framework' });
      if (!v2.saved) throw new Error('setup: version 2 was not saved');

      const versions = listVersions(dir);
      if (versions.length !== REQUIRED_VERSIONS) {
        throw new Error(`setup: ${versions.length} versions instead of ${REQUIRED_VERSIONS}`);
      }
      return { tmp, dir, v1: v1.hash, v2: v2.hash, teodoV1Text };
    });
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

// ---------------------------------------------------------------- case files

const CASES = [
  'entry-go-back',
  'entry-where-and-question',
  'entry-not-available',
  'entry-prepare-proceed',
  'entry-prepare-two-turns',
];

function loadCase(caseDir) {
  const data = loadYamlMapping(path.join(caseDir, 'case.yaml'));
  for (const field of ['case', 'prompt']) {
    if (typeof data[field] !== 'string') throw new Error(`case.yaml: ${field} missing`);
  }
  if (data.reply !== undefined && typeof data.reply !== 'string') throw new Error('case.yaml: reply must be a string');
  if (!CASES.includes(data.case)) throw new Error(`case.yaml: unknown case ${data.case}`);
  return data;
}

/** The files that define the process under test (same set as the new-campaign runner). */
function instructionFiles() {
  const yllir = path.join(REPO_ROOT, 'yllir');
  const files = ['skills', 'agents', 'templates', 'hooks'].flatMap((dir) => listFiles(path.join(yllir, dir)));
  files.push(...listFiles(path.join(yllir, 'scripts'), { scriptsOnly: true }));
  return [...new Set(files)].filter((file) => !path.basename(file).startsWith('.'));
}

// ---------------------------------------------------------------- grading helpers

/** Runs git in dir without throwing: stdout, or null on failure. */
function tryGit(dir, args) {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
}

/** Exit code of a git command (0 means true for is-ancestor), or -1 when git cannot run. */
function gitExitCode(dir, args) {
  try {
    execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    return 0;
  } catch (err) {
    return typeof err.status === 'number' ? err.status : -1;
  }
}

/** The words the master must never see, from the "Never say" section of lexicon.md. */
function neverSayWords() {
  const text = fs.readFileSync(LEXICON, 'utf8');
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

/** Typographic apostrophes become ASCII, so that «com'era» matches either way; the text is lower-cased. */
function normalized(text) {
  return text.replace(/[’‘]/g, "'").toLowerCase();
}

/**
 * Check B6 of the new-campaign runner, for the final message: no never-say word,
 * no backtick, no version-code-like token. Returns the findings.
 */
function plainWords(report) {
  const neverSayFound = neverSayWords().filter((word) => containsWord(report, word));
  const technicalFound = [
    ...(report.includes('`') ? ['backtick'] : []),
    ...[...report.matchAll(/(?<![\p{L}\p{N}])[0-9a-f]{7,40}(?![\p{L}\p{N}])/gu)]
      .map((m) => m[0])
      .filter((token) => /\d/.test(token) && /\p{L}/u.test(token)),
  ];
  const reasons = [];
  if (neverSayFound.length > 0) reasons.push(`never-say words: ${neverSayFound.join(', ')}`);
  if (technicalFound.length > 0) reasons.push(`technical tokens: ${technicalFound.join(', ')}`);
  return { ok: reasons.length === 0, reasons, neverSayFound, technicalFound };
}

/** The no-write checks (W1, N1): two versions, nothing changed. */
function noWriteCheck(dir) {
  const reasons = [];
  const count = Number(tryGit(dir, ['rev-list', '--count', 'HEAD'])?.trim());
  if (count !== 2) reasons.push(`commit count is ${Number.isNaN(count) ? 'unknown' : count} (want 2)`);
  const status = tryGit(dir, ['status', '--porcelain']);
  if (status === null) reasons.push('git status failed');
  else if (status.trim() !== '') reasons.push(`git status not empty: ${status.trim().split('\n').join(' | ')}`);
  return reasons;
}

// ---------------------------------------------------------------- prepare-session cases

const PREPARE_CASES = ['entry-prepare-proceed', 'entry-prepare-two-turns'];
const PREPARE_FILE = 'Trama/La cenere che canta/Sessione 4.md';
const PREPARE_ID = 'la-cenere-che-canta-04';
const PREPARE_DEPENDS = ['la-cenere-che-canta-03'];
const PREPARE_LOCATION = 'lago-grigio';
const PREPARE_SUBJECT = 'Preparata la sessione «Sessione 4»';
const PREPARE_PROTECTED = ['Personaggi/', 'Creature/', 'Oggetti/', 'Mondo/', 'Storia/'];
const PREPARE_QUESTIONS = 'Questions for the master';
const NOT_INVENTED = ['Successo', 'Fallimento', 'Nota'];

/** A check result as the tuple [id, ok, reasons]. */
const result = (id, reasons) => [id, reasons.length === 0, reasons];

/** Words of a text, folded (lower case, no accents). */
function wordsOf(text) {
  return (text.match(/\p{L}+/gu) ?? []).map((word) => foldForm(word));
}

/** Commit count of the campaign repository, NaN when git fails. */
function commitCount(dir) {
  return Number(tryGit(dir, ['rev-list', '--count', 'HEAD'])?.trim());
}

/** Reasons from the topic handoffs: exactly one topic, process prepare-session, the given status. */
function topicReasons(dir, status) {
  let topics;
  try {
    topics = listTopics(dir);
  } catch (err) {
    return [`listTopics: ${err.message}`];
  }
  if (topics.length !== 1) return [`${topics.length} topics (want 1)`];
  const reasons = [];
  if (topics[0].process !== 'prepare-session') reasons.push(`process is ${topics[0].process}`);
  if (topics[0].status !== status) reasons.push(`status is ${topics[0].status} (want ${status})`);
  return reasons;
}

/** P1 (frontmatter) and P2 (format) of the new session file. */
function sessionFileResults(dir) {
  const file = path.join(dir, PREPARE_FILE);
  if (!fs.existsSync(file)) {
    const missing = [`${PREPARE_FILE} does not exist`];
    return [result('P1', missing), result('P2', missing)];
  }
  const { data, body, errors } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  const p1 = [];
  if (!data) {
    p1.push('no frontmatter');
  } else {
    for (const e of errors) p1.push(`frontmatter line ${e.line}: ${e.message}`);
    if (data.id !== PREPARE_ID) p1.push(`id is ${JSON.stringify(data.id)}`);
    if (JSON.stringify(data.depends_on) !== JSON.stringify(PREPARE_DEPENDS)) {
      p1.push(`depends_on is ${JSON.stringify(data.depends_on)}`);
    }
    if (!Array.isArray(data.location) || !data.location.includes(PREPARE_LOCATION)) {
      p1.push(`location does not include ${PREPARE_LOCATION}`);
    }
  }

  const lines = (body ?? '').split('\n');
  const p2 = [];
  const first = lines.find((line) => line.trim() !== '') ?? '';
  if (!/^# \S/.test(first.trim())) p2.push('the first body line is not a level-1 heading');
  if (!lines.some((line) => /^_[^_].*_$/.test(line.trim()))) p2.push('no italic narration paragraph');
  const hasCheck = lines.some((line, i) => {
    if (!/^###\s/.test(line)) return false;
    const next = lines.slice(i + 1, i + 7);
    return next.some((l) => l.includes('**Successo:**')) && next.some((l) => l.includes('**Fallimento:**'));
  });
  if (!hasCheck) p2.push('no ### check with Successo and Fallimento within 6 lines');
  return [result('P1', p1), result('P2', p2)];
}

/** P3 (only the session file added since version 2, no protected folder changed), P4 (links), P5 (saved, clean). */
function repoResults(dir, v2) {
  const p3 = [];
  const diff = v2 ? tryGit(dir, ['diff', '--name-status', v2, 'HEAD']) : null;
  if (!v2) {
    p3.push('version 2 is unknown');
  } else if (diff === null) {
    p3.push('git diff failed');
  } else {
    const rows = diff
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => line.split('\t'));
    const pathOf = (row) => row[row.length - 1];
    const added = rows.filter((row) => row[0].startsWith('A')).map(pathOf);
    if (JSON.stringify(added) !== JSON.stringify([PREPARE_FILE])) {
      p3.push(`files added since version 2: ${added.join(', ') || 'none'}`);
    }
    const protectedChanged = rows
      .map(pathOf)
      .filter((p) => PREPARE_PROTECTED.some((prefix) => p.startsWith(prefix)));
    if (protectedChanged.length > 0) p3.push(`protected files changed: ${protectedChanged.join(', ')}`);
  }

  const p4 = [];
  try {
    const { errors } = checkLinks(dir);
    for (const e of errors.slice(0, 5)) p4.push(`${e.file}:${e.line} ${e.code} ${e.message}`);
    if (errors.length > 5) p4.push(`${errors.length - 5} more`);
  } catch (err) {
    p4.push(`checkLinks: ${err.message}`);
  }

  const p5 = [];
  const count = commitCount(dir);
  if (count !== 3) p5.push(`commit count is ${Number.isNaN(count) ? 'unknown' : count} (want 3)`);
  const subject = tryGit(dir, ['log', '-1', '--format=%s']);
  if (subject === null) p5.push('no newest commit');
  else if (subject.trim() !== PREPARE_SUBJECT) p5.push(`newest subject is ${JSON.stringify(subject.trim())}`);
  const body = tryGit(dir, ['log', '-1', '--format=%B']) ?? '';
  if (!body.includes('Yllir-Kind: framework')) p5.push('newest commit lacks Yllir-Kind: framework');
  const status = tryGit(dir, ['status', '--porcelain']);
  if (status === null) p5.push('git status failed');
  else if (status.trim() !== '') p5.push(`git status not empty: ${status.trim().split('\n').join(' | ')}`);

  return [result('P3', p3), result('P4', p4), result('P5', p5)];
}

/** P9: the write review of the session says APPLY. */
function reviewResult(dir) {
  const file = path.join(dir, '.campaign', 'state', 'write', 'review.json');
  try {
    const review = JSON.parse(fs.readFileSync(file, 'utf8'));
    const reasons = review.outcome === 'APPLY' ? [] : [`review outcome is ${JSON.stringify(review.outcome)}`];
    return result('P9', reasons);
  } catch (err) {
    return result('P9', [`review.json: ${err.message}`]);
  }
}

/** Reasons why the topic does not hold an open question: one active topic with a non-empty, not "none", question section. */
function openQuestionReasons(dir) {
  const reasons = topicReasons(dir, 'active');
  if (reasons.length === 0) {
    try {
      const section = readSection(dir, { id: listTopics(dir)[0].id, section: PREPARE_QUESTIONS }).trim();
      if (section === '' || section.toLowerCase() === 'none') reasons.push('Questions for the master is empty or none');
    } catch (err) {
      reasons.push(`readSection: ${err.message}`);
    }
  }
  return reasons;
}

/**
 * Path B (conflict asked): nothing written, two commits, and the final message asks the master
 * about the Lino and Oria kinship contradiction. Checks C1 to C3.
 */
function conflictAskedResults(dir, report) {
  const c1 = [];
  const count = commitCount(dir);
  if (count !== 2) c1.push(`commit count is ${Number.isNaN(count) ? 'unknown' : count} (want 2)`);
  if (fs.existsSync(path.join(dir, PREPARE_FILE))) c1.push('the session file exists');

  const c2 = [];
  if (report === null || report === undefined) {
    c2.push('no final message');
  } else if (!report.includes('?')) {
    c2.push('no question mark in the message');
  }
  return [result('C1', c1), result('C2', c2), result('C3', openQuestionReasons(dir))];
}

/** The question the master is asked: the last sentence of the message that contains a question mark, or null. */
function questionText(report) {
  if (report === null || report === undefined) return null;
  const sentence = report
    .split(/(?<=[.!?])\s+/)
    .reverse()
    .find((s) => s.includes('?'));
  return sentence ? sentence.trim() : null;
}

/** Q1 and Q2: graded after the first turn of a two-turn case, before the second turn is run. */
function gradeTurnOne(dir, report) {
  const q1 = [];
  if (commitCount(dir) !== 2) q1.push('commit count is not 2 after the first message');
  if (fs.existsSync(path.join(dir, PREPARE_FILE))) q1.push('the session file exists after the first message');
  if (report === null || report === undefined) {
    q1.push('no final message');
  } else {
    if (!report.includes('?')) q1.push('no question mark in the message');
    if (!normalized(report).includes('giocat')) q1.push('the message does not say that the sessions are not played');
  }

  return [result('Q1', q1), result('Q2', openQuestionReasons(dir))];
}

/** P10, informational only: capitalised words of the session body that no source names. */
function possibleInventedNames(dir, prompt) {
  const file = path.join(dir, PREPARE_FILE);
  if (!fs.existsSync(file)) return null;
  const { body, bodyStartLine } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  const known = new Set([
    ...wordsOf(prompt),
    ...buildSubjectIndex(dir).subjects.flatMap((subject) => subject.forms.flatMap((f) => wordsOf(f.text))),
    ...NOT_INVENTED.map((word) => foldForm(word)),
  ]);
  const found = new Set();
  for (const line of analyzeMarkdown(body, bodyStartLine).lines) {
    if (!['paragraph', 'list', 'quote'].includes(line.block)) continue;
    // Link targets «(…)» after «]» are not words of the text; the frontmatter is not in body.
    const content = line.text.replace(/^\s*(>\s*|[-*+]\s+|\d+[.)]\s+)/, '').replace(/\]\([^)]*\)/g, ']');
    for (const match of content.matchAll(/\p{L}+/gu)) {
      const word = match[0];
      if (word.length < 2 || !/^\p{Lu}/u.test(word)) continue;
      const before = content.slice(0, match.index).replace(/[\s_*«»“”"'’(\[—–-]+$/u, '');
      if (before === '' || /[.!?…:;]$/.test(before)) continue; // first word of a line, sentence or list item
      if (!known.has(foldForm(word))) found.add(word);
    }
  }
  return [...found].sort(compareStrings);
}

// ---------------------------------------------------------------- checks per case

/**
 * Each case has its own checks. A check that cannot run counts as failed.
 * turnOne is { results } from gradeTurnOne for a two-turn case, or null.
 * Returns { checks: { id: bool }, failures: [...], neverSayFound, technicalFound, possibleInventedNames }.
 */
function gradeCase({ caseName, dir, setup, report, prompt = '', turnOne = null, turn1Report = null }) {
  const checks = {};
  const failures = [];
  let plain = null;
  let invented = null;
  let pathTaken = null;
  const record = (id, ok, reasons) => {
    checks[id] = ok === true;
    if (!ok) failures.push(`${id} ${reasons.length > 0 ? reasons.join('; ') : 'failed'}`);
  };
  const noReport = (id) => record(id, false, ['no final message']);
  const finalPlainWords = (id) => {
    if (report === null || report === undefined) return noReport(id);
    plain = plainWords(report);
    record(id, plain.ok, plain.reasons);
  };
  const text = report === null || report === undefined ? '' : normalized(report);

  if (caseName === 'entry-go-back') {
    // E1 restored: the card is byte for byte the version 1 text.
    {
      const current = fs.readFileSync(path.join(dir, TEODO));
      const ok = setup !== null && current.equals(Buffer.from(setup.teodo_v1_text, 'utf8'));
      record('E1', ok, ok ? [] : ['card is not the version 1 text']);
    }
    // E2 history kept: three versions, version 1 and 2 still in history, restore commit, clean tree.
    {
      const reasons = [];
      const count = Number(tryGit(dir, ['rev-list', '--count', 'HEAD'])?.trim());
      if (count !== 3) reasons.push(`commit count is ${Number.isNaN(count) ? 'unknown' : count} (want 3)`);
      for (const [name, hash] of [['version 1', setup?.v1], ['version 2', setup?.v2]]) {
        if (!hash || gitExitCode(dir, ['merge-base', '--is-ancestor', hash, 'HEAD']) !== 0) {
          reasons.push(`${name} is not in the history`);
        }
      }
      const body = tryGit(dir, ['log', '-1', '--format=%B']);
      if (body === null) reasons.push('no newest commit message');
      else if (!body.includes('Yllir-Kind: restore')) reasons.push('newest commit lacks Yllir-Kind: restore');
      const status = tryGit(dir, ['status', '--porcelain']);
      if (status === null) reasons.push('git status failed');
      else if (status.trim() !== '') reasons.push(`git status not empty: ${status.trim().split('\n').join(' | ')}`);
      record('E2', reasons.length === 0, reasons);
    }
    // E3 nothing else changed: the tree equals version 1.
    {
      const diff = setup ? tryGit(dir, ['diff', '--name-only', setup.v1, 'HEAD']) : null;
      const ok = diff !== null && diff.trim() === '';
      record('E3', ok, ok ? [] : [diff === null ? 'git diff failed' : `files differ from version 1: ${diff.trim().split('\n').join(', ')}`]);
    }
    // E4 plain words.
    finalPlainWords('E4');
    // E5 Italian: at least two Italian markers in the final message.
    {
      const markers = [' la ', ' di ', ' è ', ' che ', 'versione'].filter((m) => text.includes(m));
      record('E5', markers.length >= 2, markers.length >= 2 ? [] : [`Italian markers found: ${markers.join(', ') || 'none'}`]);
    }
  } else if (caseName === 'entry-where-and-question') {
    // W1 no writes.
    {
      const reasons = noWriteCheck(dir);
      record('W1', reasons.length === 0, reasons);
    }
    // W2 summary names the newest version's card.
    if (report === null || report === undefined) noReport('W2');
    else record('W2', text.includes('teodo marr'), text.includes('teodo marr') ? [] : ['«Teodo Marr» is not in the final message']);
    // W3 answer names the region of the place.
    if (report === null || report === undefined) noReport('W3');
    else {
      const ok = text.includes('morvalle') || text.includes('valle');
      record('W3', ok, ok ? [] : ['neither «Morvalle» nor «valle» is in the final message']);
    }
    // W4 plain words.
    finalPlainWords('W4');
  } else if (caseName === 'entry-not-available') {
    // N1 no writes.
    {
      const reasons = noWriteCheck(dir);
      record('N1', reasons.length === 0, reasons);
    }
    // N2 honest: says it is not there yet.
    if (report === null || report === undefined) noReport('N2');
    else {
      const ok = text.includes('non') && ['ancora', 'disponibil', 'versione'].some((w) => text.includes(w));
      record('N2', ok, ok ? [] : ['the final message does not say that this is not available yet']);
    }
    // N3 offers what exists: going back or answering questions.
    if (report === null || report === undefined) noReport('N3');
    else {
      const ok = ['torna', "com'era", 'versione salvata', 'versioni', 'domand'].some((w) => text.includes(w));
      record('N3', ok, ok ? [] : ['the final message does not offer going back or questions']);
    }
    // N4 plain words.
    finalPlainWords('N4');
  } else if (PREPARE_CASES.includes(caseName)) {
    const results = [];
    if (turnOne) results.push(...turnOne.results);
    // Path saved: the session file exists, and P1 to P9 apply. Path conflict-asked: nothing written,
    // and the master is asked about the contradiction (C1 to C3). Either path passes.
    pathTaken = fs.existsSync(path.join(dir, PREPARE_FILE)) ? 'saved' : 'conflict-asked';
    if (pathTaken === 'saved') {
      results.push(...sessionFileResults(dir));
      results.push(...repoResults(dir, setup?.v2 ?? null));
      results.push(result('P8', topicReasons(dir, 'closed')));
      results.push(reviewResult(dir));
      if (caseName === 'entry-prepare-proceed') {
        const reasons =
          report === null || report === undefined
            ? ['no final message']
            : normalized(report).includes('giocat')
              ? []
              : ['the message does not say that the sessions before are not played'];
        results.push(result('P6', reasons));
      }
    } else {
      results.push(...conflictAskedResults(dir, report));
    }
    // P7 covers every message of the case.
    const plainReasons = report === null || report === undefined ? ['no final message'] : [];
    for (const message of [turn1Report, report]) {
      if (message === null || message === undefined) continue;
      plainReasons.push(...plainWords(message).reasons);
    }
    results.push(result('P7', plainReasons));
    plain = report === null || report === undefined ? null : plainWords(report);
    invented = dir && fs.existsSync(dir) ? possibleInventedNames(dir, prompt) : null;
    for (const [id, ok, reasons] of results) record(id, ok, reasons);
  } else {
    throw new Error(`no checks for case ${caseName}`);
  }

  return {
    checks,
    pass: Object.values(checks).every(Boolean),
    failures,
    neverSayFound: plain ? plain.neverSayFound : null,
    technicalFound: plain ? plain.technicalFound : null,
    possibleInventedNames: invented,
    path: pathTaken,
    question: pathTaken === 'conflict-asked' ? questionText(report) : null,
  };
}

// ---------------------------------------------------------------- records

/** Builds the JSONL record of one run. */
function makeRecord({ caseName, run, date, model, hash, agentFailure, agent, graded, copy, gradeOnly }) {
  const failures = [...(agentFailure ? [`agent error: ${agentFailure}`] : []), ...graded.failures];
  const record = {
    case: caseName,
    run,
    date,
    model,
    instructions_hash: hash,
    pass: graded.pass && !agentFailure,
    checks: graded.checks,
    failures,
    never_say_found: graded.neverSayFound,
    technical_found: graded.technicalFound,
    report: agent ? agent.report : null,
    cost_usd: agent ? agent.cost_usd : null,
    duration_ms: agent ? agent.duration_ms : null,
    num_turns: agent ? agent.num_turns : null,
  };
  if (copy !== undefined) record.copy = copy;
  if (gradeOnly) record.grade_only = true;
  if (graded.possibleInventedNames) record.possible_invented_names = graded.possibleInventedNames;
  if (graded.path) record.path = graded.path;
  if (graded.question) record.question = graded.question;
  if (agent && agent.turn1_report !== undefined) record.report_turn_1 = agent.turn1_report;
  return record;
}

/** The record without the long report texts, for the console. */
function consoleView(record) {
  const { report, report_turn_1: reportTurnOne, ...rest } = record;
  return rest;
}

/**
 * Runs the agent for one case in dir. A case with a reply runs a second turn in the same folder
 * (--continue) after the first turn has been graded. Returns { agent, turnOne }: agent is the
 * combined result (cost and duration summed, turn1_report the first message), turnOne the grade
 * of the state after the first turn, or null.
 */
function runAgentTurns({ dir, caseData, model }) {
  const common = { cwd: dir, model, allowedTools: ALLOWED_TOOLS, timeoutMs: AGENT_TIMEOUT_MS };
  const first = runClaude({ ...common, prompt: caseData.prompt });
  if (caseData.reply === undefined) return { agent: first, turnOne: null };
  if (!first.ok) return { agent: { ...first, turn1_report: null }, turnOne: null };

  const turnOne = { results: gradeTurnOne(dir, first.report) };
  const second = runClaude({ ...common, prompt: caseData.reply, continueConversation: true });
  const sum = (a, b) => (a === null || b === null ? null : a + b);
  const agent = {
    ok: second.ok,
    report: second.report,
    cost_usd: sum(first.cost_usd, second.cost_usd),
    duration_ms: sum(first.duration_ms, second.duration_ms),
    num_turns: sum(first.num_turns, second.num_turns),
    error: second.ok ? null : second.error,
    turn1_report: first.report,
  };
  return { agent, turnOne };
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

  if (setupOnly) {
    const setup = setupTwoVersions();
    console.log(`dir: ${setup.dir}`);
    console.log(`version 1: ${setup.v1}`);
    console.log(`version 2: ${setup.v2}`);
    console.log('git log:');
    console.log(tryGit(setup.dir, ['log', '--format=%h %s']) ?? 'git log failed');
    return;
  }

  const gradeOnly = opts.values['--grade-only'];
  if (gradeOnly !== undefined) {
    const runJson = opts.values['--run-json'];
    if (runJson === undefined) throw new Error(`--grade-only needs --run-json <file>\n${USAGE}`);
    const dir = path.resolve(gradeOnly);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`--grade-only: ${dir} is not a folder`);
    const saved = JSON.parse(fs.readFileSync(path.resolve(runJson), 'utf8'));
    const turnOne = Array.isArray(saved.turn_one_results) ? { results: saved.turn_one_results } : null;
    const graded = gradeCase({
      caseName: caseData.case,
      dir,
      setup: saved.setup ?? null,
      report: saved.report ?? null,
      prompt: caseData.prompt,
      turnOne,
      turn1Report: saved.turn1_report ?? null,
    });
    const record = makeRecord({
      caseName: caseData.case,
      run: 1,
      date: new Date().toISOString(),
      model: opts.model,
      hash,
      agentFailure: saved.error ?? null,
      agent: saved.report === null || saved.report === undefined ? null : saved,
      graded,
      copy: dir,
      gradeOnly: true,
    });
    if (caseData.reply !== undefined && turnOne === null) {
      record.note = 'grade-only: the checks of the first turn (Q1, Q2) were not run; they need a run kept with --keep';
    }
    console.log(JSON.stringify(consoleView(record)));
    process.exitCode = printSummary([record], opts.model, hash) === 1 ? 0 : 1;
    return;
  }

  const summaries = [];
  for (let i = 1; i <= opts.runs; i++) {
    const date = new Date().toISOString();
    const setup = setupTwoVersions();
    const dir = setup.dir;
    let record;
    try {
      const { agent, turnOne } = runAgentTurns({ dir, caseData, model: opts.model });
      const graded = gradeCase({
        caseName: caseData.case,
        dir,
        setup: { v1: setup.v1, v2: setup.v2, teodo_v1_text: setup.teodoV1Text },
        report: agent.ok ? agent.report : null,
        prompt: caseData.prompt,
        turnOne,
        turn1Report: agent.turn1_report ?? null,
      });
      record = makeRecord({
        caseName: caseData.case,
        run: i,
        date,
        model: opts.model,
        hash,
        agentFailure: agent.ok ? null : agent.error,
        agent,
        graded,
        copy: opts.keep ? dir : undefined,
      });
      if (opts.keep) {
        fs.writeFileSync(
          `${dir}.run.json`,
          JSON.stringify({
            report: agent.report,
            cost_usd: agent.cost_usd,
            duration_ms: agent.duration_ms,
            num_turns: agent.num_turns,
            error: agent.ok ? null : agent.error,
            setup: { v1: setup.v1, v2: setup.v2, teodo_v1_text: setup.teodoV1Text },
            turn1_report: agent.turn1_report,
            turn_one_results: turnOne ? turnOne.results : undefined,
          }),
        );
      }
    } finally {
      if (opts.keep) {
        console.log(`kept run ${i}: ${dir}`);
      } else {
        fs.rmSync(setup.tmp, { recursive: true, force: true });
      }
    }
    appendResult(caseData.case, record);
    console.log(JSON.stringify(consoleView(record)));
    summaries.push(record);
  }

  const passed = printSummary(summaries, opts.model, hash);
  process.exitCode = passed === summaries.length ? 0 : 1;
}

try {
  main();
} catch (err) {
  console.error(`run-entry-case: ${err.message}`);
  process.exitCode = 2;
}
