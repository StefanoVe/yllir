// Installs the pinned Photoshop MCP server (@alisaitteke/photoshop-mcp) outside every
// campaign, and serves an empty MCP server while Photoshop or the server is missing so
// that the host never shows a failed server. Every function takes its dependencies
// (listing, existence checks, runner) so that tests need no real npm and no network.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCHEMA = 'yllir.third-party.ready.v1';
const PACKAGE_DIR = ['node_modules', '@alisaitteke', 'photoshop-mcp'];
const LOCK_STALE_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 300000;
const MESSAGE_LIMIT = 200;
const DEFAULT_PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

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

/** Reads the pinned manifest of the Photoshop MCP server. */
export function loadManifest(pluginRoot = DEFAULT_PLUGIN_ROOT) {
  const file = path.join(pluginRoot, 'modules', 'third-party', 'photoshop-mcp', 'manifest.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** The folder of the pinned installation: <dataDir>/third-party/photoshop-mcp/<version>. */
export function installDir(dataDir, manifest) {
  return path.resolve(dataDir, 'third-party', manifest.id, manifest.version);
}

/** The newest Photoshop folder installed, or null. Injectable listing and existence checks. */
export function findPhotoshop({
  platform = process.platform,
  exists = fs.existsSync,
  list = listDirectories,
} = {}) {
  let root;
  let join;
  if (platform === 'darwin') {
    root = '/Applications';
    join = path.posix.join;
  } else if (platform === 'win32') {
    root = 'C:\\Program Files\\Adobe';
    join = path.win32.join;
  } else {
    return null;
  }
  const names = list(root)
    .filter((name) => name.startsWith('Adobe Photoshop'))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const name of names) {
    const candidate = join(root, name);
    if (exists(candidate)) return candidate;
  }
  return null;
}

function listDirectories(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * The parsed ready.json when the installation is complete for the pinned version and
 * its entry exists, else null. The returned object carries the entry path.
 */
export function readReady(dataDir, manifest, { exists = fs.existsSync, readFile = fs.readFileSync } = {}) {
  const file = path.join(installDir(dataDir, manifest), 'ready.json');
  let ready;
  try {
    ready = JSON.parse(readFile(file, 'utf8'));
  } catch {
    return null;
  }
  if (!ready || ready.schema !== SCHEMA || ready.id !== manifest.id || ready.version !== manifest.version) return null;
  if (typeof ready.entry !== 'string' || !exists(ready.entry)) return null;
  return ready;
}

/**
 * Runs a command without a shell (except npm on Windows, which is a .cmd file). Resolves to
 * { code, stdout, stderr, error, timedOut }; `error` is the error code when the process
 * could not start (ENOENT when npm is missing). Never rejects.
 */
export function defaultRunner(cmd, args, { cwd, env, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let done = false;
    let timedOut = false;
    let timer = null;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code: null, error: undefined, timedOut, stdout, stderr, ...result });
    };

    let child;
    try {
      child = spawn(cmd, args, {
        cwd,
        env: env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });
    } catch (err) {
      finish({ error: err.code ?? 'SPAWN', stderr: err.message });
      return;
    }
    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (err) => finish({ error: err.code ?? 'SPAWN', stderr: stderr + err.message }));
    child.on('close', (code) => finish({ code: code ?? null }));
  });
}

/** Takes the install lock (`<installDir>.lock`). Returns false when a fresh lock is held by another run. */
function acquireLock(lockFile, now) {
  const tryCreate = () => {
    fs.writeFileSync(lockFile, `${process.pid} ${new Date(now()).toISOString()}\n`, { flag: 'wx' });
    return true;
  };
  try {
    return tryCreate();
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  const age = now() - fs.statSync(lockFile).mtimeMs;
  if (age < LOCK_STALE_MS) return false;
  fs.rmSync(lockFile, { force: true });
  return tryCreate();
}

/** The installed package's version, read from its own package.json, or null. */
function installedVersion(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, ...PACKAGE_DIR, 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
}

/**
 * Installs the pinned server when it is missing. Resolves to { ok: true, entry } or
 * { ok: false, reason, message } where reason is no-npm | install-failed | integrity |
 * timeout | busy. Never rejects. ready.json is written last, only on success.
 */
export async function ensureInstalled({
  pluginRoot = DEFAULT_PLUGIN_ROOT,
  dataDir,
  runner = defaultRunner,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = () => Date.now(),
}) {
  const root = path.resolve(dataDir);
  const manifest = loadManifest(pluginRoot);
  const existing = readReady(root, manifest);
  if (existing) return { ok: true, entry: existing.entry };

  const dir = installDir(root, manifest);
  const lockFile = `${dir}.lock`;
  let locked = false;
  try {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    if (!acquireLock(lockFile, now)) return failure('busy', 'another session is installing the Photoshop server');
    locked = true;

    const again = readReady(root, manifest);
    if (again) return { ok: true, entry: again.entry };

    fs.mkdirSync(dir, { recursive: true });
    const moduleDir = path.join(pluginRoot, 'modules', 'third-party', manifest.id);
    for (const name of ['package.json', 'package-lock.json']) {
      fs.copyFileSync(path.join(moduleDir, name), path.join(dir, name));
    }

    const npm = await runner('npm', ['ci', '--no-audit', '--no-fund'], { cwd: dir, timeoutMs });
    if (npm.error === 'ENOENT') throw new StepError('no-npm', 'npm is not installed, so the Photoshop server cannot be set up');
    if (npm.timedOut) throw new StepError('timeout', 'npm ci did not finish in time');
    if (npm.code !== 0) throw new StepError('install-failed', `npm ci failed: ${oneLine(npm.stderr)}`);

    const version = installedVersion(dir);
    if (version !== manifest.version) {
      throw new StepError('integrity', `installed version ${version ?? 'none'} is not ${manifest.version}`);
    }
    const entry = path.join(dir, ...PACKAGE_DIR, manifest.bin);
    if (!fs.existsSync(entry)) throw new StepError('install-failed', `entry ${manifest.bin} is missing`);

    const ready = { schema: SCHEMA, id: manifest.id, version: manifest.version, entry };
    const file = path.join(dir, 'ready.json');
    fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(ready, null, 2)}\n`);
    fs.renameSync(`${file}.tmp`, file);
    return { ok: true, entry };
  } catch (err) {
    if (err instanceof StepError) return failure(err.reason, err.message);
    return failure('install-failed', err.message);
  } finally {
    if (locked) fs.rmSync(lockFile, { force: true });
  }
}

/**
 * A minimal MCP server over newline-delimited JSON on the given streams. It has no tools,
 * so the host shows the server as connected while Photoshop or the server is missing.
 * Resolves when the input ends.
 */
export function emptyServer(stdin, stdout) {
  const send = (message) => stdout.write(`${JSON.stringify(message)}\n`);
  const rl = readline.createInterface({ input: stdin, crlfDelay: Infinity });

  rl.on('line', (line) => {
    if (line.trim() === '') return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    if (!message || message.id === undefined) return;
    const { id, method, params } = message;
    if (method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'yllir-photoshop', version: '0' },
        },
      });
    } else if (method === 'tools/list') {
      send({ jsonrpc: '2.0', id, result: { tools: [] } });
    } else if (method === 'ping') {
      send({ jsonrpc: '2.0', id, result: {} });
    } else {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  });

  return new Promise((resolve) => rl.on('close', resolve));
}
