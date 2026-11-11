// Read-only check of the folder a session starts in. Its text is added to the
// assistant's context by the SessionStart hook, so the entry skill can react.
// It never writes and never throws: every sub-check that fails becomes a
// null value (or a 'check-failed' code for settings).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { validateConfig } from './config.mjs';
import { checkFingerprints } from './instructions.mjs';
import { listVersions, status } from './versions.mjs';
import { parseYamlLite } from './yaml-lite.mjs';
import { workNote } from './work-note.mjs';
import { checkUpdate, formatUpdateNotice } from './update-check.mjs';
import { listSheets, readStructure } from './subjects.mjs';
import { parseFrontmatter } from './frontmatter.mjs';

const PLUGIN_JSON = path.resolve(import.meta.dirname, '../../.claude-plugin/plugin.json');
const VERSION_PATH = '.campaign/version.yaml';
const UPDATE_STATE_PATH = '.campaign/state/update.yaml';
// Paths the framework never counts as changes (same rules as versions.mjs).
const IGNORED_PREFIXES = ['.campaign/state', '.campaign/cache'];
const VERSION_LIMIT = 1000000;
// Root-level notes that are not world cards.
const ROOT_NOTES = ['CLAUDE.md', 'README.md'];
const HEADER = 'YLLIR SESSION CHECK (for the assistant, not for the master)';
const NEXT_STEP = 'next: invoke the skill yllir:yllir before answering the master.';

/**
 * @returns {{
 *   root: string,
 *   folder: 'empty' | 'campaign' | 'unfinished' | 'other',
 *   git: 'ok' | 'missing',
 *   versions: { count: number, last: { message: string, date: string } | null } | null,
 *   unsaved: number | null,
 *   settings: { ok: boolean, codes: string[] } | null,
 *   instructions: 'up-to-date' | 'missing' | { changed: string[] } | null,
 *   framework_version: string | null,
 *   campaign_framework_version: string | null,
 *   post_update: 'needed' | null,
 *   work_note: string | null,
 *   update: { installed: string, published: string, news: string | null } | null,
 * }}
 */
export function sessionCheck(root) {
  const dir = path.resolve(root);
  const folder = detectFolder(dir);
  const result = {
    root: realRoot(dir),
    folder,
    git: gitState(),
    versions: null,
    unsaved: null,
    settings: null,
    instructions: null,
    framework_version: attempt(readFrameworkVersion, null),
    campaign_framework_version: null,
    post_update: null,
    work_note: null,
    update: null,
  };
  if (folder !== 'campaign') {
    return result;
  }

  const saved = attempt(() => savedState(dir), null);
  if (saved !== null) {
    result.versions = saved.versions;
    result.unsaved = saved.unsaved;
  }
  result.settings = attempt(
    () => {
      const config = validateConfig(dir);
      return { ok: config.ok, codes: unique(config.errors.map((issue) => issue.code)) };
    },
    { ok: false, codes: ['check-failed'] },
  );
  result.instructions = attempt(() => {
    const fingerprints = checkFingerprints(dir);
    if (fingerprints.missing_version_file) return 'missing';
    if (fingerprints.ok) return 'up-to-date';
    return { changed: [...fingerprints.changed] };
  }, null);
  result.campaign_framework_version = attempt(() => readCampaignVersion(dir), null);
  result.post_update = attempt(() => readPostUpdate(dir), null);
  result.work_note = attempt(() => workNote(dir), null);
  result.update = attempt(() => checkUpdate(dir), null);
  return result;
}

/** Plain-text report for the assistant. Lines whose value is null are omitted. */
export function formatCheck(result) {
  const lines = [HEADER, `campaign root: ${result.root}`, `folder: ${result.folder}`, `git: ${result.git}`];

  if (result.versions !== null) {
    const { count, last } = result.versions;
    lines.push(
      last === null
        ? `saved versions: ${count}`
        : `saved versions: ${count} (last: "${last.message}" on ${last.date})`,
    );
  }
  if (result.unsaved !== null) {
    lines.push(`changes not yet saved: ${result.unsaved} files`);
  }
  if (result.settings !== null) {
    lines.push(
      result.settings.ok
        ? 'settings: valid'
        : `settings: problems: ${result.settings.codes.join(', ')}`,
    );
  }
  if (result.instructions !== null) {
    if (result.instructions === 'up-to-date') {
      lines.push('instructions: up to date');
    } else if (result.instructions === 'missing') {
      lines.push('instructions: missing');
    } else {
      lines.push(`instructions: changed by hand: ${result.instructions.changed.join(', ')}`);
    }
  }
  if (result.framework_version !== null) {
    const made =
      result.campaign_framework_version === null
        ? ''
        : ` (campaign made with ${result.campaign_framework_version})`;
    lines.push(`framework version: ${result.framework_version}${made}`);
    if (
      result.campaign_framework_version !== null &&
      result.campaign_framework_version !== result.framework_version
    ) {
      lines.push('campaign alignment: needed');
    }
  }
  if (result.post_update === 'needed') {
    lines.push('post-update: needed');
  }
  if (result.work_note !== null) {
    lines.push(`work note: ${result.work_note}`);
  }
  lines.push(NEXT_STEP);
  if (result.update) {
    lines.push('', formatUpdateNotice(result.update));
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- sub-checks

/** Absolute real path of the folder, or the resolved path when it does not exist. */
function realRoot(dir) {
  try {
    return fs.realpathSync(dir);
  } catch {
    return dir;
  }
}

function detectFolder(dir) {
  try {
    if (fs.existsSync(path.join(dir, 'campaign.yaml'))) {
      // A first new-campaign run that stopped halfway: config written, no saved
      // version and no world card. Any doubt (a failed check) keeps 'campaign'.
      return attempt(() => isUnfinished(dir), false) ? 'unfinished' : 'campaign';
    }
    const names = fs.readdirSync(dir);
    return names.every((name) => name.startsWith('.')) ? 'empty' : 'other';
  } catch {
    return 'other';
  }
}

/** True when the campaign has no saved version and no .md card yet. */
function isUnfinished(dir) {
  if (savedVersionCount(dir) > 0) return false;
  return !hasCard(dir);
}

function savedVersionCount(dir) {
  if (!status(dir).isRepo) return 0;
  return listVersions(dir, { limit: 1 }).length;
}

/**
 * Any .md file in the campaign, except the instruction files at the root and
 * anything inside dot-named entries (the framework's own state).
 */
function hasCard(root) {
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (walk(path.join(dir, entry.name), relPath)) return true;
      } else if (entry.isFile() && entry.name.endsWith('.md') && !ROOT_NOTES.includes(relPath)) {
        return true;
      }
    }
    return false;
  };
  return walk(root, '');
}

function gitState() {
  try {
    execFileSync('git', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    return 'ok';
  } catch (err) {
    return err.code === 'ENOENT' ? 'missing' : 'ok';
  }
}

/**
 * Saved versions and unsaved changes. A campaign that is not a git repository
 * yet has no saved versions, and every non-ignored file counts as unsaved.
 */
function savedState(dir) {
  const state = status(dir);
  if (!state.isRepo) {
    return { versions: { count: 0, last: null }, unsaved: countFiles(dir) };
  }
  const list = listVersions(dir, { limit: VERSION_LIMIT });
  const last = list.length === 0 ? null : { message: list[0].message, date: list[0].date.slice(0, 10) };
  return { versions: { count: list.length, last }, unsaved: state.changed.length };
}

function countFiles(root) {
  let count = 0;
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.name === '.git' || isIgnored(relPath)) continue;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), relPath);
      } else {
        count += 1;
      }
    }
  };
  walk(root, '');
  return count;
}

function isIgnored(relPath) {
  return IGNORED_PREFIXES.some((prefix) => relPath === prefix || relPath.startsWith(`${prefix}/`));
}

function readCampaignVersion(dir) {
  const text = readTextOrNull(path.join(dir, VERSION_PATH));
  if (text === null) return null;
  const parsed = parseYamlLite(text);
  if (parsed.errors.length > 0 || parsed.data === null || typeof parsed.data !== 'object') return null;
  const version = parsed.data.framework_version;
  return typeof version === 'string' ? version : null;
}

/** Pending post-update sheet conversion, read without changing campaign state. */
function readPostUpdate(dir) {
  const itemText = readTextOrNull(path.join(dir, '.campaign/state/update/item-descriptions.json'));
  if (itemText === null && hasItemSheets(dir) && isAtLeast(readFrameworkVersion(), '0.26.0')) return 'needed';
  if (itemText !== null) {
    try {
      const inventory = JSON.parse(itemText);
      if (inventory.migration_id !== 'item-descriptions-v1' || !Array.isArray(inventory.items)) return 'needed';
      if (inventory.items.some((item) => !item || typeof item.file !== 'string' || item.status !== 'complete')) return 'needed';
    } catch { return 'needed'; }
  }
  const text = readTextOrNull(path.join(dir, UPDATE_STATE_PATH));
  if (text === null) return null;
  const parsed = parseYamlLite(text);
  if (parsed.errors.length > 0 || parsed.data === null || typeof parsed.data !== 'object') return null;
  return parsed.data.sheet_migration === 'pending' || parsed.data.geography_migration === 'pending' ? 'needed' : null;
}

function hasItemSheets(dir) {
  const { structure } = readStructure(dir);
  if (!structure) return false;
  for (const category of structure.filter((entry) => entry.type === 'objects' && typeof entry.folder === 'string')) {
    for (const file of listSheets(dir, category.folder)) {
      try { if (parseFrontmatter(fs.readFileSync(path.join(dir, file), 'utf8')).data?.template === 'item') return true; }
      catch { return true; }
    }
  }
  return false;
}

function isAtLeast(version, minimum) {
  const parse = (value) => /^\d+\.\d+\.\d+$/.test(value ?? '') ? value.split('.').map(Number) : null;
  const a = parse(version), b = parse(minimum);
  return Boolean(a && b && (a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] >= b[2])))));
}

function readFrameworkVersion() {
  const version = JSON.parse(fs.readFileSync(PLUGIN_JSON, 'utf8')).version;
  return typeof version === 'string' ? version : null;
}

// ---------------------------------------------------------------- helpers

function attempt(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function unique(values) {
  return [...new Set(values)];
}

function readTextOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
    throw err;
  }
}
