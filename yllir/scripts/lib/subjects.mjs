// Builds the subject index of a campaign: one entry per subject sheet, with
// its forms (title and aliases), duplicate ids, and homonyms (forms shared by
// two or more subjects).

import fs from 'node:fs';
import path from 'node:path';
import { parseYamlLite } from './yaml-lite.mjs';
import { parseFrontmatter } from './frontmatter.mjs';
import { analyzeMarkdown } from './zones.mjs';
import { foldForm } from './fold.mjs';

const SUBJECT_TYPES = new Set(['places', 'subjects', 'objects', 'free', 'master-only']);

/**
 * Reads the structure list of campaign.yaml.
 * @param {string} campaignRoot absolute path
 * @returns {{ structure: object[]|null, errors: Array<{file: string, message: string}> }}
 */
export function readStructure(campaignRoot) {
  let text;
  try {
    text = fs.readFileSync(path.join(campaignRoot, 'campaign.yaml'), 'utf8');
  } catch {
    return { structure: null, errors: [{ file: 'campaign.yaml', message: 'campaign.yaml not found' }] };
  }
  const { data, errors } = parseYamlLite(text);
  if (errors.length > 0) {
    const [first] = errors;
    return {
      structure: null,
      errors: [{ file: 'campaign.yaml', message: `line ${first.line}: ${first.message}` }],
    };
  }
  if (!data || !Array.isArray(data.structure)) {
    return {
      structure: null,
      errors: [{ file: 'campaign.yaml', message: 'structure must be a list' }],
    };
  }
  const structure = data.structure.filter(
    (entry) => entry !== null && typeof entry === 'object' && !Array.isArray(entry),
  );
  return { structure, errors: [] };
}

/**
 * Decides whether a campaign-relative path lies in a master-only category. The
 * category of a path is the one with the longest folder that is a prefix of it.
 * Shared by check-links and link planning, so the two never disagree.
 * @param {object[]} structure the structure list of campaign.yaml
 * @returns {(rel: string) => boolean}
 */
export function masterOnlyChecker(structure) {
  const categories = structure
    .filter((entry) => typeof entry.folder === 'string')
    .map((entry) => {
      const folder = path.posix.normalize(entry.folder).replace(/\/+$/, '');
      const prefix = folder === '.' || folder === '' ? '' : `${folder}/`;
      return { type: entry.type, prefix };
    });

  return (rel) => {
    let best = null;
    for (const category of categories) {
      if (rel.startsWith(category.prefix) && (best === null || category.prefix.length > best.prefix.length)) {
        best = category;
      }
    }
    return best !== null && best.type === 'master-only';
  };
}

/**
 * Lists the Markdown files under `<campaignRoot>/<folder>`, recursively, skipping
 * directories named `img`. A symlink counts as a file when it points to a regular
 * file (document-ingest links original documents this way); its path stays the
 * path of the symlink. Symlinks to directories, broken symlinks and loops are
 * ignored. A missing folder gives an empty list.
 * @returns {string[]} relative paths with `/` separators, sorted
 */
export function listSheets(campaignRoot, folder) {
  const base = path.join(campaignRoot, folder);
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return;
      throw err;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'img') walk(full);
      } else if (entry.name.endsWith('.md') && isRegularFile(full, entry)) {
        found.push(path.relative(campaignRoot, full).split(path.sep).join('/'));
      }
    }
  };
  walk(base);
  return found.sort(compareStrings);
}

/**
 * True for a regular file, or for a symlink whose target is a regular file.
 * Directory symlinks are never followed; any error (broken link, loop) is false.
 */
function isRegularFile(full, entry) {
  if (entry.isFile()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    return fs.statSync(full).isFile();
  } catch {
    return false;
  }
}

/**
 * Lists the Markdown files of an `external` category: a folder that may hold
 * symlinks to directories or files of another campaign. Those files are
 * read-only originals; they are indexed as link destinations only.
 * Paths go through the symlinks (never the real path), so a link written
 * from a campaign document reaches them. Symlinks are followed. Each directory
 * is entered once and each file is kept once (by realpath), so loops and shared
 * files give no duplicates. Broken links, loops and unreadable entries are
 * skipped silently. Directories named `img` are skipped. A missing folder gives [].
 * @param {string} campaignRoot absolute path
 * @param {string} folder campaign-relative folder of the category
 * @param {string[]} [exclude] paths relative to the folder: a file, or a subfolder (all of it)
 * @returns {string[]} campaign-relative paths with `/` separators, sorted
 */
export function listExternalSheets(campaignRoot, folder, exclude = []) {
  const base = path.join(campaignRoot, folder);
  const excluded = exclude
    .filter((item) => typeof item === 'string')
    .map(normalizeRelative);
  const isExcluded = (rel) => excluded.some((item) => rel === item || rel.startsWith(`${item}/`));
  const visitedDirs = new Set(); // realpaths of the directories already entered
  const seenFiles = new Set(); // realpaths of the files already kept
  const found = [];

  const realpathOrNull = (p) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return null;
    }
  };

  const walk = (dir, relDir) => {
    const dirReal = realpathOrNull(dir);
    if (dirReal === null || visitedDirs.has(dirReal)) return;
    visitedDirs.add(dirReal);

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => compareStrings(a.name, b.name));

    for (const entry of entries) {
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
      if (isExcluded(rel)) continue;
      const full = path.join(dir, entry.name);

      let stat;
      try {
        stat = fs.statSync(full); // follows symlinks; throws on broken links and loops
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (entry.name !== 'img') walk(full, rel);
      } else if (stat.isFile() && entry.name.endsWith('.md')) {
        const real = realpathOrNull(full);
        if (real === null || seenFiles.has(real)) continue;
        seenFiles.add(real);
        found.push(path.relative(campaignRoot, full).split(path.sep).join('/'));
      }
    }
  };

  walk(base, '');
  return found.sort(compareStrings);
}

/** Folder without `./`, doubled separators or a trailing slash, with `/` separators. */
function normalizeRelative(item) {
  return path.posix.normalize(item.split(path.sep).join('/')).replace(/\/+$/, '');
}

/** Campaign-relative folder as a prefix ('' for the campaign root). */
function folderPrefix(folder) {
  const normalized = path.posix.normalize(folder).replace(/\/+$/, '');
  return normalized === '.' ? '' : normalized;
}

/** Code-unit comparison, so the result does not depend on the locale. */
export function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * @param {string} campaignRoot absolute path to the campaign folder
 * @returns {{ subjects: object[], homonyms: object[], errors: object[] }}
 */
export function buildSubjectIndex(campaignRoot) {
  const { structure, errors } = readStructure(campaignRoot);
  if (structure === null) {
    return { subjects: [], homonyms: [], errors };
  }

  const subjects = [];
  const bySubjectId = new Map(); // id -> sheet of the first subject with that id
  const indexErrors = [];

  for (const category of structure) {
    if (typeof category.folder !== 'string') continue;
    if (category.type === 'external') {
      indexExternal(campaignRoot, category, { subjects, bySubjectId, indexErrors });
      continue;
    }
    if (!SUBJECT_TYPES.has(category.type)) continue;

    for (const sheet of listSheets(campaignRoot, category.folder)) {
      const text = fs.readFileSync(path.join(campaignRoot, sheet), 'utf8');
      const { data, body, bodyStartLine } = parseFrontmatter(text);

      if (!data || typeof data.id !== 'string' || data.id === '') {
        indexErrors.push({ file: sheet, message: 'missing id' });
        continue;
      }

      const title = firstTitle(analyzeMarkdown(body, bodyStartLine).lines);
      if (title === null) {
        indexErrors.push({ file: sheet, message: 'missing title' });
        continue;
      }

      let aliases = [];
      if (data.aliases !== undefined) {
        if (Array.isArray(data.aliases)) {
          aliases = data.aliases.map(String);
        } else {
          indexErrors.push({ file: sheet, message: 'aliases must be a list' });
        }
      }

      if (bySubjectId.has(data.id)) {
        indexErrors.push({
          file: sheet,
          message: `duplicate id ${data.id} (also in ${bySubjectId.get(data.id)})`,
        });
        continue;
      }
      bySubjectId.set(data.id, sheet);

      subjects.push({
        id: data.id,
        category: category.id,
        type: category.type,
        sheet,
        forms: buildForms(title, aliases),
      });
    }
  }

  subjects.sort((a, b) => compareStrings(a.id, b.id));

  const byFolded = new Map(); // folded -> Set of subject ids
  for (const subject of subjects) {
    for (const form of subject.forms) {
      if (!byFolded.has(form.folded)) byFolded.set(form.folded, new Set());
      byFolded.get(form.folded).add(subject.id);
    }
  }
  const homonyms = [];
  for (const [folded, ids] of byFolded) {
    if (ids.size >= 2) {
      homonyms.push({ folded, subjects: [...ids].sort(compareStrings) });
    }
  }
  homonyms.sort((a, b) => compareStrings(a.folded, b.folded));

  indexErrors.sort(
    (a, b) => compareStrings(a.file, b.file) || compareStrings(a.message, b.message),
  );

  return { subjects, homonyms, errors: indexErrors };
}

/**
 * Adds the subjects of an `external` category. Their documents are never ours:
 * their content never causes an error (only a duplicate id does). The id comes
 * from the frontmatter `id` when it is a non-empty string, else from the path
 * inside the category; the title falls back to the file name.
 */
function indexExternal(campaignRoot, category, { subjects, bySubjectId, indexErrors }) {
  const prefix = folderPrefix(category.folder);
  const exclude = Array.isArray(category.exclude) ? category.exclude : [];

  for (const sheet of listExternalSheets(campaignRoot, category.folder, exclude)) {
    let text;
    try {
      text = fs.readFileSync(path.join(campaignRoot, sheet), 'utf8');
    } catch {
      continue; // unreadable original: skipped silently
    }
    const { data, body, bodyStartLine } = parseFrontmatter(text);

    const relInFolder = prefix === '' ? sheet : sheet.slice(prefix.length + 1);
    const ownId = typeof data?.id === 'string' && data.id !== '' ? data.id : relInFolder.slice(0, -'.md'.length);
    const id = `${category.id}:${ownId}`;

    if (bySubjectId.has(id)) {
      indexErrors.push({
        file: sheet,
        message: `duplicate id ${id} (also in ${bySubjectId.get(id)})`,
      });
      continue;
    }
    bySubjectId.set(id, sheet);

    const title =
      firstTitle(analyzeMarkdown(body, bodyStartLine).lines) ??
      path.posix.basename(sheet, '.md');
    const aliases = Array.isArray(data?.aliases) ? data.aliases.map(String) : [];

    subjects.push({
      id,
      category: category.id,
      type: 'external',
      sheet,
      forms: buildForms(title, aliases),
      external: true,
    });
  }
}

/** Forms of a subject: the title, then the aliases, without duplicates (by folded text). */
function buildForms(title, aliases) {
  const forms = [];
  const seen = new Set();
  const addForm = (text, kind) => {
    const folded = foldForm(text);
    if (folded === '' || seen.has(folded)) return;
    seen.add(folded);
    forms.push({ text, folded, kind, status: 'fact' });
  };
  addForm(title, 'title');
  for (const alias of aliases) addForm(alias, 'alias');
  return forms;
}

/** Text of the first level-1 heading, or null when there is none (or it is empty). */
function firstTitle(lines) {
  for (const line of lines) {
    if (line.block === 'heading' && line.level === 1) {
      return line.headingText === '' ? null : line.headingText;
    }
  }
  return null;
}
