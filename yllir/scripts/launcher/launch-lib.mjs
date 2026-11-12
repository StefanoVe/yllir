// Pure helpers of the master screen launcher: argument parsing, campaign language,
// messages, the single-instance lock check and the READY line of the server.
// Used by launch.mjs; no side effects except the reads named below.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const MESSAGES = {
  M1: {
    it: 'Il master screen è aperto nel browser. Lascia questa finestra aperta mentre giochi; chiudila quando hai finito.',
    en: 'The master screen is open in your browser. Keep this window open while you play, and close it when you are done.',
  },
  M3: {
    it: 'Il master screen non è ancora disponibile in questa versione di Yllir. Aggiorna Yllir e riprova.',
    en: 'The master screen is not available in this version of Yllir yet. Update Yllir and try again.',
  },
  M4: {
    it: "Non riesco ad avviare il master screen. Riprova; se continua, chiedi aiuto all'assistente.",
    en: 'I could not start the master screen. Try again; if it keeps happening, ask the assistant for help.',
  },
};

const LANGUAGES = ['it', 'en'];
const STATUS_TIMEOUT_MS = 2000;

/** 'it' or 'en' for a known language code, else null. */
export function normalizeLang(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toLowerCase();
  return LANGUAGES.includes(code) ? code : null;
}

/** The text of a message for a language; English when the language is unknown. */
export function message(key, lang) {
  const texts = MESSAGES[key];
  if (!texts) throw new Error(`unknown message ${key}`);
  return texts[normalizeLang(lang) ?? 'en'];
}

/**
 * Parses `<campaign dir> [--lang it|en]` (also `--lang=it`). Unknown flags are
 * ignored. Returns { campaign: string | null, lang: 'it' | 'en' | null }.
 */
export function parseArgs(argv) {
  const out = { campaign: null, lang: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--lang') {
      out.lang = normalizeLang(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--lang=')) {
      out.lang = normalizeLang(arg.slice('--lang='.length));
    } else if (arg.startsWith('--')) {
      continue;
    } else if (out.campaign === null) {
      out.campaign = arg;
    }
  }
  return out;
}

/**
 * Reads `language.main` from campaign.yaml with a line reader (no YAML parser).
 * Returns 'it' or 'en', defaulting to 'en'.
 */
export function readCampaignLanguage(campaignDir) {
  let text;
  try {
    text = fs.readFileSync(path.join(campaignDir, 'campaign.yaml'), 'utf8');
  } catch {
    return 'en';
  }
  let inLanguage = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (/^\S/.test(line)) {
      inLanguage = /^language:\s*$/.test(line);
      continue;
    }
    if (inLanguage) {
      const found = /^\s+main:\s*['"]?([A-Za-z-]+)['"]?\s*$/.exec(line.replace(/\s+#.*$/, ''));
      if (found) return normalizeLang(found[1]) ?? 'en';
    }
  }
  return 'en';
}

/** The lock file the server writes at start: `<campaign>/.campaign/state/master-screen/server.json`. */
export function lockPath(campaignDir) {
  return path.join(campaignDir, '.campaign', 'state', 'master-screen', 'server.json');
}

/**
 * The lock of a server as { pid, port, url }, or null when missing or malformed.
 * The URL must be a plain http URL on 127.0.0.1 or localhost, so a damaged lock
 * can never send the browser somewhere else.
 */
export function readLock(campaignDir) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(lockPath(campaignDir), 'utf8'));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  if (!Number.isInteger(raw.pid) || raw.pid <= 0) return null;
  if (typeof raw.url !== 'string') return null;
  let url;
  try {
    url = new URL(raw.url);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:') return null;
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return null;
  return { pid: raw.pid, port: raw.port ?? null, url: url.origin };
}

/** True when a process with this pid exists (EPERM means it exists but belongs to someone else). */
export function isPidAlive(pid, kill = process.kill) {
  try {
    kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

/** True when GET <url>/api/status answers with a 2xx status. Never throws. */
export async function probeStatus(url) {
  try {
    const res = await fetch(new URL('/api/status', url), { signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * The URL of a server that already runs for this campaign, or null. A lock whose
 * pid is dead is never probed; a live pid must also answer /api/status.
 */
export async function findLiveServer(campaignDir, { probe = probeStatus, alive = isPidAlive } = {}) {
  const lock = readLock(campaignDir);
  if (lock === null) return null;
  if (!alive(lock.pid)) return null;
  return (await probe(lock.url)) ? lock.url : null;
}

/** { url, pid } when the line is the server's READY line, else null. */
export function parseReadyLine(line) {
  let data;
  try {
    data = JSON.parse(String(line).trim());
  } catch {
    return null;
  }
  if (!data || data.ready !== true || typeof data.url !== 'string') return null;
  if (!Number.isInteger(data.pid) || data.pid <= 0) return null;
  return { url: data.url, pid: data.pid };
}

/** The command that opens a URL in the default browser, per platform. */
export function browserCommand(url, platform = process.platform) {
  if (platform === 'darwin') return { cmd: 'open', args: [url] };
  if (platform === 'win32') return { cmd: 'explorer.exe', args: [url] };
  return { cmd: 'xdg-open', args: [url] };
}

/** True when the path is an existing regular file. */
function isExistingFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * The Claude Code path from the output of `command -v claude` (POSIX: only the last
 * non-empty line counts, so noise printed by the shell profile is ignored) or of
 * `where claude` (Windows: the first line that is an existing file). Returns an
 * absolute existing file or null. Never throws.
 */
export function parseClaudeLookup(output, { platform = process.platform, exists = isExistingFile } = {}) {
  const lines = String(output ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const candidates = platform === 'win32' ? lines : lines.slice(-1);
  const flavour = platform === 'win32' ? path.win32 : path.posix;
  for (const candidate of candidates) {
    if (flavour.isAbsolute(candidate) && exists(candidate)) return candidate;
  }
  return null;
}

/**
 * Finds Claude Code the way the user's terminal does: runs the login shell once
 * (`-ilc 'command -v claude'`, no shell string) on macOS and Linux, `where claude` on
 * Windows. Failures and timeouts give null. `execFile` is injectable for tests.
 */
export function resolveUserClaudePath({
  platform = process.platform,
  env = process.env,
  execFile = execFileCallback,
  exists = isExistingFile,
} = {}) {
  const run = platform === 'win32'
    ? execFile('where', ['claude'], { timeout: 5000, windowsHide: true })
    : execFile(env.SHELL || '/bin/zsh', ['-ilc', 'command -v claude'], { timeout: 5000 });
  return run.then((stdout) => parseClaudeLookup(stdout, { platform, exists }));
}

/** execFile as a promise of stdout; any failure resolves to null. */
export function execFileCallback(file, args, options) {
  return new Promise((resolve) => {
    try {
      execFile(file, args, options, (err, stdout) => resolve(err ? null : String(stdout)));
    } catch {
      resolve(null);
    }
  });
}

/**
 * The environment of the server process: PATH gets the directory of the running Node
 * first (so a `#!/usr/bin/env node` Claude script finds node), and YLLIR_CLAUDE_PATH
 * carries the Claude Code path when one was found. The input env is not changed.
 */
export function buildChildEnv({ env = {}, claudePath = null, nodeDir, platform = process.platform }) {
  const out = { ...env };
  const sep = platform === 'win32' ? ';' : ':';
  const key = Object.keys(out).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';
  const current = out[key] ?? '';
  out[key] = [nodeDir, current].filter((part) => part !== undefined && part !== '').join(sep);
  if (claudePath) out.YLLIR_CLAUDE_PATH = claudePath;
  return out;
}
