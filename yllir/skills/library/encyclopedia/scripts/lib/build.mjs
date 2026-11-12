// Builds the public encyclopedia of a campaign. The site is written into a
// temporary folder inside .campaign/cache/, every pre-publish check runs over the
// written files, and only a passing build replaces the previous one (a rename).
// A failing build leaves the previous build untouched and removes its temporary
// folder. The report is written into the build, so the saved build always says
// what it is.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateConfig } from '../../../../../scripts/lib/config.mjs';
import { ID_RE, collectEntries } from './entries.mjs';
import { renderIndex, renderEntry, renderRedirect, renderGone, render404, searchIndex } from './site.mjs';
import { runChecks } from './checks.mjs';
import { decryptLocked } from './locked.mjs';
import { langOf, reportText } from './strings.mjs';

const SITE_DIR = fileURLToPath(new URL('../../site/', import.meta.url));
export const CACHE_SUBDIR = path.join('.campaign', 'cache');
export const BUILD_NAME = 'encyclopedia';
export const DEFAULT_BASE_URL = 'http://localhost/';

/** Where the last good build lives: `<root>/.campaign/cache/encyclopedia/`. */
export function buildDir(root) {
  return path.join(root, CACHE_SUBDIR, BUILD_NAME);
}

/** The report saved with the last good build, or null. */
export function readSavedReport(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(buildDir(root), 'report.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** The current instant as ISO text. YLLIR_NOW (ISO text) overrides it, for tests. */
export function nowIso() {
  const fixed = process.env.YLLIR_NOW;
  if (fixed && !Number.isNaN(Date.parse(fixed))) return new Date(fixed).toISOString();
  return new Date().toISOString();
}

function failedReport(root, checkId, message) {
  return {
    ok: false,
    entries: 0,
    excluded: [],
    warnings: [],
    checks: [{ id: checkId, status: 'fail', message }],
    baseUrl: DEFAULT_BASE_URL,
    generatedAt: nowIso(),
    previewUrl: fs.existsSync(path.join(buildDir(root), 'index.html')) ? '/enc/' : null,
    manifest: {},
  };
}

/**
 * Builds the encyclopedia of a campaign.
 * @param {string} root campaign folder (absolute)
 * @returns {Promise<object>} the EncyclopediaReport: ok false when a check failed or the build could not run
 */
export async function buildEncyclopedia(root) {
  const validated = validateConfig(root);
  if (validated.config === null) {
    return failedReport(root, 'config', reportText('en')['config-missing']);
  }
  const config = validated.config;
  const lang = langOf(config.language?.main);
  const text = reportText(lang);
  if (validated.errors.length > 0) return failedReport(root, 'config', text['config-invalid']);
  if (config.modules?.encyclopedia !== true) return failedReport(root, 'module', text['module-off']);

  const siteTitle = config.encyclopedia?.title ?? config.campaign?.name ?? 'Encyclopedia';
  const baseUrl = config.encyclopedia?.base_url ?? DEFAULT_BASE_URL;
  const cacheDir = path.join(root, CACHE_SUBDIR);
  const dest = buildDir(root);
  const tmp = path.join(cacheDir, `${BUILD_NAME}.tmp-${crypto.randomBytes(6).toString('hex')}`);

  try {
    fs.mkdirSync(tmp, { recursive: true });
    const report = await writeAndCheck({ root, config, lang, siteTitle, baseUrl, tmp, dest });
    if (!report.ok) {
      fs.rmSync(tmp, { recursive: true, force: true });
      report.previewUrl = fs.existsSync(path.join(dest, 'index.html')) ? '/enc/' : null;
      return report;
    }
    report.previewUrl = '/enc/';
    fs.writeFileSync(path.join(tmp, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    swap(tmp, dest);
    return report;
  } catch {
    fs.rmSync(tmp, { recursive: true, force: true });
    return failedReport(root, 'build', text['build-error']);
  }
}

async function writeAndCheck({ root, config, lang, siteTitle, baseUrl, tmp }) {
  const collected = collectEntries(root, config);
  const { entries } = collected;
  const text = reportText(lang);
  const warnings = [...collected.warnings];
  const write = (rel, content) => {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };

  // Entries, index, 404, assets and the search index.
  const locks = [];
  for (const entry of entries) {
    const rendered = renderEntry(entry, { lang, siteTitle });
    write(path.join('e', entry.id, 'index.html'), rendered.html);
    locks.push(...rendered.locks);
  }
  const categories = [];
  for (const entry of entries) {
    if (!categories.some((c) => c.id === entry.category)) categories.push({ id: entry.category, title: entry.categoryTitle });
  }
  write('index.html', renderIndex({ lang, siteTitle, entries, categories }));
  write('404.html', render404({ lang, siteTitle }));
  write(path.join('assets', 'site.css'), fs.readFileSync(path.join(SITE_DIR, 'site.css'), 'utf8'));
  write(path.join('assets', 'site.js'), fs.readFileSync(path.join(SITE_DIR, 'site.js'), 'utf8'));
  write('search.json', `${JSON.stringify(searchIndex(entries), null, 1)}\n`);

  // Pictures, copied under their content hash.
  const copied = new Set();
  for (const entry of entries) {
    for (const rel of entry.images) {
      const info = collected.images.get(rel);
      if (!info) continue;
      const name = `${info.hash}.${info.ext}`;
      if (copied.has(name)) continue;
      copied.add(name);
      write(path.join('assets', 'img', name), info.bytes);
    }
  }

  // Merged ids redirect to their survivor; retired ids without one get a plain page.
  const entryIds = new Set(entries.map((e) => e.id));
  const redirects = new Map(); // old id -> survivor entry, or null when two entries claim it
  for (const entry of entries) {
    for (const old of entry.merged) {
      if (entryIds.has(old)) {
        warnings.push({ code: 'merged-id', message: text.mergedSkipped(old) });
      } else if (redirects.has(old) && redirects.get(old)?.id !== entry.id) {
        warnings.push({ code: 'merged-id', message: text.mergedDuplicate(old) });
        redirects.set(old, null);
      } else if (!redirects.has(old)) {
        redirects.set(old, entry);
      }
    }
  }
  for (const [old, target] of [...redirects].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    if (target === null) continue;
    write(path.join('e', old, 'index.html'), renderRedirect({ lang, siteTitle, target: { id: target.id, title: target.title } }));
  }
  for (const id of [...collected.retired].filter((x) => ID_RE.test(x)).sort()) {
    if (entryIds.has(id)) {
      warnings.push({ code: 'retired-id', message: text.retiredSkipped(id) });
      continue;
    }
    if (redirects.has(id)) continue;
    write(path.join('e', id, 'index.html'), renderGone({ lang, siteTitle }));
  }

  // The manifest: one hash per entry, so the next build can say what changed.
  const manifest = {};
  for (const entry of entries) {
    manifest[entry.id] = crypto
      .createHash('sha256')
      .update(entry.markdown)
      .update(entry.images.map((rel) => collected.images.get(rel)?.hash ?? '').join(','))
      .digest('hex')
      .slice(0, 16);
  }
  const previous = readSavedReport(root);
  const change = compareManifest(previous?.manifest ?? null, manifest);

  // Self-test: each locked text opens with its code, through the same Web Crypto path the site uses.
  const roundtrip = await Promise.all(
    locks.map(async (lock) => {
      try {
        return { ok: (await decryptLocked(lock)) === lock.plain };
      } catch {
        return { ok: false };
      }
    }),
  );

  // The checks read what was written, not what was meant to be written.
  const outputs = listFiles(tmp)
    .filter((rel) => rel !== 'report.json')
    .map((rel) => ({ rel, bytes: fs.readFileSync(path.join(tmp, rel)) }));
  const result = runChecks({
    lang,
    outputs,
    collected,
    structure: Array.isArray(config.structure) ? config.structure : [],
    roundtrip,
    change,
  });
  warnings.push(...result.warnings);

  return {
    ok: result.checks.every((c) => c.status !== 'fail'),
    entries: entries.length,
    excluded: collected.excluded,
    warnings: warnings.map((w) => ({ code: w.code, ...(w.path ? { path: w.path } : {}), message: w.message })),
    checks: result.checks,
    baseUrl,
    generatedAt: nowIso(),
    previewUrl: null,
    manifest,
  };
}

function compareManifest(prev, next) {
  if (prev === null || typeof prev !== 'object') return { first: true, added: 0, removed: 0, changed: 0 };
  const ids = Object.keys(next);
  return {
    first: false,
    added: ids.filter((id) => !(id in prev)).length,
    removed: Object.keys(prev).filter((id) => !(id in next)).length,
    changed: ids.filter((id) => id in prev && prev[id] !== next[id]).length,
  };
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

/** Replaces the saved build with the temporary one; the old build goes only after the new one is in place. */
function swap(tmp, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const hadOld = fs.existsSync(dest);
  const old = `${dest}.old-${crypto.randomBytes(6).toString('hex')}`;
  if (hadOld) fs.renameSync(dest, old);
  try {
    fs.renameSync(tmp, dest);
  } catch (err) {
    if (hadOld) fs.renameSync(old, dest);
    throw err;
  }
  if (hadOld) fs.rmSync(old, { recursive: true, force: true });
}
