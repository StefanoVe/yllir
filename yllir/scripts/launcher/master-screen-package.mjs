// The master screen package: a gzip tar published as a GitHub Release asset and pinned
// in yllir/master-screen.json. Downloads it, checks its sha256 against the pin, extracts
// it after checking every archive entry, and installs it under
// <home>/master-screen/<version>/. Used by launch.mjs through ensureMasterScreen.
// Only the system tar runs, through execFile and never through a shell.

import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { message } from './launch-lib.mjs';

export const PIN_FILE = 'master-screen.json';
const VERIFIED_MARKER = '.verified';
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const SHA256_RE = /^[0-9a-fA-F]{64}$/;
const PIN_URL_RE = /^https:\/\/github\.com\/([A-Za-z0-9_][A-Za-z0-9_.-]*)\/([A-Za-z0-9_][A-Za-z0-9_.-]*)\/releases\/download\/master-screen-v(\d+\.\d+\.\d+)\/yllir-master-screen-(\d+\.\d+\.\d+)\.tar\.gz$/;
const MAX_PACKAGE_SIZE = 100 * 1024 * 1024;
const SIZE_SLACK = 1024 * 1024;
const MAX_REDIRECTS = 3;
const IDLE_TIMEOUT_MS = 60 * 1000;
const STALE_TMP_MS = 60 * 60 * 1000;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const DOWNLOAD_HOSTS = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];
const TEST_HOSTS = ['127.0.0.1'];
const TAR_MAX_BUFFER = 16 * 1024 * 1024;
const ROOT_FILES = new Set(['server.mjs', 'VERSION']);

/** An Error with a `code` the callers map to a message: no-package, download-failed or bad-package. */
function fail(code, reason) {
  const err = new Error(reason);
  err.code = code;
  return err;
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** The YLLIR home: YLLIR_HOME, else ~/.yllir. */
export function defaultHome(env = process.env) {
  return env.YLLIR_HOME || path.join(os.homedir(), '.yllir');
}

/**
 * Reads and validates <frameworkRoot>/master-screen.json. Returns
 * { version, sha256 (lowercase), url, size } or null when the file is missing or invalid.
 * The URL must be the release asset of this same version on github.com; unknown keys are ignored.
 */
export function readPin(frameworkRoot) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(frameworkRoot, PIN_FILE), 'utf8'));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { version, sha256, url, size } = raw;
  if (typeof version !== 'string' || !VERSION_RE.test(version)) return null;
  if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) return null;
  if (typeof url !== 'string') return null;
  const match = PIN_URL_RE.exec(url);
  if (!match || match[3] !== version || match[4] !== version) return null;
  if (!Number.isInteger(size) || size <= 0 || size > MAX_PACKAGE_SIZE) return null;
  return { version, sha256: sha256.toLowerCase(), url, size };
}

/** <home>/master-screen/<version> */
export function installedDir(home, version) {
  return path.join(home, 'master-screen', version);
}

/** True when the version folder has the verified marker and a server.mjs. */
export function isInstalled(home, version) {
  if (!VERSION_RE.test(version)) return false;
  const dir = installedDir(home, version);
  return isFile(path.join(dir, VERIFIED_MARKER)) && isFile(path.join(dir, 'server.mjs'));
}

/** Compares two x.y.z strings: negative, zero or positive. */
export function compareSemver(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return 0;
}

function listVersionDirs(home) {
  try {
    return fs.readdirSync(path.join(home, 'master-screen'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && VERSION_RE.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** The newest verified installed version (semver), or null. */
export function newestInstalled(home) {
  const versions = listVersionDirs(home)
    .filter((version) => isInstalled(home, version))
    .sort((a, b) => compareSemver(b, a));
  return versions[0] ?? null;
}

/** A URL is allowed when it is https on an allowed host (plain http and 127.0.0.1 only with the test flag). */
function checkHop(value, hosts, allowHttp) {
  let url;
  try {
    url = value instanceof URL ? value : new URL(value);
  } catch {
    throw fail('download-failed', 'invalid download address');
  }
  const schemeOk = url.protocol === 'https:' || (allowHttp && url.protocol === 'http:');
  if (!schemeOk || !hosts.includes(url.hostname) || url.username || url.password) {
    throw fail('download-failed', `download address refused: ${url.protocol}//${url.hostname}`);
  }
  return url;
}

/**
 * Streams the package into a new `<dest>/master-screen/.tmp-<random>/package.tar.gz` while
 * hashing it. Follows at most 3 redirects, each on an allowed host, with an idle timeout and
 * a size cap of `size` + 1 MB. On any failure the temp folder is deleted. Returns
 * { file, tmpDir }; the caller deletes tmpDir when done. `dest` is the YLLIR home folder.
 * A checksum mismatch fails with code bad-package, everything else with download-failed.
 */
export async function downloadPackage({
  url,
  sha256,
  size,
  dest,
  fetchImpl = globalThis.fetch,
  env = process.env,
  idleTimeoutMs = IDLE_TIMEOUT_MS,
}) {
  const allowHttp = env.YLLIR_ALLOW_HTTP_TEST === '1';
  const hosts = allowHttp ? [...DOWNLOAD_HOSTS, ...TEST_HOSTS] : DOWNLOAD_HOSTS;
  let target = checkHop(url, hosts, allowHttp);

  const base = path.join(dest, 'master-screen');
  fs.mkdirSync(base, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(base, '.tmp-'));
  const file = path.join(tmpDir, 'package.tar.gz');
  const controller = new AbortController();
  let timer = null;
  const armIdle = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), idleTimeoutMs);
  };

  try {
    armIdle();
    let res;
    for (let redirects = 0; ; redirects += 1) {
      res = await fetchImpl(target.href, { redirect: 'manual', signal: controller.signal });
      if (!REDIRECT_STATUS.has(res.status)) break;
      const location = res.headers.get('location');
      if (!location || redirects >= MAX_REDIRECTS) throw fail('download-failed', 'too many redirects');
      target = checkHop(new URL(location, target), hosts, allowHttp);
    }
    if (res.status !== 200) throw fail('download-failed', `HTTP ${res.status}`);

    const limit = size + SIZE_SLACK;
    const hash = crypto.createHash('sha256');
    let total = 0;
    const handle = await fs.promises.open(file, 'w');
    try {
      if (res.body) {
        for await (const chunk of res.body) {
          armIdle();
          total += chunk.length;
          if (total > limit) {
            controller.abort();
            throw fail('download-failed', 'the package is larger than the pin says');
          }
          hash.update(chunk);
          await handle.write(chunk);
        }
      }
    } finally {
      await handle.close();
    }
    clearTimeout(timer);

    if (hash.digest('hex') !== sha256.toLowerCase()) {
      throw fail('bad-package', 'the package checksum does not match the pin');
    }
    return { file, tmpDir };
  } catch (err) {
    clearTimeout(timer);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (err.code === 'bad-package' || err.code === 'download-failed') throw err;
    throw fail('download-failed', err.message);
  }
}

/** Runs the system tar with an argument list (no shell). Resolves to stdout. */
function runTar(args) {
  const bin = process.platform === 'win32' ? 'tar.exe' : 'tar';
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: TAR_MAX_BUFFER, windowsHide: true }, (err, stdout) => {
      if (err) reject(fail('bad-package', `tar failed: ${err.message}`));
      else resolve(String(stdout));
    });
  });
}

function lines(text) {
  return String(text).split(/\r?\n/).filter((line) => line !== '');
}

/**
 * Refuses one archive entry unless it is server.mjs or VERSION (regular files), or public
 * or something under public (regular files or folders). Refuses absolute paths, `..`,
 * backslashes, and links or devices (the first character of the verbose listing).
 */
function checkEntry(raw, kind) {
  let name = raw.startsWith('./') ? raw.slice(2) : raw;
  if (name.endsWith('/')) name = name.slice(0, -1);
  if (name === '' || name === '.') return;
  const refuse = () => fail('bad-package', `entry not allowed in the package: ${raw}`);
  if (name.includes('\\') || path.posix.isAbsolute(name) || /^[A-Za-z]:/.test(name)) throw refuse();
  if (name.split('/').some((part) => part === '' || part === '.' || part === '..')) throw refuse();
  if (ROOT_FILES.has(name)) {
    if (kind !== '-') throw refuse();
    return;
  }
  const underPublic = name === 'public' || name.startsWith('public/');
  if (!underPublic || (kind !== '-' && kind !== 'd')) throw refuse();
}

/** Lists the archive with names and kinds and refuses it before anything is extracted. */
async function checkArchive(tgz, tarImpl) {
  const names = lines(await tarImpl(['-tzf', tgz]));
  const kinds = lines(await tarImpl(['-tvzf', tgz]));
  if (names.length === 0 || names.length !== kinds.length) {
    throw fail('bad-package', 'the package listing is inconsistent');
  }
  names.forEach((name, index) => checkEntry(name, kinds[index].charAt(0)));
}

function isVerifiedDir(dir) {
  return isFile(path.join(dir, VERIFIED_MARKER)) && isFile(path.join(dir, 'server.mjs'));
}

/**
 * Checks and extracts `tgz` into a temp folder next to `destDir`, requires server.mjs and
 * public/index.html, writes the .verified marker and renames the folder to `destDir`. When
 * `destDir` is already verified (another launcher won), it keeps that one and drops this
 * one. Any failure throws code bad-package and leaves no temp folder behind.
 * Returns { installed: boolean }.
 */
export async function extractPackage(tgz, destDir, { tarImpl = runTar } = {}) {
  const base = path.dirname(destDir);
  fs.mkdirSync(base, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(base, '.tmp-'));
  try {
    await checkArchive(tgz, tarImpl);
    const stage = path.join(tmp, 'stage');
    fs.mkdirSync(stage);
    await tarImpl(['-xzf', tgz, '-C', stage]);
    if (!isFile(path.join(stage, 'server.mjs')) || !isFile(path.join(stage, 'public', 'index.html'))) {
      throw fail('bad-package', 'the package has no server.mjs or public/index.html');
    }
    const marker = { version: path.basename(destDir), verifiedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(stage, VERIFIED_MARKER), `${JSON.stringify(marker)}\n`);

    if (fs.existsSync(destDir)) {
      if (isVerifiedDir(destDir)) return { installed: false };
      // Only a folder without the marker can be here: nobody renames an unverified folder in place.
      fs.rmSync(destDir, { recursive: true, force: true });
    }
    try {
      fs.renameSync(stage, destDir);
    } catch (err) {
      if (isVerifiedDir(destDir)) return { installed: false };
      throw err;
    }
    return { installed: true };
  } catch (err) {
    if (err.code === 'bad-package') throw err;
    throw fail('bad-package', err.message);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Removes one folder; a failure (a locked folder on Windows, a folder that vanished) is ignored. */
function removeQuietly(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    // Retried on the next start.
  }
}

/**
 * Keeps only `keepVersion`: removes every other version folder under <home>/master-screen/
 * and the `.tmp-*` folders (downloads and stages) older than an hour, since a live download
 * is never that old. The bundled <frameworkRoot>/master-screen/ folder is outside <home> and
 * is never touched. Never throws, and each folder is removed on its own.
 *
 * Running servers are not checked here. The launcher's lock (launch-lib.mjs, readLock) is per
 * campaign and does not record the version folder a server runs from, so the launcher cannot
 * tell whether an old version is in use. On macOS and Linux an open file survives unlink; a
 * server that still reads files from a removed folder may fail until it is restarted. On
 * Windows a locked folder cannot be removed and is skipped, then retried on the next start.
 */
export function pruneOld(home, keepVersion) {
  const base = path.join(home, 'master-screen');
  for (const version of listVersionDirs(home)) {
    if (version !== keepVersion) removeQuietly(path.join(base, version));
  }
  let entries = [];
  try {
    entries = fs.readdirSync(base);
  } catch {
    return;
  }
  const cutoff = Date.now() - STALE_TMP_MS;
  for (const name of entries) {
    if (!name.startsWith('.tmp-')) continue;
    const full = path.join(base, name);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) removeQuietly(full);
    } catch {
      // A folder that vanished meanwhile needs no cleanup.
    }
  }
}

function installedResult(home, version, source) {
  return { serverFile: path.join(installedDir(home, version), 'server.mjs'), source, version };
}

/**
 * Finds the master screen server to start, in this order: env YLLIR_MASTER_SCREEN_DIR,
 * the legacy bundled `<frameworkRoot>/master-screen/server.mjs`, the pinned version when
 * installed, a download of the pinned version, and finally the newest installed verified
 * version (with a plain notice). Returns { serverFile, source, version? } or
 * { error: 'no-package' | 'download-failed' | 'bad-package' }. `say` receives M6 and M8.
 */
export async function ensureMasterScreen({
  frameworkRoot,
  env = process.env,
  home = defaultHome(env),
  lang = 'en',
  say = () => {},
  fetchImpl,
  tarImpl,
}) {
  const override = env.YLLIR_MASTER_SCREEN_DIR;
  if (override) {
    const serverFile = path.join(override, 'server.mjs');
    return isFile(serverFile) ? { serverFile, source: 'env' } : { error: 'no-package' };
  }
  const bundled = path.join(frameworkRoot, 'master-screen', 'server.mjs');
  if (isFile(bundled)) return { serverFile: bundled, source: 'bundled' };

  const pin = readPin(frameworkRoot);
  if (pin && isInstalled(home, pin.version)) {
    pruneOld(home, pin.version);
    return installedResult(home, pin.version, 'installed');
  }

  let error = 'no-package';
  if (pin) {
    say(message('M6', lang));
    try {
      const { file, tmpDir } = await downloadPackage({
        url: pin.url,
        sha256: pin.sha256,
        size: pin.size,
        dest: home,
        fetchImpl,
        env,
      });
      try {
        await extractPackage(file, installedDir(home, pin.version), { tarImpl });
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
      if (!isInstalled(home, pin.version)) throw fail('bad-package', 'the package did not install');
      pruneOld(home, pin.version);
      return installedResult(home, pin.version, 'downloaded');
    } catch (err) {
      error = ['bad-package', 'download-failed'].includes(err.code) ? err.code : 'download-failed';
    }
  }

  const fallback = newestInstalled(home);
  if (fallback) {
    pruneOld(home, fallback);
    say(message('M8', lang));
    return installedResult(home, fallback, 'fallback');
  }
  return { error: pin ? error : 'no-package' };
}
