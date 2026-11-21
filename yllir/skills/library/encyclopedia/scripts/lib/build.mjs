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
import { compareStrings } from '../../../../../scripts/lib/subjects.mjs';
import { renderIndex, renderEntry, renderRedirect, renderGone, render404, searchIndex, nameKey } from './site.mjs';
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

  const siteTitle = config.encyclopedia?.title ?? config.campaign?.name ?? 'Codex';
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

/**
 * The hash of one entry: its public text and the hashes of its pictures. The build writes it into
 * the manifest, and computeChanges compares it, so both must use this one function.
 */
export function entryHash(entry, images) {
  return crypto
    .createHash('sha256')
    .update(entry.markdown)
    .update(entry.images.map((rel) => images.get(rel)?.hash ?? '').join(','))
    .digest('hex')
    .slice(0, 16);
}

async function writeAndCheck({ root, config, lang, siteTitle, baseUrl, tmp }) {
  const collected = collectEntries(root, config);
  const { entries, settings } = collected;
  const text = reportText(lang);
  const warnings = [...collected.warnings];
  const generatedAt = nowIso();
  const write = (rel, content) => {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };
  if (!settings.flavourText) warnings.push({ code: 'flavour-off', message: text.flavourOff });

  // Entries, index, 404, assets, card data and the search index.
  // Discovered mode: each card is written under the name key of its title, and the keys go
  // into discover.json. A key that two titles share gets a numbered suffix, with a warning.
  const discovered = settings.list === 'discovered';
  const keyTitles = new Map(); // key -> titles that use it, first one first
  const discoverKeys = [];
  const cardKeyOf = (title) => {
    const base = nameKey(title);
    const titles = keyTitles.get(base) ?? [];
    titles.push(title);
    keyTitles.set(base, titles);
    if (titles.length === 1) return base;
    warnings.push({ code: 'name-key-clash', message: `${titles[0]} / ${title}` });
    return `${base}-${titles.length}`;
  };
  const locks = [];
  for (const entry of entries) {
    const rendered = renderEntry(entry, { lang, siteTitle, listMode: settings.list });
    write(path.join('e', entry.id, 'index.html'), rendered.html);
    locks.push(...rendered.locks);
    if (discovered) {
      const key = cardKeyOf(entry.title);
      discoverKeys.push(key);
      write(path.join('c', `${key}.json`), `${JSON.stringify({
        id: entry.id,
        title: entry.title,
        summary: entry.summary,
        artwork: entry.artwork?.src ?? null,
        placeholder: entry.placeholder,
      }, null, 1)}\n`);
    }
  }
  if (discovered) write('discover.json', `${JSON.stringify([...discoverKeys].sort())}\n`);
  const categories = [];
  for (const entry of entries) {
    if (!categories.some((c) => c.id === entry.category)) categories.push({ id: entry.category, title: entry.categoryTitle });
  }
  write('index.html', renderIndex({ lang, siteTitle, entries, categories, listMode: settings.list }));
  write('404.html', render404({ lang, siteTitle }));
  write(path.join('assets', 'site.css'), fs.readFileSync(path.join(SITE_DIR, 'site.css'), 'utf8'));
  write(path.join('assets', 'site.js'), fs.readFileSync(path.join(SITE_DIR, 'site.js'), 'utf8'));
  if (fs.existsSync(path.join(SITE_DIR, 'placeholders'))) {
    for (const name of fs.readdirSync(path.join(SITE_DIR, 'placeholders')).filter((n) => n.endsWith('.svg')).sort()) {
      write(path.join('assets', 'placeholders', name), fs.readFileSync(path.join(SITE_DIR, 'placeholders', name)));
    }
  }
  if (settings.list === 'full') write('search.json', `${JSON.stringify(searchIndex(entries), null, 1)}\n`);

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
  for (const entry of entries) manifest[entry.id] = entryHash(entry, collected.images);
  const sortedIds = Object.keys(manifest).sort(compareStrings);
  write('manifest.json', `${JSON.stringify({
    generatedAt,
    entries: Object.fromEntries(sortedIds.map((id) => [id, { hash: manifest[id], title: entries.find((e) => e.id === id).title }])),
  }, null, 1)}\n`);
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
    generatedAt,
    previewUrl: null,
    manifest,
    settings,
  };
}

/**
 * The changes since the saved build, without writing anything: the entries added, changed and
 * removed, each with its title, sorted by title.
 * @returns {{ built: boolean, generatedAt?: string, added?: object[], changed?: object[], removed?: object[], error?: string }}
 */
export function computeChanges(root) {
  const manifestFile = path.join(buildDir(root), 'manifest.json');
  if (!fs.existsSync(manifestFile)) return { built: false };
  const validated = validateConfig(root);
  if (validated.config === null) return { built: true, error: reportText('en')['config-missing'] };
  const config = validated.config;
  const text = reportText(langOf(config.language?.main));
  if (validated.errors.length > 0) return { built: true, error: text['config-invalid'] };
  if (config.modules?.encyclopedia !== true) return { built: true, error: text['module-off'] };

  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  } catch {
    return { built: true, error: text['build-error'] };
  }
  const previous = saved?.entries ?? {};
  const collected = collectEntries(root, config);
  const current = new Map(collected.entries.map((entry) => [entry.id, { title: entry.title, hash: entryHash(entry, collected.images) }]));
  const byTitle = (a, b) => compareStrings(a.title.toLowerCase(), b.title.toLowerCase()) || compareStrings(a.id, b.id);
  const added = [];
  const changed = [];
  const removed = [];
  for (const [id, now] of current) {
    if (!(id in previous)) added.push({ id, title: now.title });
    else if (previous[id]?.hash !== now.hash) changed.push({ id, title: now.title });
  }
  for (const id of Object.keys(previous)) {
    if (!current.has(id)) removed.push({ id, title: previous[id]?.title ?? id });
  }
  return {
    built: true,
    generatedAt: saved?.generatedAt,
    added: added.sort(byTitle),
    changed: changed.sort(byTitle),
    removed: removed.sort(byTitle),
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
