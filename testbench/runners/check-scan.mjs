#!/usr/bin/env node
// Grades the mention scanner against the answer key of a synthetic fixture.
// Read-only: the campaign is scanned in memory and nothing is written into the
// fixture. The only file written is the --json report, and only when asked.
//
// Usage: node testbench/runners/check-scan.mjs [fixtureDir] [--json <file>]
// Exit codes: 0 every mention passes and there are no unexpected occurrences;
//             1 otherwise; 2 the key or the campaign cannot be read.

import fs from 'node:fs';
import path from 'node:path';
import { buildSubjectIndex, readStructure } from '../../yllir/scripts/lib/subjects.mjs';
import { scanMentions } from '../../yllir/scripts/lib/mentions.mjs';
import { parseYamlLite } from '../../yllir/scripts/lib/yaml-lite.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const DEFAULT_FIXTURE = path.join(REPO_ROOT, 'testbench', 'fixtures', 'morvalle');
const USAGE = 'usage: node testbench/runners/check-scan.mjs [fixtureDir] [--json <file>]';
const UNEXPECTED_STATES = new Set(['bare', 'ambiguous', 'linked-elsewhere']);
const EXCLUDED_BY_CONTEXT = {
  title: 'excluded-title',
  italic: 'excluded-italic',
  code: 'excluded-code',
  comment: 'excluded-comment',
  mermaid: 'excluded-diagram',
  self: 'self',
};
const REQUIRED_FIELDS = ['file', 'snippet', 'subject', 'context', 'expected'];

function parseArgs(argv) {
  const opts = { fixtureDir: DEFAULT_FIXTURE, jsonPath: null };
  let positional = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      if (i + 1 >= argv.length) throw new Error(`--json needs a file name\n${USAGE}`);
      opts.jsonPath = path.resolve(argv[++i]);
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option ${arg}\n${USAGE}`);
    } else if (positional === null) {
      positional = arg;
    } else {
      throw new Error(USAGE);
    }
  }
  if (positional !== null) opts.fixtureDir = path.resolve(positional);
  return opts;
}

function loadKey(fixtureDir) {
  const keyPath = path.join(fixtureDir, 'key.yaml');
  let text;
  try {
    text = fs.readFileSync(keyPath, 'utf8');
  } catch (err) {
    throw new Error(`cannot read ${keyPath}: ${err.code ?? err.message}`);
  }
  const { data, errors } = parseYamlLite(text);
  if (errors.length > 0) {
    throw new Error(`${keyPath} line ${errors[0].line}: ${errors[0].message}`);
  }
  if (!data || !Array.isArray(data.mentions)) {
    throw new Error(`${keyPath}: mentions must be a list`);
  }
  return data;
}

/** Maps a key (expected, context) pair to the scanner state it demands, or null. */
function expectedState(mention) {
  const { expected, context } = mention;
  switch (expected) {
    case 'link':
      return context === 'bare' || context === 'master-block' || context === 'table' ? 'bare' : null;
    case 'no-link':
      return Object.hasOwn(EXCLUDED_BY_CONTEXT, context) ? EXCLUDED_BY_CONTEXT[context] : null;
    case 'none':
      return context === 'linked' ? 'linked' : null;
    case 'fix-link':
      return context === 'linked-elsewhere' ? 'linked-elsewhere' : null;
    case 'ask':
      return context === 'ambiguous' ? 'ambiguous' : null;
    default:
      return null;
  }
}

/**
 * Grades one key mention. The scanner occurrence it consumes is added to
 * `explained` (a set shared by all mentions), whether or not the mention passes.
 * An occurrence counts as explained only when a key mention consumed it.
 */
function gradeMention(rawMention, scan, campaignRoot, explained) {
  const mention = rawMention !== null && typeof rawMention === 'object' ? rawMention : {};
  const result = {
    id: String(mention.id ?? '(no id)'),
    file: typeof mention.file === 'string' ? mention.file : '(no file)',
    line: null,
    pass: false,
    reason: null,
    expected_state: null,
    got_state: null,
  };
  const fail = (reason) => {
    result.reason = reason;
    return result;
  };

  const missing = REQUIRED_FIELDS.find((field) => typeof mention[field] !== 'string');
  if (missing !== undefined) return fail(`malformed mention: ${missing} missing`);

  const expected = expectedState(mention);
  result.expected_state = expected;
  if (expected === null) return fail('unknown expectation');

  let text;
  try {
    text = fs.readFileSync(path.join(campaignRoot, mention.file), 'utf8');
  } catch {
    return fail('file not readable');
  }
  const hits = [];
  text.split(/\r?\n/).forEach((lineText, index) => {
    if (lineText.includes(mention.snippet)) hits.push(index + 1);
  });
  if (hits.length !== 1) return fail('snippet not unique');
  result.line = hits[0];

  if (mention.occurrence !== undefined && !(Number.isInteger(mention.occurrence) && mention.occurrence >= 1)) {
    return fail('malformed mention: occurrence');
  }

  // Scanner occurrences on this line for this subject, leftmost first.
  const matched = scan.occurrences
    .filter(
      (o) =>
        o.file === mention.file &&
        o.line === result.line &&
        (o.subject === mention.subject ||
          (o.subject === null && Array.isArray(o.candidates) && o.candidates.includes(mention.subject))),
    )
    .sort((a, b) => a.col - b.col);
  if (matched.length === 0) return fail('not found by scanner');

  // Each key mention consumes one occurrence. With `occurrence: N` it takes the
  // N-th one; without it, the leftmost one not yet consumed by another mention.
  let chosen;
  if (mention.occurrence !== undefined) {
    if (mention.occurrence > matched.length) return fail(`occurrence ${mention.occurrence} not found`);
    chosen = matched[mention.occurrence - 1];
  } else {
    chosen = matched.find((o) => !explained.has(o));
    if (chosen === undefined) return fail('not found by scanner');
  }
  explained.add(chosen);
  result.got_state = chosen.state;

  if (chosen.state !== expected) {
    return fail(`expected ${expected}, got ${chosen.state}`);
  }

  if (expected === 'ambiguous' && Array.isArray(mention.candidates)) {
    const same =
      Array.isArray(chosen.candidates) &&
      mention.candidates.every((id) => chosen.candidates.includes(id));
    if (!same) return fail('candidates differ');
  }

  if (mention.context === 'master-block' && chosen.in_master !== true) {
    return fail('in_master false');
  }

  result.pass = true;
  return result;
}

function grade(opts) {
  const key = loadKey(opts.fixtureDir);
  const campaignRoot = path.join(opts.fixtureDir, 'campaign');
  const { structure, errors } = readStructure(campaignRoot);
  if (structure === null) {
    throw new Error(`cannot read campaign at ${campaignRoot}: ${errors[0].message}`);
  }

  const index = buildSubjectIndex(campaignRoot);
  const scan = scanMentions(campaignRoot, index);

  const explained = new Set();
  const results = key.mentions.map((m) => gradeMention(m, scan, campaignRoot, explained));
  const unexpected = scan.occurrences.filter(
    (o) => !explained.has(o) && UNEXPECTED_STATES.has(o.state),
  );

  const passed = results.filter((r) => r.pass).length;
  const bareExpected = results.filter((r) => r.expected_state === 'bare');
  const bareFound = bareExpected.filter((r) => r.got_state === 'bare').length;
  const excludedViolations = results.filter(
    (r) =>
      r.expected_state !== null &&
      (r.expected_state.startsWith('excluded-') || r.expected_state === 'self') &&
      r.got_state === 'bare',
  ).length;
  const askExpected = results.filter((r) => r.expected_state === 'ambiguous');
  const askPassed = askExpected.filter((r) => r.pass).length;
  const coverage =
    bareExpected.length === 0
      ? 'n/a'
      : `${((100 * bareFound) / bareExpected.length).toFixed(1)}%`;

  const lines = [];
  for (const r of results) {
    if (!r.pass) lines.push(`FAIL ${r.id} ${r.file}:${r.line ?? '?'} ${r.reason}`);
  }
  for (const o of unexpected) {
    const who = o.subject ?? (o.candidates ?? []).join(',');
    lines.push(`UNEXPECTED ${o.file}:${o.line}:${o.col} ${o.state} ${who} "${o.text}"`);
  }
  lines.push(
    `mentions: ${passed}/${results.length} passed`,
    `link coverage: ${bareFound} / ${bareExpected.length}   (${coverage})`,
    `excluded-context violations: ${excludedViolations}`,
    `ask decisions: ${askPassed}/${askExpected.length}`,
    `unexpected: ${unexpected.length}`,
  );
  console.log(lines.join('\n'));

  if (opts.jsonPath !== null) {
    const report = {
      fixture: key.fixture ?? path.basename(opts.fixtureDir),
      results: results.map((r) => ({
        id: r.id,
        pass: r.pass,
        ...(r.pass ? {} : { reason: r.reason }),
        expected_state: r.expected_state,
        ...(r.got_state !== null ? { got_state: r.got_state } : {}),
      })),
      unexpected: unexpected.map((o) => ({
        file: o.file,
        line: o.line,
        col: o.col,
        state: o.state,
        subject: o.subject,
        candidates: o.candidates ?? null,
        text: o.text,
      })),
      metrics: {
        mentions_passed: passed,
        mentions_total: results.length,
        bare_expected: bareExpected.length,
        bare_found: bareFound,
        link_coverage_percent: bareExpected.length === 0 ? null : Number(((100 * bareFound) / bareExpected.length).toFixed(1)),
        excluded_violations: excludedViolations,
        ask_passed: askPassed,
        ask_expected: askExpected.length,
        unexpected: unexpected.length,
      },
    };
    fs.writeFileSync(opts.jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  const clean = passed === results.length && unexpected.length === 0;
  process.exitCode = clean ? 0 : 1;
}

try {
  grade(parseArgs(process.argv.slice(2)));
} catch (err) {
  console.error(`check-scan: ${err.message}`);
  process.exitCode = 2;
}
