// Copies drafted Markdown files into a campaign. Every path is checked before
// anything is written: when one entry is refused, nothing is written at all.

import fs from 'node:fs';
import path from 'node:path';
import { readStructure } from '../../../../../scripts/lib/subjects.mjs';
import { plotMap } from '../../../../../skills/library/plot-map/scripts/lib/plot-map.mjs';
import { writeSessionMaps } from '../../../../../skills/library/plot-map/scripts/lib/session-map.mjs';

const PROTECTED_NAMES = ['campaign.yaml', 'CLAUDE.md', 'AGENTS.md'];
const PROTECTED_FOLDERS = ['.campaign', '.git'];

/**
 * @param {string} root campaign folder
 * @param {{ draftDir: string, files: string[] }} options draftDir may be relative to root
 * @returns {{ written: string[], errors: Array<{code: string, path: string|null, message: string}> }}
 */
export function applyDraft(root, { draftDir, files } = {}) {
  const dir = path.resolve(root);
  const errors = [];
  const problem = (code, at, message) => errors.push({ code, path: at, message });

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    problem('bad-root', null, 'the campaign folder does not exist');
    return { written: [], errors };
  }
  if (typeof draftDir !== 'string' || draftDir.trim() === '') {
    problem('bad-input', 'draftDir', 'draftDir must be the folder that holds the drafts');
    return { written: [], errors };
  }
  if (!Array.isArray(files) || files.length === 0) {
    problem('bad-input', 'files', 'files must be a non-empty list of campaign-relative paths');
    return { written: [], errors };
  }

  const draftRoot = path.resolve(dir, draftDir);
  const plan = [];
  const seen = new Set();

  for (const rel of files) {
    if (typeof rel !== 'string' || rel === '') {
      problem('bad-path', String(rel), 'each file must be a path of text');
      continue;
    }
    if (seen.has(rel)) continue;
    seen.add(rel);

    const refusal = checkTargetPath(rel);
    if (refusal !== null) {
      problem(refusal.code, rel, refusal.message);
      continue;
    }

    const draft = path.join(draftRoot, rel);
    const target = path.join(dir, rel);

    let draftStat;
    try {
      draftStat = fs.statSync(draft);
    } catch {
      problem('missing-draft', rel, `there is no draft for ${rel}`);
      continue;
    }
    if (!draftStat.isFile()) {
      problem('missing-draft', rel, `there is no draft for ${rel}`);
      continue;
    }
    if (draftStat.size === 0) {
      problem('empty-draft', rel, `the draft of ${rel} is empty`);
      continue;
    }
    if (isDirectory(target)) {
      problem('bad-target', rel, `${rel} is a folder in the campaign`);
      continue;
    }
    plan.push({ rel, draft, target });
  }

  if (errors.length > 0) {
    return { written: [], errors };
  }

  const written = [];
  for (const item of plan) {
    try {
      fs.mkdirSync(path.dirname(item.target), { recursive: true });
      fs.copyFileSync(item.draft, item.target);
    } catch (err) {
      problem('write-failed', item.rel, `${item.rel} cannot be written (${err.code ?? 'error'})`);
      return { written, errors };
    }
    written.push(item.rel);
  }

  // Derived files: the main file of each plot session is rebuilt from its events.
  for (const rel of regenerateSessionMaps(dir, written)) {
    if (!written.includes(rel)) written.push(rel);
  }
  return { written, errors };
}

/**
 * Rebuilds the main files of the plot sessions when one of the written files lies
 * inside a plot category. Does nothing when no written file is in a plot category,
 * or when the plot map cannot be read (campaign-config error).
 * @returns {string[]} campaign-relative paths of the main files written
 */
function regenerateSessionMaps(root, written) {
  const { structure } = readStructure(root);
  if (structure === null) return [];
  const plotFolders = structure
    .filter((c) => c.type === 'plot' && typeof c.folder === 'string')
    .map((c) => path.posix.normalize(c.folder));
  const inPlot = written.some((rel) => plotFolders.some((folder) => rel.startsWith(`${folder}/`)));
  if (!inPlot) return [];

  const map = plotMap(root);
  if (map.errors.some((e) => e.code === 'campaign-config')) return [];
  return writeSessionMaps(root, map.sessions).written;
}

/** Returns null when the path may be written, or the reason it may not. */
function checkTargetPath(rel) {
  if (rel.includes('\\') || path.isAbsolute(rel) || rel.startsWith('/')) {
    return { code: 'bad-path', message: `${rel} must be a path inside the campaign folder` };
  }
  const parts = rel.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    return { code: 'bad-path', message: `${rel} must be a plain relative path without . or ..` };
  }
  if (parts.some((part) => PROTECTED_FOLDERS.includes(part))) {
    return { code: 'protected-path', message: `${rel} is inside a folder the framework owns` };
  }
  if (PROTECTED_NAMES.includes(parts[parts.length - 1])) {
    return { code: 'protected-file', message: `${rel} is a generated or configuration file` };
  }
  if (!rel.endsWith('.md')) {
    return { code: 'bad-extension', message: `${rel} must be a Markdown file ending in .md` };
  }
  return null;
}

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}
