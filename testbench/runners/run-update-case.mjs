#!/usr/bin/env node
// Runs one framework-update case end to end on an existing campaign. The setup is
// deterministic: it copies the morvalle-legacy fixture (the campaign before the world-graph migration) into a temporary folder, generates the
// instructions and saves version 1. Then, per scenario:
//   stale-campaign   the campaign was made with an older version (version.yaml is rewound to 0.0.1),
//                    the master has a line in customizations.md and a hand-added line in agent.md,
//                    and the tree is saved. The entry point must update silently.
//   legacy-sessions  the same, and the sessions are in the old layout (Trama/<Arc>/<N>.md with one
//                    `# ` heading per event). The update must convert them to Trama/<N>/<N>.md and
//                    Trama/<N>/Eventi/<event>.md, keep the text of every event and rebuild the links.
//   newer-published  a campaign at the installed version, and a published source (folder named by
//                    YLLIR_PUBLISHED_SOURCE) with a newer version and its news. The master asks a
//                    question; the answer must end with a question about updating and nothing is updated.
//   declined         the same, but the master says «not now». Nothing is updated and the notice is postponed.
// The agent (`claude -p`) runs with the case prompt (the master's
// message), and the runner grades what the agent left in the folder. One JSON line per run is appended
// to testbench/results/<case>.jsonl. The grading helpers are exported and tested offline.
//
// Usage: node testbench/runners/run-update-case.mjs <caseDir> [--runs N] [--model sonnet] [--agent claude] [--keep]
//        node testbench/runners/run-update-case.mjs <caseDir> --setup-only
//        node testbench/runners/run-update-case.mjs <caseDir> --grade-only <dir> --run-json <file>
// --setup-only runs the setup, prints the folders and the git log, and keeps them.
// With --keep, the folder is kept and the agent's final message, cost and the setup values are saved
// beside it as <dir>.run.json; --grade-only with --run-json grades a kept folder again without running
// the agent and does not append the record to the results file.
// Exit codes: 0 every run passes; 1 some run fails; 2 the case cannot be used.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  REPO_ROOT,
  appendResult,
  instructionsHash,
  listFiles,
  loadYamlMapping,
  applyLimits,
  parseCommonArgs,
  parseLimits,
  printSummary,
  recordHeader,
  runAgent,
} from './lib/case-common.mjs';
import { generateInstructions } from '../../yllir/scripts/lib/instructions.mjs';
import { ensureRepo, listVersions, saveManualChanges, saveVersion, status } from '../../yllir/scripts/lib/versions.mjs';
import { checkLinks } from '../../yllir/scripts/lib/links/check-links.mjs';
import { parseYamlLite } from '../../yllir/scripts/lib/yaml-lite.mjs';
import { findMetadataBlock, parseFrontmatter } from '../../yllir/scripts/lib/frontmatter.mjs';
import { listMetadataFiles } from '../../yllir/skills/library/update/scripts/lib/migrate-metadata.mjs';
import { plotMap } from '../../yllir/scripts/lib/plot/plot-map.mjs';

const USAGE =
  'usage: node testbench/runners/run-update-case.mjs <caseDir> [--runs N] [--model sonnet] [--agent claude] [--keep] [--setup-only] [--grade-only <dir> --run-json <file>]';
const AGENT_TIMEOUT_MS = 1800000;
// The legacy copy: the morvalle campaign before the world-graph migration (format of 0.29 and older).
const FIXTURE = path.join(REPO_ROOT, 'testbench', 'fixtures', 'morvalle-legacy', 'campaign');
const LEXICON = path.join(REPO_ROOT, 'yllir', 'skills', 'core', 'yllir', 'lexicon.md');
const PLUGIN_JSON = path.join(REPO_ROOT, 'yllir', '.claude-plugin', 'plugin.json');
const VERSION_PATH = '.campaign/version.yaml';
const AGENT_PATH = '.campaign/instructions/agent.md';
const CUSTOMIZATIONS_PATH = '.campaign/customizations.md';
const UPDATE_PATH = '.campaign/state/update.yaml';
const NOTICE_PATH = '.campaign/state/update-notice.yaml';
const OLD_VERSION = '0.0.1';
const V1_MESSAGE = 'Creata la campagna «Le ceneri della valle»';
const MANUAL_MESSAGE = 'Modifiche a mano prima della prova di aggiornamento';
const MASTER_LINE = 'Il master: «Teodo Marr non parla con gli stranieri prima del tramonto».';
const HAND_MARKER = 'riga-a-mano-4471';
const HAND_LINE = `Regola scritta a mano, da non perdere: ${HAND_MARKER}.`;
const NEWS =
  'La nuova versione rende più precisi i collegamenti tra personaggi e luoghi. ' +
  'Le sessioni già giocate restano come sono, e la tua campagna non cambia da sola.';
const SCENARIOS = ['stale-campaign', 'legacy-sessions', 'newer-published', 'declined'];
const CASE_SCENARIO = {
  'update-stale-campaign': 'stale-campaign',
  'update-legacy-sessions': 'legacy-sessions',
  'update-newer-published': 'newer-published',
  'update-declined': 'declined',
};
// Scenarios whose campaign is rewound to OLD_VERSION and saved with the master's changes.
const REWOUND = ['stale-campaign', 'legacy-sessions'];
const TRAMA = 'Trama';
const EVENT_FOLDER = 'Eventi';
const EVENT_LINK = /\]\(([^)\s]+)\)/;
const UPDATE_SUBJECT = /^Updated Yllir to \S+/;
const ADDED_EVENT_KEYS = /^(provenance|kind):/;
const EXTRA_TECHNICAL_WORDS = ['framework', 'hash', 'fingerprint'];
const ACK_WORDS = ['domani', 'ricord', 'va bene', "d'accordo", 'nessun problema', 'certo', 'perfetto'];
const VERSION_RE = /\b\d+\.\d+\.\d+\b/g;

// ---------------------------------------------------------------- pure helpers

/** Parses and checks case.yaml data. Throws with the reason when the case cannot be used. */
export function parseCaseData(data) {
  for (const field of ['case', 'scenario', 'prompt']) {
    if (typeof data[field] !== 'string' || data[field].trim() === '') throw new Error(`case.yaml: ${field} missing`);
  }
  if (!SCENARIOS.includes(data.scenario)) throw new Error(`case.yaml: unknown scenario ${data.scenario}`);
  if (!(data.case in CASE_SCENARIO)) throw new Error(`case.yaml: unknown case ${data.case}`);
  if (CASE_SCENARIO[data.case] !== data.scenario) {
    throw new Error(`case.yaml: case ${data.case} needs scenario ${CASE_SCENARIO[data.case]}`);
  }
  return data;
}

/** The next minor version of MAJOR.MINOR.PATCH: 0.1.0 becomes 0.2.0. Throws on other input. */
export function nextMinorVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (match === null) throw new TypeError(`not a MAJOR.MINOR.PATCH version: ${version}`);
  return `${match[1]}.${Number(match[2]) + 1}.0`;
}

/** The text with the framework_version line set to version. Every other line stays as it is. */
export function setFrameworkVersion(text, version) {
  const line = /^framework_version: "[^"]*"$/gm;
  const hits = text.match(line) ?? [];
  if (hits.length !== 1) throw new Error(`version.yaml: framework_version line found ${hits.length} times`);
  return text.replace(line, `framework_version: "${version}"`);
}

/** The words the master must never see, from the "Never say" section of lexicon.md (same rule as run-entry-case). */
export function neverSayWords(lexiconText) {
  const start = lexiconText.indexOf('## Never say');
  if (start < 0) throw new Error('lexicon.md: "Never say" section missing');
  const rest = lexiconText.slice(start + '## Never say'.length);
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

/** Typographic apostrophes become ASCII; the text is lower-cased. */
function normalized(text) {
  return text.replace(/[’‘]/g, "'").toLowerCase();
}

/**
 * Technical words in a message to the master: never-say words, the extra words of the
 * spec, backticks, saved-version codes (hexadecimal) and version numbers. Returns the findings.
 */
export function technicalFindings(report, words = neverSayWords(fs.readFileSync(LEXICON, 'utf8'))) {
  const findings = [];
  for (const word of [...words, ...EXTRA_TECHNICAL_WORDS]) {
    if (containsWord(report, word)) findings.push(`word: ${word}`);
  }
  if (report.includes('`')) findings.push('backtick');
  for (const match of report.matchAll(/(?<![\p{L}\p{N}])[0-9a-f]{7,40}(?![\p{L}\p{N}])/gu)) {
    if (/\d/.test(match[0]) && /\p{L}/u.test(match[0])) findings.push(`code: ${match[0]}`);
  }
  for (const match of report.matchAll(VERSION_RE)) findings.push(`version number: ${match[0]}`);
  return findings;
}

/** Paragraphs of a message: blocks separated by blank lines, trimmed, empty ones dropped. */
export function paragraphsOf(text) {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== '');
}

/** True when the text holds a question (a «?») and one of the words aggiorn… */
export function isUpdateQuestion(text) {
  return text.includes('?') && /aggiorn/i.test(text);
}

/** True when any sentence of the message is a question about updating. */
export function asksToUpdate(report) {
  return report
    .split(/(?<=[.!?])\s+|\n+/)
    .some((sentence) => isUpdateQuestion(sentence));
}

/** Reads framework_version from version.yaml text, or null. */
export function frameworkVersionOf(versionText) {
  if (typeof versionText !== 'string') return null;
  const parsed = parseYamlLite(versionText);
  if (parsed.errors.length > 0 || parsed.data === null || typeof parsed.data !== 'object') return null;
  return typeof parsed.data.framework_version === 'string' ? parsed.data.framework_version : null;
}

/** The fields of update-notice.yaml that matter, or null when the file is missing or unreadable. */
export function readNotice(dir) {
  const text = readText(dir, NOTICE_PATH);
  if (text === null) return null;
  const parsed = parseYamlLite(text);
  if (parsed.errors.length > 0 || parsed.data === null || typeof parsed.data !== 'object') return null;
  return {
    last_notified_on: typeof parsed.data.last_notified_on === 'string' ? parsed.data.last_notified_on : null,
    snoozed_until: typeof parsed.data.snoozed_until === 'string' ? parsed.data.snoozed_until : null,
  };
}

/** Today's date as YYYY-MM-DD in the local calendar and in UTC (the two date rules of the framework). */
export function todayDates(now = new Date()) {
  const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const utc = now.toISOString().slice(0, 10);
  return [...new Set([local, utc])];
}

// ---------------------------------------------------------------- grading helpers

/** A check result as the tuple [id, ok, reasons]. */
const result = (id, reasons) => [id, reasons.length === 0, reasons];

function readText(dir, rel) {
  try {
    return fs.readFileSync(path.join(dir, rel), 'utf8');
  } catch {
    return null;
  }
}

/** Runs git in dir without throwing: stdout, or null on failure. */
function tryGit(dir, args) {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
}

/** Number of commits of the campaign, NaN when git fails. */
function commitCount(dir) {
  return Number(tryGit(dir, ['rev-list', '--count', 'HEAD'])?.trim());
}

/** Reasons why the tree is not clean (git status), or none. */
function dirtyReasons(dir) {
  const out = tryGit(dir, ['status', '--porcelain']);
  if (out === null) return ['git status failed'];
  return out.trim() === '' ? [] : [`git status not empty: ${out.trim().split('\n').join(' | ')}`];
}

/** True when version.yaml still holds the text saved at setup. */
function versionUnchanged(dir, setup) {
  return readText(dir, VERSION_PATH) === setup.versionYamlText;
}

/**
 * Metadata check S7: no campaign document still has the metadata block in the old --- form.
 * It checks the files the migration lists, so a document the update left behind is reported by name.
 */
function metadataReasons(dir) {
  const reasons = [];
  for (const rel of listMetadataFiles(dir)) {
    const text = readText(dir, rel);
    if (text === null) continue;
    const lines = text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
    if (findMetadataBlock(lines)?.format === 'dashes') reasons.push(`${rel}: metadata block still in the --- form`);
  }
  return reasons;
}

/** Stale campaign checks S1 to S7: the update ran silently and was saved, the master's text is intact, and the metadata is in the comment form. */
export function gradeStale({ dir, setup, report }) {
  const s1 = [];
  const version = frameworkVersionOf(readText(dir, VERSION_PATH));
  if (version !== setup.installed) s1.push(`framework_version is ${version} (want ${setup.installed})`);

  const s2 = [];
  const agent = readText(dir, AGENT_PATH);
  if (agent === null) s2.push('agent.md is missing');
  else if (agent.includes(setup.marker)) s2.push('the hand-added line is still in agent.md');

  const s3 = [];
  if (readText(dir, CUSTOMIZATIONS_PATH) !== setup.customizationsText) s3.push('customizations.md changed');

  // Every version saved after the setup is a framework version (the update and the migrations it runs),
  // at least one of them is the update itself, and none is a manual one.
  const s4 = [];
  const count = commitCount(dir);
  const saved = count - setup.commits;
  if (Number.isNaN(count) || saved < 1) {
    s4.push(`no version saved after the setup (commit count ${Number.isNaN(count) ? 'unknown' : count}, setup ${setup.commits})`);
  } else {
    let versions = [];
    try {
      versions = listVersions(dir, { limit: saved });
    } catch (err) {
      s4.push(`listVersions: ${err.message}`);
    }
    for (const version of versions) {
      if (version.kind !== 'framework') s4.push(`version "${version.message}" is ${version.kind}, want framework`);
    }
    if (versions.length > 0 && !versions.some((version) => UPDATE_SUBJECT.test(version.message))) {
      s4.push('no version says «Updated Yllir to …»');
    }
  }
  s4.push(...dirtyReasons(dir));

  const s5 = [];
  if (report === null || report === undefined) s5.push('no final message');
  else s5.push(...technicalFindings(report).map((f) => `technical word: ${f}`));

  const s6 = [];
  try {
    const { errors } = checkLinks(dir);
    for (const e of errors.slice(0, 5)) s6.push(`${e.file}:${e.line} ${e.code} ${e.message}`);
  } catch (err) {
    s6.push(`checkLinks: ${err.message}`);
  }
  const s7 = metadataReasons(dir);

  return [result('S1', s1), result('S2', s2), result('S3', s3), result('S4', s4), result('S5', s5), result('S6', s6), result('S7', s7)];
}

/** Newer-published checks N1 to N6: the question is answered, the notice is recorded, nothing is updated. */
export function gradeNewer({ dir, setup, report, todays }) {
  const n1 = [];
  const n2 = [];
  const n3 = [];
  if (report === null || report === undefined) {
    n1.push('no final message');
    n2.push('no final message');
  } else {
    if (!normalized(report).includes('teodo')) n1.push('the final message does not answer the question about Teodo Marr');
    const paragraphs = paragraphsOf(report);
    const last = paragraphs[paragraphs.length - 1] ?? '';
    if (!isUpdateQuestion(last)) n2.push('the last paragraph has no question about updating');
    for (const paragraph of paragraphs.slice(0, -1)) {
      for (const match of paragraph.matchAll(VERSION_RE)) n3.push(`version number outside the last paragraph: ${match[0]}`);
    }
  }

  const n4 = [];
  const notice = readNotice(dir);
  if (notice === null) n4.push('update-notice.yaml is missing or unreadable');
  else if (!todays.includes(notice.last_notified_on)) {
    n4.push(`last_notified_on is ${notice.last_notified_on} (want one of ${todays.join(', ')})`);
  }

  const n5 = [];
  if (!versionUnchanged(dir, setup)) n5.push('version.yaml changed');
  const count = commitCount(dir);
  if (count !== setup.commits) n5.push(`a version was saved (commit count ${count}, want ${setup.commits})`);
  if (readText(dir, UPDATE_PATH) !== null) n5.push('an update was started (update.yaml exists)');

  const n6 = report === null || report === undefined ? ['no final message'] : technicalFindings(report).map((f) => `technical word: ${f}`);
  return [result('N1', n1), result('N2', n2), result('N3', n3), result('N4', n4), result('N5', n5), result('N6', n6)];
}

/** Declined checks D1 to D4: nothing is updated, the master is acknowledged, the update is not asked again. */
export function gradeDeclined({ dir, setup, report }) {
  const d1 = [];
  if (!versionUnchanged(dir, setup)) d1.push('version.yaml changed');
  const count = commitCount(dir);
  if (count !== setup.commits) d1.push(`a version was saved (commit count ${count}, want ${setup.commits})`);

  const d2 = [];
  const d3 = [];
  const d4 = [];
  if (report === null || report === undefined) {
    d2.push('no final message');
    d4.push('no final message');
  } else {
    const text = normalized(report);
    if (!ACK_WORDS.some((word) => text.includes(word))) d2.push('the final message does not acknowledge the postponement');
    if (asksToUpdate(report)) d3.push('the final message asks again to update now');
    d4.push(...technicalFindings(report).map((f) => `technical word: ${f}`));
  }
  return [result('D1', d1), result('D2', d2), result('D3', d3), result('D4', d4)];
}

/** The file name of an event: the characters that cannot be in a file name are removed. */
export function eventFileName(title) {
  return title.replace(/[/\\:*?"<>|]/g, '');
}

/** Campaign-relative path of the main file of a session. */
const mainPath = (session) => `${TRAMA}/${session}/${session}.md`;

/** Campaign-relative path of the file of one event of a session. */
const eventPath = (session, title) => `${TRAMA}/${session}/${EVENT_FOLDER}/${eventFileName(title)}.md`;

/**
 * Lines of the metadata block of a Markdown text, without its delimiters, in either form
 * (the comment form the framework writes, or the old --- form); [] when there is no closed block.
 */
function frontmatterLines(text) {
  const lines = text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  const block = findMetadataBlock(lines);
  if (block === null || block.close === -1) return [];
  return lines.slice(1, block.close);
}

/** The text with every [text](target) replaced by text, trimmed. */
function withoutLinks(text) {
  return text.replace(MARKDOWN_LINK, (whole, label) => label).trim();
}

/** Legacy layout checks L1 to L4 on top of the stale-campaign checks S1 to S7. */
export function gradeLegacy({ dir, setup, report }) {
  const stale = gradeStale({ dir, setup, report });
  const sessions = Object.entries(setup.scenes);

  const l1 = [];
  for (const old of setup.oldFiles) {
    if (fs.existsSync(path.join(dir, old))) l1.push(`old file still there: ${old}`);
  }
  for (const [session, scenes] of sessions) {
    if (!fs.existsSync(path.join(dir, mainPath(session)))) l1.push(`${mainPath(session)} is missing`);
    for (const scene of scenes) {
      if (!fs.existsSync(path.join(dir, eventPath(session, scene.title)))) {
        l1.push(`${eventPath(session, scene.title)} is missing`);
      }
    }
  }

  const l2 = [];
  try {
    const map = plotMap(dir);
    for (const e of map.errors.slice(0, 3)) l2.push(`${e.code} ${e.file}`);
    const ids = map.sessions.map((s) => s.id).sort();
    const want = [...setup.sessionIds].sort();
    if (JSON.stringify(ids) !== JSON.stringify(want)) {
      l2.push(`sessions are ${ids.join(', ') || 'none'} (want ${want.join(', ')})`);
    }
  } catch (err) {
    l2.push(`plotMap: ${err.message}`);
  }

  // A missing event file is reported by L1 only.
  // The engine adds Markdown links and the world migration adds provenance and kind lines.
  const l3 = [];
  for (const [session, scenes] of sessions) {
    for (const scene of scenes) {
      const text = readText(dir, eventPath(session, scene.title));
      if (text === null) continue;
      if (withoutLinks(parseFrontmatter(text).body) !== withoutLinks(scene.body)) l3.push(`${scene.title}: text changed`);
      const kept = frontmatterLines(text).filter((line) => !ADDED_EVENT_KEYS.test(line));
      if (kept.join('\n') !== (scene.frontmatter ?? []).join('\n')) l3.push(`${scene.title}: frontmatter changed`);
    }
  }

  const l4 = [];
  for (const [session, scenes] of sessions) {
    const main = readText(dir, mainPath(session));
    if (main === null) {
      l4.push(`${mainPath(session)} is missing`);
      continue;
    }
    if (!/^generated: true$/m.test(main)) l4.push(`${session}: no generated: true`);
    for (const scene of scenes) {
      const link = `(${EVENT_FOLDER}/${eventFileName(scene.title).replace(/ /g, '%20')}.md)`;
      if (!main.includes(link)) l4.push(`${session}: no link ${link}`);
    }
  }

  return [
    ...stale,
    result('L1', l1),
    result('L2', l2),
    result('L3', l3),
    result('L4', l4),
  ];
}

/**
 * Grades one run of a scenario. Returns { checks, pass, failures, technical_found, notice }:
 * checks maps each check id to a boolean; notice is what update-notice.yaml holds (information only).
 */
export function gradeScenario({ scenario, dir, setup, report, todays }) {
  const grade = {
    'stale-campaign': () => gradeStale({ dir, setup, report }),
    'legacy-sessions': () => gradeLegacy({ dir, setup, report }),
    'newer-published': () => gradeNewer({ dir, setup, report, todays }),
    declined: () => gradeDeclined({ dir, setup, report, todays }),
  }[scenario];
  if (grade === undefined) throw new Error(`no checks for scenario ${scenario}`);
  const checks = {};
  const failures = [];
  for (const [id, ok, reasons] of grade()) {
    checks[id] = ok === true;
    if (!ok) failures.push(`${id} ${reasons.length > 0 ? reasons.join('; ') : 'failed'}`);
  }
  return {
    checks,
    pass: Object.values(checks).every(Boolean),
    failures,
    technical_found: report === null || report === undefined ? null : technicalFindings(report),
    notice: readNotice(dir),
  };
}

// ---------------------------------------------------------------- setup

/** The event names of a session, in the order of the links under its "## Events" heading. */
function eventNamesOf(body) {
  const names = [];
  let inEvents = false;
  for (const line of body.split('\n')) {
    if (line.startsWith('## ')) {
      inEvents = line.trim() === '## Events';
      continue;
    }
    if (!inEvents) continue;
    const match = EVENT_LINK.exec(line);
    if (match !== null) names.push(path.posix.basename(decodeURIComponent(match[1]), '.md'));
  }
  return names;
}

/** Comma-separated items for a flow list in frontmatter. */
const listText = (items) => (Array.isArray(items) ? items : []).join(', ');

const EXTERNAL_LINK = /^[a-z][a-z0-9+.-]*:/i; // http:, https:, mailto:, ...
const MARKDOWN_LINK = /\[([^\]\n]*)\]\(([^)\s]+)\)/g;

/**
 * Rewrites the relative links of a Markdown body so that each one still points to the same file
 * when the body moves from folder fromDir to folder toDir (both campaign-relative, posix). The
 * target keeps its percent-encoding and its #anchor. Links with a scheme, absolute links, pure
 * anchors and everything inside a ``` fenced block are kept as they are.
 */
export function rebaseLinks(body, fromDir, toDir) {
  let fenced = false;
  return body
    .split('\n')
    .map((line) => {
      if (/^\s*```/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      return line.replace(MARKDOWN_LINK, (whole, text, target) => {
        if (EXTERNAL_LINK.test(target) || target.startsWith('/') || target.startsWith('#')) return whole;
        const hash = target.indexOf('#');
        const rawPath = hash < 0 ? target : target.slice(0, hash);
        const anchor = hash < 0 ? '' : target.slice(hash);
        const resolved = path.posix.join(fromDir, rawPath);
        const rel = path.posix.relative(toDir, resolved) || '.';
        return `[${text}](${rel}${anchor})`;
      });
    })
    .join('\n');
}

/**
 * Rewrites every session of Trama/ into the old layout, in place. Each folder Trama/<N>/ becomes
 * the file Trama/<arc>/<N>.md, or Trama/<N>.md when the session has no arc, with only id, depends_on
 * and location in the frontmatter and one "# <event>" block per event, in the order of the "## Events"
 * links. The event links are rebased to the old file's folder (see rebaseLinks), so that they resolve
 * to the same files; the event texts are otherwise kept as they are. The scenes returned for the
 * grading hold the ORIGINAL (new-layout) body, because the migration rebases the links back.
 * Returns { scenes, sessionIds, oldFiles }. Throws when the result is wrong.
 */
export function toLegacyLayout(dir) {
  const tramaDir = path.join(dir, TRAMA);
  const sessions = fs
    .readdirSync(tramaDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(tramaDir, entry.name, `${entry.name}.md`)))
    .map((entry) => entry.name)
    .sort();
  if (sessions.length === 0) throw new Error(`toLegacyLayout: no session in ${TRAMA}/`);

  const layout = { scenes: {}, sessionIds: [], oldFiles: [] };
  for (const session of sessions) {
    const { data, body } = parseFrontmatter(fs.readFileSync(path.join(dir, mainPath(session)), 'utf8'));
    if (data === null || typeof data.id !== 'string') throw new Error(`toLegacyLayout: ${session} has no id`);

    const oldFile = typeof data.arc === 'string' && data.arc !== '' ? `${TRAMA}/${data.arc}/${session}.md` : `${TRAMA}/${session}.md`;
    const oldDir = path.posix.dirname(oldFile);

    const scenes = eventNamesOf(body).map((name) => {
      const text = fs.readFileSync(path.join(dir, TRAMA, session, EVENT_FOLDER, `${name}.md`), 'utf8');
      return { title: name, body: parseFrontmatter(text).body.trim(), frontmatter: frontmatterLines(text) };
    });
    const blocks = scenes.map((scene) => {
      const eventDir = `${TRAMA}/${session}/${EVENT_FOLDER}`;
      const rebased = rebaseLinks(scene.body, eventDir, oldDir);
      if (rebased.split('\n').some((line) => line.startsWith('# '))) {
        throw new Error(`toLegacyLayout: ${scene.title} has a line starting with "# "`);
      }
      return `# ${scene.title}\n\n${rebased}\n\n`;
    });

    const header = ['---', `id: ${data.id}`, `depends_on: [${listText(data.depends_on)}]`, `location: [${listText(data.location)}]`, '---', ''];
    fs.mkdirSync(path.join(dir, oldDir), { recursive: true });
    fs.writeFileSync(path.join(dir, oldFile), `${header.join('\n')}\n${blocks.join('')}`);
    fs.rmSync(path.join(tramaDir, session), { recursive: true, force: true });

    layout.scenes[session] = scenes;
    layout.sessionIds.push(data.id);
    layout.oldFiles.push(oldFile);
  }
  checkLegacyLayout(dir, layout);
  return layout;
}

/** Throws unless the old files exist and the new session folders are gone. */
function checkLegacyLayout(dir, layout) {
  for (const old of layout.oldFiles) {
    if (!fs.existsSync(path.join(dir, old))) throw new Error(`toLegacyLayout: ${old} was not written`);
  }
  for (const session of Object.keys(layout.scenes)) {
    if (fs.existsSync(path.join(dir, mainPath(session))) || fs.existsSync(path.join(dir, TRAMA, session))) {
      throw new Error(`toLegacyLayout: ${TRAMA}/${session} still exists`);
    }
  }
}

/** Runs a function with git's global and system configuration switched off, then restores the environment. */
export function withIsolatedGit(fn) {
  const names = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'];
  const saved = names.map((name) => [name, process.env[name]]);
  const restore = () => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  let result;
  try {
    result = fn();
  } catch (err) {
    restore();
    throw err;
  }
  // A promise (the update is asynchronous) keeps the isolation until it settles.
  if (result && typeof result.then === 'function') return result.finally(restore);
  restore();
  return result;
}

function readInstalledVersion() {
  const version = JSON.parse(fs.readFileSync(PLUGIN_JSON, 'utf8')).version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('plugin.json has no version');
  return version;
}

/** A folder with the .claude-plugin/plugin.json and news of a newer version, for YLLIR_PUBLISHED_SOURCE. */
function makePublishedSource(installed) {
  const version = nextMinorVersion(installed);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-published-'));
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name: 'yllir', version }, null, 2)}\n`);
  fs.mkdirSync(path.join(dir, 'news'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'news', `${version}.md`), `${NEWS}\n`);
  return { dir, version };
}

/**
 * Builds the morvalle-legacy campaign with instructions and one saved version, then the scenario's
 * changes. Returns { tmp, dir, setup, publishedDir }; setup holds what the grading compares with.
 * Throws when the setup cannot be made; the temporary folders are removed in that case.
 */
export function setupScenario(scenario) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-update-'));
  let publishedDir = null;
  let layout = null;
  try {
    const dir = path.join(tmp, 'campaign');
    fs.cpSync(FIXTURE, dir, { recursive: true });
    const installed = readInstalledVersion();
    withIsolatedGit(() => {
      const generated = generateInstructions(dir);
      if (generated.errors.length > 0) throw new Error(`generateInstructions: ${JSON.stringify(generated.errors)}`);
      ensureRepo(dir);
      const v1 = saveVersion(dir, { message: V1_MESSAGE, kind: 'framework' });
      if (!v1.saved) throw new Error('setup: version 1 was not saved');
      if (REWOUND.includes(scenario)) {
        const versionPath = path.join(dir, VERSION_PATH);
        fs.writeFileSync(versionPath, setFrameworkVersion(fs.readFileSync(versionPath, 'utf8'), OLD_VERSION));
        fs.appendFileSync(path.join(dir, CUSTOMIZATIONS_PATH), `\n${MASTER_LINE}\n`);
        fs.appendFileSync(path.join(dir, AGENT_PATH), `\n${HAND_LINE}\n`);
        if (scenario === 'legacy-sessions') layout = toLegacyLayout(dir);
        const saved = saveManualChanges(dir, MANUAL_MESSAGE);
        if (!saved.saved) throw new Error('setup: the changes before the update were not saved');
      }
      if (!status(dir).clean) throw new Error('setup: the tree is not clean after the setup');
    });
    const commits = Number(tryGit(dir, ['rev-list', '--count', 'HEAD'])?.trim());
    if (Number.isNaN(commits)) throw new Error('setup: git log failed');
    if (!REWOUND.includes(scenario)) {
      const published = makePublishedSource(installed);
      publishedDir = published.dir;
    }
    const setup = {
      installed,
      commits,
      versionYamlText: fs.readFileSync(path.join(dir, VERSION_PATH), 'utf8'),
      customizationsText: fs.readFileSync(path.join(dir, CUSTOMIZATIONS_PATH), 'utf8'),
      marker: HAND_MARKER,
      published: publishedDir === null ? null : nextMinorVersion(installed),
    };
    if (layout !== null) {
      setup.scenes = layout.scenes;
      setup.sessionIds = layout.sessionIds;
      setup.oldFiles = layout.oldFiles;
    }
    return { tmp, dir, setup, publishedDir };
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (publishedDir !== null) fs.rmSync(publishedDir, { recursive: true, force: true });
    throw err;
  }
}

/** Runs fn with YLLIR_PUBLISHED_SOURCE set to dir (or unset when dir is null), then restores it. */
function withPublishedSource(dir, fn) {
  const saved = process.env.YLLIR_PUBLISHED_SOURCE;
  if (dir === null) delete process.env.YLLIR_PUBLISHED_SOURCE;
  else process.env.YLLIR_PUBLISHED_SOURCE = dir;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.YLLIR_PUBLISHED_SOURCE;
    else process.env.YLLIR_PUBLISHED_SOURCE = saved;
  }
}

// ---------------------------------------------------------------- case files

function loadCase(caseDir) {
  const raw = loadYamlMapping(path.join(caseDir, 'case.yaml'));
  return { ...parseCaseData(raw), limits: parseLimits(raw) };
}

/** The files that define the process under test (same set as the other runners). */
function instructionFiles() {
  const yllir = path.join(REPO_ROOT, 'yllir');
  const files = ['skills', 'agents', 'templates', 'hooks'].flatMap((dir) => listFiles(path.join(yllir, dir)));
  files.push(...listFiles(path.join(yllir, 'scripts'), { scriptsOnly: true }));
  return [...new Set(files)].filter((file) => !path.basename(file).startsWith('.'));
}

// ---------------------------------------------------------------- records and main

function makeRecord({ caseName, scenario, run, date, header, hash, agent, graded, setup, copy, gradeOnly, limits }) {
  const agentFailure = agent && !agent.ok ? agent.error : null;
  const record = {
    case: caseName,
    scenario,
    run,
    date,
    ...header,
    instructions_hash: hash,
    permission_mode: agent ? agent.permission_mode : null,
    pass: graded.pass && !agentFailure,
    checks: graded.checks,
    failures: [...(agentFailure ? [`agent error: ${agentFailure}`] : []), ...graded.failures],
    technical_found: graded.technical_found,
    notice: graded.notice,
    published_version: setup?.published ?? null,
    report: agent ? agent.report : null,
    cost_usd: agent ? agent.cost_usd : null,
    duration_ms: agent ? agent.duration_ms : null,
    num_turns: agent ? agent.num_turns : null,
    denied: agent?.denied ?? [],
    tool_calls: agent?.tool_calls ?? null,
  };
  if (copy !== undefined) record.copy = copy;
  if (gradeOnly) record.grade_only = true;
  record.limits = limits ?? null;
  return record;
}

/** The record without the long report text, for the console. */
function consoleView(record) {
  const { report, ...rest } = record;
  return rest;
}

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
  const header = recordHeader({ agent: opts.agent, modelLabel: opts.modelLabel });
  const scenario = caseData.scenario;

  if (setupOnly) {
    const prepared = setupScenario(scenario);
    console.log(`dir: ${prepared.dir}`);
    console.log(`installed version: ${prepared.setup.installed}`);
    console.log(`saved versions (commits): ${prepared.setup.commits}`);
    if (prepared.publishedDir !== null) console.log(`published source: ${prepared.publishedDir} (version ${prepared.setup.published})`);
    console.log('git log:');
    console.log(tryGit(prepared.dir, ['log', '--format=%h %s']) ?? 'git log failed');
    return;
  }

  const gradeOnly = opts.values['--grade-only'];
  if (gradeOnly !== undefined) {
    const runJson = opts.values['--run-json'];
    if (runJson === undefined) throw new Error(`--grade-only needs --run-json <file>\n${USAGE}`);
    const dir = path.resolve(gradeOnly);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`--grade-only: ${dir} is not a folder`);
    const saved = JSON.parse(fs.readFileSync(path.resolve(runJson), 'utf8'));
    const graded = applyLimits(
      gradeScenario({
        scenario,
        dir,
        setup: saved.setup,
        report: saved.report ?? null,
        todays: todayDates(),
      }),
      caseData.limits,
      saved,
    );
    const agent = saved.report === null || saved.report === undefined ? { ok: false, error: saved.error ?? 'no report' } : saved;
    const record = makeRecord({
      caseName: caseData.case,
      scenario,
      run: 1,
      date: new Date().toISOString(),
      header,
      hash,
      agent: { ...agent, ok: saved.error ? false : true, permission_mode: saved.permission_mode ?? null },
      graded,
      setup: saved.setup,
      copy: dir,
      gradeOnly: true,
      limits: caseData.limits,
    });
    console.log(JSON.stringify(consoleView(record)));
    process.exitCode = printSummary([record], opts.modelLabel, hash, opts.agent) === 1 ? 0 : 1;
    return;
  }

  const summaries = [];
  for (let i = 1; i <= opts.runs; i++) {
    const date = new Date().toISOString();
    const prepared = setupScenario(scenario);
    const { tmp, dir, setup, publishedDir } = prepared;
    let record;
    try {
      const agent = withPublishedSource(publishedDir, () =>
        runAgent({
          agent: opts.agent,
          cwd: dir,
          prompt: caseData.prompt,
          model: opts.model,
          modelGiven: opts.modelGiven,
          timeoutMs: AGENT_TIMEOUT_MS,
        }),
      );
      const graded = applyLimits(
        gradeScenario({
          scenario,
          dir,
          setup,
          report: agent.ok ? agent.report : null,
          todays: todayDates(),
        }),
        caseData.limits,
        agent,
      );
      record = makeRecord({
        caseName: caseData.case,
        scenario,
        run: i,
        date,
        header,
        hash,
        agent,
        graded,
        setup,
        copy: opts.keep ? dir : undefined,
        limits: caseData.limits,
      });
      if (opts.keep) {
        fs.writeFileSync(
          `${dir}.run.json`,
          JSON.stringify({
            report: agent.report,
            cost_usd: agent.cost_usd,
            duration_ms: agent.duration_ms,
            num_turns: agent.num_turns,
            denied: agent.denied,
            tool_calls: agent.tool_calls,
            error: agent.ok ? null : agent.error,
            permission_mode: agent.permission_mode,
            setup,
          }),
        );
      }
    } finally {
      if (opts.keep) {
        console.log(`kept run ${i}: ${dir}`);
      } else {
        fs.rmSync(tmp, { recursive: true, force: true });
        if (publishedDir !== null) fs.rmSync(publishedDir, { recursive: true, force: true });
      }
    }
    appendResult(caseData.case, record);
    console.log(JSON.stringify(consoleView(record)));
    summaries.push(record);
  }

  const passed = printSummary(summaries, opts.modelLabel, hash, opts.agent);
  process.exitCode = passed === summaries.length ? 0 : 1;
}

// Runs the CLI only when this file is the entry point, so the test file can import the helpers.
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`run-update-case: ${err.message}`);
    process.exitCode = 2;
  }
}
