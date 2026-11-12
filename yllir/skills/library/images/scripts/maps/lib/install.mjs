// Installs the pinned third-party map tools (agent-sprite-forge) outside every campaign:
// a sparse code checkout, a uv binary, a Python 3.12 venv and three packages.
// Idempotent: each step is skipped when its result already exists, and ready.json is
// written last, only when everything succeeded.

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = 'yllir.third-party.ready.v1';
const MESSAGE_LIMIT = 200;
const DEFAULT_PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..');

/** A step failure carrying one of the reasons of the contract. */
class StepError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

function oneLine(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function failure(reason, message) {
  const text = oneLine(message);
  return { ok: false, reason, message: text.length > MESSAGE_LIMIT ? text.slice(0, MESSAGE_LIMIT) : text };
}

/** Reads the pinned manifest of the third-party tools. */
export function loadManifest(pluginRoot = DEFAULT_PLUGIN_ROOT) {
  const file = path.join(pluginRoot, 'modules', 'third-party', 'agent-sprite-forge.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** The OS default data folder, per platform. */
export function defaultDataDir({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', 'yllir');
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local');
    return path.win32.join(base, 'yllir');
  }
  const xdg = env.XDG_DATA_HOME;
  const base = xdg && xdg !== '' ? xdg : path.posix.join(home, '.local', 'share');
  return path.posix.join(base, 'yllir');
}

/** The given folder when it is usable, else the OS default. Always absolute. */
export function resolveDataDir(given, opts = {}) {
  if (typeof given === 'string' && given !== '' && !given.includes('${')) return path.resolve(given);
  return path.resolve(defaultDataDir(opts));
}

/** The folder of the pinned installation inside the data folder. */
export function installDir(dataDir, manifest) {
  return path.resolve(dataDir, 'third-party', manifest.id, manifest.commit);
}

/** The Python of the venv, per platform. `dir` is the installation folder. */
export function venvPython(dir, platform = process.platform) {
  return platform === 'win32'
    ? path.join(dir, 'venv', 'Scripts', 'python.exe')
    : path.join(dir, 'venv', 'bin', 'python');
}

/** The parsed ready.json when the installation is complete and matches the pinned commit, else null. */
export function readReady(dataDir, manifest) {
  const file = path.join(installDir(dataDir, manifest), 'ready.json');
  let ready;
  try {
    ready = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!ready || ready.schema !== SCHEMA || ready.commit !== manifest.commit) return null;
  if (typeof ready.python !== 'string' || !fs.existsSync(ready.python)) return null;
  return ready;
}

/** Runs a command without a shell. Resolves to { code, stdout, stderr }; never rejects. */
export function defaultRunner(cmd, args, { cwd, env, timeoutMs = 900000 } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;
    const finish = (code, extra = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr: stderr + extra });
    };

    let child;
    try {
      child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ code: 127, stdout: '', stderr: err.message });
      return;
    }
    timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(124, 'timed out');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (err) => finish(err.code === 'ENOENT' ? 127 : 1, err.message));
    child.on('close', (code) => finish(code ?? 1));
  });
}

/** Downloads a URL into destFile. Rejects on a non-2xx answer. */
export async function defaultDownload(url, destFile) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  fs.writeFileSync(destFile, Buffer.from(await res.arrayBuffer()));
}

function uvEnv(inst) {
  return {
    ...process.env,
    UV_PYTHON_INSTALL_DIR: path.join(inst, 'python'),
    UV_CACHE_DIR: path.join(inst, 'cache'),
  };
}

async function ensureCode(inst, manifest, runner) {
  const repo = path.join(inst, 'repo');
  const discardRepo = () => fs.rmSync(repo, { recursive: true, force: true });

  if (!fs.existsSync(path.join(repo, '.git'))) {
    discardRepo();
    const steps = [
      ['clone', ['clone', '--filter=blob:none', '--no-checkout', '--sparse', manifest.repository, 'repo'], inst],
      ['sparse-checkout', ['sparse-checkout', 'set', '--no-cone', '/skills/generate2dmap/', '/skills/generate2dmedia/', '/LICENSE'], repo],
      ['checkout', ['checkout', '--quiet', manifest.commit], repo],
    ];
    for (const [label, args, cwd] of steps) {
      const res = await runner('git', args, { cwd });
      if (res.code !== 0) {
        discardRepo();
        throw new StepError('network', `git ${label} failed: ${oneLine(res.stderr)}`);
      }
    }
  }

  const rev = async (spec) => {
    const res = await runner('git', ['rev-parse', spec], { cwd: repo });
    return res.code === 0 ? oneLine(res.stdout) : null;
  };
  let problem = null;
  if ((await rev('HEAD')) !== manifest.commit) {
    problem = 'checkout is not the pinned commit';
  } else {
    for (const [p, id] of Object.entries(manifest.paths)) {
      if ((await rev(`HEAD:${p}`)) !== id) {
        problem = `tree ${p} does not match the pinned id`;
        break;
      }
    }
  }
  if (problem === null) {
    const status = await runner('git', ['status', '--porcelain'], { cwd: repo });
    if (status.code !== 0 || status.stdout.trim() !== '') problem = 'checkout has local changes';
  }
  if (problem !== null) {
    discardRepo();
    throw new StepError('hash', problem);
  }
  return repo;
}

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === name) return full;
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    }
  }
  return null;
}

async function ensureUv(inst, manifest, entry, platform, runner, download) {
  const exe = platform === 'win32' ? 'uv.exe' : 'uv';
  const uvDir = path.join(inst, 'uv');
  const uvBin = path.join(uvDir, exe);
  if (fs.existsSync(uvBin)) return uvBin;

  const downloadDir = path.join(inst, 'uv-download');
  fs.rmSync(downloadDir, { recursive: true, force: true });
  fs.mkdirSync(downloadDir, { recursive: true });
  const archive = path.join(downloadDir, entry.file);
  try {
    await download(manifest.uv.url.replace('{TARGET}', entry.file), archive);
  } catch (err) {
    throw new StepError('network', `download of uv failed: ${err.message}`);
  }
  const digest = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  if (digest !== entry.sha256) {
    fs.rmSync(archive, { force: true });
    throw new StepError('hash', 'uv archive checksum does not match');
  }

  const extractDir = path.join(downloadDir, 'extract');
  fs.mkdirSync(extractDir, { recursive: true });
  const tar = await runner('tar', ['-xf', archive, '-C', extractDir], {});
  if (tar.code !== 0) throw new StepError('hash', 'uv archive could not be extracted');
  const found = findFile(extractDir, exe);
  if (found === null) throw new StepError('hash', `uv archive does not contain ${exe}`);

  fs.mkdirSync(uvDir, { recursive: true });
  fs.copyFileSync(found, uvBin);
  if (platform !== 'win32') fs.chmodSync(uvBin, 0o755);
  fs.rmSync(downloadDir, { recursive: true, force: true });
  return uvBin;
}

async function ensureVenv(inst, manifest, uvBin, platform, runner) {
  const python = venvPython(inst, platform);
  if (fs.existsSync(python)) return python;
  const res = await runner(
    uvBin,
    ['venv', '--python', manifest.python, '--seed', path.join(inst, 'venv')],
    { env: uvEnv(inst) },
  );
  if (res.code !== 0 || !fs.existsSync(python)) {
    throw new StepError('python', `could not create the Python ${manifest.python} environment: ${oneLine(res.stderr)}`);
  }
  return python;
}

/**
 * Installs everything that is missing. Resolves to { ok: true, ready } or
 * { ok: false, reason, message }; never rejects.
 */
export async function ensureInstalled({
  dataDir,
  manifest,
  runner = defaultRunner,
  download = defaultDownload,
  platform = process.platform,
  arch = process.arch,
  now = () => new Date(),
}) {
  const root = path.resolve(dataDir);
  const existing = readReady(root, manifest);
  if (existing) return { ok: true, ready: existing };

  const target = `${platform}-${arch}`;
  if (!Object.hasOwn(manifest.uv.targets, target)) {
    return failure('unsupported', `no uv build is pinned for ${target}`);
  }

  try {
    fs.mkdirSync(installDir(root, manifest), { recursive: true });
  } catch (err) {
    return failure('disk', err.message);
  }
  const inst = installDir(root, manifest);

  try {
    const repo = await ensureCode(inst, manifest, runner);
    const uvBin = await ensureUv(inst, manifest, manifest.uv.targets[target], platform, runner, download);
    const python = await ensureVenv(inst, manifest, uvBin, platform, runner);

    const pip = await runner(
      uvBin,
      ['pip', 'install', '--python', python, ...manifest.packages],
      { env: uvEnv(inst) },
    );
    if (pip.code !== 0) throw new StepError('network', `package install failed: ${oneLine(pip.stderr)}`);

    const ready = {
      schema: SCHEMA,
      commit: manifest.commit,
      python,
      generate2dmap: path.join(repo, 'skills', 'generate2dmap'),
      generate2dmedia: path.join(repo, 'skills', 'generate2dmedia'),
      installed: new Date(now()).toISOString(),
    };
    const file = path.join(inst, 'ready.json');
    fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(ready, null, 2)}\n`);
    fs.renameSync(`${file}.tmp`, file);
    return { ok: true, ready };
  } catch (err) {
    if (err instanceof StepError) return failure(err.reason, err.message);
    return failure('disk', err.message);
  }
}
