import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  defaultDataDir,
  ensureInstalled,
  installDir,
  loadManifest,
  readReady,
  resolveDataDir,
} from './install.mjs';

const FAKE_ARCHIVE = Buffer.from('fake uv archive');
const FAKE_SHA = crypto.createHash('sha256').update(FAKE_ARCHIVE).digest('hex');

function setup(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-maps-install-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  return tmp;
}

/** The real manifest, with the darwin-arm64 checksum replaced by the fake archive's. */
function fakeManifest() {
  const manifest = loadManifest();
  manifest.uv.targets['darwin-arm64'] = { ...manifest.uv.targets['darwin-arm64'], sha256: FAKE_SHA };
  return manifest;
}

/**
 * A fake runner and download. `log` records every step in order; `readyDuringPip`
 * tells whether ready.json already existed when the packages were installed.
 */
function makeFake(manifest, options = {}) {
  const log = [];
  let readyDuringPip = null;
  const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
  const fail = (code, stderr = 'failed') => ({ code, stdout: '', stderr });

  const runner = async (cmd, args, opts = {}) => {
    const name = path.basename(cmd);
    if (name === 'git') {
      const sub = args[0];
      log.push(`git:${sub}`);
      if (sub === 'clone') {
        if (options.failClone) return fail(128, 'fatal: repository not found');
        const target = args[args.length - 1];
        fs.mkdirSync(path.join(opts.cwd, target, '.git'), { recursive: true });
        return ok();
      }
      if (sub === 'sparse-checkout' || sub === 'checkout') return ok();
      if (sub === 'rev-parse') {
        const spec = args[1];
        if (spec === 'HEAD') return ok(`${manifest.commit}\n`);
        const p = spec.slice('HEAD:'.length);
        const id = options.treeIds?.[p] ?? manifest.paths[p] ?? '';
        return ok(`${id}\n`);
      }
      if (sub === 'status') return ok(options.dirty ? ' M file\n' : '');
      return fail(1);
    }
    if (name === 'tar') {
      log.push('tar');
      const dest = args[args.indexOf('-C') + 1];
      const folder = path.join(dest, 'uv-aarch64-apple-darwin');
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, 'uv'), 'fake uv binary');
      return ok();
    }
    if (name === 'uv') {
      const inst = path.dirname(opts.env.UV_CACHE_DIR);
      if (args[0] === 'venv') {
        log.push('uv:venv');
        if (options.failVenv) return fail(1, 'no python');
        const venvDir = args[args.length - 1];
        fs.mkdirSync(path.join(venvDir, 'bin'), { recursive: true });
        fs.writeFileSync(path.join(venvDir, 'bin', 'python'), 'fake python');
        return ok();
      }
      if (args[0] === 'pip') {
        log.push('uv:pip');
        readyDuringPip = fs.existsSync(path.join(inst, 'ready.json'));
        if (options.failPip) return fail(1, 'network unreachable');
        return ok();
      }
    }
    log.push(`unexpected:${name}`);
    return fail(1);
  };

  const download = async (url, dest) => {
    log.push('download');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, options.archive ?? FAKE_ARCHIVE);
  };

  return { runner, download, log, readyDuringPip: () => readyDuringPip };
}

test('resolveDataDir and defaultDataDir follow the install contract', () => {
  const tmp = path.resolve(os.tmpdir(), 'given-folder');
  assert.equal(resolveDataDir(tmp), tmp);

  const home = '/home/user';
  const darwinDefault = path.posix.join(home, 'Library', 'Application Support', 'yllir');
  assert.equal(resolveDataDir('', { platform: 'darwin', env: {}, home }), path.resolve(darwinDefault));
  assert.equal(resolveDataDir('${CLAUDE_PLUGIN_DATA}', { platform: 'darwin', env: {}, home }), path.resolve(darwinDefault));

  assert.equal(
    defaultDataDir({ platform: 'darwin', env: {}, home }),
    darwinDefault,
  );
  assert.equal(
    defaultDataDir({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, home }),
    path.win32.join('C:\\Users\\u\\AppData\\Local', 'yllir'),
  );
  assert.equal(
    defaultDataDir({ platform: 'linux', env: { XDG_DATA_HOME: '/data/xdg' }, home }),
    path.posix.join('/data/xdg', 'yllir'),
  );
  assert.equal(
    defaultDataDir({ platform: 'linux', env: {}, home }),
    path.posix.join(home, '.local', 'share', 'yllir'),
  );
});

test('happy path installs every part and writes ready.json last', async (t) => {
  const tmp = setup(t);
  const manifest = fakeManifest();
  const fake = makeFake(manifest);
  const result = await ensureInstalled({
    dataDir: tmp,
    manifest,
    runner: fake.runner,
    download: fake.download,
    platform: 'darwin',
    arch: 'arm64',
    now: () => new Date('2026-11-11T10:00:00.000Z'),
  });

  assert.equal(result.ok, true);
  const inst = installDir(tmp, manifest);
  const ready = JSON.parse(fs.readFileSync(path.join(inst, 'ready.json'), 'utf8'));
  assert.deepEqual(ready, {
    schema: 'yllir.third-party.ready.v1',
    commit: manifest.commit,
    python: path.join(inst, 'venv', 'bin', 'python'),
    generate2dmap: path.join(inst, 'repo', 'skills', 'generate2dmap'),
    generate2dmedia: path.join(inst, 'repo', 'skills', 'generate2dmedia'),
    installed: '2026-11-11T10:00:00.000Z',
  });
  assert.equal(fake.readyDuringPip(), false);
  assert.deepEqual(fake.log.slice(0, 3), ['git:clone', 'git:sparse-checkout', 'git:checkout']);
  assert.deepEqual(fake.log.slice(-4), ['download', 'tar', 'uv:venv', 'uv:pip']);
  assert.ok(fs.existsSync(path.join(inst, 'uv', 'uv')));
});

test('a second call returns ok without running any command', async (t) => {
  const tmp = setup(t);
  const manifest = fakeManifest();
  const first = makeFake(manifest);
  await ensureInstalled({ dataDir: tmp, manifest, runner: first.runner, download: first.download, platform: 'darwin', arch: 'arm64' });

  const second = makeFake(manifest);
  const result = await ensureInstalled({ dataDir: tmp, manifest, runner: second.runner, download: second.download, platform: 'darwin', arch: 'arm64' });
  assert.equal(result.ok, true);
  assert.deepEqual(second.log, []);
  assert.ok(readReady(tmp, manifest));
});

test('a wrong tree id fails with hash and removes the checkout', async (t) => {
  const tmp = setup(t);
  const manifest = fakeManifest();
  const fake = makeFake(manifest, { treeIds: { 'skills/generate2dmap': 'f'.repeat(40) } });
  const result = await ensureInstalled({ dataDir: tmp, manifest, runner: fake.runner, download: fake.download, platform: 'darwin', arch: 'arm64' });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'hash');
  const inst = installDir(tmp, manifest);
  assert.equal(fs.existsSync(path.join(inst, 'repo')), false);
  assert.equal(fs.existsSync(path.join(inst, 'ready.json')), false);
});

test('a wrong uv checksum fails with hash and leaves no uv binary', async (t) => {
  const tmp = setup(t);
  const manifest = fakeManifest();
  const fake = makeFake(manifest, { archive: Buffer.from('tampered archive') });
  const result = await ensureInstalled({ dataDir: tmp, manifest, runner: fake.runner, download: fake.download, platform: 'darwin', arch: 'arm64' });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'hash');
  assert.equal(fs.existsSync(path.join(installDir(tmp, manifest), 'uv', 'uv')), false);
});

test('a failing git clone fails with network', async (t) => {
  const tmp = setup(t);
  const manifest = fakeManifest();
  const fake = makeFake(manifest, { failClone: true });
  const result = await ensureInstalled({ dataDir: tmp, manifest, runner: fake.runner, download: fake.download, platform: 'darwin', arch: 'arm64' });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'network');
});

test('a failing uv venv fails with python', async (t) => {
  const tmp = setup(t);
  const manifest = fakeManifest();
  const fake = makeFake(manifest, { failVenv: true });
  const result = await ensureInstalled({ dataDir: tmp, manifest, runner: fake.runner, download: fake.download, platform: 'darwin', arch: 'arm64' });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'python');
  assert.equal(fs.existsSync(path.join(installDir(tmp, manifest), 'ready.json')), false);
});

test('an unknown platform fails with unsupported before any command runs', async (t) => {
  const tmp = setup(t);
  const manifest = fakeManifest();
  const fake = makeFake(manifest);
  const result = await ensureInstalled({ dataDir: tmp, manifest, runner: fake.runner, download: fake.download, platform: 'sunos', arch: 'x64' });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unsupported');
  assert.deepEqual(fake.log, []);
});

test('the real manifest pins every target and the packages', () => {
  const manifest = loadManifest();
  assert.equal(manifest.commit, '72fa5ad92d79b811acff464da32c8f3b1caa010f');
  assert.equal(manifest.python, '3.12');
  assert.deepEqual(manifest.packages, ['numpy==2.5.4', 'pillow==13.0.0', 'scipy==1.18.1']);
  assert.deepEqual(manifest.paths, {
    'skills/generate2dmap': '2dfd3ff3b9d5c17484a07eb2f3a535fa385ceaf3',
    'skills/generate2dmedia': '1af252ea217c164ddafccb78d40ee45960e81c39',
    LICENSE: '5c7720b24e8d24177847e32f8fa498328167f6ba',
  });
  assert.deepEqual(Object.keys(manifest.uv.targets).sort(), [
    'darwin-arm64',
    'darwin-x64',
    'linux-arm64',
    'linux-x64',
    'win32-arm64',
    'win32-x64',
  ]);
  assert.equal(manifest.uv.targets['darwin-arm64'].file, 'aarch64-apple-darwin.tar.gz');
  assert.equal(manifest.uv.targets['darwin-arm64'].sha256, '60fbd5c8a1ed681845eea28d9d622fcde03c51e91a43465b64a1e17db1ed3472');
  assert.equal(manifest.uv.targets['win32-x64'].file, 'x86_64-pc-windows-msvc.zip');
});
