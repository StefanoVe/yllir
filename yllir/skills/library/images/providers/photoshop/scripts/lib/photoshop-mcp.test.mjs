import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import {
  loadManifest,
  installDir,
  findPhotoshop,
  readReady,
  ensureInstalled,
  emptyServer,
} from './photoshop-mcp.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../..');
const manifest = loadManifest(pluginRoot);

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-ps-test-'));
}

function writeReady(dataDir, overrides = {}) {
  const dir = installDir(dataDir, manifest);
  fs.mkdirSync(dir, { recursive: true });
  const entry = path.join(dir, 'entry.js');
  fs.writeFileSync(entry, '');
  const ready = { schema: 'yllir.third-party.ready.v1', id: manifest.id, version: manifest.version, entry, ...overrides };
  fs.writeFileSync(path.join(dir, 'ready.json'), JSON.stringify(ready));
  return ready;
}

/** A runner that stands in for `npm ci`: it writes the installed package unless told otherwise. */
function fakeNpm({ version = manifest.version, code = 0, error, timedOut = false, onCall } = {}) {
  const calls = [];
  const runner = async (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts.cwd });
    if (onCall) onCall(opts.cwd);
    if (error) return { code: null, error, timedOut: false, stdout: '', stderr: '' };
    if (timedOut) return { code: null, timedOut: true, stdout: '', stderr: '' };
    if (code !== 0) return { code, timedOut: false, stdout: '', stderr: 'boom' };
    const pkg = path.join(opts.cwd, 'node_modules', '@alisaitteke', 'photoshop-mcp');
    fs.mkdirSync(path.join(pkg, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@alisaitteke/photoshop-mcp', version }));
    fs.writeFileSync(path.join(pkg, manifest.bin), '');
    return { code: 0, timedOut: false, stdout: '', stderr: '' };
  };
  return { runner, calls };
}

test('the manifest pins the version and a sha512 integrity', () => {
  assert.equal(manifest.package, '@alisaitteke/photoshop-mcp');
  assert.equal(manifest.version, '1.7.37');
  assert.match(manifest.integrity, /^sha512-/);
  assert.equal(manifest.bin, 'dist/index.js');
});

test('installDir is <dataDir>/third-party/photoshop-mcp/<version>', () => {
  assert.equal(installDir('/data/y', manifest), path.resolve('/data/y', 'third-party', 'photoshop-mcp', '1.7.37'));
});

test('findPhotoshop picks the newest Adobe Photoshop folder on darwin', () => {
  const found = findPhotoshop({
    platform: 'darwin',
    exists: () => true,
    list: () => ['Safari', 'Adobe Photoshop 2024', 'Adobe Photoshop 2025', 'Adobe Premiere Pro 2025'],
  });
  assert.equal(found, '/Applications/Adobe Photoshop 2025');
});

test('findPhotoshop returns null when no Photoshop folder exists', () => {
  assert.equal(findPhotoshop({ platform: 'darwin', exists: () => true, list: () => ['Safari'] }), null);
  assert.equal(findPhotoshop({ platform: 'darwin', exists: () => true, list: () => [] }), null);
});

test('findPhotoshop looks under Program Files on win32', () => {
  const found = findPhotoshop({
    platform: 'win32',
    exists: () => true,
    list: (dir) => {
      assert.equal(dir, 'C:\\Program Files\\Adobe');
      return ['Adobe Photoshop 2024', 'Adobe Photoshop 2025'];
    },
  });
  assert.equal(found, path.win32.join('C:\\Program Files\\Adobe', 'Adobe Photoshop 2025'));
});

test('findPhotoshop is null on other platforms', () => {
  assert.equal(findPhotoshop({ platform: 'linux', exists: () => true, list: () => ['Adobe Photoshop 2025'] }), null);
});

test('readReady accepts a valid ready.json with an existing entry', () => {
  const dataDir = tempDir();
  const ready = writeReady(dataDir);
  assert.equal(readReady(dataDir, manifest).entry, ready.entry);
});

test('readReady rejects invalid JSON, a version mismatch and a missing entry', () => {
  const dataDir = tempDir();
  const dir = installDir(dataDir, manifest);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ready.json'), '{not json');
  assert.equal(readReady(dataDir, manifest), null);

  writeReady(dataDir, { version: '1.7.38' });
  assert.equal(readReady(dataDir, manifest), null);

  writeReady(dataDir, { entry: path.join(dir, 'missing.js') });
  assert.equal(readReady(dataDir, manifest), null);
});

test('readReady is null when nothing is installed', () => {
  assert.equal(readReady(tempDir(), manifest), null);
});

test('ensureInstalled installs, and writes ready.json only after npm ci', async () => {
  const dataDir = tempDir();
  const dir = installDir(dataDir, manifest);
  const readyFile = path.join(dir, 'ready.json');
  let readyAtInstall = 'unset';
  let copiedAtInstall = false;
  const { runner, calls } = fakeNpm({
    onCall: (cwd) => {
      readyAtInstall = fs.existsSync(readyFile);
      copiedAtInstall = fs.existsSync(path.join(cwd, 'package.json')) && fs.existsSync(path.join(cwd, 'package-lock.json'));
    },
  });

  const result = await ensureInstalled({ pluginRoot, dataDir, runner, now: () => Date.now() });

  assert.equal(result.ok, true);
  assert.equal(readyAtInstall, false);
  assert.equal(copiedAtInstall, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['ci', '--no-audit', '--no-fund']);
  assert.equal(calls[0].cwd, dir);
  assert.equal(result.entry, path.join(dir, 'node_modules', '@alisaitteke', 'photoshop-mcp', 'dist', 'index.js'));
  const ready = JSON.parse(fs.readFileSync(readyFile, 'utf8'));
  assert.equal(ready.schema, 'yllir.third-party.ready.v1');
  assert.equal(ready.entry, result.entry);
  assert.equal(fs.existsSync(`${dir}.lock`), false);
});

test('ensureInstalled does nothing when already ready', async () => {
  const dataDir = tempDir();
  const ready = writeReady(dataDir);
  const { runner, calls } = fakeNpm();
  const result = await ensureInstalled({ pluginRoot, dataDir, runner });
  assert.deepEqual(result, { ok: true, entry: ready.entry });
  assert.equal(calls.length, 0);
});

test('a failing npm ci gives install-failed and no ready.json', async () => {
  const dataDir = tempDir();
  const { runner } = fakeNpm({ code: 1 });
  const result = await ensureInstalled({ pluginRoot, dataDir, runner });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'install-failed');
  assert.equal(fs.existsSync(path.join(installDir(dataDir, manifest), 'ready.json')), false);
  assert.equal(fs.existsSync(`${installDir(dataDir, manifest)}.lock`), false);
});

test('a wrong installed version gives integrity', async () => {
  const dataDir = tempDir();
  const { runner } = fakeNpm({ version: '1.7.38' });
  const result = await ensureInstalled({ pluginRoot, dataDir, runner });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'integrity');
  assert.equal(fs.existsSync(path.join(installDir(dataDir, manifest), 'ready.json')), false);
});

test('a missing npm gives no-npm', async () => {
  const dataDir = tempDir();
  const { runner } = fakeNpm({ error: 'ENOENT' });
  const result = await ensureInstalled({ pluginRoot, dataDir, runner });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-npm');
});

test('a timed out npm ci gives timeout', async () => {
  const dataDir = tempDir();
  const { runner } = fakeNpm({ timedOut: true });
  const result = await ensureInstalled({ pluginRoot, dataDir, runner });
  assert.equal(result.reason, 'timeout');
});

test('a fresh lock held by another session gives busy and runs nothing', async () => {
  const dataDir = tempDir();
  const lock = `${installDir(dataDir, manifest)}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, 'other');
  const { runner, calls } = fakeNpm();
  const result = await ensureInstalled({ pluginRoot, dataDir, runner });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'busy');
  assert.equal(calls.length, 0);
  assert.equal(fs.existsSync(lock), true, 'the other session keeps its lock');
});

test('a stale lock is removed and the install goes on', async () => {
  const dataDir = tempDir();
  const lock = `${installDir(dataDir, manifest)}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, 'old');
  const old = new Date(Date.now() - 20 * 60 * 1000);
  fs.utimesSync(lock, old, old);
  const { runner, calls } = fakeNpm();
  const result = await ensureInstalled({ pluginRoot, dataDir, runner });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(fs.existsSync(lock), false);
});

test('emptyServer answers initialize, tools/list and ping, rejects unknown methods, ignores notifications', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const done = emptyServer(input, output);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'resources/list' })}\n`);
  input.end();
  await done;
  output.end();
  let text = '';
  for await (const chunk of output) text += chunk;
  const lines = text.trim().split('\n').map((line) => JSON.parse(line));

  assert.equal(lines.length, 3);
  assert.equal(lines[0].id, 1);
  assert.equal(lines[0].result.protocolVersion, '2025-06-18');
  assert.deepEqual(lines[0].result.capabilities, { tools: {} });
  assert.deepEqual(lines[0].result.serverInfo, { name: 'yllir-photoshop', version: '0' });
  assert.deepEqual(lines[1], { jsonrpc: '2.0', id: 2, result: { tools: [] } });
  assert.equal(lines[2].id, 3);
  assert.equal(lines[2].error.code, -32601);
});
