// Opens a GitHub issue on the Yllir repository on behalf of a game master, with
// three fallbacks: the gh CLI, the browser with a prefilled form, and the text
// kept in the campaign. The full text is always written to a file first.
// Failing tools are recorded in `tried`; nothing here throws for a failing tool.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { frameworkVersion, hookAgent } from './feedback-hook.mjs';

export const REPO = 'StefanoVe/yllir';

const TITLE_MAX = 120;
const FIELD_MAX = 2000;
const URL_MAX = 7000;
const REASON_MAX = 200;
const RUN_TIMEOUT_MS = 30_000;
const TRUNCATED = '\n\n[truncated, full text in the saved file]';
const FOOTER = 'Reported by the assistant on behalf of a game master. No campaign content is included.';

/** Default runner: spawnSync with an argument array, never a shell. */
function defaultRun(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', timeout: RUN_TIMEOUT_MS, shell: false });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error };
}

/** True when a path is worth replacing: not empty and not a filesystem root. */
function usable(p) {
  return typeof p === 'string' && p !== '' && p !== path.parse(p).root;
}

/** Returns a function that replaces the campaign root with <campaign> and the home folder with ~. */
function makeScrubber(root) {
  const campaign = [path.resolve(root)];
  try {
    campaign.push(fs.realpathSync(root));
  } catch {
    // The root may not exist yet; the resolved path is enough.
  }
  const pairs = [...new Set(campaign)]
    .filter(usable)
    .sort((a, b) => b.length - a.length)
    .map((from) => [from, '<campaign>']);
  const home = os.homedir();
  if (usable(home)) pairs.push([home, '~']);
  return (text) => {
    let out = String(text ?? '').replace(/\r\n?/g, '\n');
    for (const [from, to] of pairs) out = out.split(from).join(to);
    return out;
  };
}

/** Collapses runs of blank lines into one and trims the ends. */
function tidy(text) {
  return text.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n').trim();
}

/** Keeps the first `max` characters (code points, so no surrogate is split). */
function cap(text, max) {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join('') : text;
}

/** First non-empty line of a text, capped for a short reason. */
function firstLine(text) {
  const line = String(text ?? '').split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '';
  return cap(line, REASON_MAX);
}

/** The URL of a gh run: the last stdout line that starts with https://, or null. */
function lastIssueUrl(stdout) {
  const urls = String(stdout ?? '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('https://'));
  return urls.length ? urls[urls.length - 1] : null;
}

/** Runs one tool. A spawn error or a throw becomes `error`; it never escapes. */
function runTool(run, cmd, args) {
  try {
    const result = run(cmd, args) ?? {};
    const error = result.error ? `${result.error.code ? `${result.error.code}: ` : ''}${result.error.message ?? result.error}` : null;
    return {
      status: error ? null : (result.status ?? null),
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
      error,
    };
  } catch (err) {
    return { status: null, stdout: '', stderr: '', error: err?.message ?? String(err) };
  }
}

/** Reason text for a failed tool: a fixed label plus the first line of its output. */
function failureReason(label, tool, scrub) {
  const detail = firstLine(scrub(tool.error ?? tool.stderr ?? tool.stdout));
  return cap(detail ? `${label}: ${detail}` : label, REASON_MAX);
}

/** The command that opens a URL in the browser on this platform, or null. */
function openerFor(platform, url) {
  if (platform === 'darwin') return { cmd: 'open', args: [url] };
  if (platform === 'linux') return { cmd: 'xdg-open', args: [url] };
  // cmd treats & as a command separator, so it is escaped as ^&.
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', '', url.replace(/&/g, '^&')] };
  return null;
}

/**
 * Builds the issue title and Markdown body from the master's fields. Every
 * text is sanitised: the campaign root becomes <campaign>, the home folder ~,
 * blank lines are collapsed, the title is capped at 120 and each field at 2000.
 */
export function buildReport(root, fields = {}) {
  const scrub = makeScrubber(root);
  const title = cap(scrub(fields.title ?? '').replace(/\s+/g, ' ').trim(), TITLE_MAX);
  const sections = [
    ['Summary', fields.summary],
    ['Steps', fields.steps],
    ['Expected', fields.expected],
    ['Actual', fields.actual],
  ];
  const parts = [];
  for (const [heading, value] of sections) {
    const text = cap(tidy(scrub(value ?? '')), FIELD_MAX);
    if (text !== '') parts.push(`## ${heading}\n\n${text}`);
  }
  parts.push(
    [
      '## Environment',
      '',
      `- Framework version: ${frameworkVersion()}`,
      `- Agent: ${hookAgent()}`,
      `- OS: ${process.platform}`,
      `- Node: ${process.version}`,
    ].join('\n'),
  );
  parts.push(FOOTER);
  return { title, body: tidy(parts.join('\n\n')) };
}

/**
 * The prefilled "new issue" URL on the repository. When the URL would exceed
 * 7000 characters, the body is cut to the longest prefix that fits, followed by
 * a marker that points to the saved file.
 */
export function prefilledUrl(title, body) {
  const base = `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(title)}&body=`;
  const full = base + encodeURIComponent(body);
  if (full.length <= URL_MAX) return full;

  const points = Array.from(body);
  const fits = (count) => (base + encodeURIComponent(points.slice(0, count).join('') + TRUNCATED)).length <= URL_MAX;
  // Binary search for the largest prefix that still fits.
  let low = 0;
  let high = points.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(mid)) low = mid;
    else high = mid - 1;
  }
  return base + encodeURIComponent(points.slice(0, low).join('') + TRUNCATED);
}

/** Writes the full text and, next to it, the body alone (the one gh receives). */
function writeFullText(root, title, body) {
  const campaign = path.resolve(root);
  const dir = path.join(campaign, '.campaign', 'state', 'issues');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/:/g, '-');
  const full = path.join(dir, `${stamp}.md`);
  const bodyOnly = path.join(dir, `${stamp}.body.md`);
  fs.writeFileSync(full, `# ${title}\n\n${body}\n`);
  fs.writeFileSync(bodyOnly, `${body}\n`);
  return { relative: path.relative(campaign, full), bodyAbsolute: bodyOnly };
}

/**
 * Creates the issue with the first method that works: gh, then the browser
 * with a prefilled form, then the text left in the campaign. With dryRun only
 * the text is written and no tool is started.
 */
export function createIssue(root, fields = {}, options = {}) {
  const { run = defaultRun, platform = process.platform, dryRun = false } = options;
  const scrub = makeScrubber(root);
  const { title, body } = buildReport(root, fields);
  const url = prefilledUrl(title, body);
  const file = writeFullText(root, title, body);
  const tried = [];
  const finish = (status, issueUrl) => ({
    status,
    issue_url: issueUrl,
    prefilled_url: url,
    title,
    body_file: file.relative,
    tried,
  });

  if (dryRun) return finish('text', null);

  // Method 1: the gh CLI, when installed and signed in.
  const auth = runTool(run, 'gh', ['auth', 'status']);
  if (auth.error) {
    tried.push({ method: 'gh', ok: false, reason: failureReason('gh not available', auth, scrub) });
  } else if (auth.status !== 0) {
    tried.push({ method: 'gh', ok: false, reason: failureReason('not signed in to GitHub', auth, scrub) });
  } else {
    const created = runTool(run, 'gh', [
      'issue', 'create', '--repo', REPO, '--title', title, '--body-file', file.bodyAbsolute,
    ]);
    if (!created.error && created.status === 0) {
      tried.push({ method: 'gh', ok: true, reason: 'issue created' });
      return finish('created', lastIssueUrl(created.stdout));
    }
    tried.push({ method: 'gh', ok: false, reason: failureReason('gh issue create failed', created, scrub) });
  }

  // Method 2: the browser, with the prefilled form.
  const opener = openerFor(platform, url);
  if (!opener) {
    tried.push({ method: 'browser', ok: false, reason: `no browser opener on ${platform}` });
  } else {
    const opened = runTool(run, opener.cmd, opener.args);
    if (!opened.error && opened.status === 0) {
      tried.push({ method: 'browser', ok: true, reason: 'prefilled form opened' });
      return finish('browser', null);
    }
    tried.push({ method: 'browser', ok: false, reason: failureReason('browser open failed', opened, scrub) });
  }

  // Method 3: the text stays in the campaign folder.
  return finish('text', null);
}
