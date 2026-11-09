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
 * directories named `img`. A missing folder gives an empty list.
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
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        found.push(path.relative(campaignRoot, full).split(path.sep).join('/'));
      }
    }
  };
  walk(base);
  return found.sort(compareStrings);
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
    if (typeof category.folder !== 'string' || !SUBJECT_TYPES.has(category.type)) continue;

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

      subjects.push({
        id: data.id,
        category: category.id,
        type: category.type,
        sheet,
        forms,
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

/** Text of the first level-1 heading, or null when there is none (or it is empty). */
function firstTitle(lines) {
  for (const line of lines) {
    if (line.block === 'heading' && line.level === 1) {
      return line.headingText === '' ? null : line.headingText;
    }
  }
  return null;
}
