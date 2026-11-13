import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateDoctor, renderDoctorSection, buildFullReport } from './doctor-report.mjs';
import { stripExitLine } from '../../../../../scripts/lib/cli-exit.mjs';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'doctor-report.mjs');

const ALL_RAN = { errors: 'ran', sketches: 'ran', unreachable: 'ran', forgotten: 'ran', prices: 'ran' };

function coverage(extra = {}) {
  return { queries: { ...ALL_RAN }, read: ['Cronaca/2026-10-01.md'], ...extra };
}

function problem(extra = {}) {
  return {
    title: 'Thread never picked up',
    severity: 'medium',
    kind: 'narrative',
    documents: ['Cronaca 2026-10-01', 'Trama 2026-10-20'],
    evidence: 'The open thread about the bridge is not in any later plot document.',
    subject: 'ponte-di-sale',
    check: 'doctor.open-thread',
    value: 'bridge guard',
    solutions: [{ text: 'Add a hook to the next session', type: 'narrative' }],
    ...extra,
  };
}

test('an empty problem list needs every query run and a chronicle page read', () => {
  assert.equal(validateDoctor({ coverage: coverage(), problems: [] }).valid, true);
  const noRead = validateDoctor({ coverage: coverage({ read: [] }), problems: [] });
  assert.equal(noRead.valid, false);
  assert.match(noRead.errors.join('\n'), /at least one chronicle page/);
  const failed = validateDoctor({
    coverage: coverage({ queries: { ...ALL_RAN, forgotten: 'failed' } }),
    problems: [],
  });
  assert.equal(failed.valid, false);
  assert.match(failed.errors.join('\n'), /not run: forgotten/);
});

test('prices may be missing without an economy document, other queries may not', () => {
  const ok = validateDoctor({ coverage: coverage({ queries: { ...ALL_RAN, prices: 'missing' } }), problems: [] });
  assert.equal(ok.valid, true);
  const bad = validateDoctor({ coverage: coverage({ queries: { ...ALL_RAN, errors: 'missing' } }), problems: [] });
  assert.equal(bad.valid, false);
});

test('each problem needs a severity, a kind, documents, evidence and a solution with a type', () => {
  const cases = [
    [{ severity: 'critical' }, /severity/],
    [{ kind: 'logic' }, /kind/],
    [{ documents: [] }, /documents/],
    [{ evidence: '' }, /evidence/],
    [{ solutions: [] }, /solutions/],
    [{ solutions: [{ text: 'rename', type: 'auto' }] }, /type/],
    [{ check: 'open-thread' }, /check/],
    [{ value: '' }, /value/],
  ];
  for (const [extra, pattern] of cases) {
    const result = validateDoctor({ coverage: coverage(), problems: [problem(extra)] });
    assert.equal(result.valid, false, JSON.stringify(extra));
    assert.match(result.errors.join('\n'), pattern);
  }
});

test('the section orders by severity and groups low problems one line per kind', () => {
  const input = {
    coverage: coverage(),
    problems: [
      problem({ title: 'low structural A', severity: 'low', kind: 'structural' }),
      problem({ title: 'medium narrative', severity: 'medium' }),
      problem({ title: 'high structural', severity: 'high', kind: 'structural' }),
      problem({ title: 'low structural B', severity: 'low', kind: 'structural' }),
      problem({ title: 'low narrative', severity: 'low', kind: 'narrative' }),
    ],
  };
  assert.equal(validateDoctor(input).valid, true);
  const text = renderDoctorSection(input);
  const order = ['high structural', 'medium narrative'].map((t) => text.indexOf(t));
  assert.ok(order[0] < order[1]);
  assert.ok(text.indexOf('medium narrative') < text.indexOf('- low, structural (2): low structural A; low structural B'));
  assert.match(text, /- low, narrative \(1\): low narrative/);
  assert.equal(text.includes('- [low]'), false);
});

test('the full report keeps the audit text and appends the doctor section', () => {
  const audit = 'AUDIT REPORT\nstatus: COMPLETE\n';
  const result = buildFullReport(audit, { coverage: coverage(), problems: [problem()] });
  assert.equal(result.valid, true);
  assert.ok(result.text.startsWith(audit));
  assert.match(result.text, /\nDOCTOR\n/);
  assert.match(result.text, /documents: Cronaca 2026-10-01, Trama 2026-10-20/);
});

test('the CLI writes the full report, and exits 3 on invalid input', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-report-'));
  fs.writeFileSync(path.join(dir, 'report.txt'), 'AUDIT REPORT\nstatus: COMPLETE\n');
  fs.writeFileSync(path.join(dir, 'doctor.json'), JSON.stringify({ coverage: coverage(), problems: [problem()] }));
  const ok = spawnSync(process.execPath, [CLI, '--audit', path.join(dir, 'report.txt'), '--input', path.join(dir, 'doctor.json'), '--out', path.join(dir, 'out', 'report-full.txt')], { encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.equal(fs.readFileSync(path.join(dir, 'out', 'report-full.txt'), 'utf8'), stripExitLine(ok.stdout));
  assert.match(ok.stdout, /exit: 0\n$/);

  fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify({ coverage: coverage(), problems: [problem({ severity: 'x' })] }));
  const bad = spawnSync(process.execPath, [CLI, '--audit', path.join(dir, 'report.txt'), '--input', path.join(dir, 'bad.json'), '--out', path.join(dir, 'bad-out.txt')], { encoding: 'utf8' });
  assert.equal(bad.status, 3);
  assert.equal(fs.existsSync(path.join(dir, 'bad-out.txt')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
