// Update notice: compares the installed framework version with the latest
// published one and reports a newer version, at most once a day, so the
// assistant can ask the master whether to update. checkUpdate only reads.
// recordNotice is the only writer, and it writes nothing but
// .campaign/state/update-notice.yaml. Any failure means "no notice": nothing is
// printed or thrown.

import fs from 'node:fs';
import path from 'node:path';
import { parseYamlLite } from './yaml-lite.mjs';

const PLUGIN_JSON = path.resolve(import.meta.dirname, '../../.claude-plugin/plugin.json');
const NOTICE_PATH = '.campaign/state/update-notice.yaml';
const CONFIG_PATH = 'campaign.yaml';
const ENTRY_LIMIT = 2000;
const TOTAL_LIMIT = 8000;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const NEWS_NAME_RE = /^(.+)\.md$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LANG_RE = /^[a-z]{2,3}(-[a-z0-9]+)?$/i;
const HEADER = 'YLLIR UPDATE AVAILABLE (for the assistant, not for the master)';
const NEXT_STEP =
  "next: after answering the master's first request, tell the master in plain words, with no technical terms, " +
  'that a newer version exists and what it changes (use the news), and ask whether to update now. ' +
  'The master decides. Do not update without a yes. Right after telling the master, run the update script with --postpone once, so the notice is not repeated until tomorrow.';

/**
 * Compares two MAJOR.MINOR.PATCH strings.
 * @returns {-1 | 0 | 1 | null} null when either value is not strictly of that form
 */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left === null || right === null) {
    return null;
  }
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) {
      return left[i] < right[i] ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Decides whether a notice is due for the campaign.
 * @param {string} campaignRoot
 * @param {{ sourceDir?: string, installed?: string, today?: string, language?: string | null }} [options]
 *   sourceDir defaults to the YLLIR_PUBLISHED_SOURCE variable, installed to the
 *   version in plugin.json, today to the local date, language to campaign.yaml.
 * @returns {{ installed: string, published: string, news: string | null } | null}
 */
export function checkUpdate(campaignRoot, options = {}) {
  return attempt(() => {
    const sourceDir = options.sourceDir === undefined ? process.env.YLLIR_PUBLISHED_SOURCE : options.sourceDir;
    if (typeof sourceDir !== 'string' || sourceDir === '') {
      return null;
    }
    const root = path.resolve(campaignRoot);
    const installed = options.installed === undefined ? attempt(readInstalledVersion, null) : options.installed;
    const published = attempt(() => readPublishedVersion(path.resolve(sourceDir)), null);
    if (compareVersions(published, installed) !== 1) {
      return null;
    }
    const today = options.today === undefined ? localDateString(new Date()) : options.today;
    if (!noticeDue(root, today)) {
      return null;
    }
    const language = options.language === undefined ? attempt(() => campaignLanguage(root), null) : options.language;
    return {
      installed,
      published,
      news: collectNews(path.resolve(sourceDir), installed, published, language),
    };
  }, null);
}

/**
 * Writes the notice memory after the notice was shown, or when the master
 * postpones it (snoozeDays > 0). Throws on invalid arguments: this is an
 * explicit write, not a check.
 * @returns {string} absolute path of the memory file
 */
export function recordNotice(campaignRoot, { version, today, snoozeDays = 0 } = {}) {
  if (parseVersion(version) === null) {
    throw new TypeError('recordNotice: version must be MAJOR.MINOR.PATCH');
  }
  if (typeof today !== 'string' || !DATE_RE.test(today)) {
    throw new TypeError('recordNotice: today must be YYYY-MM-DD');
  }
  if (!Number.isInteger(snoozeDays) || snoozeDays < 0) {
    throw new TypeError('recordNotice: snoozeDays must be a whole number, 0 or more');
  }
  const lines = [`last_notified_version: "${version}"`, `last_notified_on: "${today}"`];
  if (snoozeDays > 0) {
    lines.push(`snoozed_until: "${addDays(today, snoozeDays)}"`);
  }
  const file = path.join(path.resolve(campaignRoot), NOTICE_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
  return file;
}

/** Text block for the assistant. News lines are indented by two spaces. */
export function formatUpdateNotice(result) {
  const lines = [HEADER, `installed: ${result.installed}`, `published: ${result.published}`];
  if (result.news !== null && result.news !== undefined) {
    lines.push('news for the master:');
    for (const line of result.news.split(/\r?\n/)) {
      lines.push(line.trim() === '' ? '' : `  ${line}`);
    }
  }
  lines.push(NEXT_STEP);
  return lines.join('\n');
}

// ---------------------------------------------------------------- checks

/** True when no notice was shown today and no snooze is still running. */
function noticeDue(root, today) {
  const memory = attempt(() => readNoticeMemory(root), {});
  if (memory.last_notified_on === today) {
    return false;
  }
  const snoozed = memory.snoozed_until;
  if (typeof snoozed === 'string' && DATE_RE.test(snoozed) && snoozed > today) {
    return false;
  }
  return true;
}

/** Parsed memory file, or {} when it is missing, corrupt or not a mapping. */
function readNoticeMemory(root) {
  const text = readTextSafe(path.join(root, NOTICE_PATH));
  if (text === null) {
    return {};
  }
  const parsed = parseYamlLite(text);
  if (parsed.errors.length > 0 || parsed.data === null || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
    return {};
  }
  return parsed.data;
}

/**
 * News for every published version after fromVersion, up to and including toVersion,
 * oldest first. For each version the language variant is used when it exists,
 * else the plain file. Never throws: any failure gives null.
 * @returns {string | null}
 */
export function collectNews(sourceDir, fromVersion, toVersion, language) {
  return attempt(() => {
    const newsDir = path.join(sourceDir, 'news');
    const versions = new Set();
    for (const name of fs.readdirSync(newsDir)) {
      const version = newsVersionOf(name);
      if (version !== null) {
        versions.add(version);
      }
    }
    const inRange = [...versions]
      .filter((v) => compareVersions(v, fromVersion) === 1 && compareVersions(v, toVersion) !== 1)
      .sort((a, b) => compareVersions(a, b));
    const entries = [];
    for (const version of inRange) {
      const text = newsTextFor(newsDir, version, language);
      if (text !== null) {
        entries.push(text);
      }
    }
    const joined = entries.join('\n\n').slice(0, TOTAL_LIMIT).trim();
    return joined === '' ? null : joined;
  }, null);
}

/** Version of a news file name (X.Y.Z.md or X.Y.Z.<lang>.md), or null when the name is not one. */
function newsVersionOf(name) {
  const match = NEWS_NAME_RE.exec(name);
  if (match === null) {
    return null;
  }
  const base = match[1];
  if (parseVersion(base) !== null) {
    return base;
  }
  const dot = base.lastIndexOf('.');
  if (dot < 0) {
    return null;
  }
  const version = base.slice(0, dot);
  const lang = base.slice(dot + 1);
  return parseVersion(version) !== null && LANG_RE.test(lang) ? version : null;
}

/** Trimmed text of one version's news: the language variant when it exists, else the plain file. */
function newsTextFor(newsDir, version, language) {
  const candidates = [];
  if (typeof language === 'string' && LANG_RE.test(language)) {
    candidates.push(`${version}.${language}.md`);
  }
  candidates.push(`${version}.md`);
  for (const name of candidates) {
    const text = readTextSafe(path.join(newsDir, name));
    if (text !== null) {
      const news = text.trim().slice(0, ENTRY_LIMIT).trim();
      return news === '' ? null : news;
    }
  }
  return null;
}

function readPublishedVersion(sourceDir) {
  const text = fs.readFileSync(path.join(sourceDir, '.claude-plugin', 'plugin.json'), 'utf8');
  const version = JSON.parse(text).version;
  return parseVersion(version) === null ? null : version;
}

function readInstalledVersion() {
  const version = JSON.parse(fs.readFileSync(PLUGIN_JSON, 'utf8')).version;
  return parseVersion(version) === null ? null : version;
}

/** campaign.yaml language.main, or null when it cannot be read. */
function campaignLanguage(root) {
  const text = readTextSafe(path.join(root, CONFIG_PATH));
  if (text === null) {
    return null;
  }
  const parsed = parseYamlLite(text);
  if (parsed.errors.length > 0 || parsed.data === null || typeof parsed.data !== 'object') {
    return null;
  }
  const language = parsed.data.language;
  const main = language !== null && typeof language === 'object' ? language.main : undefined;
  return typeof main === 'string' ? main : null;
}

// ---------------------------------------------------------------- helpers

function parseVersion(text) {
  if (typeof text !== 'string') {
    return null;
  }
  const match = SEMVER_RE.exec(text);
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
}

function addDays(date, days) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/** Local calendar date as YYYY-MM-DD. */
function localDateString(now) {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function attempt(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** File text, or null when the file is missing or cannot be read. */
function readTextSafe(file) {
  return attempt(() => fs.readFileSync(file, 'utf8'), null);
}
