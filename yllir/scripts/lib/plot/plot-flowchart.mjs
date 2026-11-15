// Plot flowchart: the one master file that the plot-mapper agent keeps, with a
// Mermaid flowchart of the plot. It lives at the root of the first plot category
// and is not a sheet, a session or a scene. Each node that stands for a sheet is
// tied to it by a `%% path: <nodeId> = <path>` comment inside the Mermaid block.
// Deterministic: code-unit sorting only, and readPlotFlowchart never throws.

import fs from 'node:fs';
import path from 'node:path';
import { parseYamlLite } from '../yaml-lite.mjs';
import { readStructure, compareStrings } from '../subjects.mjs';
import { plotMap } from './plot-map.mjs';

const NAME_EN = 'Plot map.md';
const NAME_IT = 'Mappa della trama.md';
const OPEN_FENCE = /^```mermaid\s*$/;
const CLOSE_FENCE = /^```\s*$/;
const PATH_LINE = /^\s*%%\s*path:\s*(\S+)\s*=\s*(.+?)\s*$/;

/**
 * Where the plot flowchart lives: the first plot category's folder, and the file
 * name for the campaign language. `existing` is the file that is there now, in
 * either language.
 * @param {string} root absolute path to the campaign folder
 * @returns {{ folder: string|null, existing: string|null, fileName: string }}
 */
export function plotFlowchartFile(root) {
  const fileName = campaignLanguage(root) === 'it' ? NAME_IT : NAME_EN;
  const folder = plotFolder(root);
  if (folder === null) return { folder: null, existing: null, fileName };
  const found = [fileName, fileName === NAME_IT ? NAME_EN : NAME_IT].find((name) =>
    isFile(path.join(root, folder, name)),
  );
  return { folder, existing: found === undefined ? null : path.posix.join(folder, found), fileName };
}

/**
 * Reads the Mermaid block and the `%% path` lines of the plot flowchart.
 * @param {string} root absolute path to the campaign folder
 * @returns {{ file: string|null, mermaid: string, paths: Array<{id: string, path: string}>, errors: Array<{code: string, file: string, message: string}> }}
 */
export function readPlotFlowchart(root) {
  const empty = { file: null, mermaid: '', paths: [], errors: [] };
  try {
    const { existing } = plotFlowchartFile(root);
    if (existing === null) return empty;

    let text;
    try {
      text = fs.readFileSync(path.join(root, existing), 'utf8');
    } catch (err) {
      return {
        ...empty,
        file: existing,
        errors: [{ code: 'plot-flowchart-unreadable', file: existing, message: err.message }],
      };
    }

    const block = mermaidBlock(text);
    if (block === null) {
      return {
        ...empty,
        file: existing,
        errors: [{ code: 'plot-flowchart-no-mermaid', file: existing, message: 'no mermaid flowchart block' }],
      };
    }

    const paths = [];
    for (const line of block.split('\n')) {
      const match = PATH_LINE.exec(line);
      if (match) paths.push({ id: match[1], path: match[2] });
    }
    return { file: existing, mermaid: block, paths, errors: [] };
  } catch (err) {
    return {
      ...empty,
      errors: [{ code: 'plot-flowchart-unreadable', file: '', message: String(err?.message ?? err) }],
    };
  }
}

/**
 * Checks the plot flowchart against the plot graph of the campaign.
 * Codes: plot-flowchart-missing, plot-flowchart-no-mermaid, plot-flowchart-unreadable,
 * plot-flowchart-bad-path, plot-flowchart-unmapped.
 * @param {string} root absolute path to the campaign folder
 * @returns {Array<{code: string, file: string, message: string}>} sorted by code, file, message
 */
export function checkPlotFlowchart(root) {
  const read = readPlotFlowchart(root);
  const errors = [...read.errors];

  let nodes = [];
  try {
    nodes = plotNodes(root);
  } catch {
    nodes = [];
  }

  if (read.file === null) {
    const { folder, fileName } = plotFlowchartFile(root);
    if (nodes.length > 0 && folder !== null) {
      errors.push({
        code: 'plot-flowchart-missing',
        file: path.posix.join(folder, fileName),
        message: 'the plot flowchart does not exist yet; the plot-mapper must create it',
      });
    }
    return sortErrors(errors);
  }

  for (const entry of read.paths) {
    if (!isInsideCampaign(entry.path) || !isFile(path.join(root, entry.path))) {
      errors.push({
        code: 'plot-flowchart-bad-path',
        file: read.file,
        message: `node ${entry.id} points to ${entry.path}, which does not exist`,
      });
    }
  }

  const cited = new Set(read.paths.map((entry) => path.posix.normalize(entry.path)));
  for (const node of nodes) {
    if (!cited.has(node.file)) {
      errors.push({
        code: 'plot-flowchart-unmapped',
        file: node.file,
        message: `${node.kind} ${node.id} is not in the plot flowchart`,
      });
    }
  }

  return sortErrors(errors);
}

/** Sessions and scenes of the plot graph, as { id, file, kind }. */
function plotNodes(root) {
  const { sessions } = plotMap(root);
  const nodes = [];
  for (const session of sessions) {
    nodes.push({ id: session.id, file: session.file, kind: 'session' });
    for (const scene of session.events) {
      nodes.push({ id: scene.id, file: scene.file, kind: 'scene' });
    }
  }
  return nodes;
}

/** Text of the first ```mermaid block, between its fences, or null when there is none. */
function mermaidBlock(text) {
  const lines = text.split(/\r?\n/);
  const open = lines.findIndex((line) => OPEN_FENCE.test(line));
  if (open === -1) return null;
  const close = lines.findIndex((line, i) => i > open && CLOSE_FENCE.test(line));
  if (close === -1) return null;
  return lines.slice(open + 1, close).join('\n');
}

/** Folder of the first plot category, normalized, or null when there is none. */
function plotFolder(root) {
  const { structure } = readStructure(root);
  const category = (structure ?? []).find((entry) => entry.type === 'plot' && typeof entry.folder === 'string');
  if (!category) return null;
  return path.posix.normalize(category.folder).replace(/\/+$/, '');
}

/** campaign.yaml language.main, or null when it cannot be read. */
function campaignLanguage(root) {
  try {
    const parsed = parseYamlLite(fs.readFileSync(path.join(root, 'campaign.yaml'), 'utf8'));
    if (parsed.errors.length > 0 || parsed.data === null || typeof parsed.data !== 'object') return null;
    const language = parsed.data.language;
    const main = language !== null && typeof language === 'object' ? language.main : undefined;
    return typeof main === 'string' ? main : null;
  } catch {
    return null;
  }
}

/** A target inside the campaign: relative, with no `..` segment. */
function isInsideCampaign(target) {
  if (path.posix.isAbsolute(target) || path.isAbsolute(target)) return false;
  return !target.split(/[\\/]/).includes('..');
}

function isFile(full) {
  try {
    return fs.statSync(full).isFile();
  } catch {
    return false;
  }
}

function sortErrors(errors) {
  return errors.sort(
    (a, b) => compareStrings(a.code, b.code) || compareStrings(a.file, b.file) || compareStrings(a.message, b.message),
  );
}
