#!/usr/bin/env node
// Checks that the core of the framework names no game system and no testbench
// fixture world. The terms, the scanned folders and the justified exceptions
// live in core-purity.yaml. Read-only: nothing is written.
//
// Usage: node testbench/runners/check-core-purity.mjs [--config <file>] [--root <dir>] [--json]
// Exit codes: 0 no hits (allowed ones do not count);
//             1 at least one hit;
//             2 the config cannot be read or is invalid.
// Unused allow entries are printed as warnings and do not change the exit code.

import fs from 'node:fs';
import path from 'node:path';
import { parseYamlLite } from '../../yllir/scripts/lib/yaml-lite.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const DEFAULT_CONFIG_REL = path.join('testbench', 'runners', 'core-purity.yaml');
const USAGE = 'usage: node testbench/runners/check-core-purity.mjs [--config <file>] [--root <dir>] [--json]';
const TEXT_EXTENSIONS = new Set(['.md', '.mjs', '.js', '.json', '.yaml', '.yml', '.txt']);
const EXCERPT_MAX = 160;
// A character that continues a word: a term must not be glued to one of these.
const WORD_CHAR = '\\p{L}\\p{N}_-';

/**
 * Reads and validates the purity config.
 * @param {string} file path to core-purity.yaml
 * @returns {{ scan: string[], exclude: string[], terms: string[], allow: Array<{file: string, term: string, reason: string}> }}
 * @throws {Error} when the file cannot be read, is not valid YAML in the subset, or misses a field
 */
export function loadConfig(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`cannot read ${file}: ${err.code ?? err.message}`);
  }
  const { data, errors } = parseYamlLite(text);
  if (errors.length > 0) {
    throw new Error(`${file} line ${errors[0].line}: ${errors[0].message}`);
  }
  const where = (field) => `${file}: ${field}`;
  const stringList = (field, required) => {
    const value = data[field] ?? [];
    if (!Array.isArray(value)) throw new Error(`${where(field)} must be a list`);
    for (const item of value) {
      if (typeof item !== 'string' || item.trim() === '') {
        throw new Error(`${where(field)} holds an empty or non-text item`);
      }
    }
    if (required && value.length === 0) throw new Error(`${where(field)} must not be empty`);
    return value.map((item) => item.trim());
  };
  const scan = stringList('scan', true);
  const exclude = stringList('exclude', false);
  const terms = stringList('terms', true);
  const rawAllow = data.allow ?? [];
  if (!Array.isArray(rawAllow)) throw new Error(`${where('allow')} must be a list`);
  const allow = rawAllow.map((entry, index) => {
    for (const field of ['file', 'term', 'reason']) {
      if (typeof entry?.[field] !== 'string' || entry[field].trim() === '') {
        throw new Error(`${where(`allow entry ${index + 1} needs a non-empty ${field}`)}`);
      }
    }
    return { file: entry.file.trim(), term: entry.term.trim(), reason: entry.reason.trim() };
  });
  return { scan, exclude, terms, allow };
}

/**
 * Finds whole-word, case-insensitive occurrences of the terms in a text.
 * Each (line, term) pair is reported once, at the column of its first occurrence.
 * @param {string} text
 * @param {string[]} terms
 * @returns {Array<{line: number, column: number, term: string, excerpt: string}>}
 */
export function scanText(text, terms) {
  const found = [];
  const lines = text.split(/\r?\n/);
  const patterns = terms.map((term) => ({
    term,
    re: new RegExp(`(?<![${WORD_CHAR}])${escapeRegExp(term)}(?![${WORD_CHAR}])`, 'giu'),
  }));
  lines.forEach((line, index) => {
    for (const { term, re } of patterns) {
      re.lastIndex = 0;
      const match = re.exec(line);
      if (match !== null) {
        found.push({
          line: index + 1,
          column: match.index + 1,
          term,
          excerpt: excerptOf(line),
        });
      }
    }
  });
  return found.sort((a, b) => a.line - b.line || a.column - b.column);
}

/**
 * Scans the configured folders of a repository and sorts the hits into
 * hits (to fail the check) and allowed (covered by an allow entry).
 * @param {{ root: string, config: object }} options config as returned by loadConfig
 * @returns {{ hits: object[], allowed: object[], unusedAllow: object[] }}
 * @throws {Error} when a scanned folder does not exist
 */
export function checkPurity({ root, config }) {
  const hits = [];
  const allowed = [];
  const usedAllow = new Set();
  const allowIndex = config.allow.map((entry, index) => ({ ...entry, index }));

  for (const folder of config.scan) {
    const folderPath = path.join(root, folder);
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
      throw new Error(`scan folder ${folder} does not exist under ${root}`);
    }
    for (const rel of listTextFiles(root, folder, config.exclude)) {
      const text = fs.readFileSync(path.join(root, rel), 'utf8');
      for (const occurrence of scanText(text, config.terms)) {
        const record = { file: rel, line: occurrence.line, term: occurrence.term, excerpt: occurrence.excerpt };
        const entry = allowIndex.find((candidate) => allowMatches(candidate, rel, occurrence.term));
        if (entry) {
          usedAllow.add(entry.index);
          allowed.push({ ...record, reason: entry.reason });
        } else {
          hits.push(record);
        }
      }
    }
  }

  const unusedAllow = config.allow
    .filter((_, index) => !usedAllow.has(index))
    .map(({ file, term, reason }) => ({ file, term, reason }));
  return { hits, allowed, unusedAllow };
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function excerptOf(line) {
  const trimmed = line.trim();
  return trimmed.length > EXCERPT_MAX ? `${trimmed.slice(0, EXCERPT_MAX - 3)}...` : trimmed;
}

/** An entry whose file ends with "/" is a prefix; term "*" allows every term. */
function allowMatches(entry, rel, term) {
  const fileMatches = entry.file.endsWith('/') ? rel.startsWith(entry.file) : rel === entry.file;
  if (!fileMatches) return false;
  return entry.term === '*' || entry.term.toLowerCase() === term.toLowerCase();
}

/** Relative (forward-slash) paths of the text files under one scanned folder. */
function listTextFiles(root, folder, exclude) {
  const files = [];
  const walk = (rel) => {
    if (isExcluded(rel, exclude)) return;
    const abs = path.join(root, rel);
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = `${rel}/${entry.name}`;
      if (entry.name === 'node_modules' || childRel.includes('/node_modules/')) continue;
      if (entry.isDirectory()) {
        walk(childRel);
      } else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name)) && !isExcluded(childRel, exclude)) {
        files.push(childRel);
      }
    }
  };
  walk(folder.split(path.sep).join('/'));
  return files.sort();
}

function isExcluded(rel, exclude) {
  return exclude.some((prefix) => {
    const clean = prefix.replace(/\/+$/, '');
    return rel === clean || rel.startsWith(`${clean}/`);
  });
}

function parseArgs(argv) {
  const opts = { config: null, root: REPO_ROOT, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--config' || arg === '--root') {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value\n${USAGE}`);
      opts[arg.slice(2)] = argv[++i];
    } else {
      throw new Error(`unknown argument ${arg}\n${USAGE}`);
    }
  }
  opts.root = path.resolve(opts.root);
  opts.config = path.resolve(opts.config ?? path.join(opts.root, DEFAULT_CONFIG_REL));
  return opts;
}

function main() {
  let opts;
  let config;
  try {
    opts = parseArgs(process.argv.slice(2));
    config = loadConfig(opts.config);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(2);
  }

  let result;
  try {
    result = checkPurity({ root: opts.root, config });
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(2);
  }

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    for (const hit of result.hits) {
      process.stdout.write(`${hit.file}:${hit.line}  ${hit.term}  ${hit.excerpt}\n`);
    }
    for (const entry of result.unusedAllow) {
      process.stderr.write(`warning: unused allow entry ${entry.file} ${entry.term} (${entry.reason})\n`);
    }
    process.stdout.write(
      `purity: ${result.hits.length} hits, ${result.allowed.length} allowed, ${result.unusedAllow.length} unused allow entries\n`,
    );
  }
  process.exit(result.hits.length > 0 ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
