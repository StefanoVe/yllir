import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCodexSettings, writeCodexSettings } from './settings.mjs';
import { makeCampaign, cleanupCampaigns, campaignYaml } from './test-support.mjs';
import { ensureRepo, saveVersion, status } from '../../../../../scripts/lib/versions.mjs';
import { stripExitLine } from '../../../../../scripts/lib/cli-exit.mjs';

after(cleanupCampaigns);

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'encyclopedia.mjs');

// A campaign that is a git repository with one saved version, so the tree starts clean.
function repo(files = {}, options) {
  const root = makeCampaign(files, options);
  ensureRepo(root);
  saveVersion(root, { message: 'Campaign created.', kind: 'framework' });
  return root;
}

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function read(root) {
  return fs.readFileSync(path.join(root, 'campaign.yaml'), 'utf8');
}

function cli(args) {
  const run = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { code: run.status, body: stripExitLine(run.stdout) };
}

test('reading a campaign with no keys gives the defaults', () => {
  const root = repo();
  const { errors, ...settings } = readCodexSettings(root);
  assert.deepEqual(errors, []);
  assert.deepEqual(settings, { kinds: ['item'], flavourText: true, list: 'full' });
});

test('writing into an encyclopedia block keeps the title and the comment, and does not duplicate keys', () => {
  const root = repo({}, {
    yaml: campaignYaml({ extra: 'encyclopedia:\n  title: "Codex di prova"\n  # tenere questo commento\n' }),
  });
  const first = writeCodexSettings(root, { kinds: ['item', 'place'], flavourText: false, list: 'discovered' });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.saved, true);
  let text = read(root);
  assert.match(text, /^  title: "Codex di prova"$/m);
  assert.match(text, /^  # tenere questo commento$/m);
  assert.match(text, /^  kinds: \[item, place\]$/m);
  assert.match(text, /^  flavour_text: false$/m);
  assert.match(text, /^  list: discovered$/m);

  const second = writeCodexSettings(root, { kinds: ['place'], flavourText: true, list: 'full' });
  assert.equal(second.ok, true, JSON.stringify(second));
  text = read(root);
  assert.equal(text.match(/^ {2}kinds:/gm).length, 1);
  assert.equal(text.match(/^ {2}flavour_text:/gm).length, 1);
  assert.equal(text.match(/^ {2}list:/gm).length, 1);
  assert.match(text, /^  kinds: \[place\]$/m);
  assert.match(text, /^  title: "Codex di prova"$/m);
  assert.deepEqual(readCodexSettings(root).kinds, ['place']);
});

test('writing to a campaign without the block appends it', () => {
  const root = repo();
  const before = read(root);
  const result = writeCodexSettings(root, { kinds: ['item'], flavourText: true, list: 'full' });
  assert.equal(result.ok, true, JSON.stringify(result));
  const after = read(root);
  assert.ok(after.startsWith(before));
  assert.ok(after.endsWith('encyclopedia:\n  kinds: [item]\n  flavour_text: true\n  list: full\n'));
  assert.equal(readCodexSettings(root).errors.length, 0);
});

test('a kind that does not exist is refused and the file is unchanged', () => {
  const root = repo();
  const before = read(root);
  const result = writeCodexSettings(root, { kinds: ['sword'], flavourText: true, list: 'full' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'bad-settings');
  assert.equal(read(root), before);
  assert.deepEqual(status(root).changed, []);
});

test('a write is saved as its own version and leaves other changes uncommitted', () => {
  const root = repo();
  fs.mkdirSync(path.join(root, 'Varie'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Varie', 'appunti.md'), 'Bozza non collegata.\n');
  const result = writeCodexSettings(root, { kinds: ['item'], flavourText: false, list: 'full' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(git(root, 'log', '-1', '--format=%s'), 'Codex settings');
  assert.equal(git(root, 'show', '--name-only', '--format=', 'HEAD'), 'campaign.yaml');
  const changed = status(root).changed.map((c) => c.path);
  assert.deepEqual(changed, ['Varie/appunti.md']);
});

test('the CLI sets and reads the settings', () => {
  const root = repo();
  const set = cli(['settings', root, '--set', '{"kinds":["item","place"],"flavourText":false,"list":"discovered"}']);
  assert.equal(set.code, 0, set.body);
  assert.equal(JSON.parse(set.body).ok, true);
  const read1 = cli(['settings', root]);
  assert.equal(read1.code, 0);
  const settings = JSON.parse(read1.body);
  assert.deepEqual(settings.kinds, ['item', 'place']);
  assert.equal(settings.flavourText, false);
  assert.equal(settings.list, 'discovered');
});

test('the CLI refuses bad settings with exit 1 and a usage error with exit 2', () => {
  const root = repo();
  const refused = cli(['settings', root, '--set', '{"kinds":["sword"],"flavourText":true,"list":"full"}']);
  assert.equal(refused.code, 1);
  assert.equal(JSON.parse(refused.body).error, 'bad-settings');
  assert.equal(cli(['settings', root, '--set', 'non e json']).code, 2);
  assert.equal(cli(['settings', root, 'extra']).code, 2);
  assert.equal(cli(['changes', root, 'extra']).code, 2);
});

test('changes on a campaign that was never built says so', () => {
  const root = repo();
  const changes = cli(['changes', root]);
  assert.equal(changes.code, 0);
  assert.deepEqual(JSON.parse(changes.body), { built: false });
});
