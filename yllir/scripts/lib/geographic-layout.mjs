// Plans a reversible geographic view of campaign sheets. Place folders are the
// sole source of the geographic hierarchy; all other paths are derived views.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseYamlLite } from './yaml-lite.mjs';
import { readStructure, listSheets, compareStrings } from './subjects.mjs';

const MANIFEST = '.campaign/geographic-layout.json';
const LAYOUT_TYPES = new Set(['subjects', 'objects', 'free', 'master-only']);
const HASH = (value) => crypto.createHash('sha256').update(value).digest('hex');

/** Build a JSON-safe, reviewable plan. Options may replace existing file text for planning. */
export function planGeographicLayout(root, { overlayFiles = [] } = {}) {
  const errors = [];
  const { structure, errors: configErrors } = readStructure(root);
  if (!structure) return emptyPlan([{ file: 'campaign.yaml', message: configErrors[0]?.message ?? 'invalid campaign structure' }]);
  const categories = Object.fromEntries(structure.filter((c) => typeof c.folder === 'string').map((c) => [c.type, safeFolder(c.folder)]));
  const placeFolder = categories.places ?? null;
  const labels = geographicLabels(root); // read once per plan
  const overlay = new Map(overlayFiles.map((item) => [normalizeRel(item.path), item.content]));
  const read = (rel) => overlay.has(rel) ? overlay.get(rel) : fs.readFileSync(path.join(root, rel), 'utf8');
  const placeById = new Map();
  for (const file of placeFolder ? [...new Set([...listSheets(root, placeFolder), ...[...overlay.keys()].filter((p) => p.startsWith(`${placeFolder}/`) && p.endsWith('.md'))])].sort(compareStrings) : []) {
    try {
      const parsed = metadata(read(file));
      if (typeof parsed.id !== 'string' || !parsed.id) { errors.push({ file, message: 'place sheet has no id' }); continue; }
      if (placeById.has(parsed.id)) { errors.push({ file, message: `duplicate place id ${parsed.id}` }); continue; }
      const rel = path.posix.relative(placeFolder, file);
      const parent = path.posix.dirname(rel);
      const stem = path.posix.basename(rel, '.md');
      const parentParts = parent === '.' ? [] : parent.split('/');
      const coordinate = [...parentParts, ...(parentParts.at(-1) === stem ? [] : [stem])];
      placeById.set(parsed.id, { file, coordinate, folder: placeFolder });
    } catch (error) { errors.push({ file, message: error.message }); }
  }
  if (errors.length) return emptyPlan(errors);

  const locationById = new Map();
  const eventLocations = new Map();
  const sheets = [];
  const ownership = new Map();
  const ownershipCategories = [...structure].filter((c) => typeof c.folder === 'string').sort((a, b) => safeFolder(b.folder).length - safeFolder(a.folder).length);
  for (const category of ownershipCategories) {
    const folder = safeFolder(category.folder);
    const paths = [...new Set([...listSheets(root, folder), ...[...overlay.keys()].filter((p) => p.startsWith(`${folder}/`) && p.endsWith('.md'))])];
    for (const file of paths) if (!ownership.has(file)) ownership.set(file, category);
  }
  for (const category of structure) {
    if (!LAYOUT_TYPES.has(category.type) || typeof category.folder !== 'string') continue;
    for (const file of [...new Set([...listSheets(root, safeFolder(category.folder)), ...[...overlay.keys()].filter((p) => p.startsWith(`${safeFolder(category.folder)}/`) && p.endsWith('.md'))])].sort(compareStrings)) {
      if (isLink(path.join(root, file)) || ownership.get(file) !== category) continue; // never relocate ingest originals or derived views
      let data;
      try { data = metadata(read(file)); } catch (error) { errors.push({ file, message: error.message }); continue; }
      if (!data.id) continue; // non-sheet Markdown in these folders is left alone
      sheets.push({ file, type: category.type, folder: safeFolder(category.folder), id: String(data.id), data });
      if (data.location !== undefined) {
        const ids = stringList(data.location);
        if (ids === null) { errors.push({ file, message: 'location must be a list of place ids' }); continue; }
        const resolved = resolveLocations(ids, placeById, file, errors);
        locationById.set(String(data.id), resolved);
      }
    }
  }
  const plotFolder = categories.plot;
  if (plotFolder) {
    const knownSubjectIds = new Set([...placeById.keys(), ...sheets.map((sheet) => sheet.id)]);
    for (const file of [...new Set([...listSheets(root, plotFolder), ...[...overlay.keys()].filter((p) => p.startsWith(`${plotFolder}/`) && p.endsWith('.md'))])].sort(compareStrings)) {
      if (isLink(path.join(root, file))) continue; // by-location views are never events
      try {
        const data = metadata(read(file));
        if (data.location !== undefined) {
          const ids = stringList(data.location);
          if (ids === null) errors.push({ file, message: 'location must be a list of place ids' });
          else resolveLocations(ids, placeById, file, errors);
        }
        if (data.appearances === undefined) continue;
        if (!Array.isArray(data.appearances)) { errors.push({ file, message: 'appearances must be a list' }); continue; }
        for (const appearance of data.appearances) {
          if (!appearance || typeof appearance !== 'object' || Array.isArray(appearance) || typeof appearance.subject !== 'string') {
            errors.push({ file, message: 'each appearance needs subject and location fields' }); continue;
          }
          if (!knownSubjectIds.has(appearance.subject)) errors.push({ file, message: `unknown appearance subject ${appearance.subject}` });
          const ids = stringList(appearance.location);
          if (ids === null) { errors.push({ file, message: 'appearance location must be a list of place ids' }); continue; }
          const resolved = resolveLocations(ids, placeById, file, errors);
          const item = eventLocations.get(appearance.subject) ?? [];
          item.push(...resolved);
          eventLocations.set(appearance.subject, item);
        }
      } catch (error) { errors.push({ file, message: error.message }); }
    }
  }
  if (errors.length) return emptyPlan(errors);

  const moves = [];
  const finalPathById = new Map();
  for (const sheet of sheets) {
    const loc = locationById.get(sheet.id) ?? [];
    const eventLoc = eventLocations.get(sheet.id) ?? [];
    const all = [...loc, ...eventLoc];
    const categoryFolder = sheet.folder;
    if (!all.length && (sheet.type === 'free' || sheet.type === 'master-only')) { finalPathById.set(sheet.id, sheet.file); continue; }
    const geo = all.length ? commonGeoPath(all) : [labels.unplaced];
    const destinationDir = `${categoryFolder}/${geo.join('/')}`;
    const to = `${destinationDir}/${path.posix.basename(sheet.file)}`;
    finalPathById.set(sheet.id, to);
    if (to !== sheet.file) moves.push({ from: sheet.file, to, sha256: HASH(Buffer.from(read(sheet.file))), expectedSource: overlay.has(sheet.file) });
  }

  // Make the `location` and event appearance links continue to resolve after moves.
  const moveMap = new Map(moves.map((move) => [move.from, move.to]));
  const rewrites = [];
  const allMarkdown = allCampaignMarkdown(root, structure, overlay);
  for (const file of allMarkdown) {
    const original = overlay.has(file) ? overlay.get(file) : fs.readFileSync(path.join(root, file), 'utf8');
    const outputFile = moveMap.get(file) ?? file;
    const rewritten = rewriteMarkdownLinks(original, file, outputFile, moveMap);
    if (rewritten !== original || outputFile !== file) rewrites.push({ file: outputFile, source: file, sha256: snapshotHash(root, file), expectedSha256: HASH(Buffer.from(original)), content: rewritten });
  }
  const oldManifest = readManifest(root, errors);
  const links = [];
  const oldOwned = oldManifest.links ?? [];
  if (plotFolder) {
    for (const file of [...new Set([...listSheets(root, plotFolder), ...[...overlay.keys()].filter((p) => p.startsWith(`${plotFolder}/`) && p.endsWith('.md'))])].sort(compareStrings)) {
      if (isLink(path.join(root, file))) continue;
      let data;
      try { data = metadata(read(file)); } catch { continue; }
      if (typeof data.id !== 'string') continue;
      const eventPath = file;
      const ids = new Set([...(stringList(data.location) ?? []), ...(data.appearances ?? []).flatMap((appearance) => stringList(appearance?.location) ?? [])]);
      for (const id of ids) if (placeById.has(id)) addGeographicLink(links, plotFolder, labels.byLocation, id, placeById, `${data.id}.md`, eventPath);
    }
  }
  // Precise-location views for subjects/objects whose canonical sheet lives at an ancestor.
  for (const sheet of sheets) {
    if (sheet.type === 'free' || sheet.type === 'master-only') continue;
    const exactLocations = [...(stringList(sheet.data.location) ?? []).map((id) => placeById.get(id)), ...(eventLocations.get(sheet.id) ?? [])].filter(Boolean);
    const seenCoordinates = new Set();
    for (const place of exactLocations) {
      const key = place.coordinate.join('/');
      if (seenCoordinates.has(key)) continue;
      seenCoordinates.add(key);
      const destination = `${sheet.folder}/${key}/${path.posix.basename(sheet.file)}`;
      const source = finalPathById.get(sheet.id) ?? sheet.file;
      if (destination === source) continue;
      links.push({ path: destination, target: path.posix.relative(path.posix.dirname(destination), source) });
    }
  }
  const normalizedLinks = dedupeLinks(links);
  const newLinkPaths = new Set(normalizedLinks.map((link) => link.path));
  const removals = oldOwned.filter((entry) => !newLinkPaths.has(entry.path) || normalizedLinks.find((link) => link.path === entry.path)?.target !== entry.target).map((entry) => ({ path: entry.path, target: entry.target }));
  const manifestText = `${JSON.stringify({ version: 1, links: normalizedLinks.map(({ path: linkPath, target }) => ({ path: linkPath, target })).sort((a, b) => compareStrings(a.path, b.path)) }, null, 2)}\n`;
  const manifestExists = fs.existsSync(path.join(root, MANIFEST));
  if (isLink(path.join(root, MANIFEST))) errors.push({ file: MANIFEST, message: 'manifest path is a symlink' });
  const manifestHash = manifestExists ? HASH(fs.readFileSync(path.join(root, MANIFEST))) : null;
  const snapshotMap = new Map([['campaign.yaml', { path: 'campaign.yaml', sha256: snapshotHash(root, 'campaign.yaml') }]]);
  for (const rel of allMarkdown) snapshotMap.set(rel, { path: rel, sha256: snapshotHash(root, rel), expectedSha256: overlay.has(rel) ? HASH(Buffer.from(overlay.get(rel))) : snapshotHash(root, rel) });
  for (const rel of [...new Set([...moves.map((m) => m.from), ...removals.map((r) => r.path), ...normalizedLinks.map((l) => l.path)])]) if (!snapshotMap.has(rel)) snapshotMap.set(rel, { path: rel, sha256: snapshotHash(root, rel) });
  const snapshots = [...snapshotMap.values()];
  const movingSources = new Set(moves.map((move) => move.from));
  const moveDestinations = new Set();
  for (const move of moves) {
    if (moveDestinations.has(move.to)) errors.push({ file: move.to, message: 'multiple sheets resolve to the same geographic path' });
    moveDestinations.add(move.to);
    if (fs.existsSync(path.join(root, move.to)) && !movingSources.has(move.to) && !removals.some((entry) => entry.path === move.to)) errors.push({ file: move.to, message: 'geographic destination already exists' });
  }
  const seenLinks = new Map();
  for (const link of normalizedLinks) {
    if (seenLinks.has(link.path) && seenLinks.get(link.path) !== link.target) errors.push({ file: link.path, message: 'multiple geographic views resolve to the same path' });
    seenLinks.set(link.path, link.target);
    const full = path.join(root, link.path);
    if (isLink(full)) {
      const wasOwned = oldOwned.find((item) => item.path === link.path);
      const actual = fs.readlinkSync(full);
      if (!wasOwned || actual !== wasOwned.target) errors.push({ file: link.path, message: 'geographic link path is occupied by an unowned or changed symlink' });
    } else if (fs.existsSync(full)) errors.push({ file: link.path, message: 'geographic view path collides with an existing file' });
  }
  snapshots.push({ path: MANIFEST, sha256: manifestHash });
  const linkChanges = normalizedLinks.some((link) => !isLink(path.join(root, link.path)) || fs.readlinkSync(path.join(root, link.path)) !== link.target);
  const manifestChanges = isLink(path.join(root, MANIFEST)) || (manifestExists && fs.readFileSync(path.join(root, MANIFEST), 'utf8') !== manifestText) || (!manifestExists && (moves.length > 0 || links.length > 0 || removals.length > 0 || rewrites.length > 0));
  const pathMap = Object.fromEntries(moves.map((move) => [move.from, move.to]));
  return {
    status: errors.length ? 'blocked' : 'ready', root: path.resolve(root), manifest: MANIFEST,
    migrationRequired: moves.length > 0 || linkChanges || removals.length > 0 || rewrites.length > 0 || manifestChanges,
    moves: moves.sort((a, b) => compareStrings(a.from, b.from)), links: normalizedLinks.sort((a, b) => compareStrings(a.path, b.path)),
    finalPaths: Object.fromEntries(finalPathById), pathMap,
    removals, rewrites, manifestRewrite: { path: MANIFEST, sha256: manifestHash, content: manifestText }, snapshots,
    errors,
  };
}

/** Apply a reviewed plan after validating every input and destination; rollback on any failure. */
export function applyGeographicLayout(root, plan, { files = [] } = {}) {
  const errors = validatePlan(root, plan, { allowExpected: true });
  if (errors.length) return { status: 'rejected', errors };
  const backups = new Map();
  const createdDirs = new Set();
  const track = (rel) => {
    const full = path.join(root, rel);
    if (fs.existsSync(full) || isLink(full)) backups.set(rel, { type: isLink(full) ? 'symlink' : 'file', data: isLink(full) ? fs.readlinkSync(full) : fs.readFileSync(full) });
    else backups.set(rel, null);
  };
  const mkdir = (dir) => {
    const missing = [];
    for (let current = dir; current !== root && !fs.existsSync(current); current = path.dirname(current)) missing.push(current);
    fs.mkdirSync(dir, { recursive: true }); missing.forEach((item) => createdDirs.add(item));
  };
  const touched = new Set([
    ...plan.moves.flatMap((m) => [m.from, m.to]), ...plan.rewrites.flatMap((r) => [r.file, r.source]),
    ...plan.links.map((l) => l.path), ...plan.removals.map((r) => r.path), plan.manifestRewrite.path,
  ]);
  for (const rel of touched) track(rel);
  try {
    for (const removal of plan.removals) fs.unlinkSync(path.join(root, removal.path));
    const staged = [];
    for (const move of plan.moves) {
      const from = path.join(root, move.from);
      const tempRel = `${path.posix.dirname(move.from)}/.geographic-layout-${crypto.randomUUID()}`;
      const temp = path.join(root, tempRel);
      fs.renameSync(from, temp); staged.push({ move, temp });
    }
    for (const item of staged) {
      const to = path.join(root, item.move.to);
      mkdir(path.dirname(to)); fs.renameSync(item.temp, to);
    }
    for (const rewrite of plan.rewrites) fs.writeFileSync(path.join(root, rewrite.file), rewrite.content);
    for (const link of plan.links) {
      const full = path.join(root, link.path); mkdir(path.dirname(full));
      if (!isLink(full)) fs.symlinkSync(link.target, full);
    }
    const manifest = path.join(root, plan.manifestRewrite.path); mkdir(path.dirname(manifest));
    fs.writeFileSync(manifest, plan.manifestRewrite.content);
    // Callers hold paths from before the moves; finalFiles maps them to where the files are now.
    const pathMap = plan.pathMap ?? {};
    const finalFiles = [...new Set(files.map((file) => (Object.hasOwn(pathMap, file) ? pathMap[file] : file)))];
    const changedFiles = [...new Set([...plan.rewrites.map((r) => r.file), ...plan.moves.map((m) => m.to)])].sort(compareStrings);
    return { status: 'applied', errors: [], moves: plan.moves.length, links: plan.links.length, removals: plan.removals.length, rewrites: plan.rewrites.length, finalPaths: plan.finalPaths ?? {}, finalFiles, changedFiles };
  } catch (error) {
    // A failed second phase may leave temporary names behind.
    for (const name of fs.readdirSync(root, { recursive: true }).filter((entry) => String(entry).includes('.geographic-layout-'))) {
      try { fs.rmSync(path.join(root, name), { recursive: true, force: true }); } catch {}
    }
    for (const [rel, backup] of [...backups].reverse()) {
      const full = path.join(root, rel);
      try { if (isLink(full) || fs.existsSync(full)) fs.rmSync(full, { recursive: true, force: true }); } catch {}
      if (backup) {
        fs.mkdirSync(path.dirname(full), { recursive: true });
        if (backup.type === 'symlink') fs.symlinkSync(backup.data, full); else fs.writeFileSync(full, backup.data);
      }
    }
    for (const dir of [...createdDirs].sort((a, b) => b.length - a.length)) { try { fs.rmdirSync(dir); } catch {} }
    return { status: 'failed', errors: [{ message: error.message }] };
  }
}

/** Validate a plan against its original on-disk state before applying a draft overlay. */
export function verifyGeographicLayoutPlan(root, plan) {
  const errors = validatePlan(root, plan, { allowExpected: false });
  return { status: errors.length ? 'rejected' : 'verified', errors };
}

function emptyPlan(errors) { return { status: 'blocked', migrationRequired: true, moves: [], links: [], removals: [], rewrites: [], snapshots: [], pathMap: {}, errors }; }
function normalizeRel(rel) { return String(rel).replaceAll('\\', '/').replace(/^\.\//, ''); }
function safeFolder(folder) {
  const source = normalizeRel(folder);
  const normalized = path.posix.normalize(source);
  if (normalized === '.' || source.startsWith('/') || source.split('/').includes('..') || normalized.startsWith('../')) throw new Error(`unsafe campaign folder: ${folder}`);
  return normalized;
}
function metadata(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return {};
  const { data, errors } = parseYamlLite(match[1]);
  if (errors.length) throw new Error(`frontmatter line ${errors[0].line}: ${errors[0].message}`);
  return data ?? {};
}
function stringList(value) { if (value === undefined || value === null) return []; if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) return null; return value; }
function resolveLocations(ids, places, file, errors) {
  const result = [];
  for (const id of ids) {
    const place = places.get(id);
    if (!place) errors.push({ file, message: `unknown place id ${id}` }); else result.push(place);
  }
  return result;
}
function commonGeoPath(places) {
  const coordinates = places.map((place) => place.coordinate);
  const shared = [];
  for (let i = 0; i < Math.min(...coordinates.map((parts) => parts.length)); i++) {
    if (coordinates.every((parts) => parts[i] === coordinates[0][i])) shared.push(coordinates[0][i]); else break;
  }
  return shared;
}
const GEOGRAPHIC_LABELS = {
  it: { unplaced: 'Da collocare', byLocation: 'Per luogo' },
  en: { unplaced: 'Unplaced', byLocation: 'By location' },
  es: { unplaced: 'Sin ubicar', byLocation: 'Por lugar' },
  fr: { unplaced: 'À placer', byLocation: 'Par lieu' },
  de: { unplaced: 'Ohne Ort', byLocation: 'Nach Ort' },
};
/** Folder names of the geographic layout in the campaign language; English for any other or unreadable config. */
function geographicLabels(root) {
  let language;
  try { language = parseYamlLite(fs.readFileSync(path.join(root, 'campaign.yaml'), 'utf8')).data?.language?.main; } catch { language = undefined; }
  return Object.hasOwn(GEOGRAPHIC_LABELS, language) ? GEOGRAPHIC_LABELS[language] : GEOGRAPHIC_LABELS.en;
}
function addGeographicLink(links, plotFolder, byLocation, placeId, places, linkName, eventPath) {
  const place = places.get(placeId);
  const destination = `${plotFolder}/${byLocation}/${place.coordinate.join('/')}/${linkName}`;
  links.push({ path: destination, target: path.posix.relative(path.posix.dirname(destination), eventPath) });
}
function dedupeLinks(links) {
  const seen = new Set();
  return links.filter((link) => {
    const key = `${link.path}\0${link.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function allCampaignMarkdown(root, structure, overlay = new Map()) {
  const result = new Set();
  for (const category of structure) {
    if (typeof category.folder !== 'string' || category.type === 'external') continue;
    const folder = safeFolder(category.folder);
    for (const file of listSheets(root, folder)) if (!isLink(path.join(root, file))) result.add(file);
    for (const file of overlay.keys()) if (file.startsWith(`${folder}/`) && file.endsWith('.md')) result.add(file);
  }
  return [...result].sort(compareStrings);
}
function rewriteMarkdownLinks(text, source, output, moveMap) {
  const rewriteTarget = (target) => {
    const match = /^([^#?]+)([?#].*)?$/.exec(target);
    if (!match || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) return target;
    let decoded; try { decoded = decodeURIComponent(match[1]); } catch { return target; }
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(source), decoded));
    const destination = moveMap.get(resolved) ?? resolved;
    if (output === source && destination === resolved) return target;
    const next = path.posix.relative(path.posix.dirname(output), destination) || path.posix.basename(destination);
    return `${encodeURI(next).replaceAll('%2F', '/')}${match[2] ?? ''}`;
  };
  let fenced = false;
  return text.split(/(?<=\n)/).map((line) => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return line; }
    if (fenced) return line;
    let out = line.replace(/(!?\[[^\]]*\]\()(<[^>]+>|[^\s)]+)(\s+(?:"[^"]*"|'[^']*'))?(\))/g,
      (whole, prefix, raw, title = '', close) => `${prefix}${raw.startsWith('<') ? `<${rewriteTarget(raw.slice(1, -1))}>` : rewriteTarget(raw)}${title}${close}`);
    out = out.replace(/^([ \t]*\[[^\]]+\]:[ \t]*)(<[^>]+>|\S+)(.*)$/,
      (whole, prefix, raw, suffix) => `${prefix}${raw.startsWith('<') ? `<${rewriteTarget(raw.slice(1, -1))}>` : rewriteTarget(raw)}${suffix}`);
    return out;
  }).join('');
}
function readManifest(root, errors) {
  const full = path.join(root, MANIFEST);
  if (!fs.existsSync(full)) return { links: [] };
  try {
    const value = JSON.parse(fs.readFileSync(full, 'utf8'));
    if (value.version !== 1 || !Array.isArray(value.links) || value.links.some((x) => !x || typeof x.path !== 'string' || typeof x.target !== 'string')) throw new Error('invalid geographic layout manifest');
    return value;
  } catch (error) { errors.push({ file: MANIFEST, message: error.message }); return { links: [] }; }
}
function snapshotHash(root, rel) { const full = path.join(root, rel); if (isLink(full)) return HASH(`symlink:${fs.readlinkSync(full)}`); if (fs.existsSync(full)) return HASH(fs.readFileSync(full)); return null; }
function isLink(full) { try { return fs.lstatSync(full).isSymbolicLink(); } catch { return false; } }
function validatePlan(root, plan, { allowExpected = true } = {}) {
  const errors = [];
  if (!plan || plan.status !== 'ready' || path.resolve(root) !== plan.root) return [{ message: 'plan is not ready or belongs to a different campaign root' }];
  const safePath = (rel) => {
    if (typeof rel !== 'string' || path.posix.isAbsolute(rel) || rel.split('/').some((part) => part === '..' || part === '')) throw new Error(`unsafe relative path: ${rel}`);
    const full = path.resolve(root, ...rel.split('/'));
    if (!full.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`path escapes campaign: ${rel}`);
    for (let parent = path.dirname(full); parent !== path.resolve(root); parent = path.dirname(parent)) {
      if (isLink(parent)) throw new Error(`symlink parent is forbidden: ${path.relative(root, parent)}`);
    }
    return full;
  };
  try {
    for (const snapshot of plan.snapshots ?? []) {
      safePath(snapshot.path);
      const actual = snapshotHash(root, snapshot.path);
      if (actual !== snapshot.sha256 && (!allowExpected || actual !== snapshot.expectedSha256)) errors.push({ file: snapshot.path, message: 'source changed since planning' });
    }
    const movingSources = new Set((plan.moves ?? []).map((move) => move.from)), seenSources = new Set(), destinations = new Set();
    for (const move of plan.moves ?? []) {
      safePath(move.from); safePath(move.to);
      if (seenSources.has(move.from) || destinations.has(move.to)) errors.push({ file: move.to, message: 'duplicate move source or destination' });
      seenSources.add(move.from); destinations.add(move.to);
      if (isLink(path.join(root, move.from))) errors.push({ file: move.from, message: 'refusing to move a symlink source' });
      if (fs.existsSync(path.join(root, move.to)) && !movingSources.has(move.to) && !(plan.removals ?? []).some((entry) => entry.path === move.to)) errors.push({ file: move.to, message: 'destination already exists' });
    }
    for (const rewrite of plan.rewrites ?? []) { safePath(rewrite.file); safePath(rewrite.source ?? rewrite.file); if (isLink(path.join(root, rewrite.source ?? rewrite.file))) errors.push({ file: rewrite.source ?? rewrite.file, message: 'refusing to rewrite through a symlink' }); }
    for (const link of plan.links ?? []) { safePath(link.path); if (path.posix.isAbsolute(link.target) || path.posix.normalize(path.posix.join(path.posix.dirname(link.path), link.target)).startsWith('../')) errors.push({ file: link.path, message: 'symlink target escapes campaign' }); }
    for (const removal of plan.removals ?? []) { safePath(removal.path); if (!isLink(path.join(root, removal.path)) || fs.readlinkSync(path.join(root, removal.path)) !== removal.target) errors.push({ file: removal.path, message: 'refusing to remove unowned or changed symlink' }); }
    safePath(plan.manifestRewrite.path);
    for (const entry of [...(plan.links ?? []), ...(plan.removals ?? [])]) {
      const full = path.join(root, entry.path);
      if (fs.existsSync(full) && !isLink(full) && !(plan.removals ?? []).some((r) => r.path === entry.path)) errors.push({ file: entry.path, message: 'link destination collides with existing file' });
    }
  } catch (error) { errors.push({ message: error.message }); }
  return errors;
}
