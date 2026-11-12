// Git access for the change history. Owner: history engineer.
// Every call is `git -C <campaignRoot> ...` through execFile with an argument array (never a
// shell string), with GIT_TERMINAL_PROMPT=0, LC_ALL=C and a 30 s timeout. Nothing here rewrites
// history: the only write is `revert`, which adds one commit.
import { execFile } from 'node:child_process';
import type { ChangedFile, DiffHunk, FileDiff, FileStatus } from '../../../shared/src/types.js';

export const GIT_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 256 * 1024 * 1024;
export const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
const UNDO_IDENTITY = [
  ['user.name', 'Yllir'],
  ['user.email', 'yllir@localhost.invalid'],
];

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface LogEntry {
  sha: string;
  at: string;
  subject: string;
  files: ChangedFile[];
}

export type RevertOutcome = 'done' | 'conflict' | 'nothing' | 'failed';

/** Runs git in the campaign folder. Exit codes listed in `allow` resolve; anything else rejects. */
export function runGit(root: string, args: string[], allow: number[] = [0]): Promise<GitResult> {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };
  // Variables set by an outer git process would point every call somewhere else.
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[name];
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', root, '-c', 'core.quotePath=false', ...args],
      { env, timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_BUFFER, encoding: 'utf8', windowsHide: true },
      (err, stdout, stderr) => {
        const out = String(stdout);
        const errText = String(stderr);
        if (!err) {
          resolve({ code: 0, stdout: out, stderr: errText });
          return;
        }
        const e = err as { code?: unknown; killed?: boolean; message: string };
        if (e.code === 'ENOENT') {
          reject(new Error('git is not installed or not on the PATH'));
          return;
        }
        const code = typeof e.code === 'number' ? e.code : 1;
        if (!e.killed && allow.includes(code)) {
          resolve({ code, stdout: out, stderr: errText });
          return;
        }
        const detail = errText.trim() || e.message;
        reject(new Error(`git ${args[0]} failed${e.killed ? ' (timeout)' : ''}: ${detail}`));
      },
    );
  });
}

/** Files of the framework's own state, never canon. */
export function isLocalPath(p: string): boolean {
  return p.startsWith('.campaign/') || p.startsWith('.git/') || p === '.git';
}

/** Parses `--name-status -M` lines: `M\tpath`, `A\tpath`, `D\tpath`, `R100\told\tnew`. */
export function parseNameStatus(text: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const parts = line.split('\t');
    const code = parts[0].charAt(0);
    if (code === 'R') {
      if (parts.length >= 3) files.push({ path: parts[2], status: 'renamed', from: parts[1] });
    } else if (code === 'C') {
      if (parts.length >= 3) files.push({ path: parts[2], status: 'added' });
    } else if (parts.length >= 2) {
      const status: FileStatus = code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified';
      files.push({ path: parts[1], status });
    }
  }
  return files;
}

/** The commit HEAD points to, or null when the campaign has no commit yet. */
export async function head(root: string): Promise<string | null> {
  const result = await runGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD'], [0, 1]);
  const sha = result.stdout.trim();
  return result.code === 0 && sha !== '' ? sha : null;
}

/** Full sha of a commit, or null when the id does not name a commit. */
export async function resolveCommit(root: string, id: string): Promise<string | null> {
  if (!SHA_PATTERN.test(id)) return null;
  const result = await runGit(root, ['rev-parse', '--verify', '--quiet', `${id}^{commit}`], [0, 1]);
  const sha = result.stdout.trim();
  return result.code === 0 && sha !== '' ? sha : null;
}

/** Commits last first, with the files each one touched. */
export async function log(root: string, limit: number): Promise<LogEntry[]> {
  if ((await head(root)) === null) return [];
  const result = await runGit(root, [
    'log',
    `-n${limit}`,
    '-M',
    '--name-status',
    '--format=%x1e%H%x1f%aI%x1f%s',
  ]);
  const entries: LogEntry[] = [];
  for (const chunk of result.stdout.split('\x1e')) {
    if (chunk.trim() === '') continue;
    const newline = chunk.indexOf('\n');
    const header = newline === -1 ? chunk : chunk.slice(0, newline);
    const rest = newline === -1 ? '' : chunk.slice(newline + 1);
    const [sha, at, subject] = header.split('\x1f');
    entries.push({
      sha: (sha ?? '').trim(),
      at: (at ?? '').trim(),
      subject: (subject ?? '').trim(),
      files: parseNameStatus(rest),
    });
  }
  return entries;
}

/** Files touched by one commit. */
export async function showFiles(root: string, sha: string): Promise<ChangedFile[]> {
  const result = await runGit(root, ['show', '--name-status', '-M', '--format=', sha]);
  return parseNameStatus(result.stdout);
}

/** Shas reachable from `to` and not from `from` (oldest first is not guaranteed). */
export async function revList(root: string, from: string, to: string): Promise<string[]> {
  const result = await runGit(root, ['rev-list', `${from}..${to}`]);
  return result.stdout.split('\n').map((line) => line.trim()).filter((line) => SHA_PATTERN.test(line));
}

function diffPath(raw: string, prefix: string): string | null {
  let value = raw.replace(/\t$/, '');
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
  return value.startsWith(prefix) ? value.slice(prefix.length) : null;
}

/**
 * Parses the output of `git show --patch`. Binary files have no hunks. Files under .campaign/
 * are dropped. Headers are read only before the first hunk of a file; inside a hunk every line
 * starting with +, - or space is content.
 */
export function parseUnifiedDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | null = null;
  let hunk: DiffHunk | null = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const match = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
      file = { path: match ? match[2] : line.slice('diff --git '.length), status: 'modified', hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    if (file === null) continue;
    if (line.startsWith('@@')) {
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (hunk !== null) {
      if (line.startsWith('+')) hunk.lines.push({ kind: 'add', text: line.slice(1) });
      else if (line.startsWith('-')) hunk.lines.push({ kind: 'del', text: line.slice(1) });
      else if (line.startsWith(' ')) hunk.lines.push({ kind: 'ctx', text: line.slice(1) });
      continue;
    }
    if (line.startsWith('new file mode')) file.status = 'added';
    else if (line.startsWith('deleted file mode')) file.status = 'deleted';
    else if (line.startsWith('rename from ')) file.status = 'renamed';
    else if (line.startsWith('rename to ')) {
      file.status = 'renamed';
      file.path = line.slice('rename to '.length).replace(/\t$/, '');
    } else if (line.startsWith('--- ')) {
      const old = diffPath(line.slice(4), 'a/');
      if (old !== null && file.status === 'deleted') file.path = old;
    } else if (line.startsWith('+++ ')) {
      const current = diffPath(line.slice(4), 'b/');
      if (current !== null) file.path = current;
    }
  }
  return files.filter((item) => !isLocalPath(item.path));
}

/** Full diff of one commit, canon files only. */
export async function diff(root: string, sha: string): Promise<FileDiff[]> {
  const result = await runGit(root, [
    'show',
    '--format=',
    '--patch',
    '-M',
    '--no-color',
    '--no-ext-diff',
    '-U3',
    sha,
  ]);
  return parseUnifiedDiff(result.stdout);
}

/**
 * True when nothing outside .campaign/ and .git has an uncommitted change. Untracked canon
 * files count as changes.
 */
export async function isCleanCanon(root: string, isHidden: (p: string) => boolean = isLocalPath): Promise<boolean> {
  const result = await runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const tokens = result.stdout.split('\0');
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    if (entry.length < 4) continue;
    const x = entry[0];
    const y = entry[1];
    // A rename or copy is followed by its origin path as its own NUL-separated token.
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') i++;
    if (!isHidden(entry.slice(3))) return false;
  }
  return true;
}

async function abortRevert(root: string): Promise<void> {
  await runGit(root, ['revert', '--abort'], [0, 128]);
  // Without a revert in progress (the --no-commit path) the index and files are restored here.
  await runGit(root, ['reset', '--merge'], [0, 128]);
}

/**
 * Undoes one commit: `git revert --no-commit`, then one commit whose message is
 * `Undo: <original subject>`. On conflict the revert is aborted and nothing changes.
 * Never amends and never rewrites history.
 */
export async function revert(root: string, sha: string, originalSubject: string): Promise<RevertOutcome> {
  try {
    const reverted = await runGit(root, ['revert', '--no-commit', sha], [0, 1]);
    if (reverted.code !== 0) {
      await abortRevert(root);
      return 'conflict';
    }
    const staged = await runGit(root, ['diff', '--cached', '--quiet'], [0, 1]);
    if (staged.code === 0) {
      await abortRevert(root);
      return 'nothing';
    }
    const identity: string[] = [];
    for (const [key, value] of UNDO_IDENTITY) {
      const current = await runGit(root, ['config', '--get', key], [0, 1]);
      if (current.code !== 0 || current.stdout.trim() === '') identity.push('-c', `${key}=${value}`);
    }
    await runGit(root, [...identity, 'commit', '-q', '-m', `Undo: ${originalSubject}`]);
    return 'done';
  } catch {
    await abortRevert(root).catch(() => undefined);
    return 'failed';
  }
}
