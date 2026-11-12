// Tests of master-screen-package.mjs. Downloads go to a local node:http server (with
// YLLIR_ALLOW_HTTP_TEST=1 passed explicitly), packages are real gzip tars made with the
// system tar, and the hostile archives are written header by header.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  compareSemver,
  downloadPackage,
  ensureMasterScreen,
  extractPackage,
  installedDir,
  isInstalled,
  newestInstalled,
  PIN_FILE,
  pruneOld,
  readPin,
} from './master-screen-package.mjs';
import { message } from './launch-lib.mjs';

const TEST_ENV = { YLLIR_ALLOW_HTTP_TEST: '1' };
const PIN_VERSION = '0.2.7';
const PIN_URL = `https://github.com/StefanoVe/yllir-development/releases/download/master-screen-v${PIN_VERSION}/yllir-master-screen-${PIN_VERSION}.tar.gz`;

function tempDir(t, prefix = 'yllir-msp-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A source folder with the three files a real package has. */
function sourceFolder(t, { withIndex = true } = {}) {
  const src = tempDir(t, 'yllir-msp-src-');
  fs.writeFileSync(path.join(src, 'server.mjs'), 'console.log("server");\n');
  fs.writeFileSync(path.join(src, 'VERSION'), `${PIN_VERSION}\n`);
  fs.mkdirSync(path.join(src, 'public'));
  if (withIndex) fs.writeFileSync(path.join(src, 'public', 'index.html'), '<!doctype html>\n');
  return src;
}

/** A real package built with the system tar: server.mjs, public/ and VERSION at the root. */
function realPackage(t, options) {
  const src = sourceFolder(t, options);
  const tgz = path.join(tempDir(t), 'yllir-master-screen.tar.gz');
  execFileSync('tar', ['-czf', tgz, '-C', src, 'server.mjs', 'public', 'VERSION'], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  });
  const buf = fs.readFileSync(tgz);
  return { file: tgz, buf, sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length };
}

/** A 512-byte ustar header and the padded body, written by hand. */
function tarEntry(name, { type = '0', body = Buffer.alloc(0), linkname = '' } = {}) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii');
  header.write('        ', 148, 8, 'ascii');
  header.write(type, 156, 1, 'ascii');
  header.write(linkname, 157, 100, 'utf8');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  const padded = Math.ceil(body.length / 512) * 512;
  return Buffer.concat([header, body, Buffer.alloc(padded - body.length)]);
}

function handmadeTgz(entries) {
  return zlib.gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
}

/** Writes a tar.gz to a file and returns its path. */
function writeArchive(t, buf) {
  const file = path.join(tempDir(t), 'hostile.tar.gz');
  fs.writeFileSync(file, buf);
  return file;
}

/** A local http server. `handler(req, res)` answers; resolves { base, server }. */
function serve(t, handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.on('clientError', (err, socket) => socket.destroy(err));
    server.listen(0, '127.0.0.1', () => {
      t.after(() => {
        server.closeAllConnections();
        server.close();
      });
      resolve({ base: `http://127.0.0.1:${server.address().port}`, server });
    });
  });
}

/** Lists the leftover temp folders under <home>/master-screen (none when the folder is absent). */
function leftovers(home) {
  try {
    return fs.readdirSync(path.join(home, 'master-screen')).filter((name) => name.startsWith('.tmp-'));
  } catch {
    return [];
  }
}

function writePin(root, overrides = {}) {
  const pin = {
    version: PIN_VERSION,
    sha256: 'a'.repeat(64),
    url: PIN_URL,
    size: 1234567,
    ...overrides,
  };
  for (const key of Object.keys(overrides)) if (overrides[key] === undefined) delete pin[key];
  fs.writeFileSync(path.join(root, PIN_FILE), JSON.stringify(pin));
}

/** Installs a fake verified version (marker and server.mjs) under the home. */
function installFake(home, version, { verified = true } = {}) {
  const dir = installedDir(home, version);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'server.mjs'), `// ${version}\n`);
  if (verified) fs.writeFileSync(path.join(dir, '.verified'), '{}\n');
  return dir;
}

test('readPin accepts a valid pin and ignores unknown keys', (t) => {
  const root = tempDir(t);
  writePin(root, { note: 'extra' });
  assert.deepEqual(readPin(root), { version: PIN_VERSION, sha256: 'a'.repeat(64), url: PIN_URL, size: 1234567 });
});

test('readPin lowercases the sha256 and accepts the size cap exactly', (t) => {
  const root = tempDir(t);
  writePin(root, { sha256: 'AB'.repeat(32), size: 100 * 1024 * 1024 });
  const pin = readPin(root);
  assert.equal(pin.sha256, 'ab'.repeat(32));
  assert.equal(pin.size, 100 * 1024 * 1024);
});

test('readPin returns null when the file is missing or not JSON', (t) => {
  const root = tempDir(t);
  assert.equal(readPin(root), null);
  fs.writeFileSync(path.join(root, PIN_FILE), '{ not json');
  assert.equal(readPin(root), null);
  fs.writeFileSync(path.join(root, PIN_FILE), '[]');
  assert.equal(readPin(root), null);
});

test('readPin refuses every bad field', (t) => {
  const root = tempDir(t);
  const bad = [
    { version: '0.2' },
    { version: '0.2.7-beta' },
    { version: 27 },
    { sha256: 'a'.repeat(63) },
    { sha256: 'g'.repeat(64) },
    { sha256: undefined },
    { url: 'http://github.com/StefanoVe/yllir-development/releases/download/master-screen-v0.2.7/yllir-master-screen-0.2.7.tar.gz' },
    { url: 'https://evil.example.com/StefanoVe/yllir-development/releases/download/master-screen-v0.2.7/yllir-master-screen-0.2.7.tar.gz' },
    { url: 'https://github.com.evil.example/StefanoVe/yllir-development/releases/download/master-screen-v0.2.7/yllir-master-screen-0.2.7.tar.gz' },
    { url: PIN_URL.replace('master-screen-v0.2.7', 'master-screen-v0.2.6') },
    { url: PIN_URL.replace('yllir-master-screen-0.2.7', 'yllir-master-screen-0.2.6') },
    { url: `${PIN_URL}?download=1` },
    { url: PIN_URL.replace('.tar.gz', '.zip') },
    { url: 'https://github.com/../yllir-development/releases/download/master-screen-v0.2.7/yllir-master-screen-0.2.7.tar.gz' },
    { size: 0 },
    { size: -5 },
    { size: 1.5 },
    { size: '1234' },
    { size: 100 * 1024 * 1024 + 1 },
    { size: undefined },
  ];
  for (const overrides of bad) {
    writePin(root, overrides);
    assert.equal(readPin(root), null, JSON.stringify(overrides));
  }
});

test('compareSemver orders numerically, not as text', () => {
  assert.ok(compareSemver('0.10.0', '0.9.0') > 0);
  assert.ok(compareSemver('0.2.10', '0.2.9') > 0);
  assert.equal(compareSemver('1.2.3', '1.2.3'), 0);
});

test('newestInstalled picks the highest verified version', (t) => {
  const home = tempDir(t);
  installFake(home, '0.9.0');
  installFake(home, '0.10.0');
  installFake(home, '0.2.10');
  installFake(home, '0.11.0', { verified: false });
  assert.equal(newestInstalled(home), '0.10.0');
  assert.equal(newestInstalled(tempDir(t)), null);
});

test('a version folder without the .verified marker is not installed', (t) => {
  const home = tempDir(t);
  installFake(home, '0.2.7', { verified: false });
  assert.equal(isInstalled(home, '0.2.7'), false);
  assert.equal(newestInstalled(home), null);
});

test('downloadPackage streams the bytes into a temp folder and checks the sha256', async (t) => {
  const pkg = realPackage(t);
  const { base } = await serve(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'application/gzip' });
    res.end(pkg.buf);
  });
  const home = tempDir(t);
  const result = await downloadPackage({
    url: `${base}/pkg.tar.gz`,
    sha256: pkg.sha256,
    size: pkg.size,
    dest: home,
    env: TEST_ENV,
  });
  assert.deepEqual(fs.readFileSync(result.file), pkg.buf);
  assert.equal(path.dirname(result.file), result.tmpDir);
  assert.match(path.basename(result.tmpDir), /^\.tmp-/);
  fs.rmSync(result.tmpDir, { recursive: true, force: true });
});

test('a checksum mismatch deletes the temp file and installs nothing', async (t) => {
  const pkg = realPackage(t);
  const { base } = await serve(t, (req, res) => res.end(pkg.buf));
  const home = tempDir(t);
  await assert.rejects(
    downloadPackage({ url: `${base}/pkg.tar.gz`, sha256: 'b'.repeat(64), size: pkg.size, dest: home, env: TEST_ENV }),
    (err) => err.code === 'bad-package',
  );
  assert.deepEqual(leftovers(home), []);
  assert.equal(newestInstalled(home), null);
});

test('a download larger than size plus 1 MB is aborted and removed', async (t) => {
  const { base } = await serve(t, (req, res) => {
    res.writeHead(200);
    res.end(Buffer.alloc(3 * 1024 * 1024, 7));
  });
  const home = tempDir(t);
  await assert.rejects(
    downloadPackage({ url: `${base}/big.tar.gz`, sha256: 'c'.repeat(64), size: 1000, dest: home, env: TEST_ENV }),
    (err) => err.code === 'download-failed',
  );
  assert.deepEqual(leftovers(home), []);
});

test('a redirect to a host outside the allow-list is refused without a request', async (t) => {
  let hits = 0;
  const { base } = await serve(t, (req, res) => {
    hits += 1;
    res.writeHead(302, { location: 'https://example.com/steal.tar.gz' });
    res.end();
  });
  const home = tempDir(t);
  await assert.rejects(
    downloadPackage({ url: `${base}/start`, sha256: 'd'.repeat(64), size: 10, dest: home, env: TEST_ENV }),
    (err) => err.code === 'download-failed',
  );
  assert.equal(hits, 1);
  assert.deepEqual(leftovers(home), []);
});

test('a redirect to an allowed host is followed', async (t) => {
  const pkg = realPackage(t);
  const { base } = await serve(t, (req, res) => {
    if (req.url === '/start') {
      res.writeHead(302, { location: '/final.tar.gz' });
      res.end();
      return;
    }
    res.writeHead(200);
    res.end(pkg.buf);
  });
  const home = tempDir(t);
  const result = await downloadPackage({
    url: `${base}/start`,
    sha256: pkg.sha256,
    size: pkg.size,
    dest: home,
    env: TEST_ENV,
  });
  assert.deepEqual(fs.readFileSync(result.file), pkg.buf);
  fs.rmSync(result.tmpDir, { recursive: true, force: true });
});

test('more than 3 redirects fail', async (t) => {
  const { base } = await serve(t, (req, res) => {
    res.writeHead(302, { location: '/again' });
    res.end();
  });
  await assert.rejects(
    downloadPackage({ url: `${base}/x`, sha256: 'e'.repeat(64), size: 10, dest: tempDir(t), env: TEST_ENV }),
    (err) => err.code === 'download-failed',
  );
});

test('a 404 answer fails with download-failed', async (t) => {
  const { base } = await serve(t, (req, res) => {
    res.writeHead(404);
    res.end('missing');
  });
  const home = tempDir(t);
  await assert.rejects(
    downloadPackage({ url: `${base}/gone.tar.gz`, sha256: 'f'.repeat(64), size: 10, dest: home, env: TEST_ENV }),
    (err) => err.code === 'download-failed',
  );
  assert.deepEqual(leftovers(home), []);
});

test('a stalled download fails after the idle timeout', async (t) => {
  const { base } = await serve(t, (req, res) => {
    res.writeHead(200);
    res.write('partial');
  });
  const home = tempDir(t);
  await assert.rejects(
    downloadPackage({
      url: `${base}/slow.tar.gz`,
      sha256: 'a'.repeat(64),
      size: 1000,
      dest: home,
      env: TEST_ENV,
      idleTimeoutMs: 200,
    }),
    (err) => err.code === 'download-failed',
  );
  assert.deepEqual(leftovers(home), []);
});

test('plain http is refused without the test flag', async (t) => {
  const { base } = await serve(t, (req, res) => res.end('x'));
  await assert.rejects(
    downloadPackage({ url: `${base}/p.tar.gz`, sha256: 'a'.repeat(64), size: 10, dest: tempDir(t), env: {} }),
    (err) => err.code === 'download-failed',
  );
});

test('extractPackage installs a real package atomically with the marker', (t) => {
  const pkg = realPackage(t);
  const home = tempDir(t);
  const dest = installedDir(home, PIN_VERSION);
  const result = extractPackage(pkg.file, dest);
  return result.then((out) => {
    assert.deepEqual(out, { installed: true });
    assert.ok(fs.existsSync(path.join(dest, 'server.mjs')));
    assert.ok(fs.existsSync(path.join(dest, 'public', 'index.html')));
    assert.ok(fs.existsSync(path.join(dest, '.verified')));
    assert.equal(isInstalled(home, PIN_VERSION), true);
    assert.deepEqual(leftovers(home), []);
  });
});

test('extractPackage keeps an existing verified install (race) and drops its own copy', async (t) => {
  const pkg = realPackage(t);
  const home = tempDir(t);
  const dest = installFake(home, PIN_VERSION);
  const out = await extractPackage(pkg.file, dest);
  assert.deepEqual(out, { installed: false });
  assert.equal(fs.readFileSync(path.join(dest, 'server.mjs'), 'utf8'), `// ${PIN_VERSION}\n`);
  assert.deepEqual(leftovers(home), []);
});

test('extractPackage replaces a folder that has no marker', async (t) => {
  const pkg = realPackage(t);
  const home = tempDir(t);
  const dest = installFake(home, PIN_VERSION, { verified: false });
  const out = await extractPackage(pkg.file, dest);
  assert.deepEqual(out, { installed: true });
  assert.equal(isInstalled(home, PIN_VERSION), true);
});

test('extractPackage needs public/index.html', async (t) => {
  const pkg = realPackage(t, { withIndex: false });
  const home = tempDir(t);
  const dest = installedDir(home, PIN_VERSION);
  await assert.rejects(extractPackage(pkg.file, dest), (err) => err.code === 'bad-package');
  assert.equal(fs.existsSync(dest), false);
  assert.deepEqual(leftovers(home), []);
});

const HOSTILE = {
  'a parent folder entry (../evil)': [tarEntry('../evil.mjs', { body: Buffer.from('x') })],
  'an absolute path': [tarEntry('/tmp/evil.mjs', { body: Buffer.from('x') })],
  'a symlink entry': [tarEntry('server.mjs', { type: '2', linkname: '/etc/passwd' })],
  'a hard link entry': [tarEntry('public/hard.html', { type: '1', linkname: 'server.mjs' })],
  'a file outside the allowed names': [tarEntry('secret.txt', { body: Buffer.from('x') })],
  'a parent folder inside public': [tarEntry('public/../../evil.mjs', { body: Buffer.from('x') })],
};

for (const [label, entries] of Object.entries(HOSTILE)) {
  test(`extractPackage refuses an archive with ${label}`, async (t) => {
    const file = writeArchive(t, handmadeTgz(entries));
    const home = tempDir(t);
    const dest = installedDir(home, PIN_VERSION);
    await assert.rejects(extractPackage(file, dest), (err) => err.code === 'bad-package');
    assert.equal(fs.existsSync(dest), false);
    assert.deepEqual(leftovers(home), []);
    assert.equal(fs.existsSync(path.join(home, 'evil.mjs')), false);
  });
}

test('an empty or unreadable archive is refused as bad-package', async (t) => {
  const home = tempDir(t);
  const file = writeArchive(t, Buffer.from('not a tar at all'));
  await assert.rejects(extractPackage(file, installedDir(home, PIN_VERSION)), (err) => err.code === 'bad-package');
  assert.deepEqual(leftovers(home), []);
});

/** Makes a temp folder under <home>/master-screen/ that is `ageMs` old. */
function tempFolder(home, name, ageMs) {
  const dir = path.join(home, 'master-screen', name);
  fs.mkdirSync(dir, { recursive: true });
  const when = new Date(Date.now() - ageMs);
  fs.utimesSync(dir, when, when);
  return dir;
}

const TWO_HOURS = 2 * 60 * 60 * 1000;

function masterScreenEntries(home) {
  return fs.readdirSync(path.join(home, 'master-screen')).sort();
}

test('pruneOld keeps only the given version and removes stale temp folders', (t) => {
  const home = tempDir(t);
  for (const v of ['0.1.0', '0.2.0', '0.3.0', '0.4.0']) installFake(home, v);
  tempFolder(home, '.tmp-old', TWO_HOURS);
  tempFolder(home, '.tmp-new', 0);

  pruneOld(home, '0.3.0');

  assert.deepEqual(masterScreenEntries(home), ['.tmp-new', '0.3.0']);
});

test('pruneOld never throws when the home has no master-screen folder', (t) => {
  assert.doesNotThrow(() => pruneOld(tempDir(t), '0.1.0'));
});

test('ensureMasterScreen on an installed pin keeps only that version and removes stale temp folders', async (t) => {
  const root = tempDir(t);
  writePin(root);
  const home = tempDir(t);
  installFake(home, '0.1.0');
  installFake(home, '0.2.6');
  installFake(home, PIN_VERSION);
  tempFolder(home, '.tmp-old', TWO_HOURS);
  tempFolder(home, '.tmp-live', 0);

  const res = await ensureMasterScreen({
    frameworkRoot: root,
    home,
    env: {},
    fetchImpl: async () => {
      throw new Error('network must not be used');
    },
  });

  assert.equal(res.source, 'installed');
  assert.deepEqual(masterScreenEntries(home), ['.tmp-live', PIN_VERSION]);
});

test('ensureMasterScreen on a fallback keeps only the fallback version', async (t) => {
  const root = tempDir(t);
  writePin(root);
  const home = tempDir(t);
  installFake(home, '0.1.0');
  installFake(home, '0.2.3');
  installFake(home, '0.2.5');
  tempFolder(home, '.tmp-old', TWO_HOURS);

  const res = await ensureMasterScreen({
    frameworkRoot: root,
    home,
    env: {},
    say: () => {},
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });

  assert.equal(res.source, 'fallback');
  assert.equal(res.version, '0.2.5');
  assert.deepEqual(masterScreenEntries(home), ['0.2.5']);
});

test('ensureMasterScreen prunes nothing when no version is usable', async (t) => {
  const root = tempDir(t);
  writePin(root);
  const home = tempDir(t);
  installFake(home, '0.1.0', { verified: false });
  installFake(home, '0.2.0', { verified: false });
  tempFolder(home, '.tmp-old', TWO_HOURS);

  const res = await ensureMasterScreen({
    frameworkRoot: root,
    home,
    env: {},
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });

  assert.deepEqual(res, { error: 'download-failed' });
  assert.deepEqual(masterScreenEntries(home), ['.tmp-old', '0.1.0', '0.2.0']);
});

test('ensureMasterScreen prunes nothing when the download fails the checksum', async (t) => {
  const pkg = realPackage(t);
  const root = tempDir(t);
  writePin(root, { sha256: '0'.repeat(64), size: pkg.size });
  const home = tempDir(t);
  installFake(home, '0.1.0', { verified: false });

  const res = await ensureMasterScreen({
    frameworkRoot: root,
    home,
    env: {},
    fetchImpl: async () => new Response(pkg.buf, { status: 200 }),
  });

  assert.deepEqual(res, { error: 'bad-package' });
  assert.deepEqual(masterScreenEntries(home), ['0.1.0']);
});

test('a folder that cannot be removed is skipped and the start still succeeds', async (t) => {
  if (process.platform === 'win32' || process.getuid?.() === 0) {
    t.skip('needs a non-root POSIX user to make a folder read-only');
    return;
  }
  // Registered before the temp dirs so it runs before their cleanup (hooks run in order).
  let base = null;
  t.after(() => {
    if (base) fs.chmodSync(base, 0o700);
  });
  const root = tempDir(t);
  writePin(root);
  const home = tempDir(t);
  installFake(home, PIN_VERSION);
  installFake(home, '0.1.0');
  base = path.join(home, 'master-screen');
  fs.chmodSync(base, 0o500);

  const res = await ensureMasterScreen({
    frameworkRoot: root,
    home,
    env: {},
    fetchImpl: async () => {
      throw new Error('network must not be used');
    },
  });

  // rmSync may empty the folder's own files before it fails on the read-only parent; the folder
  // then has no marker, is never treated as installed, and is removed on a later start.
  assert.equal(res.source, 'installed');
  assert.ok(fs.existsSync(installedDir(home, '0.1.0')));
});

test('ensureMasterScreen uses the env override first and never touches the network', async (t) => {
  const root = tempDir(t);
  writePin(root);
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, 'server.mjs'), '//\n');
  const res = await ensureMasterScreen({
    frameworkRoot: root,
    home: tempDir(t),
    env: { YLLIR_MASTER_SCREEN_DIR: dir },
    fetchImpl: async () => {
      throw new Error('network must not be used');
    },
  });
  assert.deepEqual(res, { serverFile: path.join(dir, 'server.mjs'), source: 'env' });
});

test('ensureMasterScreen uses the legacy bundled build when present, before any pin', async (t) => {
  const root = tempDir(t);
  writePin(root);
  fs.mkdirSync(path.join(root, 'master-screen'));
  fs.writeFileSync(path.join(root, 'master-screen', 'server.mjs'), '//\n');
  const res = await ensureMasterScreen({
    frameworkRoot: root,
    home: tempDir(t),
    env: {},
    fetchImpl: async () => {
      throw new Error('network must not be used');
    },
  });
  assert.deepEqual(res, { serverFile: path.join(root, 'master-screen', 'server.mjs'), source: 'bundled' });
});

test('ensureMasterScreen uses the pinned version when it is already installed', async (t) => {
  const root = tempDir(t);
  writePin(root);
  const home = tempDir(t);
  installFake(home, PIN_VERSION);
  const res = await ensureMasterScreen({
    frameworkRoot: root,
    home,
    env: {},
    fetchImpl: async () => {
      throw new Error('network must not be used');
    },
  });
  assert.deepEqual(res, {
    serverFile: path.join(installedDir(home, PIN_VERSION), 'server.mjs'),
    source: 'installed',
    version: PIN_VERSION,
  });
});

test('ensureMasterScreen downloads the pin, installs it and prunes old versions', async (t) => {
  const pkg = realPackage(t);
  const root = tempDir(t);
  writePin(root, { sha256: pkg.sha256, size: pkg.size });
  const home = tempDir(t);
  installFake(home, '0.1.0');
  installFake(home, '0.2.5');
  installFake(home, '0.2.6');
  const said = [];
  const res = await ensureMasterScreen({
    frameworkRoot: root,
    home,
    env: {},
    lang: 'en',
    say: (text) => said.push(text),
    fetchImpl: async () => new Response(pkg.buf, { status: 200 }),
  });
  assert.equal(res.source, 'downloaded');
  assert.equal(res.version, PIN_VERSION);
  assert.ok(fs.existsSync(res.serverFile));
  assert.deepEqual(said, [message('M6', 'en')]);
  assert.deepEqual(masterScreenEntries(home), [PIN_VERSION]);
});

test('ensureMasterScreen falls back to the newest installed version when offline', async (t) => {
  const root = tempDir(t);
  writePin(root);
  const home = tempDir(t);
  installFake(home, '0.1.0');
  installFake(home, '0.2.3');
  const said = [];
  const res = await ensureMasterScreen({
    frameworkRoot: root,
    home,
    env: {},
    lang: 'it',
    say: (text) => said.push(text),
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });
  assert.deepEqual(res, {
    serverFile: path.join(installedDir(home, '0.2.3'), 'server.mjs'),
    source: 'fallback',
    version: '0.2.3',
  });
  assert.deepEqual(said, [message('M6', 'it'), message('M8', 'it')]);
  assert.deepEqual(masterScreenEntries(home), ['0.2.3']);
});

test('ensureMasterScreen reports download-failed when offline and nothing is installed', async (t) => {
  const root = tempDir(t);
  writePin(root);
  const home = tempDir(t);
  const res = await ensureMasterScreen({
    frameworkRoot: root,
    home,
    env: {},
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });
  assert.deepEqual(res, { error: 'download-failed' });
  assert.deepEqual(leftovers(home), []);
});

test('ensureMasterScreen reports bad-package when the download does not match the pin', async (t) => {
  const pkg = realPackage(t);
  const root = tempDir(t);
  writePin(root, { sha256: '0'.repeat(64), size: pkg.size });
  const home = tempDir(t);
  const res = await ensureMasterScreen({
    frameworkRoot: root,
    home,
    env: {},
    fetchImpl: async () => new Response(pkg.buf, { status: 200 }),
  });
  assert.deepEqual(res, { error: 'bad-package' });
  assert.equal(newestInstalled(home), null);
});

test('ensureMasterScreen ignores an installed folder without the marker', async (t) => {
  const root = tempDir(t);
  writePin(root);
  const home = tempDir(t);
  installFake(home, PIN_VERSION, { verified: false });
  const res = await ensureMasterScreen({
    frameworkRoot: root,
    home,
    env: {},
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });
  assert.deepEqual(res, { error: 'download-failed' });
});

test('ensureMasterScreen reports no-package without a pin and without an installed copy', async (t) => {
  const root = tempDir(t);
  const res = await ensureMasterScreen({
    frameworkRoot: root,
    home: tempDir(t),
    env: {},
    fetchImpl: async () => {
      throw new Error('network must not be used');
    },
  });
  assert.deepEqual(res, { error: 'no-package' });
});

test('the package messages exist in both languages', () => {
  assert.match(message('M6', 'it'), /Scarico il master screen/);
  assert.match(message('M7', 'en'), /could not download the master screen/);
  assert.match(message('M8', 'it'), /già presente/);
});
