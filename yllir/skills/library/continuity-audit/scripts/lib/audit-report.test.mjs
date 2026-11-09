import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateJudgments, buildReport } from './audit-report.mjs';
import { stripExitLine } from '../../../../../scripts/lib/cli-exit.mjs';


const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'audit-report.mjs');

/** A fact with the given place; in_master marks facts that come from the master-only block. */
function fact(id, document, line, extra = {}) {
  return {
    id,
    document,
    line,
    value: 'v',
    source_type: 'narrative',
    quote: `quote of ${id}`,
    in_master: false,
    ...extra,
  };
}

/** A candidate with the given facts; values default to two conflicting values. */
function candidate(cid, facts, extra = {}) {
  return {
    cid,
    kind: 'value-conflict',
    subject: 'Lago Grigio',
    attribute: 'fondazione',
    values: ['1200', '1350'],
    facts,
    ...extra,
  };
}

const TWO_PLACES = [fact('F1', 'Mondo/X.md', 12), fact('F2', 'Storia/Y.md', 8)];

function judgment(cid, extra = {}) {
  return {
    cid,
    category: 'direct-contradiction',
    related_to_change: true,
    locators: ['Mondo/X.md:12', 'Storia/Y.md:8'],
    reason: 'two different founding years, both stated as fact',
    ...extra,
  };
}

function scope(mode = 'full') {
  return { mode, subjects: ['lago-grigio'], files: [], errors: [] };
}

function facts(extra = {}) {
  return {
    mode: 'full',
    complete: true,
    coverage: [
      { fid: 'D001', document: 'Mondo/X.md', status: 'extracted', facts_valid: 1, facts_discarded: 0 },
      { fid: 'D002', document: 'Storia/Y.md', status: 'extracted', facts_valid: 1, facts_discarded: 0 },
    ],
    facts: [...TWO_PLACES],
    discarded: [],
    ...extra,
  };
}

function candidates(list, extra = {}) {
  return { candidates: list, excluded: [], hypotheses: [], stats: {}, ...extra };
}

test('buildReport counts external documents read apart from the campaign documents', () => {
  const external = { fid: 'D003', document: 'Mondo/Raatnagar.md', status: 'extracted', facts_valid: 1, facts_discarded: 0 };
  const notRead = { fid: 'D004', document: 'Mondo/Altro.md', status: 'to-read', facts_valid: 0, facts_discarded: 0 };
  const current = facts({
    coverage: [...facts().coverage, external, notRead],
    complete: false,
  });
  const withExternal = {
    mode: 'full',
    subjects: ['lago-grigio'],
    files: [
      { fid: 'D001', document: 'Mondo/X.md', external: false },
      { fid: 'D002', document: 'Storia/Y.md', external: false },
      { fid: 'D003', document: 'Mondo/Raatnagar.md', external: true },
      { fid: 'D004', document: 'Mondo/Altro.md', external: true },
    ],
    errors: [],
  };
  const report = buildReport({ scope: withExternal, facts: current, candidates: candidates([]), judgments: [] });
  assert.ok(report.text.includes('external documents (read only, shared world): 2 in scope, read 1, not read 1\n'));
  assert.deepEqual(report.json.external, { documents: 2, read: 1, not_read: 1 });
  assert.equal(report.status, 'INCOMPLETE');
});

// ---------- validateJudgments ----------

test('validateJudgments accepts a correct judgment', () => {
  const cands = candidates([candidate('C001', TWO_PLACES)]);
  const result = validateJudgments(cands.candidates, [judgment('C001')], 'full');
  assert.deepEqual(result.problems, []);
  assert.equal(result.valid.get('C001').category, 'direct-contradiction');
});

test('validateJudgments reports judgments that are not an array', () => {
  const result = validateJudgments([candidate('C001', TWO_PLACES)], { cid: 'C001' }, 'full');
  assert.equal(result.problems.length, 1);
  assert.equal(result.problems[0].cid, null);
  assert.match(result.problems[0].message, /array/);
  assert.equal(result.valid.size, 0);
});

test('validateJudgments reports an unknown cid', () => {
  const result = validateJudgments([candidate('C001', TWO_PLACES)], [judgment('C001'), judgment('C999')], 'full');
  assert.deepEqual(
    result.problems.map((p) => [p.cid, p.message]),
    [['C999', 'unknown cid "C999"']],
  );
});

test('validateJudgments reports a duplicate cid', () => {
  const result = validateJudgments([candidate('C001', TWO_PLACES)], [judgment('C001'), judgment('C001')], 'full');
  assert.equal(result.problems.length, 1);
  assert.equal(result.problems[0].cid, 'C001');
  assert.match(result.problems[0].message, /duplicate/);
});

test('validateJudgments reports a missing judgment for a candidate', () => {
  const result = validateJudgments([candidate('C001', TWO_PLACES), candidate('C002', TWO_PLACES)], [judgment('C001')], 'full');
  assert.deepEqual(
    result.problems.map((p) => [p.cid, p.message]),
    [['C002', 'missing judgment for this cid']],
  );
});

test('validateJudgments reports a bad category', () => {
  const result = validateJudgments([candidate('C001', TWO_PLACES)], [judgment('C001', { category: 'maybe' })], 'full');
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0].message, /bad category/);
});

test('validateJudgments requires related_to_change in pre mode only', () => {
  const cands = [candidate('C001', TWO_PLACES)];
  const missing = { cid: 'C001', category: 'direct-contradiction', locators: ['Mondo/X.md:12', 'Storia/Y.md:8'], reason: 'r' };
  const pre = validateJudgments(cands, [missing], 'pre');
  assert.equal(pre.problems.length, 1);
  assert.match(pre.problems[0].message, /related_to_change/);

  const badType = validateJudgments(cands, [judgment('C001', { related_to_change: 'yes' })], 'pre');
  assert.equal(badType.problems.length, 1);

  const full = validateJudgments(cands, [missing], 'full');
  assert.deepEqual(full.problems, []);
});

test('validateJudgments reports a locator that is not a fact place of the candidate', () => {
  const result = validateJudgments(
    [candidate('C001', TWO_PLACES)],
    [judgment('C001', { locators: ['Mondo/X.md:12', 'Altro.md:3'] })],
    'full',
  );
  // The bad locator is one problem; the candidate then has only one valid locator, which is a second problem.
  assert.equal(result.problems.length, 2);
  assert.match(result.problems[0].message, /Altro\.md:3/);
  assert.match(result.problems[1].message, /at least 2/);
});

test('validateJudgments reports too few locators when facts come from two places', () => {
  const result = validateJudgments(
    [candidate('C001', TWO_PLACES)],
    [judgment('C001', { locators: ['Mondo/X.md:12'] })],
    'full',
  );
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0].message, /at least 2/);
});

test('validateJudgments does not count the same locator twice', () => {
  const result = validateJudgments(
    [candidate('C001', TWO_PLACES)],
    [judgment('C001', { locators: ['Mondo/X.md:12', 'Mondo/X.md:12'] })],
    'full',
  );
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0].message, /at least 2/);
});

test('validateJudgments reports an empty reason', () => {
  const result = validateJudgments([candidate('C001', TWO_PLACES)], [judgment('C001', { reason: '   ' })], 'full');
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0].message, /reason/);
});

// ---------- buildReport: validity and status ----------

test('buildReport is INVALID with one line per problem', () => {
  const report = buildReport({
    scope: scope(),
    facts: facts(),
    candidates: candidates([candidate('C001', TWO_PLACES)]),
    judgments: [judgment('C001', { category: 'nope' })],
  });
  assert.equal(report.status, 'INVALID');
  assert.equal(report.json.status, 'INVALID');
  assert.equal(
    report.text,
    'AUDIT REPORT\nstatus: INVALID\n- C001: bad category "nope"\n',
  );
});

test('buildReport is COMPLETE with problems and perspective separated', () => {
  const cands = candidates([
    candidate('C001', TWO_PLACES),
    candidate('C002', TWO_PLACES, { subject: 'Torre', attribute: 'altezza', values: ['30 m', '45 m'] }),
  ]);
  const report = buildReport({
    scope: scope('full'),
    facts: facts(),
    candidates: cands,
    judgments: [
      judgment('C001'),
      judgment('C002', {
        category: 'perspective',
        reason: 'the guide measures from the base, the chronicle from the top',
      }),
    ],
  });
  assert.equal(report.status, 'COMPLETE');
  const lines = report.text.split('\n');
  assert.ok(lines.includes('status: COMPLETE'));
  assert.ok(lines.includes('problems (1):'));
  assert.ok(lines.includes('differences explained by perspective or source (1):'));
  const problemIndex = lines.indexOf('problems (1):');
  const perspectiveIndex = lines.indexOf('differences explained by perspective or source (1):');
  assert.equal(
    lines[problemIndex + 1],
    '- [direct-contradiction] Lago Grigio fondazione: 1200 vs 1350 — Mondo/X.md:12, Storia/Y.md:8 — two different founding years, both stated as fact',
  );
  assert.match(lines[perspectiveIndex + 1], /^- \[perspective\] Torre altezza: 30 m vs 45 m /);
  assert.equal(report.json.problems.length, 1);
  assert.equal(report.json.perspective.length, 1);
});

test('buildReport is INCOMPLETE when facts are incomplete', () => {
  const report = buildReport({
    scope: scope(),
    facts: facts({ complete: false }),
    candidates: candidates([candidate('C001', TWO_PLACES)]),
    judgments: [judgment('C001')],
  });
  assert.equal(report.status, 'INCOMPLETE');
  assert.match(report.text, /^status: INCOMPLETE$/m);
});

test('buildReport is INCOMPLETE with 0 candidates and no coverage review', () => {
  const report = buildReport({
    scope: scope(),
    facts: facts(),
    candidates: candidates([]),
    judgments: [],
  });
  assert.equal(report.status, 'INCOMPLETE');
  assert.match(report.text, /^coverage review: not run$/m);
});

test('buildReport is COMPLETE with 0 candidates and a CONFIRMED coverage review', () => {
  const report = buildReport({
    scope: scope(),
    facts: facts(),
    candidates: candidates([]),
    judgments: [],
    coverageReview: { verdict: 'CONFIRMED', missed: [] },
  });
  assert.equal(report.status, 'COMPLETE');
  assert.match(report.text, /^coverage review: CONFIRMED$/m);
});

test('buildReport is INCOMPLETE when the coverage review finds missed facts', () => {
  const report = buildReport({
    scope: scope(),
    facts: facts(),
    candidates: candidates([]),
    judgments: [],
    coverageReview: {
      verdict: 'MISSED',
      missed: [{ fid: 'D002', quote: 'the lake froze in 1400', note: 'not extracted' }],
    },
  });
  assert.equal(report.status, 'INCOMPLETE');
  assert.match(report.text, /^coverage review: MISSED \(1 missed\)$/m);
  assert.equal(report.json.coverage_review.verdict, 'MISSED');
  assert.equal(report.json.coverage_review.missed.length, 1);
  assert.equal(report.json.coverage_review.missed[0].fid, 'D002');
  assert.ok(!JSON.stringify(report.json).includes('froze'));
});

// ---------- buildReport: layout ----------

test('buildReport prints - none under every empty list', () => {
  const report = buildReport({ scope: scope(), facts: facts(), candidates: candidates([]), judgments: [], coverageReview: { verdict: 'CONFIRMED', missed: [] } });
  assert.equal(
    report.text,
    [
      'AUDIT REPORT',
      'status: COMPLETE',
      'mode: full',
      'coverage: 2 documents — extracted 2, read with no facts 0, not read 0',
      'external documents (read only, shared world): 0 in scope, read 0, not read 0',
      'facts: 2 valid, 0 discarded',
      'problems (0):',
      '- none',
      'differences explained by perspective or source (0):',
      '- none',
      "excluded by the master's decisions (0):",
      '- none',
      'hypotheses not treated as facts: 0',
      'not checked:',
      '- none',
      'coverage review: CONFIRMED',
      '',
    ].join('\n'),
  );
});

test('buildReport in pre mode lists related problems first with the RELATED prefix', () => {
  const cands = candidates([
    candidate('C001', TWO_PLACES, { subject: 'Alfa' }),
    candidate('C002', TWO_PLACES, { subject: 'Beta' }),
  ]);
  const report = buildReport({
    scope: scope('pre'),
    facts: facts(),
    candidates: cands,
    judgments: [
      judgment('C001', { related_to_change: false, reason: 'unrelated detail' }),
      judgment('C002', { related_to_change: true, reason: 'touches the change' }),
    ],
  });
  const lines = report.text.split('\n');
  const start = lines.indexOf('problems (2):') + 1;
  assert.match(lines[start], /^- \[RELATED\] \[direct-contradiction\] Beta /);
  assert.match(lines[start + 1], /^- \[direct-contradiction\] Alfa /);
  assert.ok(!lines[start + 1].includes('[RELATED]'));
});

test('buildReport in full mode ignores related_to_change', () => {
  const report = buildReport({
    scope: scope('full'),
    facts: facts(),
    candidates: candidates([candidate('C001', TWO_PLACES)]),
    judgments: [judgment('C001', { related_to_change: true })],
  });
  assert.equal(report.status, 'COMPLETE');
  assert.ok(!report.text.includes('[RELATED]'));
});

test('buildReport prints the excluded section with the exclusion reason', () => {
  const report = buildReport({
    scope: scope(),
    facts: facts(),
    candidates: candidates([], {
      excluded: [
        {
          cid: 'C009',
          kind: 'value-conflict',
          subject: 'Porto Vecchio',
          attribute: 'nome',
          values: ['Vecchio', 'Antico'],
          exclusion: 'master-decision',
          reason: 'the master decided the two names are an intentional alias',
        },
      ],
      hypotheses: [fact('H1', 'Mondo/X.md', 4)],
    }),
    judgments: [],
    coverageReview: { verdict: 'CONFIRMED', missed: [] },
  });
  assert.ok(
    report.text.includes(
      "excluded by the master's decisions (1):\n- Porto Vecchio nome: Vecchio vs Antico — the master decided the two names are an intentional alias\n",
    ),
  );
  assert.ok(report.text.includes('hypotheses not treated as facts: 1\n'));
  assert.equal(report.json.excluded.length, 1);
  assert.equal(report.json.hypotheses, 1);
});

test('buildReport lists unread documents and discarded facts under not checked', () => {
  const report = buildReport({
    scope: scope(),
    facts: facts({
      coverage: [
        { fid: 'D001', document: 'Mondo/X.md', status: 'extracted', facts_valid: 1, facts_discarded: 0 },
        { fid: 'D002', document: 'Storia/Y.md', status: 'read', facts_valid: 0, facts_discarded: 0 },
        { fid: 'D003', document: 'Diario/Z.md', status: 'to-read', facts_valid: 0, facts_discarded: 0 },
      ],
      discarded: [{ fid: 'D001', index: 4, reason: 'duplicate of F1', fact: { value: 'x' } }],
    }),
    candidates: candidates([]),
    judgments: [],
    coverageReview: { verdict: 'CONFIRMED', missed: [] },
  });
  assert.ok(report.text.includes('coverage: 3 documents — extracted 1, read with no facts 1, not read 1\n'));
  assert.ok(report.text.includes('facts: 2 valid, 1 discarded\n'));
  assert.ok(report.text.includes('not checked:\n- Diario/Z.md (not read)\n- D001#4 discarded: duplicate of F1\n'));
  assert.equal(report.json.coverage.not_read, 1);
  assert.equal(report.json.coverage.read_no_facts, 1);
});

test('buildReport never prints the quote of an in_master fact', () => {
  const SECRET = 'ZEPHYRQUILL';
  const masterFacts = [
    fact('F1', 'Mondo/X.md', 12, { in_master: true, quote: `the hidden word is ${SECRET}` }),
    fact('F2', 'Storia/Y.md', 8),
  ];
  const report = buildReport({
    scope: scope(),
    facts: facts({ facts: masterFacts }),
    candidates: candidates([candidate('C001', masterFacts)]),
    judgments: [judgment('C001')],
  });
  assert.equal(report.status, 'COMPLETE');
  assert.ok(!report.text.includes(SECRET));
  assert.ok(!JSON.stringify(report.json).includes(SECRET));
});

// ---------- CLI ----------

/** Writes the JSON inputs in a temporary directory and returns its path and a file map. */
function writeInputs(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, value] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
  }
  return dir;
}

function runCli(dir, extra = []) {
  return spawnSync(
    process.execPath,
    [
      CLI,
      '--scope', path.join(dir, 'scope.json'),
      '--facts', path.join(dir, 'facts.json'),
      '--candidates', path.join(dir, 'candidates.json'),
      '--judgments', path.join(dir, 'judgments.json'),
      '--out', path.join(dir, 'out', 'report.json'),
      '--text', path.join(dir, 'out', 'report.txt'),
      ...extra,
    ],
    { encoding: 'utf8' },
  );
}

test('CLI exits 0 for COMPLETE and writes both outputs', (t) => {
  const dir = writeInputs(t, {
    'scope.json': scope(),
    'facts.json': facts(),
    'candidates.json': candidates([candidate('C001', TWO_PLACES)]),
    'judgments.json': [judgment('C001')],
  });
  const result = runCli(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^AUDIT REPORT\nstatus: COMPLETE/);
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'report.json'), 'utf8'));
  assert.equal(json.status, 'COMPLETE');
  assert.equal(fs.readFileSync(path.join(dir, 'out', 'report.txt'), 'utf8'), stripExitLine(result.stdout));
});

test('CLI exits 1 for INCOMPLETE', (t) => {
  const dir = writeInputs(t, {
    'scope.json': scope(),
    'facts.json': facts({ complete: false }),
    'candidates.json': candidates([candidate('C001', TWO_PLACES)]),
    'judgments.json': [judgment('C001')],
  });
  assert.equal(runCli(dir).status, 1);
});

test('CLI exits 3 for INVALID', (t) => {
  const dir = writeInputs(t, {
    'scope.json': scope(),
    'facts.json': facts(),
    'candidates.json': candidates([candidate('C001', TWO_PLACES)]),
    'judgments.json': [judgment('C001', { locators: ['Nowhere.md:1'] })],
  });
  const result = runCli(dir);
  assert.equal(result.status, 3);
  assert.match(result.stdout, /^AUDIT REPORT\nstatus: INVALID\n- C001: /);
});

test('CLI accepts a missing judgments file when there are 0 candidates', (t) => {
  const dir = writeInputs(t, {
    'scope.json': scope(),
    'facts.json': facts(),
    'candidates.json': candidates([]),
    'coverage-review.json': { verdict: 'CONFIRMED', missed: [] },
  });
  const result = runCli(dir, ['--coverage-review', path.join(dir, 'coverage-review.json')]);
  assert.equal(result.status, 0, result.stderr);
});

test('CLI exits 2 for a missing judgments file when there are candidates', (t) => {
  const dir = writeInputs(t, {
    'scope.json': scope(),
    'facts.json': facts(),
    'candidates.json': candidates([candidate('C001', TWO_PLACES)]),
  });
  assert.equal(runCli(dir).status, 2);
});

test('CLI exits 2 for usage errors', (t) => {
  const dir = writeInputs(t, {});
  const result = spawnSync(process.execPath, [CLI, '--scope', path.join(dir, 'x.json')], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage:/);
});

test('CLI exits 2 for unreadable input', (t) => {
  const dir = writeInputs(t, {
    'scope.json': scope(),
    'facts.json': '{ not json',
    'candidates.json': candidates([]),
  });
  assert.equal(runCli(dir).status, 2);
});
