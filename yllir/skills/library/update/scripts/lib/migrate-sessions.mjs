// Converts the sessions of the old layout to the current one. Old layout: one
// file per session, `<Category>/<Arc>/<Name>.md`, whose `# ` headings are the
// events. Current layout: a folder per session, `<Category>/<Name>/`, holding
// the main file `<Name>.md` (generated) and one file per event in `Eventi/`.
// Runs as a post-update process, after the generated instructions are written.
// Deterministic, and idempotent: a second run finds nothing to migrate. The
// old files stay in the git history, so the conversion is reversible.

import fs from 'node:fs';
import path from 'node:path';
import { METADATA_CLOSE, METADATA_OPEN, parseFrontmatter } from '../../../../../scripts/lib/frontmatter.mjs';
import { compareStrings, listCanonicalSheets, readStructure } from '../../../../../scripts/lib/subjects.mjs';

const EVENT_FOLDERS = new Set(['Eventi', 'Events']);
const NEW_EVENT_FOLDER = 'Eventi';
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const LINK = /\[([^\]\n]*)\]\(([^)\n]+)\)/g;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;

/**
 * @param {string} root absolute path to the campaign folder
 * @param {{ dryRun?: boolean }} [options] a dry run computes the same result and writes nothing
 * @returns {{ migrated: string[], errors: Array<{code: string, message: string, file?: string}> }}
 *   migrated: campaign-relative paths of the old session files converted, sorted.
 */
export function migrateSessions(root, { dryRun = false } = {}) {
  const migrated = [];
  const errors = [];
  const { structure, errors: configErrors } = readStructure(root);
  if (structure === null) {
    for (const e of configErrors) {
      errors.push({ code: 'campaign-config', file: e.file, message: e.message });
    }
    return { migrated, errors };
  }

  // 1. Plan every conversion. Nothing is written yet.
  const plans = [];
  const claimed = new Set(); // lower-cased new folders planned in this run
  for (const item of findLegacyFiles(root, structure)) {
    const plan = planSession(root, item, claimed, errors);
    if (plan !== null) plans.push(plan);
  }
  if (plans.length === 0) return { migrated, errors };

  // 2. Links: old session files now point to their new main file or event file.
  const sessionTargets = new Map(); // old file -> { main, slugs: Map<slug, event file> }
  for (const plan of plans) {
    const slugs = new Map();
    for (const event of plan.events) {
      const slug = slugOf(event.title);
      if (slug !== '' && !slugs.has(slug)) slugs.set(slug, event.file);
    }
    sessionTargets.set(plan.old, { main: plan.newMain, slugs });
  }
  const lookup = (resolved, anchor) => {
    const entry = sessionTargets.get(resolved);
    if (entry === undefined) return null;
    if (anchor) {
      const event = entry.slugs.get(normalizeAnchor(anchor));
      if (event !== undefined) return event;
    }
    return entry.main;
  };

  // Links inside the moved text are resolved from the old place and written from the new one.
  for (const plan of plans) {
    const oldDir = path.posix.dirname(plan.old);
    const newDir = `${plan.newFolder}/${NEW_EVENT_FOLDER}`;
    for (const event of plan.events) {
      event.content = rewriteLinks(event.content, oldDir, newDir, 'moved', lookup);
    }
  }

  // Links in the other Markdown files that point to a migrated session.
  const migratedOld = new Set(plans.map((plan) => plan.old));
  const others = [];
  for (const file of listMarkdown(root)) {
    if (migratedOld.has(file)) continue;
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const dir = path.posix.dirname(file);
    const next = rewriteLinks(text, dir, dir, 'other', lookup);
    if (next !== text) others.push({ file, text: next });
  }

  // 3. Write, then delete the old files. Nothing is written in a dry run.
  for (const plan of plans) {
    if (dryRun) {
      migrated.push(plan.old);
      continue;
    }
    try {
      fs.mkdirSync(path.join(root, plan.newFolder, NEW_EVENT_FOLDER), { recursive: true });
      for (const event of plan.events) {
        fs.writeFileSync(path.join(root, event.file), eventText(plan, event));
      }
      fs.writeFileSync(path.join(root, plan.newMain), mainText(plan));
      fs.rmSync(path.join(root, plan.old));
      removeEmptyFolders(root, path.posix.dirname(plan.old), plan.folder);
      migrated.push(plan.old);
    } catch (err) {
      errors.push({ code: 'migrate-failed', file: plan.old, message: err.message });
    }
  }
  if (!dryRun) {
    for (const other of others) {
      fs.writeFileSync(path.join(root, other.file), other.text);
    }
  }

  return { migrated: migrated.sort(compareStrings), errors };
}

// ---------------------------------------------------------------- planning

/**
 * Legacy plot files: in a plot category, neither `<X>/<X>.md` nor `<X>/Eventi|Events/<N>.md`.
 * Symlinks (geographic views, import links) are never legacy files: they point to
 * files that are classified on their own, and converting them would create fake sessions.
 */
function findLegacyFiles(root, structure) {
  const seen = new Set();
  const found = [];
  for (const category of structure) {
    if (category.type !== 'plot' || typeof category.folder !== 'string') continue;
    const folder = path.posix.normalize(category.folder);
    for (const file of listCanonicalSheets(root, category.folder)) {
      if (seen.has(file)) continue;
      seen.add(file);
      if (isSymlink(root, file)) continue;
      const rel = path.posix.relative(folder, file);
      if (classifyPlotFile(rel) === 'legacy') {
        found.push({ file, folder, rel });
      }
    }
  }
  return found.sort((a, b) => compareStrings(a.file, b.file));
}

/** True when the campaign path is a symlink. A path that cannot be read counts as a symlink, so it is skipped. */
function isSymlink(root, file) {
  try {
    return fs.lstatSync(path.join(root, file)).isSymbolicLink();
  } catch {
    return true;
  }
}

/** Same rule as plot-map.mjs: session main file, event file, or legacy. */
function classifyPlotFile(rel) {
  const parts = rel.split('/');
  if (parts.length === 2 && parts[1] === `${parts[0]}.md`) return 'session';
  if (parts.length === 3 && EVENT_FOLDERS.has(parts[1])) return 'event';
  return 'legacy';
}

/** Plans the conversion of one legacy file, or records why it is not converted. */
function planSession(root, item, claimed, errors) {
  const skip = (message) => {
    errors.push({ code: 'migrate-skipped', file: item.file, message });
    return null;
  };

  const text = fs.readFileSync(path.join(root, item.file), 'utf8');
  const parsed = parseFrontmatter(text);
  if (parsed.errors.length > 0) {
    return skip(`invalid frontmatter: line ${parsed.errors[0].line}: ${parsed.errors[0].message}`);
  }
  const data = parsed.data;
  if (!data || typeof data.id !== 'string' || data.id === '') {
    return skip('the file has no id');
  }
  const dependsOn = listField(data, 'depends_on');
  const location = listField(data, 'location');
  if (dependsOn === null || location === null) {
    return skip('depends_on and location must be lists');
  }

  const name = path.posix.basename(item.file, '.md');
  if (name === '') return skip('the file has no name');
  const arc = path.posix.relative(item.folder, path.posix.dirname(item.file));
  const newFolder = path.posix.join(item.folder, name);
  const newMain = `${newFolder}/${name}.md`;

  if (claimed.has(newFolder.toLowerCase()) || fs.existsSync(path.join(root, newFolder)) || fs.existsSync(path.join(root, newMain))) {
    errors.push({ code: 'migrate-conflict', file: item.file, message: `${newFolder}/ already exists` });
    return null;
  }
  claimed.add(newFolder.toLowerCase());

  const split = splitEvents(parsed.body, name);
  const fileNames = eventFileNames(split.map((event) => event.title));
  const events = split.map((event, index) => ({
    title: event.title,
    content: event.content,
    id: `${data.id}-e${pad2(index + 1)}`,
    file: `${newFolder}/${NEW_EVENT_FOLDER}/${fileNames[index]}.md`,
  }));

  return {
    old: item.file,
    folder: item.folder,
    arc,
    id: data.id,
    dependsOn,
    location,
    newFolder,
    newMain,
    events,
  };
}

/** A list field: [] when missing, the items when a list, null when it is not a list. */
function listField(data, key) {
  if (data[key] === undefined) return [];
  return Array.isArray(data[key]) ? data[key].slice() : null;
}

/**
 * Splits a body into events at the `# ` headings outside code fences. Text before
 * the first heading joins the first event; with no heading at all, the whole body
 * is one event titled with the session name.
 * @returns {Array<{title: string, content: string}>}
 */
function splitEvents(body, sessionName) {
  const lines = body.split('\n');
  const code = codeLines(lines);
  const preamble = [];
  const events = [];
  let current = null;
  lines.forEach((raw, i) => {
    const line = stripCr(raw);
    if (!code[i] && line.startsWith('# ')) {
      current = { title: line.slice(2).trim(), lines: [] };
      events.push(current);
      return;
    }
    (current === null ? preamble : current.lines).push(raw);
  });

  if (events.length === 0) {
    return [{ title: sessionName, content: trimLeadingBlank(preamble).join('\n') }];
  }
  if (preamble.join('').trim() !== '') {
    events[0].lines = [...trimTrailingBlank(preamble), ...events[0].lines];
  }
  return events.map((event) => ({
    title: event.title,
    content: trimLeadingBlank(event.lines).join('\n'),
  }));
}

/** For each line, true when it is part of a code fence (the fence lines included). */
function codeLines(lines) {
  const flags = [];
  let fence = null; // { char, length } while inside a fence
  for (const raw of lines) {
    const line = stripCr(raw);
    if (fence !== null) {
      const close = FENCE_CLOSE.exec(line);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
      flags.push(true);
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      fence = { char: open[1][0], length: open[1].length };
      flags.push(true);
      continue;
    }
    flags.push(false);
  }
  return flags;
}

/** File names of the events of one session: illegal characters removed, duplicates numbered. */
function eventFileNames(titles) {
  const used = new Set();
  return titles.map((title, index) => {
    const base = title.replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, ' ').trim() || `Evento ${pad2(index + 1)}`;
    let name = base;
    let n = 2;
    while (used.has(name.toLowerCase())) {
      name = `${base} ${n}`;
      n++;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

// ---------------------------------------------------------------- text

function eventText(plan, event) {
  const header = [METADATA_OPEN, `id: ${event.id}`, `session: ${plan.id}`, 'depends_on: []', 'location: []', METADATA_CLOSE];
  return `${header.join('\n')}\n\n${event.content}`;
}

function mainText(plan) {
  const lines = [METADATA_OPEN, `id: ${plan.id}`, `depends_on: ${flowList(plan.dependsOn)}`, `location: ${flowList(plan.location)}`];
  if (plan.arc !== '') lines.push(`arc: "${plan.arc}"`);
  lines.push('generated: true', METADATA_CLOSE, '', 'Generated file. Do not edit by hand.', '');
  return lines.join('\n');
}

function flowList(items) {
  return `[${items.join(', ')}]`;
}

/**
 * Rewrites the relative Markdown links of a text, outside code fences.
 * @param {string} text
 * @param {string} fromDir campaign-relative folder the text is read from
 * @param {string} toDir campaign-relative folder the text is written to
 * @param {'moved' | 'other'} mode 'moved': every relative link is re-based from fromDir to toDir;
 *   'other': only links to migrated sessions change
 * @param {(resolved: string, anchor: string|null) => string|null} lookup new target of a migrated session
 */
function rewriteLinks(text, fromDir, toDir, mode, lookup) {
  const lines = text.split('\n');
  const code = codeLines(lines);
  return lines
    .map((line, i) => {
      if (code[i]) return line;
      return line.replace(LINK, (whole, label, target) => {
        const next = rewriteTarget(target, fromDir, toDir, mode, lookup);
        return next === null ? whole : `[${label}](${next})`;
      });
    })
    .join('\n');
}

/** New text of a link target, or null to leave the link as it is. */
function rewriteTarget(target, fromDir, toDir, mode, lookup) {
  // A title after the target, as in [x](path "title"), is kept as it is.
  const titled = /^(.*?)(\s+(?:"[^"]*"|'[^']*'))$/.exec(target);
  const url = titled ? titled[1] : target;
  const suffix = titled ? titled[2] : '';

  if (url.startsWith('#') || url.startsWith('/') || SCHEME.test(url)) return null;
  const hash = url.indexOf('#');
  const rawPath = hash === -1 ? url : url.slice(0, hash);
  const anchor = hash === -1 ? null : url.slice(hash + 1);
  if (rawPath === '') return null;

  const resolved = path.posix.normalize(path.posix.join(fromDir, safeDecode(rawPath)));
  if (resolved === '..' || resolved.startsWith('../') || path.posix.isAbsolute(resolved)) return null;

  const hit = lookup(resolved, anchor);
  if (hit !== null) {
    return encodeSpaces(path.posix.relative(toDir, hit)) + suffix;
  }
  if (mode === 'other') return null;
  const relative = path.posix.relative(toDir, resolved);
  return encodeSpaces(relative) + (anchor === null ? '' : `#${anchor}`) + suffix;
}

function encodeSpaces(target) {
  return target.replace(/ /g, '%20');
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Heading slug used for anchors: lower case, spaces become dashes. */
function slugOf(title) {
  return title.toLowerCase().replace(/ /g, '-');
}

function normalizeAnchor(anchor) {
  return slugOf(safeDecode(anchor));
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function stripCr(raw) {
  return raw.endsWith('\r') ? raw.slice(0, -1) : raw;
}

function trimLeadingBlank(lines) {
  let start = 0;
  while (start < lines.length && lines[start].trim() === '') start++;
  return lines.slice(start);
}

function trimTrailingBlank(lines) {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') end--;
  return lines.slice(0, end);
}

// ---------------------------------------------------------------- files

/** Campaign-relative paths of every Markdown file, except those in .campaign/ and .git/. */
function listMarkdown(root) {
  const found = [];
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (rel === '' && (entry.name === '.campaign' || entry.name === '.git')) continue;
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), childRel);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        found.push(childRel);
      }
    }
  };
  walk(root, '');
  return found.sort(compareStrings);
}

/** Deletes the folder and its ancestors while they are empty, never the category folder itself. */
function removeEmptyFolders(root, folder, categoryFolder) {
  const category = categoryFolder.replace(/\/+$/, '');
  let dir = folder;
  while (dir.startsWith(`${category}/`)) {
    const full = path.join(root, dir);
    if (fs.readdirSync(full).length > 0) break;
    fs.rmdirSync(full);
    dir = path.posix.dirname(dir);
  }
}
