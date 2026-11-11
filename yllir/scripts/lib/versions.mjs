// Saved versions of a campaign, stored as git history. The master never sees
// git: this module is the only place where the framework runs git on a campaign.
// Every call is synchronous and uses execFileSync with an argument array.
// History is only ever added to: no push, pull, fetch, reset --hard, rebase,
// amend, force or branch checkout.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const KINDS = ['framework', 'manual', 'restore'];

const TRAILER = 'Yllir-Kind';
const IGNORED_RULES = ['.campaign/state/', '.campaign/cache/', '.campaign/drafts/', '.claude/settings.local.json'];
const IDENTITY = [
  ['user.name', 'Yllir'],
  ['user.email', 'yllir@localhost.invalid'],
];
const LOG_FORMAT = '%h%x1f%aI%x1f%s%x1f%(trailers:key=Yllir-Kind,valueonly)%x1e';

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * Runs git in `dir` and returns { status, stdout }. Exit codes listed in `allow`
 * are expected results and are returned, not thrown.
 */
function runGit(dir, args, { input, allow = [0] } = {}) {
  if (!fs.existsSync(dir)) {
    throw fail('not-repo', `${dir} does not exist`);
  }
  const env = { ...process.env };
  // Variables set by an outer git process would redirect every call elsewhere.
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) {
    delete env[name];
  }
  try {
    const stdout = execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      input,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 512 * 1024 * 1024,
    });
    return { status: 0, stdout };
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw fail('no-git', 'git is not installed or not on the PATH');
    }
    if (typeof err.status === 'number' && allow.includes(err.status)) {
      return { status: err.status, stdout: err.stdout ?? '' };
    }
    const detail = String(err.stderr ?? err.message).trim();
    throw fail('git-failed', `git ${args[0]} failed: ${detail}`);
  }
}

/** True only when `dir` is the top of its own git work tree. */
function isTopLevel(dir) {
  if (!fs.existsSync(dir)) return false;
  const result = runGit(dir, ['rev-parse', '--show-toplevel'], { allow: [128] });
  if (result.status !== 0) return false;
  return result.stdout.trim() === fs.realpathSync(dir);
}

function requireRepo(dir) {
  if (!isTopLevel(dir)) {
    throw fail('not-repo', `${dir} is not a git repository; the framework does not write without git`);
  }
}

function hasCommits(dir) {
  return runGit(dir, ['rev-parse', '--verify', '--quiet', 'HEAD'], { allow: [1] }).status === 0;
}

function checkKind(kind) {
  if (!KINDS.includes(kind)) {
    throw fail('bad-kind', `kind must be one of ${KINDS.join(', ')}`);
  }
}

function checkMessage(message) {
  if (typeof message !== 'string' || message.trim() === '') {
    throw fail('bad-message', 'a version needs a message');
  }
}

/** Splits the NUL-separated output of git -z commands, dropping empty tails. */
function splitZ(text) {
  return text.split('\0').filter((item) => item !== '');
}

/** With explicit paths, pathspecs are file names, not patterns. */
function literalFor(paths) {
  return paths.length > 0 ? ['--literal-pathspecs'] : [];
}

/**
 * Makes `dir` a campaign repository: git init when it is not the top of a work
 * tree, the ignore rules for local state, and a repo-local identity when none is set.
 * Changes to .gitignore are left uncommitted.
 * @returns {{ created: boolean }}
 */
export function ensureRepo(root) {
  const dir = path.resolve(root);
  fs.mkdirSync(dir, { recursive: true });
  let created = false;
  if (!isTopLevel(dir)) {
    runGit(dir, ['init', '-q', '-b', 'main']);
    created = true;
  }
  ensureIgnoreRules(dir);
  ensureIdentity(dir);
  return { created };
}

function ensureIgnoreRules(dir) {
  const file = path.join(dir, '.gitignore');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const present = new Set(text.split(/\r?\n/).map((line) => line.trim()));
  const missing = IGNORED_RULES.filter((rule) => !present.has(rule));
  if (missing.length === 0) return;
  const separator = text === '' || text.endsWith('\n') ? '' : '\n';
  fs.writeFileSync(file, `${text}${separator}${missing.join('\n')}\n`);
}

function ensureIdentity(dir) {
  for (const [key, value] of IDENTITY) {
    const current = runGit(dir, ['config', '--get', key], { allow: [1] });
    if (current.status !== 0 || current.stdout.trim() === '') {
      runGit(dir, ['config', key, value]);
    }
  }
}

function classify(x, y) {
  if (x === '?' && y === '?') return 'added';
  if (x === 'R' || y === 'R') return 'renamed';
  if (x === 'D' || y === 'D') return 'deleted';
  if (x === 'A' || y === 'A' || x === 'C' || y === 'C') return 'added';
  return 'modified';
}

/**
 * @returns {{ isRepo: boolean, clean: boolean, changed: Array<{path: string, change: string}> }}
 */
export function status(root) {
  const dir = path.resolve(root);
  if (!isTopLevel(dir)) {
    return { isRepo: false, clean: false, changed: [] };
  }
  const out = runGit(dir, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).stdout;
  const tokens = splitZ(out);
  const changed = [];
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    const x = entry[0];
    const y = entry[1];
    const file = entry.slice(3);
    // In -z output a rename or copy is followed by its origin path as a separate token.
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') i++;
    changed.push({ path: file, change: classify(x, y) });
  }
  return { isRepo: true, clean: changed.length === 0, changed };
}

/**
 * Stages everything and commits it as one saved version. Nothing staged means nothing saved.
 * @returns {{ saved: boolean, hash?: string, message?: string }}
 */
export function saveVersion(root, { message, kind }) {
  const dir = path.resolve(root);
  requireRepo(dir);
  checkKind(kind);
  checkMessage(message);
  const subject = message.trim();
  runGit(dir, ['add', '-A']);
  const staged = runGit(dir, ['diff', '--cached', '--quiet'], { allow: [1] });
  if (staged.status === 0) {
    return { saved: false };
  }
  runGit(dir, ['commit', '-q', '--cleanup=whitespace', '-F', '-'], {
    input: `${subject}\n\n${TRAILER}: ${kind}\n`,
  });
  const hash = runGit(dir, ['rev-parse', '--short', 'HEAD']).stdout.trim();
  return { saved: true, hash, message: subject };
}

/** Saves the master's own edits before the framework starts any work. */
export function saveManualChanges(root, message) {
  return saveVersion(root, { message, kind: 'manual' });
}

/**
 * @returns {Array<{hash: string, date: string, message: string, kind: string}>} newest first
 */
export function listVersions(root, { limit = 20, paths = [] } = {}) {
  const dir = path.resolve(root);
  requireRepo(dir);
  if (!Number.isInteger(limit) || limit < 1) {
    throw fail('bad-limit', 'limit must be a positive integer');
  }
  if (!hasCommits(dir)) return [];
  const tail = paths.length > 0 ? ['--', ...paths] : [];
  const out = runGit(dir, [
    ...literalFor(paths),
    'log',
    `-n${limit}`,
    `--format=${LOG_FORMAT}`,
    ...tail,
  ]).stdout;
  return out
    .split('\x1e')
    .map((record) => record.trim())
    .filter((record) => record !== '')
    .map((record) => {
      const [hash, date, subject, trailer] = record.split('\x1f');
      const kind = (trailer ?? '').split('\n')[0].trim();
      return {
        hash,
        date,
        message: subject,
        kind: kind === '' ? 'unknown' : kind,
      };
    });
}

/**
 * Brings the campaign (or the given paths) back to the state of version `to`.
 * The restore is a new saved version, so history is kept.
 * Files that exist now but not in `to` are removed.
 * @returns {{ saved: boolean, hash: string|null, restored: string[] }}
 */
export function restore(root, { to, paths = [], message } = {}) {
  const dir = path.resolve(root);
  requireRepo(dir);
  checkMessage(message);
  if (!status(dir).clean) {
    throw fail('not-clean', 'the campaign has unsaved changes; save them before restoring');
  }
  const exists =
    typeof to === 'string' &&
    to !== '' &&
    !to.startsWith('-') &&
    runGit(dir, ['cat-file', '-e', `${to}^{commit}`], { allow: [1, 128] }).status === 0;
  if (!exists) {
    throw fail('unknown-version', `${to} is not a saved version of this campaign`);
  }

  const pre = literalFor(paths);
  // Without paths the whole tree is in scope; `:/` is the pathspec for that.
  const restoreScope = paths.length > 0 ? paths : [':/'];
  const treeScope = paths.length > 0 ? ['--', ...paths] : [];

  const restored = splitZ(
    runGit(dir, [...pre, 'diff', '--no-renames', '--name-only', '-z', 'HEAD', to, ...treeScope]).stdout,
  );
  if (restored.length === 0) {
    return { saved: false, hash: null, restored };
  }

  runGit(dir, [...pre, 'restore', `--source=${to}`, '--staged', '--worktree', '--', ...restoreScope]);

  // Files tracked now but absent from `to` are removed explicitly, so the
  // whole-tree restore does not depend on how git restore treats extra files.
  const headFiles = splitZ(
    runGit(dir, [...pre, 'ls-tree', '-r', '-z', '--name-only', 'HEAD', ...treeScope]).stdout,
  );
  const targetFiles = new Set(
    splitZ(runGit(dir, [...pre, 'ls-tree', '-r', '-z', '--name-only', to, ...treeScope]).stdout),
  );
  const stale = headFiles.filter((file) => !targetFiles.has(file));
  if (stale.length > 0) {
    runGit(dir, ['--literal-pathspecs', 'rm', '-q', '--ignore-unmatch', '--', ...stale]);
  }

  const saved = saveVersion(dir, { message, kind: 'restore' });
  return { saved: saved.saved, hash: saved.hash ?? null, restored };
}
