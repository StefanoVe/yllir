import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'plan-links.mjs');

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

/** Writes a tiny campaign, runs `fn(root)`, and removes it afterwards. */
function withCampaign(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-linker-args-'));
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
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function run(root, args) {
  return spawnSync(process.execPath, [SCRIPT, root, ...args], { encoding: 'utf8' });
}

test('an empty --subjects is accepted and gives the same plan as omitting it', () => {
  withCampaign((root) => {
    const omitted = path.join(root, 'omitted.json');
    const empty = path.join(root, 'empty.json');
    const a = run(root, ['--out', omitted]);
    const b = run(root, ['--subjects', '', '--out', empty]);
    assert.equal(a.status, 0, a.stdout + a.stderr);
    assert.equal(b.status, 0, b.stdout + b.stderr);
    assert.match(b.stdout.trim().split('\n').at(-1) ?? '', /^exit: 0$/);
    assert.equal(fs.readFileSync(empty, 'utf8'), fs.readFileSync(omitted, 'utf8'));
  });
});

test('a --subjects flag without a value is still a usage error', () => {
  withCampaign((root) => {
    const out = path.join(root, 'plan.json');
    const result = run(root, ['--subjects', '--out', out]);
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(out), false);
  });
});

test('an empty --files is still a usage error', () => {
  withCampaign((root) => {
    const out = path.join(root, 'plan.json');
    const result = run(root, ['--files', '', '--out', out]);
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(out), false);
  });
});
