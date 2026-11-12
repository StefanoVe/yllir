import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  browserCommand,
  buildChildEnv,
  findLiveServer,
  isPidAlive,
  lockPath,
  message,
  normalizeLang,
  parseArgs,
  parseClaudeLookup,
  parseReadyLine,
  readCampaignLanguage,
  readLock,
  resolveUserClaudePath,
} from './launch-lib.mjs';

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-launch-lib-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A pid that certainly belongs to no running process: a child that has already exited. */
function deadPid() {
  const res = spawnSync(process.execPath, ['-e', '']);
  return res.pid;
}

function writeLock(campaign, content) {
  const file = lockPath(campaign);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
}

test('parseArgs reads the campaign folder and --lang in both forms', () => {
  assert.deepEqual(parseArgs(['/x/camp', '--lang', 'it']), { campaign: '/x/camp', lang: 'it' });
  assert.deepEqual(parseArgs(['--lang=en', '/x/camp']), { campaign: '/x/camp', lang: 'en' });
  assert.deepEqual(parseArgs(['/x/camp']), { campaign: '/x/camp', lang: null });
  assert.deepEqual(parseArgs([]), { campaign: null, lang: null });
});

test('parseArgs ignores unknown flags and an unsupported language', () => {
  assert.deepEqual(parseArgs(['--verbose', '/x/camp', '--lang', 'fr']), { campaign: '/x/camp', lang: null });
  assert.deepEqual(parseArgs(['/x/camp', '--lang']), { campaign: '/x/camp', lang: null });
});

test('normalizeLang accepts only it and en', () => {
  assert.equal(normalizeLang(' IT '), 'it');
  assert.equal(normalizeLang('en'), 'en');
  assert.equal(normalizeLang('de'), null);
  assert.equal(normalizeLang(undefined), null);
});

test('message falls back to English and rejects unknown keys', () => {
  assert.match(message('M3', 'it'), /non è ancora disponibile/);
  assert.match(message('M3', 'en'), /not available/);
  assert.equal(message('M4', 'de'), message('M4', 'en'));
  assert.throws(() => message('M9', 'en'));
});

test('readCampaignLanguage reads language.main from campaign.yaml', (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, 'campaign.yaml'), 'name: x\nlanguage:\n  main: it\n  other: []\n');
  assert.equal(readCampaignLanguage(dir), 'it');
});

test('readCampaignLanguage handles quotes, comments and other top-level keys', (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(
    path.join(dir, 'campaign.yaml'),
    '# top comment\nlanguage:\n  main: "en"   # the main one\nother:\n  main: it\n',
  );
  assert.equal(readCampaignLanguage(dir), 'en');
});

test('readCampaignLanguage defaults to en when missing or unknown', (t) => {
  const dir = tempDir(t);
  assert.equal(readCampaignLanguage(dir), 'en');
  fs.writeFileSync(path.join(dir, 'campaign.yaml'), 'language:\n  main: fr\n');
  assert.equal(readCampaignLanguage(dir), 'en');
  fs.writeFileSync(path.join(dir, 'campaign.yaml'), 'name: nothing here\n');
  assert.equal(readCampaignLanguage(dir), 'en');
});

test('parseReadyLine accepts the READY line and rejects anything else', () => {
  assert.deepEqual(parseReadyLine('{"ready":true,"url":"http://127.0.0.1:4317","pid":123}'), {
    url: 'http://127.0.0.1:4317',
    pid: 123,
  });
  assert.deepEqual(parseReadyLine('  {"ready":true,"url":"http://127.0.0.1:4318","pid":7}\r'), {
    url: 'http://127.0.0.1:4318',
    pid: 7,
  });
  assert.equal(parseReadyLine('starting server…'), null);
  assert.equal(parseReadyLine('{"ready":false,"url":"http://127.0.0.1:1","pid":1}'), null);
  assert.equal(parseReadyLine('{"ready":true,"pid":1}'), null);
  assert.equal(parseReadyLine('{"ready":true,"url":"http://127.0.0.1:1","pid":"1"}'), null);
  assert.equal(parseReadyLine(''), null);
});

test('isPidAlive is true for this process and false for a dead child', () => {
  assert.equal(isPidAlive(process.pid), true);
  assert.equal(isPidAlive(deadPid()), false);
});

test('readLock accepts only a loopback http lock', (t) => {
  const dir = tempDir(t);
  assert.equal(readLock(dir), null);
  writeLock(dir, { pid: 42, port: 4317, url: 'http://127.0.0.1:4317' });
  assert.deepEqual(readLock(dir), { pid: 42, port: 4317, url: 'http://127.0.0.1:4317' });
  writeLock(dir, '{ not json');
  assert.equal(readLock(dir), null);
  writeLock(dir, { pid: 42, url: 'http://example.com:4317' });
  assert.equal(readLock(dir), null);
  writeLock(dir, { pid: 42, url: 'file:///etc/passwd' });
  assert.equal(readLock(dir), null);
  writeLock(dir, { pid: -1, url: 'http://127.0.0.1:4317' });
  assert.equal(readLock(dir), null);
});

test('findLiveServer ignores a lock whose pid is dead without probing it', async (t) => {
  const dir = tempDir(t);
  writeLock(dir, { pid: deadPid(), port: 4317, url: 'http://127.0.0.1:4317' });
  let probed = false;
  const url = await findLiveServer(dir, {
    probe: async () => {
      probed = true;
      return true;
    },
  });
  assert.equal(url, null);
  assert.equal(probed, false);
});

test('findLiveServer returns the URL only when the pid is alive and the status answers', async (t) => {
  const dir = tempDir(t);
  writeLock(dir, { pid: process.pid, port: 4317, url: 'http://127.0.0.1:4317' });
  assert.equal(await findLiveServer(dir, { probe: async () => true }), 'http://127.0.0.1:4317');
  assert.equal(await findLiveServer(dir, { probe: async () => false }), null);
});

test('findLiveServer returns null without a lock file', async (t) => {
  const dir = tempDir(t);
  assert.equal(await findLiveServer(dir, { probe: async () => true }), null);
});

test('browserCommand picks the opener of each platform', () => {
  assert.deepEqual(browserCommand('http://127.0.0.1:1', 'darwin'), { cmd: 'open', args: ['http://127.0.0.1:1'] });
  assert.equal(browserCommand('http://127.0.0.1:1', 'win32').cmd, 'explorer.exe');
  assert.equal(browserCommand('http://127.0.0.1:1', 'linux').cmd, 'xdg-open');
});

test('parseClaudeLookup takes the last line of the login shell output, ignoring profile noise', () => {
  const exists = (file) => file === '/home/u/.nvm/versions/node/v20/bin/claude';
  const out = 'welcome banner\nnvm: loaded\n/home/u/.nvm/versions/node/v20/bin/claude\n';
  assert.equal(parseClaudeLookup(out, { platform: 'linux', exists }), '/home/u/.nvm/versions/node/v20/bin/claude');
});

test('parseClaudeLookup rejects relative, alias-like and missing results', () => {
  const exists = () => true;
  assert.equal(parseClaudeLookup('claude\n', { platform: 'darwin', exists }), null);
  assert.equal(parseClaudeLookup('', { platform: 'darwin', exists }), null);
  assert.equal(parseClaudeLookup('/x/claude\n', { platform: 'darwin', exists: () => false }), null);
  assert.equal(parseClaudeLookup(undefined, { platform: 'darwin', exists }), null);
});

test('parseClaudeLookup on Windows takes the first existing absolute line of where', () => {
  const exists = (file) => file === 'C:\\npm\\claude.cmd';
  const out = 'INFO: not here\r\nC:\\npm\\claude.cmd\r\nC:\\other\\claude.exe\r\n';
  assert.equal(parseClaudeLookup(out, { platform: 'win32', exists }), 'C:\\npm\\claude.cmd');
});

test('resolveUserClaudePath runs the login shell with argv, not a shell string', async () => {
  const calls = [];
  const execFake = (file, args, options) => {
    calls.push({ file, args, options });
    return Promise.resolve('/home/u/.local/bin/claude\n');
  };
  const found = await resolveUserClaudePath({
    platform: 'linux',
    env: { SHELL: '/usr/bin/bash' },
    execFile: execFake,
    exists: () => true,
  });
  assert.equal(found, '/home/u/.local/bin/claude');
  assert.equal(calls[0].file, '/usr/bin/bash');
  assert.deepEqual(calls[0].args, ['-ilc', 'command -v claude']);
  assert.equal(calls[0].options.timeout, 5000);
});

test('resolveUserClaudePath falls back to zsh and uses where on Windows', async () => {
  const calls = [];
  const execFake = (file, args) => {
    calls.push([file, args]);
    return Promise.resolve(null);
  };
  assert.equal(await resolveUserClaudePath({ platform: 'darwin', env: {}, execFile: execFake, exists: () => true }), null);
  await resolveUserClaudePath({ platform: 'win32', env: {}, execFile: execFake, exists: () => true });
  assert.deepEqual(calls[0], ['/bin/zsh', ['-ilc', 'command -v claude']]);
  assert.deepEqual(calls[1], ['where', ['claude']]);
});

test('buildChildEnv puts the Node directory first on PATH and sets YLLIR_CLAUDE_PATH', () => {
  const env = { PATH: '/usr/bin:/bin', HOME: '/h' };
  const out = buildChildEnv({ env, claudePath: '/h/.local/bin/claude', nodeDir: '/h/.yllir/node/bin' });
  assert.equal(out.PATH, '/h/.yllir/node/bin:/usr/bin:/bin');
  assert.equal(out.YLLIR_CLAUDE_PATH, '/h/.local/bin/claude');
  assert.equal(out.HOME, '/h');
  assert.equal(env.PATH, '/usr/bin:/bin', 'the input env is not changed');
  assert.equal('YLLIR_CLAUDE_PATH' in env, false);
});

test('buildChildEnv omits YLLIR_CLAUDE_PATH when nothing was found and uses ; on Windows', () => {
  const out = buildChildEnv({ env: { Path: 'C:\\Windows' }, claudePath: null, nodeDir: 'C:\\node', platform: 'win32' });
  assert.equal(out.Path, 'C:\\node;C:\\Windows');
  assert.equal('YLLIR_CLAUDE_PATH' in out, false);
  const empty = buildChildEnv({ env: {}, nodeDir: '/n', platform: 'linux' });
  assert.equal(empty.PATH, '/n');
});
