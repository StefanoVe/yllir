// Deterministic check of every link and image in a campaign: targets, anchors,
// the master-only privacy rule, and the Markdown errors of the checked files.
// Its result overrides any agent opinion.

import fs from 'node:fs';
import path from 'node:path';
import { readStructure, listSheets, compareStrings, masterOnlyChecker } from '../../../../../scripts/lib/subjects.mjs';
import { parseFrontmatter } from '../../../../../scripts/lib/frontmatter.mjs';
import { analyzeMarkdown } from '../../../../../scripts/lib/zones.mjs';
import { headingAnchor } from '../../../../../scripts/lib/normalize.mjs';

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * @param {string} campaignRoot path to the campaign folder
 * @param {{ files?: string[]|null }} [options] campaign-relative files to check; all sheets when null
 * @returns {{ checked: string[], links: number, errors: Array<{file: string, line: number, col: number, target: string|null, code: string, message: string}> }}
 */
export function checkLinks(campaignRoot, { files = null } = {}) {
  const root = path.resolve(campaignRoot);
  const { structure, errors: structureErrors } = readStructure(root);
  if (structure === null) {
    throw new Error(structureErrors[0].message);
  }

  const isMasterOnly = masterOnlyChecker(structure);

  const listed =
    files === null
      ? listAllSheets(root, structure)
      : files.map((file) => relOf(root, path.resolve(root, file)));
  const toCheck = [...new Set(listed)].sort(compareStrings);

  const cache = new Map(); // campaign-relative path -> analysis, or null when unreadable
  const errors = [];
  const checked = [];
  let links = 0;

  /** Analysis of a file under the campaign root, cached. Null when it is not a readable file. */
  const loadDoc = (rel) => {
    if (!cache.has(rel)) {
      let doc = null;
      if (insideRel(rel)) {
        try {
          doc = analyzeDoc(fs.readFileSync(path.join(root, rel), 'utf8'));
        } catch {
          doc = null;
        }
      }
      cache.set(rel, doc);
    }
    return cache.get(rel);
  };

  for (const rel of toCheck) {
    const doc = loadDoc(rel);
    if (doc === null) {
      const outside = !insideRel(rel);
      errors.push({
        file: rel,
        line: 1,
        col: 1,
        target: null,
        code: outside ? 'outside-campaign' : 'missing-file',
        message: outside ? 'file is outside the campaign folder' : 'file not found',
      });
      continue;
    }
    checked.push(rel);

    for (const e of doc.frontmatterErrors) {
      errors.push({ file: rel, line: e.line, col: 1, target: null, code: 'markdown', message: e.message });
    }
    for (const e of doc.zoneErrors) {
      errors.push({ file: rel, line: e.line, col: 1, target: null, code: 'markdown', message: e.message });
    }

    const sourceIsMasterOnly = isMasterOnly(rel);
    const sourceAbs = path.join(root, rel);

    for (const line of doc.lines) {
      for (const span of line.spans) {
        if (span.kind !== 'link' && span.kind !== 'image') continue;
        const target = span.target;
        if (SCHEME.test(target)) continue;
        links++;

        const report = (code, message) =>
          errors.push({ file: rel, line: line.line, col: span.start + 1, target, code, message });

        if (target.startsWith('/')) {
          report('absolute-path', 'links must be relative');
          continue;
        }

        const hash = target.indexOf('#');
        const rawPath = hash < 0 ? target : target.slice(0, hash);
        const anchor = hash < 0 ? '' : target.slice(hash + 1);

        let decoded;
        try {
          decoded = decodeURIComponent(rawPath);
        } catch {
          report('bad-encoding', 'target path is not valid percent-encoding');
          continue;
        }
        if (decoded.startsWith('/')) {
          report('absolute-path', 'links must be relative');
          continue;
        }

        const targetRel = decoded === '' ? rel : relOf(root, path.resolve(path.dirname(sourceAbs), decoded));

        if (!insideRel(targetRel)) {
          report('outside-campaign', 'link leaves the campaign folder');
          continue;
        }
        if (!fs.existsSync(path.join(root, targetRel))) {
          report('missing-target', `no file at ${targetRel}`);
          continue;
        }

        if (anchor !== '' && targetRel.endsWith('.md')) {
          const targetDoc = loadDoc(targetRel);
          if (targetDoc !== null && !targetDoc.anchors.has(anchor)) {
            report('missing-anchor', `no heading #${anchor} in ${targetRel}`);
          }
        }

        if (
          isMasterOnly(targetRel) &&
          !sourceIsMasterOnly &&
          !line.inMaster
        ) {
          report('public-link-to-master-only', `a public text links to the master-only file ${targetRel}`);
        }
      }
    }
  }

  errors.sort((a, b) => compareStrings(a.file, b.file) || a.line - b.line || a.col - b.col);

  return { checked, links, errors };

  function listAllSheets(rootDir, entries) {
    const found = new Set();
    for (const entry of entries) {
      if (typeof entry.folder !== 'string') continue;
      for (const sheet of listSheets(rootDir, entry.folder)) found.add(sheet);
    }
    return [...found];
  }
}

/** Analysis of one file: frontmatter and zone errors, and the anchors it offers. */
function analyzeDoc(text) {
  const frontmatter = parseFrontmatter(text);
  const zones = analyzeMarkdown(frontmatter.body, frontmatter.bodyStartLine);
  const anchors = new Set();
  const seen = new Map(); // base anchor -> occurrences so far
  let hasMaster = false;

  for (const line of zones.lines) {
    if (line.block === 'master-open') hasMaster = true;
    if (line.block !== 'heading') continue;
    const base = headingAnchor(line.headingText);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  if (hasMaster) anchors.add('master');

  return {
    lines: zones.lines,
    frontmatterErrors: frontmatter.errors,
    zoneErrors: zones.errors,
    anchors,
  };
}

/** Campaign-relative path with `/` separators. */
function relOf(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

/** True when a campaign-relative path stays inside the campaign folder. */
function insideRel(rel) {
  return !path.isAbsolute(rel) && rel.split('/')[0] !== '..';
}
