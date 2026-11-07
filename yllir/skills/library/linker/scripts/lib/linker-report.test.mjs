import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeLinkerReport, checkLine, countCheckErrors, computeStatus } from './linker-report.mjs';

/** Creates a temporary campaign folder with the given files, runs `fn` and removes it. */
function withRoot(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
    }
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const EVIDENCE = 'People/Teodo Marr.md';

function proposal(pid, extra = {}) {
  return {
    pid,
    file: 'Trama/Nota.md',
    line: 3,
    col: 5,
    text: 'Teodo',
    subject: 'teodo-marr',
    sheet: EVIDENCE,
    target: '../People/Teodo%20Marr.md',
    before: 'x Teodo y',
    after: 'x [Teodo](../People/Teodo%20Marr.md) y',
    in_master: false,
    ...extra,
  };
}

function outcome(p, kind, reason = 'reviewer reason') {
  return {
    id: p.pid,
    file: p.file,
    occurrence: `${p.line}:${p.col}`,
    target: p.target,
    evidence: EVIDENCE,
    outcome: kind,
    reason,
  };
}

function planWith({ proposals = [], review = [], scope = ['Trama/Nota.md'] } = {}) {
  return { scope, errors: [], proposals, review };
}

const CAMPAIGN_FILES = {
  'People/Teodo Marr.md': '---\nid: teodo-marr\n---\n\n# Teodo Marr\n',
};

/** Writes the given inputs into a temp campaign, runs the report, returns the text and status. */
function run(root, { plan, outcomes, result, checkExit = null, statusReason = null, planFile = null, continueWith = 'write-sequence step 7' } = {}) {
  // A plan of undefined is not written, so the plan file is missing.
  const write = (name, value) => {
    const full = path.join(root, name);
    fs.writeFileSync(full, typeof value === 'string' ? value : JSON.stringify(value));
    return full;
  };
  const planPath = planFile ?? (plan === undefined ? path.join(root, 'plan.json') : write('plan.json', plan));
  const outcomesPath = outcomes === undefined ? null : write('outcomes.json', outcomes);
  const resultPath = result === undefined ? null : write('result.json', result);
  const outFile = path.join(root, 'out', 'report.txt');
  const res = writeLinkerReport({
    root,
    planFile: planPath,
    outcomesFile: outcomesPath,
    resultFile: resultPath,
    checkExit,
    statusReason,
    continueWith,
    outFile,
  });
  return { status: res.status, text: fs.readFileSync(outFile, 'utf8') };
}

test('full report text is exact for an ambiguous review item and a linked-elsewhere one', () => {
  withRoot(CAMPAIGN_FILES, (root) => {
    const plan = planWith({
      review: [
        { rid: 'R001', file: 'Trama/A.md', line: 74, col: 1, text: 'Oria', state: 'ambiguous', subject: null, candidates: ['oria-brunel', 'oria-valdes'] },
        { rid: 'R002', file: 'Trama/A.md', line: 91, col: 2, text: 'Sibilla Aurne', state: 'linked-elsewhere', subject: 'sibilla-aurne', link_target: 'Personaggi/Teodo Marr.md' },
      ],
    });
    const { status, text } = run(root, { plan, checkExit: '0', result: { ok: true, applied: [] } });
    assert.equal(status, 'DONE');
    assert.equal(
      text,
      [
        'LINKER REPORT',
        'status: DONE',
        'scope: 1 files',
        'applied: 0',
        'omitted: 0',
        'decisions for the master:',
        '- Trama/A.md:74 "Oria" could be oria-brunel or oria-valdes — ambiguous name',
        '- Trama/A.md:91 "Sibilla Aurne" links to Personaggi/Teodo Marr.md — link points to a different document',
        'check: passed',
        'continue with: write-sequence step 7',
        '',
      ].join('\n'),
    );
  });
});

test('ASK and FIX outcomes are decisions, in plan order after the review items', () => {
  withRoot(CAMPAIGN_FILES, (root) => {
    const p1 = proposal('P001', { line: 4, text: 'Teodo' });
    const p2 = proposal('P002', { line: 9, text: 'Teodo' });
    const p3 = proposal('P003', { line: 12, text: 'Teodo' });
    const plan = planWith({
      proposals: [p1, p2, p3],
      review: [{ rid: 'R001', file: 'Trama/Nota.md', line: 1, col: 1, text: 'Oria', state: 'ambiguous', subject: null, candidates: ['a', 'b'] }],
    });
    // Outcomes given in reverse order: the report must still follow plan order.
    const outcomes = [outcome(p3, 'FIX', 'use the other sheet'), outcome(p1, 'ASK', 'two Teodos?'), outcome(p2, 'OMIT', 'in a quote')];
    const { text } = run(root, { plan, outcomes, checkExit: '0' });
    const decisions = text.split('\n').filter((l) => l.startsWith('- '));
    assert.deepEqual(decisions, [
      '- Trama/Nota.md:1 "Oria" could be a or b — ambiguous name',
      '- Trama/Nota.md:4 "Teodo" could be teodo-marr — two Teodos?',
      '- Trama/Nota.md:12 "Teodo" could be teodo-marr — use the other sheet',
    ]);
  });
});

test('no decisions prints "- none"', () => {
  withRoot(CAMPAIGN_FILES, (root) => {
    const p1 = proposal('P001');
    const { text } = run(root, { plan: planWith({ proposals: [p1] }), outcomes: [outcome(p1, 'APPLY')], result: { ok: true, applied: ['P001'] }, checkExit: '0' });
    assert.match(text, /^decisions for the master:\n- none\ncheck: passed\n/m);
    assert.match(text, /^applied: 1$/m);
  });
});

test('omitted lists valid OMIT outcomes with their reasons; invalid ones are not counted', () => {
  withRoot(CAMPAIGN_FILES, (root) => {
    const p1 = proposal('P001', { line: 3 });
    const p2 = proposal('P002', { line: 5 });
    const bad = { ...outcome(p2, 'OMIT', 'x'), occurrence: '99:99' };
    const { text } = run(root, { plan: planWith({ proposals: [p1, p2] }), outcomes: [outcome(p1, 'OMIT', 'a quote'), bad], checkExit: '0' });
    assert.match(text, /^omitted: 1 \(P001: a quote\)$/m);
  });
});

test('omitted with several entries joins them with "; "', () => {
  withRoot(CAMPAIGN_FILES, (root) => {
    const p1 = proposal('P001', { line: 3 });
    const p2 = proposal('P002', { line: 5 });
    const { text } = run(root, { plan: planWith({ proposals: [p1, p2] }), outcomes: [outcome(p1, 'OMIT', 'quote'), outcome(p2, 'OMIT', 'code')], checkExit: '0' });
    assert.match(text, /^omitted: 2 \(P001: quote; P002: code\)$/m);
  });
});

test('status DONE with a passing check and an ok result', () => {
  withRoot(CAMPAIGN_FILES, (root) => {
    const { status, text } = run(root, { plan: planWith(), checkExit: '0', result: { ok: true, applied: [] } });
    assert.equal(status, 'DONE');
    assert.match(text, /^status: DONE$/m);
  });
});

test('status NEEDS_ATTENTION when check-exit is 1, with the count from check.json', () => {
  withRoot({ ...CAMPAIGN_FILES, '.campaign/state/linker/check.json': { errors: [{ file: 'a' }, { file: 'b' }] } }, (root) => {
    const { status, text } = run(root, { plan: planWith(), checkExit: '1' });
    assert.equal(status, 'NEEDS_ATTENTION');
    assert.match(text, /^check: 2 errors$/m);
  });
});

test('status NEEDS_ATTENTION when the apply result is not ok', () => {
  withRoot(CAMPAIGN_FILES, (root) => {
    const { status } = run(root, { plan: planWith(), checkExit: '0', result: { ok: false, applied: [] } });
    assert.equal(status, 'NEEDS_ATTENTION');
  });
});

test('status FAILED when a status reason is given, with the reason appended', () => {
  withRoot(CAMPAIGN_FILES, (root) => {
    const { status, text } = run(root, { plan: planWith(), checkExit: '0', statusReason: 'apply crashed' });
    assert.equal(status, 'FAILED');
    assert.match(text, /^status: FAILED \(apply crashed\)$/m);
  });
});

test('status FAILED when the plan cannot be read, and FAILED wins over check-exit 1', () => {
  withRoot(CAMPAIGN_FILES, (root) => {
    const missing = run(root, { planFile: path.join(root, 'nope.json'), checkExit: '0' });
    assert.equal(missing.status, 'FAILED');
    assert.match(missing.text, /^status: FAILED$/m);
    assert.match(missing.text, /^scope: 0 files$/m);

    const broken = run(root, { plan: '{not json', checkExit: '1' });
    assert.equal(broken.status, 'FAILED');

    const notPlan = run(root, { plan: { proposals: [] }, checkExit: '0' });
    assert.equal(notPlan.status, 'FAILED');

    const withCheck = run(root, { plan: planWith(), checkExit: '1', statusReason: 'x' });
    assert.equal(withCheck.status, 'FAILED');
  });
});

test('check line: passed, <n> errors, and not run for other codes and none', () => {
  withRoot(CAMPAIGN_FILES, (root) => {
    assert.match(run(root, { plan: planWith(), checkExit: '0' }).text, /^check: passed$/m);
    assert.match(run(root, { plan: planWith(), checkExit: '1' }).text, /^check: 1 errors$/m);
    assert.match(run(root, { plan: planWith(), checkExit: '2' }).text, /^check: not run$/m);
    assert.match(run(root, { plan: planWith(), checkExit: 'other' }).text, /^check: not run$/m);
    assert.match(run(root, { plan: planWith(), checkExit: null }).text, /^check: not run$/m);
  });
});

test('check.json with a broken shape counts as 1 error', () => {
  withRoot({ ...CAMPAIGN_FILES, '.campaign/state/linker/check.json': '{broken' }, (root) => {
    assert.match(run(root, { plan: planWith(), checkExit: '1' }).text, /^check: 1 errors$/m);
  });
});

test('missing outcomes and result files count as zero, and do not change the status', () => {
  withRoot(CAMPAIGN_FILES, (root) => {
    const p1 = proposal('P001');
    const { status, text } = run(root, { plan: planWith({ proposals: [p1] }), checkExit: '0' });
    assert.equal(status, 'DONE');
    assert.match(text, /^applied: 0$/m);
    assert.match(text, /^omitted: 0$/m);
  });
});

test('an unreadable outcomes file needs attention', () => {
  withRoot(CAMPAIGN_FILES, (root) => {
    const { status } = run(root, { plan: planWith(), outcomes: '{broken', checkExit: '0' });
    assert.equal(status, 'NEEDS_ATTENTION');
  });
});

test('the report is written to the given path, creating its folder', () => {
  withRoot(CAMPAIGN_FILES, (root) => {
    const res = run(root, { plan: planWith(), checkExit: '0' });
    assert.equal(res.status, 'DONE');
    assert.ok(fs.existsSync(path.join(root, 'out', 'report.txt')));
  });
});

test('helper functions', () => {
  assert.equal(checkLine('0', null), 'passed');
  assert.equal(checkLine('1', 3), '3 errors');
  assert.equal(checkLine(null, null), 'not run');
  assert.equal(countCheckErrors([1, 2]), 2);
  assert.equal(countCheckErrors({ errors: 4 }), 4);
  assert.equal(countCheckErrors({}), 1);
  assert.equal(computeStatus({ planOk: true, statusReason: null, checkExit: null, resultNotOk: false, attention: false }), 'DONE');
});
