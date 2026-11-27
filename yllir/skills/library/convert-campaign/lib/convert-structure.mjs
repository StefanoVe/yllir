// Structure report of the source folder of a structured convert (issue #138): files, front-matter,
// headings, links, master-only conventions, features and hints, read from the input only.
// buildReport(inputDir) returns the report object and writes nothing. Every list is sorted with compareStrings.

import fs from 'node:fs';
import path from 'node:path';
import { compareStrings } from '../../../../scripts/lib/subjects.mjs';
import {
  codeMask,
  findConventions,
  findFeatures,
  findLinks,
  headings,
  parseFrontmatter,
  resolveLink,
} from './vault-parse.mjs';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const TODO_NAMES = new Set(['todo', 'to-do', 'da fare', 'dafare', 'tasks']);
const DAILY_NAME = /^\d{4}-\d{2}-\d{2}$/;
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;
const EXAMPLES_PER_CONVENTION = 2;
const EXAMPLE_CHARS = 80;
const LONG_FILE_LINES = 300;

/** Walks the input folder: Markdown and image paths (sorted) and the excluded entries. */
function walk(root) {
  const markdown = [];
  const images = [];
  const excluded = [];
  const visit = (rel) => {
    const absolute = rel === '' ? root : path.join(root, rel);
    const entries = fs.readdirSync(absolute, { withFileTypes: true })
      .sort((a, b) => compareStrings(a.name, b.name));
    for (const entry of entries) {
      const child = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) excluded.push({ path: `${child}/`, reason: 'tool-folder' });
        else visit(child);
      } else if (entry.isFile()) {
        const ext = path.posix.extname(entry.name.toLowerCase());
        if (ext === '.canvas') excluded.push({ path: child, reason: 'canvas' });
        else if (ext === '.md') markdown.push(child);
        else if (IMAGE_EXTENSIONS.has(ext)) images.push(child);
        else excluded.push({ path: child, reason: 'other-type' });
      }
    }
  };
  visit('');
  return {
    markdown: markdown.sort(compareStrings),
    images: images.sort(compareStrings),
    excluded: excluded.sort((a, b) => compareStrings(a.path, b.path)),
  };
}

/** Lines of a UTF-8 file: split on LF, a trailing CR removed, no phantom line after a final LF. */
function readLines(absolute) {
  const text = fs.readFileSync(absolute, 'utf8');
  if (text === '') return { text, lines: [] };
  const lines = text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  if (text.endsWith('\n')) lines.pop();
  return { text, lines };
}

/** Parses one Markdown file: front-matter, body, headings, conventions, features and resolved links. */
function analyse(root, rel, allPaths) {
  const { text, lines } = readLines(path.join(root, rel));
  const { keys, bodyStart } = parseFrontmatter(text);
  const body = lines.slice(bodyStart - 1);
  return {
    path: rel,
    lines,
    bodyStart,
    frontmatter: keys,
    body,
    headings: headings(body, bodyStart),
    links: findLinks(body, bodyStart).map((link) => ({ link, resolved: resolveLink(link, rel, allPaths) })),
    conventions: findConventions(body, bodyStart),
    features: findFeatures(body, bodyStart),
  };
}

/** True when a non-heading line holds a link and, without its links and list marker, at most 3 words. */
function holdsLinkAndLittle(line, links) {
  if (links.length === 0) return false;
  let rest = line;
  for (const link of [...links].sort((a, b) => b.col - a.col)) {
    rest = rest.slice(0, link.col) + rest.slice(link.end);
  }
  const words = rest.replace(LIST_MARKER, '').split(/\s+/).filter((word) => word !== '');
  return words.length <= 3;
}

/**
 * Index: at least 5 non-blank lines, and at least 70% of the non-blank lines that are neither headings
 * nor inside a fenced block are link-and-little lines.
 */
function looksLikeIndex(doc) {
  const headingLines = new Set(doc.headings.map((h) => h.line));
  const fenced = codeMask(doc.body);
  const nonBlank = [];
  doc.body.forEach((line, i) => {
    if (line.trim() !== '') nonBlank.push(doc.bodyStart + i);
  });
  if (nonBlank.length < 5) return false;
  const candidates = nonBlank.filter((n) => !headingLines.has(n) && !fenced[n - doc.bodyStart]);
  if (candidates.length === 0) return false;
  const linksByLine = new Map();
  for (const { link } of doc.links) {
    if (!linksByLine.has(link.line)) linksByLine.set(link.line, []);
    linksByLine.get(link.line).push(link);
  }
  const qualifying = candidates.filter((n) => holdsLinkAndLittle(doc.body[n - doc.bodyStart], linksByLine.get(n) ?? []));
  return qualifying.length * 10 >= candidates.length * 7;
}

/** The hints of one file, sorted. */
function hintsOf(doc) {
  const hints = [];
  const folders = doc.path.split('/').slice(0, -1).map((segment) => segment.toLowerCase());
  const base = path.posix.basename(doc.path, path.posix.extname(doc.path));
  if (looksLikeIndex(doc)) hints.push('index');
  if (DAILY_NAME.test(base)) hints.push('daily');
  if (folders.some((f) => TODO_NAMES.has(f)) || TODO_NAMES.has(base.toLowerCase())) hints.push('todo');
  const level1 = doc.headings.filter((h) => h.level === 1).length;
  if (level1 >= 2) hints.push('multi-subject');
  if (doc.lines.length > LONG_FILE_LINES) hints.push('long');
  if (folders.some((f) => f.includes('session') || f.includes('serate'))) hints.push('session');
  return hints.sort(compareStrings);
}

/** Trimmed first line of a convention, cut to EXAMPLE_CHARS characters. */
function excerpt(line) {
  return Array.from(line.trim()).slice(0, EXAMPLE_CHARS).join('');
}

/** A plain object whose keys are in compareStrings order. */
function sortedObject(counts) {
  return Object.fromEntries([...counts].sort((a, b) => compareStrings(a[0], b[0])));
}

/** Builds the structure report of an input folder. Reads only; writes nothing. */
export function buildReport(inputDir) {
  const root = path.resolve(inputDir);
  let isDirectory = false;
  try {
    isDirectory = fs.statSync(root).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) throw new Error(`cannot read the input folder: ${root}`);

  const walked = walk(root);
  const allPaths = [...walked.markdown, ...walked.images].sort(compareStrings);
  const imageSet = new Set(walked.images);
  const docs = walked.markdown.map((rel) => analyse(root, rel, allPaths));

  // linksIn: links of other files that resolve to a file.
  const linksIn = new Map();
  for (const doc of docs) {
    for (const { resolved } of doc.links) {
      if (resolved.path !== null && resolved.path !== doc.path) {
        linksIn.set(resolved.path, (linksIn.get(resolved.path) ?? 0) + 1);
      }
    }
  }

  // embeddedBy: Markdown files that embed each image.
  const embeddedBy = new Map();
  for (const doc of docs) {
    for (const { link, resolved } of doc.links) {
      if (!link.embed || resolved.path === null || !imageSet.has(resolved.path)) continue;
      if (!embeddedBy.has(resolved.path)) embeddedBy.set(resolved.path, new Set());
      embeddedBy.get(resolved.path).add(doc.path);
    }
  }

  const count = { markdown: 0, wiki: 0, 'wiki-label': 0, 'wiki-anchor': 0, embed: 0 };
  const missing = [];
  const ambiguous = [];
  for (const doc of docs) {
    for (const { link, resolved } of doc.links) {
      if (link.embed) {
        count.embed++;
      } else if (link.form === 'markdown') {
        count.markdown++;
      } else {
        if (link.label !== null) count['wiki-label']++;
        if (link.anchor !== null) count['wiki-anchor']++;
        if (link.label === null && link.anchor === null) count.wiki++;
      }
      if (resolved.status === 'missing') {
        missing.push({ file: doc.path, line: link.line, raw: link.raw });
      } else if (resolved.status === 'ambiguous') {
        ambiguous.push({ file: doc.path, line: link.line, raw: link.raw, candidates: resolved.candidates });
      }
    }
  }

  const files = docs.map((doc) => ({
    path: doc.path,
    type: 'markdown',
    lines: doc.lines.length,
    bodyStart: doc.bodyStart,
    frontmatter: doc.frontmatter,
    headings: doc.headings,
    linksOut: doc.links.filter(({ resolved }) => resolved.path !== null).length,
    linksIn: linksIn.get(doc.path) ?? 0,
    conventions: doc.conventions.map(({ id, start, end }) => ({ id, start, end })),
    features: doc.features,
    hints: hintsOf(doc),
  }));

  // conventions: one entry per id, files counted once each, the first examples in path order.
  const conventionMap = new Map();
  const frontmatterCounts = new Map();
  const featureCounts = new Map();
  for (const doc of docs) {
    const seen = new Set();
    for (const conv of doc.conventions) {
      if (!conventionMap.has(conv.id)) conventionMap.set(conv.id, { id: conv.id, files: 0, examples: [] });
      const entry = conventionMap.get(conv.id);
      if (!seen.has(conv.id)) {
        seen.add(conv.id);
        entry.files++;
      }
      if (entry.examples.length < EXAMPLES_PER_CONVENTION) {
        entry.examples.push({ file: doc.path, line: conv.start, text: excerpt(doc.lines[conv.start - 1]) });
      }
    }
    for (const key of Object.keys(doc.frontmatter)) {
      frontmatterCounts.set(key, (frontmatterCounts.get(key) ?? 0) + 1);
    }
    for (const feature of doc.features) {
      featureCounts.set(feature.id, (featureCounts.get(feature.id) ?? 0) + 1);
    }
  }
  const conventions = [...conventionMap.values()].sort((a, b) => compareStrings(a.id, b.id));

  const byFileAndLine = (a, b) => compareStrings(a.file, b.file) || a.line - b.line;
  const images = walked.images.map((image) => ({
    path: image,
    embeddedBy: [...(embeddedBy.get(image) ?? [])].sort(compareStrings),
  }));

  return {
    input: root,
    files,
    images,
    excluded: walked.excluded,
    links: {
      count,
      missing: missing.sort(byFileAndLine),
      ambiguous: ambiguous.sort(byFileAndLine),
    },
    frontmatterKeys: sortedObject(frontmatterCounts),
    conventions,
    features: sortedObject(featureCounts),
  };
}
