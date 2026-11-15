import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureRepo, saveVersion, listVersions } from './lib/versions.mjs';

const script = fileURLToPath(new URL('./engine.mjs', import.meta.url));
const SECRET = 'SEGRETO-DEL-MASTER';

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

const SHEET = `---\nid: teodo-marr\n---\n\n# Teodo Marr\n\n<!-- master -->\nNote riservate: ${SECRET}\n<!-- /master -->\n\nUn mercante.\n`;
const NOTE = '# Nota\n\nIncontro con Teodo Marr oggi.\n';

/** Creates a campaign folder with the given files and optionally a git repo with one saved version. */
function withCampaign({ git }, body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-links-cli-'));
  const files = { 'campaign.yaml': CAMPAIGN, 'People/Teodo Marr.md': SHEET, 'Trama/Nota.md': NOTE };
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  try {
    if (git) {
      ensureRepo(root);
      saveVersion(root, { message: 'Base', kind: 'framework' });
    }
    body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function cli(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

/** The JSON document a command printed, without the trailing `exit: <code>` line. */
function json(result) {
  return JSON.parse(result.stdout.slice(0, result.stdout.lastIndexOf('\nexit:')));
}

test('plan mode prints the proposals with evidence, no master text, and saves the plan', () => {
  withCampaign({ git: false }, (root) => {
    const result = cli(['links', root, '--files', 'Trama/Nota.md']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes(SECRET), false);
    const out = json(result);
    assert.equal(out.ok, true);
    assert.equal(out.count, 1);
    assert.equal(out.proposals[0].evidence, 'People/Teodo Marr.md:5');
    assert.equal(out.plan_file, '.campaign/state/link-review.json');
    assert.ok(fs.existsSync(path.join(root, '.campaign', 'state', 'link-review.json')));
  });
});

test('apply mode applies the outcomes of a plan and saves one version', () => {
  withCampaign({ git: true }, (root) => {
    const before = listVersions(root).length;
    const plan = json(cli(['links', root, '--files', 'Trama/Nota.md']));
    const outcomes = path.join(root, '.campaign', 'state', 'outcomes.json');
    fs.writeFileSync(outcomes, JSON.stringify([{ id: plan.proposals[0].pid, outcome: 'APPLY', reason: 'the full name of the subject' }]));

    const result = cli(['links', root, '--apply', '.campaign/state/outcomes.json', '--message', 'Links: Nota']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const out = json(result);
    assert.equal(out.ok, true);
    assert.deepEqual(out.applied, ['P001']);
    assert.equal(typeof out.saved.hash, 'string');
    assert.match(fs.readFileSync(path.join(root, 'Trama/Nota.md'), 'utf8'), /\[Teodo Marr\]\(\.\.\/People\/Teodo%20Marr\.md\)/);
    assert.equal(listVersions(root).length, before + 1);
  });
});

test('apply mode refuses a campaign that is not a git repository with exit 1', () => {
  withCampaign({ git: false }, (root) => {
    cli(['links', root, '--files', 'Trama/Nota.md']);
    fs.writeFileSync(path.join(root, '.campaign', 'state', 'outcomes.json'), JSON.stringify([{ id: 'P001', outcome: 'APPLY', reason: 'x' }]));
    const result = cli(['links', root, '--apply', '.campaign/state/outcomes.json', '--message', 'Links: Nota']);
    assert.equal(result.status, 1);
    const out = json(result);
    assert.equal(out.ok, false);
    assert.equal(out.errors[0].code, 'no-git');
    assert.equal(fs.readFileSync(path.join(root, 'Trama/Nota.md'), 'utf8'), NOTE);
  });
});

test('usage errors exit 2: --apply with --files, and --apply without --message', () => {
  withCampaign({ git: false }, (root) => {
    const both = cli(['links', root, '--apply', '.campaign/state/outcomes.json', '--files', 'Trama/Nota.md', '--message', 'x']);
    assert.equal(both.status, 2);
    assert.equal(json(both).error, 'usage');

    const noMessage = cli(['links', root, '--apply', '.campaign/state/outcomes.json']);
    assert.equal(noMessage.status, 2);
    assert.equal(json(noMessage).error, 'usage');

    const noFiles = cli(['links', root]);
    assert.equal(noFiles.status, 2);
  });
});

test('the plan file must stay under .campaign/state/', () => {
  withCampaign({ git: false }, (root) => {
    const result = cli(['links', root, '--files', 'Trama/Nota.md', '--out', 'Trama/plan.json']);
    assert.equal(result.status, 2);
    assert.equal(json(result).error, 'usage');
    assert.equal(fs.existsSync(path.join(root, 'Trama', 'plan.json')), false);
  });
});
