// Resolves and runs one allowed map tool inside one map job folder of a campaign.
// The map tools are third-party Python scripts installed by the framework; this
// module only decides which script runs, checks the arguments and spawns it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn as nodeSpawn } from 'node:child_process';

export const ALLOWED_TOOLS = Object.freeze([
  'map_bundle',
  'map_nav',
  'build_scene_preview',
  'compose_layered_preview',
  'export_tiled',
  'conform_background',
  'extract_prop_pack',
  'extract_terrain_tiles',
  'map_grid',
]);

const GENERATE2DMAP_TOOLS = new Set(ALLOWED_TOOLS.filter((tool) => tool !== 'map_grid'));
export const READY_SCHEMA = 'yllir.third-party.ready.v1';
export const INSTALL_COMMIT = '72fa5ad92d79b811acff464da32c8f3b1caa010f';
export const TIMEOUT_MS = 600000;

const JOB_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const PATH_EXTENSIONS = ['.json', '.png', '.jpg', '.html', '.csv'];
const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
// The folder that holds maps-run.mjs and map-grid.py.
export const MAPS_DIR = path.resolve(LIB_DIR, '..');

/** Default data folder of the framework for this operating system. */
export function defaultDataDir(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'yllir');
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA && env.LOCALAPPDATA.trim() ? env.LOCALAPPDATA : path.join(home, 'AppData', 'Local');
    return path.join(local, 'yllir');
  }
  const xdg = env.XDG_DATA_HOME && env.XDG_DATA_HOME.trim() ? env.XDG_DATA_HOME : path.join(home, '.local', 'share');
  return path.join(xdg, 'yllir');
}

/** A --data-dir that is empty or still holds a literal `${` means "not given". */
export function resolveDataDir(dataDir) {
  const value = typeof dataDir === 'string' ? dataDir.trim() : '';
  if (value === '' || value.includes('${')) return defaultDataDir();
  return path.resolve(value);
}

export function installDirOf(dataDir) {
  return path.join(dataDir, 'third-party', 'agent-sprite-forge', INSTALL_COMMIT);
}

/** Reads INSTALL_DIR/ready.json. Returns the parsed object, or null when it is missing or invalid. */
export function readReadyFile(dataDir) {
  const file = path.join(installDirOf(dataDir), 'ready.json');
  let ready;
  try {
    ready = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!ready || typeof ready !== 'object') return null;
  if (ready.schema !== READY_SCHEMA) return null;
  if (typeof ready.python !== 'string' || !fs.existsSync(ready.python)) return null;
  if (typeof ready.generate2dmap !== 'string') return null;
  return ready;
}

/** Absolute path of the script for a tool, or null when the tool is not allowed. */
export function resolveScript(tool, ready, hereDir) {
  if (tool === 'map_grid') return path.join(hereDir, 'map-grid.py');
  if (GENERATE2DMAP_TOOLS.has(tool)) return path.join(ready.generate2dmap, 'scripts', `${tool}.py`);
  return null;
}

function looksLikePath(arg) {
  if (/[\\/]/.test(arg)) return true;
  const lower = arg.toLowerCase();
  return PATH_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Returns the first argument that names a path outside jobDir, or null when all are inside. */
export function checkArgs(jobDir, args) {
  for (const arg of args) {
    if (typeof arg !== 'string' || arg.startsWith('-')) continue;
    if (!looksLikePath(arg)) continue;
    const rel = path.relative(jobDir, path.resolve(jobDir, arg));
    const inside = rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
    if (!inside) return arg;
  }
  return null;
}

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Runs one allowed tool in the job folder. Returns { ok: true } on success,
 * { ok: false, code } when the script exits non-zero, or { ok: false, error } when
 * the run is refused or cannot start. Child output goes to onStdout / onStderr.
 */
export function runTool({
  campaignRoot,
  jobId,
  dataDir,
  tool,
  args = [],
  spawnImpl = nodeSpawn,
  onStdout = () => {},
  onStderr = () => {},
}) {
  const fail = (error) => ({ ok: false, error });

  if (!ALLOWED_TOOLS.includes(tool)) return fail('tool-not-allowed');
  if (typeof jobId !== 'string' || !JOB_ID_PATTERN.test(jobId)) return fail('bad-job-id');

  const jobDir = path.resolve(campaignRoot, '.campaign', 'state', 'maps', jobId);
  if (!isDirectory(jobDir)) return fail('no-job');

  const ready = readReadyFile(resolveDataDir(dataDir));
  if (ready === null) return fail('not-installed');

  const script = resolveScript(tool, ready, MAPS_DIR);
  if (script === null) return fail('tool-not-allowed');

  if (checkArgs(jobDir, args) !== null) return fail('path-outside-job');

  const env = { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' };
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(ready.python, [script, ...args], {
        cwd: jobDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch {
      resolve(fail('failed'));
      return;
    }

    let timedOut = false;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // The child may already have exited; the close event settles the run.
      }
    }, TIMEOUT_MS);
    timer.unref?.();

    child.stdout?.on('data', (chunk) => onStdout(chunk));
    child.stderr?.on('data', (chunk) => onStderr(chunk));
    child.on('error', () => finish(fail('failed')));
    child.on('close', (code) => {
      if (timedOut) finish(fail('timeout'));
      else if (code === 0) finish({ ok: true });
      else finish({ ok: false, code: code ?? 1 });
    });
  });
}
