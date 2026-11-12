// End-to-end checks of launch.mjs in a throwaway framework: launch.mjs and
// launch-lib.mjs are copied next to a fake master-screen/server.mjs, so no browser
// is opened and no real server is started.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Builds <tmp>/framework with the launcher copied in and a fake server with the given body. */
function fakeFramework(t, serverBody) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-launch-e2e-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const launcher = path.join(root, 'scripts', 'launcher');
  fs.mkdirSync(launcher, { recursive: true });
  fs.copyFileSync(path.join(HERE, 'launch.mjs'), path.join(launcher, 'launch.mjs'));
  fs.copyFileSync(path.join(HERE, 'launch-lib.mjs'), path.join(launcher, 'launch-lib.mjs'));
  if (serverBody !== null) {
    fs.mkdirSync(path.join(root, 'master-screen'), { recursive: true });
    fs.writeFileSync(path.join(root, 'master-screen', 'server.mjs'), serverBody);
  }
  return { root, launcher: path.join(launcher, 'launch.mjs') };
}

function campaignDir(t, yaml = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-launch-camp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (yaml) fs.writeFileSync(path.join(dir, 'campaign.yaml'), yaml);
  return dir;
}

function run(launcher, args) {
  return spawnSync(process.execPath, [launcher, ...args], { encoding: 'utf8', timeout: 20000 });
}

test('reports M3 when the server bundle is missing', (t) => {
  const { launcher } = fakeFramework(t, null);
  const res = run(launcher, [campaignDir(t)]);
  assert.equal(res.status, 1);
  assert.equal(res.stdout.trim(), 'The master screen is not available in this version of Yllir yet. Update Yllir and try again.');
});

test('uses the campaign language for M3 when --lang is absent', (t) => {
  const { launcher } = fakeFramework(t, null);
  const res = run(launcher, [campaignDir(t, 'language:\n  main: it\n')]);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /non è ancora disponibile/);
});

test('starts the server with the expected arguments, then prints M1 after READY', (t) => {
  const record = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-launch-rec-')), 'argv.json');
  t.after(() => fs.rmSync(path.dirname(record), { recursive: true, force: true }));
  const server = `
import fs from 'node:fs';
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(JSON.stringify({ ready: true, url: 'http://127.0.0.1:4317', pid: process.pid }) + '\\n');
setTimeout(() => process.exit(0), 300);
`;
  const { launcher, root } = fakeFramework(t, server);
  const campaign = campaignDir(t);
  const res = run(launcher, [campaign, '--lang', 'en']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /The master screen is open in your browser\. Keep this window open/);
  const argv = JSON.parse(fs.readFileSync(record, 'utf8'));
  assert.deepEqual(argv, [
    '--campaign',
    campaign,
    '--framework',
    fs.realpathSync(root),
    '--open',
    '--exit-when-closed',
  ]);
});

test('reports M4 and exits 1 when the server stops before READY', (t) => {
  const { launcher } = fakeFramework(t, 'process.exit(3);\n');
  const res = run(launcher, [campaignDir(t), '--lang', 'it']);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /Non riesco ad avviare il master screen/);
});

test('reports M4 when the campaign folder does not exist', (t) => {
  const { launcher } = fakeFramework(t, 'process.exit(0);\n');
  const res = run(launcher, [path.join(os.tmpdir(), 'yllir-no-such-campaign-folder')]);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /I could not start the master screen/);
});
