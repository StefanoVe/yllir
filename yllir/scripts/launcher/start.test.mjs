// Tests of start.sh (macOS and Linux). A local node:http mirror serves a tiny fake
// Node archive whose sha256 is injected through YLLIR_NODE_SHA256_OVERRIDE (test only).
// PATH is limited to /usr/bin:/bin so the download branch runs, and YLLIR_HOME is a
// throwaway folder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'start.sh');
const SKIP = process.platform === 'win32' ? 'POSIX only' : false;
const VERSION = fs.readFileSync(path.join(HERE, 'node-version.txt'), 'utf8').match(/^version=(.+)$/m)[1];

function platformFile() {
  const os_ = process.platform === 'darwin' ? 'darwin' : 'linux';
  const cpu = process.arch === 'arm64' ? 'arm64' : 'x64';
  const ext = os_ === 'darwin' ? 'tar.gz' : 'tar.xz';
  return `node-v${VERSION}-${os_}-${cpu}.${ext}`;
}

/** A fake Node: answers the version check, and prints its arguments otherwise. */
const FAKE_NODE = `#!/bin/sh
if [ "$1" = "-e" ]; then exit 0; fi
echo "FAKE-NODE $*"
`;

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Builds the fake archive in `dir` and returns its path and sha256. */
function buildArchive(dir) {
  const stage = path.join(dir, 'stage');
  const top = platformFile().replace(/\.tar\.(gz|xz)$/, '');
  fs.mkdirSync(path.join(stage, top, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(stage, top, 'bin', 'node'), FAKE_NODE, { mode: 0o755 });
  const archive = path.join(dir, 'fake-node.tar.gz');
  const res = spawnSync('tar', ['-czf', archive, '-C', stage, top]);
  assert.equal(res.status, 0, res.stderr?.toString());
  return { archive, sha: sha256(archive) };
}

/** A mirror that serves the archive for any /v<version>/<file> request and records each one. */
function mirror(archive) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    if (req.url.startsWith(`/v${VERSION}/`) && fs.existsSync(archive)) {
      res.writeHead(200, { 'content-type': 'application/gzip' });
      res.end(fs.readFileSync(archive));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, hits, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

/** Runs start.sh without blocking this process, so the in-test mirror can answer. */
function runStart(args, options) {
  return new Promise((resolve) => {
    execFile('sh', [SCRIPT, ...args], { ...options, encoding: 'utf8', timeout: 60000 }, (err, stdout, stderr) => {
      resolve({ status: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr });
    });
  });
}

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-start-sh-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'yllir-home');
  fs.mkdirSync(home);
  const campaign = path.join(root, 'campaign');
  fs.mkdirSync(campaign);
  return { root, home, campaign };
}

function skipIfHostHasNode() {
  for (const dir of ['/usr/bin', '/bin']) {
    if (fs.existsSync(path.join(dir, 'node'))) return 'a node binary exists in /usr/bin or /bin';
  }
  return false;
}

test('start.sh is valid POSIX sh', { skip: SKIP }, async () => {
  const res = await new Promise((resolve) => execFile('sh', ['-n', SCRIPT], (err, _out, stderr) => resolve({ status: err ? 1 : 0, stderr })));
  assert.equal(res.status, 0, res.stderr);
});

test('start.sh uses a Node found on PATH without downloading', { skip: SKIP }, async (t) => {
  const { home, campaign, root } = setup(t);
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'node'), FAKE_NODE, { mode: 0o755 });
  const { server, hits, base } = await mirror(path.join(root, 'missing.tar.gz'));
  t.after(() => server.close());
  const res = await runStart([campaign, '--lang', 'it'], {
    env: { PATH: `${bin}:/usr/bin:/bin`, YLLIR_HOME: home, YLLIR_NODE_BASE_URL: base, HOME: root },
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /FAKE-NODE .*launch\.mjs .* --lang it/);
  assert.deepEqual(hits, []);
  assert.equal(fs.existsSync(path.join(home, 'node')), false);
});

test('start.sh downloads, verifies and installs Node when none exists', { skip: SKIP || skipIfHostHasNode() }, async (t) => {
  const { home, campaign, root } = setup(t);
  const { archive, sha } = buildArchive(root);
  const { server, hits, base } = await mirror(archive);
  t.after(() => server.close());
  const res = await runStart([campaign], {
    env: {
      PATH: '/usr/bin:/bin',
      HOME: root,
      YLLIR_HOME: home,
      YLLIR_NODE_BASE_URL: base,
      YLLIR_NODE_SHA256_OVERRIDE: sha,
    },
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /FAKE-NODE .*launch\.mjs/);
  assert.equal(hits.length, 1);
  assert.equal(hits[0], `/v${VERSION}/${platformFile()}`);
  assert.equal(fs.existsSync(path.join(home, 'node', 'bin', 'node')), true);
  assert.deepEqual(fs.readdirSync(home).filter((name) => name.startsWith('tmp.')), []);
});

test('start.sh aborts without extracting when the checksum does not match', { skip: SKIP || skipIfHostHasNode() }, async (t) => {
  const { home, campaign, root } = setup(t);
  const { archive } = buildArchive(root);
  const { server, base } = await mirror(archive);
  t.after(() => server.close());
  const res = await runStart([campaign], {
    env: {
      PATH: '/usr/bin:/bin',
      HOME: root,
      YLLIR_HOME: home,
      YLLIR_NODE_BASE_URL: base,
      YLLIR_NODE_SHA256_OVERRIDE: '0'.repeat(64),
    },
    encoding: 'utf8',
  });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /I could not download a required component/);
  assert.equal(fs.existsSync(path.join(home, 'node')), false);
  assert.deepEqual(fs.readdirSync(home).filter((name) => name.startsWith('tmp.')), []);
});

test('start.sh reports a download failure in the chosen language', { skip: SKIP || skipIfHostHasNode() }, async (t) => {
  const { home, campaign, root } = setup(t);
  const { server, base } = await mirror(path.join(root, 'none.tar.gz'));
  t.after(() => server.close());
  const res = await runStart([campaign, '--lang', 'it'], {
    env: { PATH: '/usr/bin:/bin', HOME: root, YLLIR_HOME: home, YLLIR_NODE_BASE_URL: base },
    encoding: 'utf8',
  });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Non riesco a scaricare il componente necessario/);
  assert.equal(fs.existsSync(path.join(home, 'node')), false);
});
