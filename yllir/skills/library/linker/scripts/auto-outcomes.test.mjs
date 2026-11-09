import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planLinks } from './lib/link-plan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'auto-outcomes.mjs');

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

/** Writes a temporary campaign with one safe mention and its plan file, runs `fn(root, planFile)`. */
function withPlan(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-auto-cli-'));
  try {
    const files = {
      'campaign.yaml': CAMPAIGN,
      'People/Ilde Varnò.md': '---\nid: ilde-varno\n---\n\n# Ilde Varnò\n\nUn testo.\n',
      'Trama/Nota.md': '# Nota\n\nIncontro con Ilde Varnò oggi.\n',
    };
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    const planFile = path.join(root, '.campaign', 'state', 'linker', 'plan.json');
    fs.mkdirSync(path.dirname(planFile), { recursive: true });
    fs.writeFileSync(planFile, `${JSON.stringify(planLinks(root), null, 2)}\n`);
    return fn(root, planFile);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

test('CLI writes the outcomes and prints the counts, ending with exit: 0', () => {
  withPlan((root, planFile) => {
    const out = path.join(root, '.campaign', 'state', 'linker', 'outcomes.json');
    const result = run([root, '--plan', planFile, '--out', out]);
    assert.equal(result.status, 0);
    assert.ok(result.stdout.startsWith('auto: 1\nuncertain: 0\n'));
    assert.ok(result.stdout.endsWith('exit: 0\n'));

    const outcomes = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].outcome, 'APPLY');
    assert.equal(outcomes[0].evidence, 'People/Ilde Varnò.md:5');
  });
});

test('CLI lists each uncertain pid after the counts', () => {
  withPlan((root, planFile) => {
    const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
    plan.proposals[0].in_master = true;
    fs.writeFileSync(planFile, JSON.stringify(plan));
    const out = path.join(root, 'outcomes.json');
    const result = run([root, '--plan', planFile, '--out', out]);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'auto: 0\nuncertain: 1\nuncertain P001\nexit: 0\n');
    assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), []);
  });
});

test('CLI without --out is a usage error with exit 2', () => {
  withPlan((root, planFile) => {
    const result = run([root, '--plan', planFile]);
    assert.equal(result.status, 2);
    assert.ok(result.stderr.includes('usage: node auto-outcomes.mjs'));
    assert.equal(result.stdout, 'exit: 2\n');
  });
});
