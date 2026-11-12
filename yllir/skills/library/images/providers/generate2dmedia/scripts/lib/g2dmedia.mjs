// Client of the generate2dmedia route: the third-party route_media.py of agent-sprite-forge
// (installed by the third-party installer) generates one image for one job folder.
// Only the job prompt, and the keys the campaign gives for this provider, reach it. The child
// process never inherits the master's own key variables or FORGE_ settings, and its
// configuration folder is an empty folder inside the job. Keys are never printed or logged.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG_SIGNATURE } from '../../../../scripts/lib/png-signature.mjs';

export const G2D_KEY_NAMES = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'XAI_API_KEY', 'ARK_API_KEY', 'FAL_KEY'];

/** The services the master can name; route_media.py's `--route` values. Absent means `auto`. */
export const G2D_ROUTES = ['gemini', 'openai', 'xai', 'byteplus', 'fal'];

/** True when `route` is absent (null or undefined) or one of G2D_ROUTES. */
export function isValidRoute(route) {
  return route === null || route === undefined || G2D_ROUTES.includes(route);
}

const PROVIDER_ID = 'generate2dmedia';
const KEYS_FILE = path.join('.campaign', 'state', 'keys.json');
const READY_SCHEMA = 'yllir.third-party.ready.v1';
const COMMIT = '72fa5ad92d79b811acff464da32c8f3b1caa010f';
const PROBE_TIMEOUT_MS = 20000;
const MESSAGE_LIMIT = 200;

function oneLine(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function failure(error, message) {
  const text = oneLine(message);
  return { ok: false, error, message: text.length > MESSAGE_LIMIT ? text.slice(0, MESSAGE_LIMIT) : text };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Folder that holds the third-party install. An empty or unresolved (`${...}`) value,
 * or none, means the OS default data folder of yllir.
 */
export function resolveDataDir(dataDir, { platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (typeof dataDir === 'string' && dataDir.trim() !== '' && !dataDir.includes('${')) {
    return path.resolve(dataDir);
  }
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'yllir');
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'yllir');
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'yllir');
}

/**
 * Reads the install record written by the third-party installer. Returns
 * { python, generate2dmedia } when the record is valid and route_media.py exists,
 * otherwise null (not installed).
 */
export function readReady(dataDir) {
  const installDir = path.join(resolveDataDir(dataDir), 'third-party', 'agent-sprite-forge', COMMIT);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(installDir, 'ready.json'), 'utf8'));
  } catch {
    return null;
  }
  if (!isPlainObject(data) || data.schema !== READY_SCHEMA || data.commit !== COMMIT) return null;
  for (const key of ['python', 'generate2dmedia']) {
    if (typeof data[key] !== 'string' || !path.isAbsolute(data[key])) return null;
  }
  if (!fs.existsSync(path.join(data.generate2dmedia, 'scripts', 'route_media.py'))) return null;
  return { python: data.python, generate2dmedia: data.generate2dmedia };
}

/** The keys the campaign gives this provider: only allowed names with non-empty string values. */
export function readG2dKeys(campaignRoot) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(campaignRoot, KEYS_FILE), 'utf8'));
  } catch {
    return {};
  }
  const entry = data?.[PROVIDER_ID];
  if (!isPlainObject(entry)) return {};
  const keys = {};
  for (const name of G2D_KEY_NAMES) {
    if (typeof entry[name] === 'string' && entry[name] !== '') keys[name] = entry[name];
  }
  return keys;
}

/**
 * Environment of the child process. Key variables and FORGE_ settings of the base
 * are removed, then only the given keys are set. `fake` (tests only) is set when given
 * explicitly, never inherited.
 */
export function childEnv({ base = process.env, keys = {}, configDir, fake = null } = {}) {
  const env = { ...base };
  for (const name of Object.keys(env)) {
    if (G2D_KEY_NAMES.includes(name) || name.startsWith('FORGE_')) delete env[name];
  }
  for (const name of G2D_KEY_NAMES) {
    if (typeof keys[name] === 'string') env[name] = keys[name];
  }
  env.XDG_CONFIG_HOME = configDir;
  env.APPDATA = configDir;
  env.PYTHONUTF8 = '1';
  if (fake !== null) env.FORGE_ROUTE_MEDIA_FAKE = fake;
  return env;
}

/** The text sent to route_media: the job prompt, and the negative part when there is one. */
export function promptText(job) {
  return job.prompt + (job.negative ? `\n\nAvoid: ${job.negative}` : '');
}

function lastMatching(text, test) {
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (test(lines[i])) return lines[i];
  }
  return null;
}

/** Turns the exit code and output of route_media.py into a result; writes result.png and run.json on success. */
function collectResult({ code, output, jobDir, job }) {
  if (code === 3) return failure('unavailable', 'no route');
  if (code !== 0) {
    const errorLine = lastMatching(output, (line) => line.startsWith('error:'));
    if (errorLine !== null) return failure('failed', errorLine.slice('error:'.length));
    return failure('failed', `route_media.py exited with code ${code}`);
  }
  const summary = lastMatching(output, (line) => line.startsWith('{'));
  let parsed = null;
  try {
    parsed = summary === null ? null : JSON.parse(summary);
  } catch {
    parsed = null;
  }
  if (!isPlainObject(parsed) || parsed.status !== 'ok' || typeof parsed.artifact !== 'string' || parsed.artifact === '') {
    return failure('failed', 'no image produced');
  }
  let bytes;
  try {
    bytes = fs.readFileSync(path.resolve(jobDir, parsed.artifact));
  } catch {
    return failure('failed', 'no image produced');
  }
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return failure('failed', 'not a png');

  const route = typeof parsed.route === 'string' ? parsed.route : '';
  const model = typeof parsed.model === 'string' ? parsed.model : '';
  fs.writeFileSync(path.join(jobDir, 'result.png'), bytes);
  fs.writeFileSync(
    path.join(jobDir, 'run.json'),
    `${JSON.stringify({ provider: PROVIDER_ID, parameters: { width: job.width, height: job.height, route, model } }, null, 2)}\n`,
  );
  return { ok: true, route };
}

/**
 * Runs one generate job through route_media.py. Resolves to { ok: true, route } or
 * { ok: false, error, message } with error one of: unsupported, unavailable, failed, timeout.
 */
export function runG2dmedia({
  campaignRoot,
  jobDir,
  ready,
  spawnImpl = spawn,
  timeoutMs = 900000,
  fake = null,
  route = null,
}) {
  const job = JSON.parse(fs.readFileSync(path.join(jobDir, 'job.json'), 'utf8'));
  if (job.operation !== 'generate') {
    return Promise.resolve(failure('unsupported', `operation ${job.operation} is not supported by generate2dmedia`));
  }
  if (!isValidRoute(route)) {
    return Promise.resolve(failure('invalid', `route must be one of ${G2D_ROUTES.join(', ')}`));
  }
  if (!ready) return Promise.resolve(failure('unavailable', 'not installed'));

  const logPath = path.join(jobDir, 'g2d.log');
  const configDir = path.join(jobDir, 'g2d-config');
  // A retry reuses the job folder: outputs of an earlier attempt must never count as success.
  fs.rmSync(path.join(jobDir, 'result.png'), { force: true });
  fs.rmSync(path.join(jobDir, 'run.json'), { force: true });
  fs.rmSync(path.join(jobDir, 'g2d-out'), { recursive: true, force: true });
  fs.rmSync(configDir, { recursive: true, force: true });
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(jobDir, 'prompt.txt'), promptText(job), 'utf8');

  const args = [
    path.join(ready.generate2dmedia, 'scripts', 'route_media.py'),
    'image',
    '--prompt-file',
    'prompt.txt',
    '--size',
    `${job.width}x${job.height}`,
    '--out-dir',
    'g2d-out',
    '--project-dir',
    jobDir,
  ];
  const reference = typeof job.reference === 'string' ? path.resolve(jobDir, job.reference) : null;
  if (reference !== null && fs.existsSync(reference)) args.push('--reference', reference);
  if (route !== null && route !== undefined) args.push('--route', route);

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    let child = null;
    let output = '';
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const onData = (chunk) => {
      fs.appendFileSync(logPath, chunk);
      output += chunk;
    };

    fs.appendFileSync(logPath, '');
    try {
      child = spawnImpl(ready.python, args, {
        cwd: jobDir,
        env: childEnv({ keys: readG2dKeys(campaignRoot), configDir, fake }),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      settle(failure('failed', err.message));
      return;
    }

    timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
      settle(failure('timeout', 'generate2dmedia did not finish in time and was stopped'));
    }, timeoutMs);

    child.on('error', (err) => {
      if (err.code === 'ENOENT') settle(failure('unavailable', `python not found: ${ready.python}`));
      else settle(failure('failed', err.message));
    });
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', (code) => {
      if (settled) return;
      try {
        settle(collectResult({ code, output, jobDir, job }));
      } catch (err) {
        settle(failure('failed', err.message));
      }
    });
  });
}

/**
 * Checks whether route_media.py finds a route for images. Resolves to
 * { available, reason } with reason null, not-installed, no-route or probe-failed.
 */
export function probeG2dmedia({ campaignRoot, ready, spawnImpl = spawn, timeoutMs = PROBE_TIMEOUT_MS, route = null }) {
  if (!ready) return Promise.resolve({ available: false, reason: 'not-installed' });
  if (!isValidRoute(route)) return Promise.resolve({ available: false, reason: 'invalid' });

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    let probeDir = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (probeDir !== null) fs.rmSync(probeDir, { recursive: true, force: true });
      resolve(result);
    };

    let child;
    try {
      probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-g2d-probe-'));
      const configDir = path.join(probeDir, 'config');
      fs.mkdirSync(configDir);
      const probeArgs = [path.join(ready.generate2dmedia, 'scripts', 'route_media.py'), 'resolve', '--kind', 'image'];
      if (route !== null && route !== undefined) probeArgs.push('--route', route);
      child = spawnImpl(ready.python, probeArgs, {
        cwd: probeDir,
        env: childEnv({ keys: readG2dKeys(campaignRoot), configDir }),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      finish({ available: false, reason: 'probe-failed' });
      return;
    }

    timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
      finish({ available: false, reason: 'probe-failed' });
    }, timeoutMs);

    child.stdout.on('data', () => {});
    child.stderr.on('data', () => {});
    child.on('error', () => finish({ available: false, reason: 'probe-failed' }));
    child.on('close', (code) => {
      if (code === 0) finish({ available: true, reason: null });
      else if (code === 3) finish({ available: false, reason: 'no-route' });
      else finish({ available: false, reason: 'probe-failed' });
    });
  });
}
