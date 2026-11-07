import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planLinks } from './link-plan.mjs';
import { applyLinks, validateOutcomes } from './apply-links.mjs';

const CAMPAIGN = [
  'name: Test',
  'structure:',
  '  - id: people',
  '    folder: People',
  '    type: subjects',
  '  - id: plot',
  '    folder: Trama',
  '    type: plot',
  '',
].join('\n');

const TEODO = '# Teodo Marr\n\nUn testo.\n';

/** Writes a temporary campaign, runs `fn` on it and removes it afterwards. */
function withCampaign(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-'));
  try {
    const all = {
      'campaign.yaml': CAMPAIGN,
      'People/Teodo Marr.md': `---\nid: teodo-marr\n---\n\n${TEODO}`,
      ...files,
    };
    for (const [rel, content] of Object.entries(all)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function read(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function outcomeFor(p, outcome, reason = 'test reason', evidence = p.sheet) {
  return {
    id: p.pid,
    file: p.file,
    occurrence: `${p.line}:${p.col}`,
    target: p.target,
    evidence,
    outcome,
    reason,
  };
}

const LINK = (target = '../People/Teodo%20Marr.md') => `[Teodo Marr](${target})`;

test('a single APPLY writes the link and is ok', () => {
  withCampaign({ 'Trama/Nota.md': '# Nota\n\nIncontro con Teodo Marr oggi.\n' }, (root) => {
    const plan = planLinks(root);
    const result = applyLinks(root, plan, [outcomeFor(plan.proposals[0], 'APPLY')]);
    assert.equal(
      read(root, 'Trama/Nota.md'),
      `# Nota\n\nIncontro con ${LINK()} oggi.\n`,
    );
    assert.deepEqual(result.applied, ['P001']);
    assert.deepEqual(result.skipped, []);
    assert.deepEqual(result.residual_unexplained, []);
    assert.equal(result.ok, true);
  });
});

test('two APPLY on the same line are both applied correctly', () => {
  withCampaign({ 'Trama/Nota.md': '# Nota\n\nTeodo Marr e Teodo Marr.\n' }, (root) => {
    const plan = planLinks(root);
    const outcomes = plan.proposals.map((p) => outcomeFor(p, 'APPLY'));
    const result = applyLinks(root, plan, outcomes);
    assert.equal(
      read(root, 'Trama/Nota.md'),
      `# Nota\n\n${LINK()} e ${LINK()}.\n`,
    );
    assert.deepEqual(result.applied, ['P001', 'P002']);
    assert.equal(result.ok, true);
  });
});

test('an OMIT is not applied and is explained', () => {
  const original = '# Nota\n\nIncontro con Teodo Marr oggi.\n';
  withCampaign({ 'Trama/Nota.md': original }, (root) => {
    const plan = planLinks(root);
    const result = applyLinks(root, plan, [outcomeFor(plan.proposals[0], 'OMIT')]);
    assert.equal(read(root, 'Trama/Nota.md'), original);
    assert.deepEqual(result.applied, []);
    assert.deepEqual(result.omit, ['P001']);
    assert.deepEqual(result.residual_unexplained, []);
    assert.equal(result.ok, true);
  });
});

test('a missing outcome is reported and leaves a residual', () => {
  const original = '# Nota\n\nIncontro con Teodo Marr oggi.\n';
  withCampaign({ 'Trama/Nota.md': original }, (root) => {
    const plan = planLinks(root);
    const result = applyLinks(root, plan, []);
    assert.equal(read(root, 'Trama/Nota.md'), original);
    assert.deepEqual(result.missing_outcome, ['P001']);
    assert.equal(result.residual_unexplained.length, 1);
    assert.equal(result.ok, false);
  });
});

test('a line changed after planning is skipped, not written', () => {
  withCampaign({ 'Trama/Nota.md': '# Nota\n\nIncontro con Teodo Marr oggi.\n' }, (root) => {
    const plan = planLinks(root);
    const changed = '# Nota\n\nUn altro testo senza nomi.\n';
    fs.writeFileSync(path.join(root, 'Trama/Nota.md'), changed);
    const result = applyLinks(root, plan, [outcomeFor(plan.proposals[0], 'APPLY')]);
    assert.equal(read(root, 'Trama/Nota.md'), changed);
    assert.deepEqual(result.skipped, [{ pid: 'P001', reason: 'line changed' }]);
    assert.deepEqual(result.applied, []);
    // A skipped proposal counts as explained.
    assert.deepEqual(result.residual_unexplained, []);
    assert.equal(result.ok, true);
  });
});

test('CRLF line endings are preserved', () => {
  withCampaign(
    { 'Trama/Nota.md': '# Nota\r\n\r\nPrima riga.\r\nIncontro con Teodo Marr.\r\nFine\r\n' },
    (root) => {
      const plan = planLinks(root);
      const result = applyLinks(root, plan, [outcomeFor(plan.proposals[0], 'APPLY')]);
      assert.equal(
        read(root, 'Trama/Nota.md'),
        `# Nota\r\n\r\nPrima riga.\r\nIncontro con ${LINK()}.\r\nFine\r\n`,
      );
      assert.equal(result.ok, true);
    },
  );
});

test('a trailing newline is preserved, and its absence too', () => {
  withCampaign({ 'Trama/Con.md': '# Con\n\nTeodo Marr.\n', 'Trama/Senza.md': '# Senza\n\nTeodo Marr.' }, (root) => {
    const plan = planLinks(root);
    const outcomes = plan.proposals.map((p) => outcomeFor(p, 'APPLY'));
    const result = applyLinks(root, plan, outcomes);
    assert.equal(read(root, 'Trama/Con.md'), `# Con\n\n${LINK()}.\n`);
    assert.equal(read(root, 'Trama/Senza.md'), `# Senza\n\n${LINK()}.`);
    assert.equal(result.ok, true);
  });
});

test('validateOutcomes gives one reason per rejection', () => {
  withCampaign({ 'Trama/Nota.md': '# Nota\n\nIncontro con Teodo Marr oggi.\n' }, (root) => {
    const plan = planLinks(root);
    const good = outcomeFor(plan.proposals[0], 'APPLY');
    const cases = [
      [null, 'not an object'],
      ['P001', 'not an object'],
      [{ ...good, id: 'P999' }, 'unknown id'],
      [{ ...good, file: 'Trama/Altro.md' }, 'file differs from the proposal'],
      [{ ...good, occurrence: '9:9' }, 'occurrence differs from the proposal'],
      [{ ...good, target: '../People/Altro.md' }, 'target differs from the proposal'],
      [{ ...good, evidence: undefined }, 'evidence missing'],
      [{ ...good, evidence: 'People/Inesistente.md:3' }, 'evidence path does not exist'],
      [{ ...good, evidence: '../../../etc/hosts' }, 'evidence path does not exist'],
      [{ ...good, outcome: 'MAYBE' }, 'invalid outcome'],
      [{ ...good, reason: '   ' }, 'reason missing'],
    ];
    for (const [entry, reason] of cases) {
      const { valid, rejected } = validateOutcomes(root, plan, [entry]);
      assert.deepEqual(valid, [], `valid for reason "${reason}"`);
      assert.equal(rejected.length, 1, `rejected count for reason "${reason}"`);
      assert.equal(rejected[0].reason, reason);
    }
  });
});

test('validateOutcomes accepts a good entry with a line locator, and rejects a duplicate id', () => {
  withCampaign({ 'Trama/Nota.md': '# Nota\n\nIncontro con Teodo Marr oggi.\n' }, (root) => {
    const plan = planLinks(root);
    const good = outcomeFor(plan.proposals[0], 'APPLY', 'ok', 'People/Teodo Marr.md:3');
    const { valid, rejected } = validateOutcomes(root, plan, [good, { ...good }]);
    assert.deepEqual(valid, [good]);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason, 'duplicate id');
  });
});

test('a rejected APPLY is never written and makes the result not ok', () => {
  const original = '# Nota\n\nIncontro con Teodo Marr oggi.\n';
  withCampaign({ 'Trama/Nota.md': original }, (root) => {
    const plan = planLinks(root);
    const bad = { ...outcomeFor(plan.proposals[0], 'APPLY'), reason: '' };
    const result = applyLinks(root, plan, [bad]);
    assert.equal(read(root, 'Trama/Nota.md'), original);
    assert.equal(result.rejected.length, 1);
    assert.equal(result.ok, false);
  });
});
