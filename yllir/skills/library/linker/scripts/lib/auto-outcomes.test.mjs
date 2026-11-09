import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planLinks } from './link-plan.mjs';
import { autoOutcomes } from './auto-outcomes.mjs';
import { applyLinks } from './apply-links.mjs';

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

/** Sheet with frontmatter: the title line is always line 5. */
function sheet(id, title) {
  return `---\nid: ${id}\n---\n\n# ${title}\n\nUn testo.\n`;
}

/** Writes a temporary campaign, runs `fn` on it and removes it afterwards. */
function withCampaign(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-auto-'));
  try {
    const all = { 'campaign.yaml': CAMPAIGN, ...files };
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

/** Plan with one proposal for `Ilde Varnò` (safe) in Trama/Nota.md. */
const SAFE_FILES = {
  'People/Ilde Varnò.md': sheet('ilde-varno', 'Ilde Varnò'),
  'Trama/Nota.md': '# Nota\n\nIncontro con Ilde Varnò oggi.\n',
};

test('two-word capitalized name is accepted with evidence on the title line', () => {
  withCampaign(SAFE_FILES, (root) => {
    const plan = planLinks(root);
    assert.equal(plan.proposals.length, 1);
    const [p] = plan.proposals;
    const { outcomes, uncertain } = autoOutcomes(root, plan);
    assert.deepEqual(uncertain, []);
    assert.deepEqual(outcomes, [
      {
        id: p.pid,
        file: 'Trama/Nota.md',
        occurrence: `${p.line}:${p.col}`,
        target: p.target,
        evidence: 'People/Ilde Varnò.md:5',
        outcome: 'APPLY',
        reason: 'deterministic: full proper name of one subject',
      },
    ]);
  });
});

test('one-word name is uncertain', () => {
  withCampaign(
    {
      'People/Oria.md': sheet('oria', 'Oria'),
      'Trama/Nota.md': '# Nota\n\nIncontro con Oria oggi.\n',
    },
    (root) => {
      const plan = planLinks(root);
      assert.equal(plan.proposals.length, 1);
      const { outcomes, uncertain } = autoOutcomes(root, plan);
      assert.deepEqual(outcomes, []);
      assert.deepEqual(uncertain, [plan.proposals[0].pid]);
    },
  );
});

test('a name with a lowercase word is uncertain', () => {
  withCampaign(
    {
      'People/Torre di Guardia.md': sheet('torre', 'Torre di Guardia'),
      'Trama/Nota.md': '# Nota\n\nSiamo alla Torre di Guardia.\n',
    },
    (root) => {
      const plan = planLinks(root);
      assert.equal(plan.proposals.length, 1);
      const { outcomes, uncertain } = autoOutcomes(root, plan);
      assert.deepEqual(outcomes, []);
      assert.deepEqual(uncertain, [plan.proposals[0].pid]);
    },
  );
});

test('a proposal in master-only text is uncertain', () => {
  withCampaign(SAFE_FILES, (root) => {
    const plan = planLinks(root);
    plan.proposals[0].in_master = true;
    const { outcomes, uncertain } = autoOutcomes(root, plan);
    assert.deepEqual(outcomes, []);
    assert.deepEqual(uncertain, ['P001']);
  });
});

test('two proposals at the same file, line and column are both uncertain', () => {
  withCampaign(SAFE_FILES, (root) => {
    const plan = planLinks(root);
    const [p] = plan.proposals;
    plan.proposals.push({ ...p, pid: 'P002' });
    const { outcomes, uncertain } = autoOutcomes(root, plan);
    assert.deepEqual(outcomes, []);
    assert.deepEqual(uncertain, ['P001', 'P002']);
  });
});

test('a sheet that does not exist is uncertain', () => {
  withCampaign(SAFE_FILES, (root) => {
    const plan = planLinks(root);
    plan.proposals[0].sheet = 'People/Nope.md';
    const { outcomes, uncertain } = autoOutcomes(root, plan);
    assert.deepEqual(outcomes, []);
    assert.deepEqual(uncertain, ['P001']);
  });
});

test('an absolute sheet path or a path with .. is uncertain', () => {
  withCampaign(SAFE_FILES, (root) => {
    const plan = planLinks(root);
    const [p] = plan.proposals;

    plan.proposals[0] = { ...p, sheet: path.join(root, 'People', 'Ilde Varnò.md') };
    assert.deepEqual(autoOutcomes(root, plan).uncertain, ['P001']);

    plan.proposals[0] = { ...p, sheet: '../People/Ilde Varnò.md' };
    assert.deepEqual(autoOutcomes(root, plan).uncertain, ['P001']);
    assert.deepEqual(autoOutcomes(root, plan).outcomes, []);
  });
});

test('an empty plan gives no outcomes and nothing uncertain', () => {
  withCampaign(SAFE_FILES, (root) => {
    const result = autoOutcomes(root, { scope: [], errors: [], proposals: [], review: [] });
    assert.deepEqual(result, { outcomes: [], uncertain: [] });
  });
});

test('the auto outcomes pass applyLinks end to end, with manual outcomes for the rest', () => {
  withCampaign(
    {
      'People/Ilde Varnò.md': sheet('ilde-varno', 'Ilde Varnò'),
      'People/Torre di Guardia.md': sheet('torre', 'Torre di Guardia'),
      'Trama/Nota.md': '# Nota\n\nIncontro con Ilde Varnò alla Torre di Guardia.\n',
    },
    (root) => {
      const plan = planLinks(root);
      assert.equal(plan.proposals.length, 2);
      const { outcomes, uncertain } = autoOutcomes(root, plan);
      assert.deepEqual(uncertain, plan.proposals.filter((p) => p.text !== 'Ilde Varnò').map((p) => p.pid));

      const manual = plan.proposals
        .filter((p) => uncertain.includes(p.pid))
        .map((p) => ({
          id: p.pid,
          file: p.file,
          occurrence: `${p.line}:${p.col}`,
          target: p.target,
          evidence: `${p.sheet}:5`,
          outcome: 'APPLY',
          reason: 'test: approved by the reviewer',
        }));

      const result = applyLinks(root, plan, [...outcomes, ...manual]);
      assert.equal(result.ok, true);
      assert.deepEqual(result.rejected, []);
      assert.deepEqual(result.applied.sort(), plan.proposals.map((p) => p.pid).sort());

      const written = fs.readFileSync(path.join(root, 'Trama/Nota.md'), 'utf8');
      const ilde = plan.proposals.find((p) => p.text === 'Ilde Varnò');
      assert.ok(written.includes(`[Ilde Varnò](${ilde.target})`));
    },
  );
});
