import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeShortcut } from './write-shortcut.mjs';

const IS_WINDOWS = process.platform === 'win32';

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-shortcut-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A fake framework whose start.sh records its arguments, one per line, in `record`. */
function fakeFramework(root, record) {
  const dir = path.join(root, 'scripts', 'launcher');
  fs.mkdirSync(dir, { recursive: true });
  const script = `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > '${record}'\n`;
  fs.writeFileSync(path.join(dir, 'start.sh'), script);
  return root;
}

test('macOS writes the .command shortcut in Italian, executable, with the framework path baked in', (t) => {
  const campaign = tempDir(t);
  const result = writeShortcut({
    campaignRoot: campaign,
    frameworkRoot: '/opt/yllir framework',
    language: 'it',
    platform: 'darwin',
  });
  const file = path.join(campaign, 'Apri master screen.command');
  assert.deepEqual(result, { path: file, created: true });
  const body = fs.readFileSync(file, 'utf8');
  assert.equal(body.split('\n')[1], '# yllir-shortcut v1');
  assert.match(body, /FW="\/opt\/yllir framework"/);
  assert.match(body, /--lang it/);
  assert.doesNotMatch(body, /\{\{/);
  if (!IS_WINDOWS) assert.equal(fs.statSync(file).mode & 0o777, 0o755);
});

test('Linux writes the .sh and .desktop pair in English with a quoted Exec', (t) => {
  const campaign = tempDir(t);
  const result = writeShortcut({
    campaignRoot: campaign,
    frameworkRoot: '/opt/yllir',
    language: 'en',
    platform: 'linux',
  });
  const sh = path.join(campaign, 'Open master screen.sh');
  const desktop = path.join(campaign, 'Open master screen.desktop');
  assert.deepEqual(result, { path: sh, created: true });
  assert.match(fs.readFileSync(sh, 'utf8'), /--lang en/);
  const text = fs.readFileSync(desktop, 'utf8');
  assert.match(text, /^# yllir-shortcut v1$/m);
  assert.match(text, /^Name=Open master screen$/m);
  assert.match(text, new RegExp(`^Exec="${campaign.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/Open master screen\\.sh"$`, 'm'));
  if (!IS_WINDOWS) {
    assert.equal(fs.statSync(sh).mode & 0o777, 0o755);
    assert.equal(fs.statSync(desktop).mode & 0o777, 0o755);
  }
});

test('Windows writes the .cmd shortcut calling start.ps1 and pausing only on failure', (t) => {
  const campaign = tempDir(t);
  const result = writeShortcut({
    campaignRoot: campaign,
    frameworkRoot: 'C:\\Yllir 100%\\framework',
    language: 'it',
    platform: 'win32',
  });
  const file = path.join(campaign, 'Apri master screen.cmd');
  assert.deepEqual(result, { path: file, created: true });
  const body = fs.readFileSync(file, 'utf8');
  assert.equal(body.split(/\r?\n/)[0], '@rem yllir-shortcut v1');
  assert.match(body, /powershell -NoProfile -ExecutionPolicy Bypass -File "%FW%\\scripts\\launcher\\start\.ps1" "%HERE%" --lang it/);
  assert.match(body, /if errorlevel 1 pause/);
  assert.match(body, /set "FW=C:\\Yllir 100%%\\framework"/);
  assert.match(body, /%USERPROFILE%\\\.yllir\\framework-path/);
  assert.doesNotMatch(body, /\{\{/);
});

test('the shortcut names of each platform and language', (t) => {
  const campaign = tempDir(t);
  const names = [
    ['darwin', 'it', 'Apri master screen.command'],
    ['win32', 'it', 'Apri master screen.cmd'],
    ['win32', 'en', 'Open master screen.cmd'],
  ];
  for (const [platform, language, name] of names) {
    const dir = fs.mkdtempSync(path.join(campaign, 'c-'));
    const result = writeShortcut({ campaignRoot: dir, frameworkRoot: '/fw', language, platform });
    assert.equal(path.basename(result.path), name);
  }
});

test('an unsupported platform writes nothing', (t) => {
  const campaign = tempDir(t);
  assert.deepEqual(
    writeShortcut({ campaignRoot: campaign, frameworkRoot: '/fw', language: 'en', platform: 'freebsd' }),
    { path: null, created: false },
  );
  assert.deepEqual(fs.readdirSync(campaign), []);
});

test('an unrelated file with the same name is never overwritten', (t) => {
  const campaign = tempDir(t);
  const file = path.join(campaign, 'Open master screen.command');
  fs.writeFileSync(file, '#!/bin/sh\necho mine\n');
  const result = writeShortcut({ campaignRoot: campaign, frameworkRoot: '/fw', language: 'en', platform: 'darwin' });
  assert.deepEqual(result, { path: file, created: false });
  assert.equal(fs.readFileSync(file, 'utf8'), '#!/bin/sh\necho mine\n');
});

test('a shortcut with the marker is refreshed, and an identical one is left alone', (t) => {
  const campaign = tempDir(t);
  const file = path.join(campaign, 'Open master screen.command');
  fs.writeFileSync(file, '#!/bin/sh\n# yllir-shortcut v1\necho old\n');
  const first = writeShortcut({ campaignRoot: campaign, frameworkRoot: '/fw', language: 'en', platform: 'darwin' });
  assert.equal(first.created, true);
  assert.match(fs.readFileSync(file, 'utf8'), /FW="\/fw"/);
  const second = writeShortcut({ campaignRoot: campaign, frameworkRoot: '/fw', language: 'en', platform: 'darwin' });
  assert.equal(second.created, false);
});

test('a shortcut with the marker on its first line is refreshed too (Windows)', (t) => {
  const campaign = tempDir(t);
  const file = path.join(campaign, 'Open master screen.cmd');
  fs.writeFileSync(file, '@rem yllir-shortcut v1\r\n@echo off\r\n');
  const result = writeShortcut({ campaignRoot: campaign, frameworkRoot: 'C:\\fw', language: 'en', platform: 'win32' });
  assert.equal(result.created, true);
  assert.match(fs.readFileSync(file, 'utf8'), /C:\\fw/);
});

test('the Linux .desktop Exec escapes quotes, dollar signs and percent signs', (t) => {
  const campaign = path.join(tempDir(t), 'a "quoted" $HOME 100%');
  fs.mkdirSync(campaign);
  writeShortcut({ campaignRoot: campaign, frameworkRoot: '/fw', language: 'en', platform: 'linux' });
  const line = fs.readFileSync(path.join(campaign, 'Open master screen.desktop'), 'utf8')
    .split('\n')
    .find((l) => l.startsWith('Exec='));
  // Undo the desktop-entry escaping: %% -> %, then \x -> x inside the quotes.
  const raw = line.slice('Exec='.length).replace(/%%/g, '%');
  assert.ok(raw.startsWith('"') && raw.endsWith('"'));
  const unescaped = raw.slice(1, -1).replace(/\\(.)/g, '$1');
  assert.equal(unescaped, path.join(campaign, 'Open master screen.sh'));
});

test('a campaign path with spaces and quotes works when the shortcut runs (POSIX)', { skip: IS_WINDOWS && 'POSIX only' }, (t) => {
  const root = tempDir(t);
  const campaign = path.join(root, `My "Campaign" it's $5 dir`);
  fs.mkdirSync(campaign);
  const record = path.join(root, 'args.txt');
  const framework = fakeFramework(path.join(root, 'fw "with" spaces'), record);
  writeShortcut({ campaignRoot: campaign, frameworkRoot: framework, language: 'it', platform: 'darwin' });
  const shortcut = path.join(campaign, 'Apri master screen.command');

  // Path read from the framework-path file.
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.yllir'), { recursive: true });
  fs.writeFileSync(path.join(home, '.yllir', 'framework-path'), `${framework}\n`);
  const run = spawnSync('sh', [shortcut], { env: { PATH: process.env.PATH, HOME: home }, cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(fs.readFileSync(record, 'utf8').split('\n').slice(0, 3), [campaign, '--lang', 'it']);

  // Without the file, the path baked in at creation time is used.
  fs.rmSync(record, { force: true });
  const emptyHome = path.join(root, 'empty-home');
  fs.mkdirSync(emptyHome);
  const fallback = spawnSync('sh', [shortcut], { env: { PATH: process.env.PATH, HOME: emptyHome }, cwd: root, encoding: 'utf8' });
  assert.equal(fallback.status, 0, fallback.stderr);
  assert.equal(fs.readFileSync(record, 'utf8').split('\n')[0], campaign);
});

test('the shortcut reports a missing framework and exits non-zero (POSIX)', { skip: IS_WINDOWS && 'POSIX only' }, (t) => {
  const root = tempDir(t);
  const campaign = path.join(root, 'camp');
  fs.mkdirSync(campaign);
  writeShortcut({ campaignRoot: campaign, frameworkRoot: path.join(root, 'gone'), language: 'en', platform: 'darwin' });
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  const run = spawnSync('sh', [path.join(campaign, 'Open master screen.command')], {
    env: { PATH: process.env.PATH, HOME: home },
    input: '\n',
    encoding: 'utf8',
  });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /I could not start the master screen/);
});
