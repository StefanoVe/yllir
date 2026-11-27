// Plan validation and apply of the structured convert (issue #138, spec sections 4 and 5).
// Reads the plan, checks all of it, and only then writes the drafts and copies the images.
// Parsing comes from vault-parse.mjs; this file never runs git.

import fs from 'node:fs';
import path from 'node:path';
import { readStructure, masterOnlyChecker, compareStrings } from '../../../../scripts/lib/subjects.mjs';
import { renderMetadata } from '../../../../scripts/lib/frontmatter.mjs';
import { headingAnchor } from '../../../../scripts/lib/normalize.mjs';
import {
  parseFrontmatter, findLinks, findConventions, findFeatures, headings, resolveLink,
} from './vault-parse.mjs';

// Spec 7.2: the allowed meta keys, in write order.
const META_ORDER = [
  'id', 'kind', 'template', 'item_type', 'session', 'provenance', 'location', 'status', 'ended',
  'when', 'depends_on', 'participants', 'characters', 'items', 'played', 'aliases', 'appearances',
  'enemies', 'relations', 'sketch',
];
const LIST_KEYS = new Set(['location', 'participants', 'depends_on', 'characters', 'items', 'played', 'aliases']);
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;
// Text parts may not carry the reserved block markers or an HTML comment end (spec 8.5).
const TEXT_PART_MARKERS = /<!-- master -->|<!-- \/master -->|-->/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isImage = (p) => IMAGE_EXT.test(p);
const isMarkdown = (p) => /\.md$/i.test(p);
const blank = (s) => s.trim() === '';
const hashLevel = (line) => {
  const m = /^(#{1,6})(\s|$)/.exec(line);
  return m ? m[1].length : 0;
};
const setLevel = (line, level) => line.replace(/^#{1,6}/, '#'.repeat(level));
const lastSeg = (target) => target.split('/').pop().replace(/\.md$/i, '');

function trimBlank(lines) {
  let a = 0;
  let b = lines.length;
  while (a < b && blank(lines[a])) a++;
  while (b > a && blank(lines[b - 1])) b--;
  return lines.slice(a, b);
}

function encodeSegment(text) {
  return encodeURIComponent(text).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

/** Relative href from the folder of `fromTarget` to `toTarget`, each segment encoded. */
function hrefTo(fromTarget, toTarget) {
  return path.posix.relative(path.posix.dirname(fromTarget), toTarget)
    .split('/')
    .map(encodeSegment)
    .join('/');
}

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Input Markdown and image files, campaign-style relative paths with `/`, sorted. Dot folders are skipped. */
function walkInput(input) {
  const found = [];
  const visit = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      const r = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) visit(full, r);
      else if (entry.isFile() && (isMarkdown(r) || isImage(r))) found.push(r);
    }
  };
  visit(input, '');
  return found.sort(compareStrings);
}

function targetProblem(target, mustBeMarkdown) {
  if (typeof target !== 'string' || target === '') return 'target must be a path';
  if (mustBeMarkdown && !target.endsWith('.md')) return `${target}: target must end in .md`;
  if (path.posix.isAbsolute(target) || path.isAbsolute(target)) return `${target}: target must be relative`;
  if (target.split('/').includes('..')) return `${target}: target must not contain ..`;
  if (target === '.campaign' || target.startsWith('.campaign/')) return `${target}: target must not be under .campaign/`;
  return null;
}

/** Renders the metadata lines of a document (spec 4 order). Returns null and reports on a bad field. */
function metadataLines(meta, errors) {
  const bad = (message) => errors.push({ code: 'bad-plan', message });
  if (!isObject(meta)) {
    bad('meta must be an object');
    return null;
  }
  for (const key of Object.keys(meta)) {
    if (!META_ORDER.includes(key)) errors.push({ code: 'unknown-key', message: `unknown meta key ${key}` });
  }
  if (typeof meta.id !== 'string' || !SLUG.test(meta.id)) {
    bad('meta.id is required and must be a slug');
    return null;
  }
  const lines = [];
  let ok = true;
  const check = (rendered) => {
    if (rendered.includes('-->') || rendered.includes('\n')) {
      bad(`meta value breaks the block: ${rendered}`);
      ok = false;
    }
  };
  for (const key of META_ORDER) {
    const value = meta[key];
    if (value === undefined) continue;
    if (key === 'relations') {
      if (!Array.isArray(value) || value.some((r) => !isObject(r) || typeof r.to !== 'string' || typeof r.type !== 'string')) {
        bad('meta.relations must be a list of { to, type }');
        ok = false;
        continue;
      }
      if (value.length === 0) continue;
      lines.push('relations:');
      for (const r of value) {
        const pair = [`  - to: ${r.to}`, `    type: ${r.type}`];
        pair.forEach(check);
        lines.push(...pair);
      }
    } else if (key === 'appearances') {
      if (!Array.isArray(value) || value.some((a) => !isObject(a) || typeof a.subject !== 'string'
        || !Array.isArray(a.location) || a.location.some((item) => typeof item !== 'string' || /[,[\]]/.test(item)))) {
        bad('meta.appearances must be a list of { subject, location }');
        ok = false;
        continue;
      }
      if (value.length === 0) continue;
      lines.push('appearances:');
      for (const a of value) {
        const pair = [`  - subject: ${a.subject}`, `    location: [${a.location.join(', ')}]`];
        pair.forEach(check);
        lines.push(...pair);
      }
    } else if (key === 'enemies') {
      if (!Array.isArray(value) || value.some((e) => !isObject(e) || typeof e.id !== 'string'
        || !Number.isInteger(e.count) || e.count < 1)) {
        bad('meta.enemies must be a list of { id, count } with a positive integer count');
        ok = false;
        continue;
      }
      if (value.length === 0) continue;
      lines.push('enemies:');
      for (const e of value) {
        const pair = [`  - id: ${e.id}`, `    count: ${e.count}`];
        pair.forEach(check);
        lines.push(...pair);
      }
    } else if (key === 'sketch') {
      if (value !== true) {
        bad('meta.sketch must be true');
        ok = false;
        continue;
      }
      lines.push('sketch: true');
    } else if (LIST_KEYS.has(key)) {
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || /[,[\]]/.test(item))) {
        bad(`meta.${key} must be a list of plain texts`);
        ok = false;
        continue;
      }
      const rendered = `${key}: [${value.join(', ')}]`;
      check(rendered);
      lines.push(rendered);
    } else {
      if (typeof value !== 'string' && typeof value !== 'number') {
        bad(`meta.${key} must be a text or a number`);
        ok = false;
        continue;
      }
      const rendered = `${key}: ${value}`;
      check(rendered);
      lines.push(rendered);
    }
  }
  return ok ? lines : null;
}

/** Shared reader of input files: lines, body start, front-matter keys and conventions, cached. */
function makeReader(input) {
  const cache = new Map();
  return (rel) => {
    if (cache.has(rel)) return cache.get(rel);
    let record = null;
    try {
      const text = fs.readFileSync(path.join(input, rel), 'utf8');
      const lines = text.split(/\r?\n/);
      if (lines.length > 0 && lines.at(-1) === '') lines.pop(); // the newline ending the last line
      const fm = parseFrontmatter(text);
      const body = lines.slice(fm.bodyStart - 1);
      record = {
        lines,
        keys: fm.keys,
        bodyStart: fm.bodyStart,
        conventions: findConventions(body, fm.bodyStart),
        headings: headings(body, fm.bodyStart),
      };
    } catch {
      record = null;
    }
    cache.set(rel, record);
    return record;
  };
}

/** The shared `### <masterHeading>` of a document: returned once per document (state.shared). */
function sharedHeading(state, masterHeading) {
  if (state.shared) return [];
  state.shared = true;
  return [`### ${masterHeading}`];
}

/**
 * Public lines of one part, after the master conventions are moved out, the shift applied and
 * the first H1 of the first part dropped. Links and features are handled by the caller.
 */
function preparePart(record, part, masterConventions, masterHeading, isFirst, state) {
  const L = record.lines;
  const { from, to } = part;
  const src = (a, b) => L.slice(a - 1, b);
  if (part.master === true) {
    // A master part writes nothing in the public body: its lines (shifted) go whole to the reserved block.
    // Its conventions are not processed on their own, and its heading is ignored.
    const texts = src(from, to);
    let levelError = false;
    for (const h of headings(texts, 1)) {
      const want = h.level + part.shift;
      if (h.level === 1 && want < 2) levelError = true;
      texts[h.line - 1] = setLevel(texts[h.line - 1], Math.min(6, Math.max(2, want)));
    }
    const body = trimBlank(texts);
    return {
      texts: [], srcLines: [], chunks: body.length > 0 ? [[...sharedHeading(state, masterHeading), ...body]] : [],
      fixed: 0, levelError, dropped: null,
    };
  }
  const inPart = (c) => c.start >= from && c.end <= to;
  const candidates = record.conventions.filter((c) => masterConventions[c.id] === 'master' && inPart(c));
  const moved = candidates.filter((c) => !candidates.some((o) => o !== c
    && o.start <= c.start && c.end <= o.end && (o.start < c.start || o.end > c.end)));
  const removed = new Set();
  const cuts = new Map();
  const chunks = [];
  let fixed = 0;
  const shared = () => sharedHeading(state, masterHeading);

  for (const c of moved) {
    if (c.id === 'html-master') {
      let inner = c.inner ? src(c.inner[0], c.inner[1]) : [];
      inner = inner.filter((l) => l.trim() !== '## Master');
      if (!headings(inner, 1).some((h) => h.level >= 3)) {
        inner = [`### ${masterHeading}`, ...inner];
        fixed++;
      }
      chunks.push(trimBlank(inner));
    } else if (c.id.startsWith('heading:')) {
      const sectionLevel = hashLevel(L[c.start - 1]);
      const inner = c.inner ? src(c.inner[0], c.inner[1]) : [];
      for (const h of headings(inner, 1)) {
        inner[h.line - 1] = setLevel(inner[h.line - 1], Math.min(6, h.level - sectionLevel + 3));
      }
      chunks.push(trimBlank([`### ${c.heading}`, '', ...inner]));
    } else if (c.id === 'obsidian-comment') {
      const first = L[c.start - 1];
      const open = first.indexOf('%%');
      if (c.start === c.end) {
        const close = first.indexOf('%%', open + 2);
        chunks.push(trimBlank([...shared(), first.slice(open + 2, close)]));
        cuts.set(c.start, [...(cuts.get(c.start) ?? []), [open, close + 2]]);
        removed.delete(c.start);
        continue;
      }
      const last = L[c.end - 1];
      const close = last.indexOf('%%');
      const inner = [first.slice(open + 2), ...src(c.start + 1, c.end - 1), last.slice(0, close)];
      chunks.push(trimBlank([...shared(), ...inner]));
    } else {
      chunks.push(trimBlank([...shared(), ...src(c.start, c.end)]));
    }
    if (c.id !== 'obsidian-comment' || c.start !== c.end) {
      for (let n = c.start; n <= c.end; n++) removed.add(n);
    }
  }

  let texts = [];
  let srcLines = [];
  for (let n = from; n <= to; n++) {
    if (removed.has(n)) continue;
    let text = L[n - 1];
    const spans = cuts.get(n) ?? [];
    for (const [a, b] of [...spans].sort((x, y) => y[0] - x[0])) text = text.slice(0, a) + text.slice(b);
    texts.push(text);
    srcLines.push(n);
  }

  let dropped = null;
  if (isFirst) {
    const i = texts.findIndex((t) => !blank(t));
    if (i >= 0 && hashLevel(texts[i]) === 1) {
      dropped = srcLines[i];
      texts = texts.filter((_, k) => k !== i);
      srcLines = srcLines.filter((_, k) => k !== i);
    }
  }

  let levelError = false;
  for (const h of headings(texts, 1)) {
    const want = h.level + part.shift;
    if (h.level === 1 && want < 2) levelError = true;
    texts[h.line - 1] = setLevel(texts[h.line - 1], Math.min(6, Math.max(2, want)));
  }

  return { texts, srcLines, chunks, fixed, levelError, dropped };
}

/** Validates the structure of the plan and the parts. Returns the context (errors in ctx.errors). */
function analyse(root, plan) {
  const errors = [];
  const bad = (message) => errors.push({ code: 'bad-plan', message });
  const fail = (code, message) => errors.push({ code, message });
  const ctx = {
    root, plan, errors, walked: [], walkedSet: new Set(), routed: new Set(), parts: [], textParts: [],
    readRecord: null, isMasterOnly: () => false,
  };

  if (!isObject(plan)) {
    bad('plan must be an object');
    return ctx;
  }
  if (typeof plan.input !== 'string' || !path.isAbsolute(plan.input)) {
    bad('input must be an absolute path');
    return ctx;
  }
  if (!isDirectory(plan.input)) {
    fail('missing-input', `input folder not found: ${plan.input}`);
    return ctx;
  }
  ctx.readRecord = makeReader(plan.input);
  ctx.walked = walkInput(plan.input);
  ctx.walkedSet = new Set(ctx.walked);
  const { structure } = readStructure(root);
  ctx.isMasterOnly = masterOnlyChecker(structure ?? []);

  if (typeof plan.masterHeading !== 'string' || blank(plan.masterHeading)) bad('masterHeading must be a text');
  if (!isObject(plan.masterConventions)) {
    bad('masterConventions must be an object');
  } else {
    for (const [id, value] of Object.entries(plan.masterConventions)) {
      if (value !== 'master' && value !== 'public') bad(`convention ${id}: value must be master or public`);
    }
  }
  if (!Array.isArray(plan.documents)) bad('documents must be a list');
  if (plan.images !== undefined && !Array.isArray(plan.images)) bad('images must be a list');
  if (!isObject(plan.routes)) {
    bad('routes must be an object');
  } else {
    for (const key of ['source', 'skip', 'full']) {
      const list = plan.routes[key] ?? [];
      if (!Array.isArray(list) || list.some((p) => typeof p !== 'string')) bad(`routes.${key} must be a list of paths`);
      else for (const p of list) ctx.routed.add(p);
    }
  }
  if (errors.length > 0) return ctx;

  const images = plan.images ?? [];
  for (const img of images) {
    if (!isObject(img) || typeof img.file !== 'string' || typeof img.target !== 'string') {
      bad('images entries need file and target');
      continue;
    }
    if (!ctx.walkedSet.has(img.file) || !isImage(img.file)) fail('missing-input', `image not found: ${img.file}`);
    const problem = targetProblem(img.target, false);
    if (problem) fail('bad-target', problem);
  }

  const targets = new Set();
  const ids = new Set();
  plan.documents.forEach((doc, di) => {
    if (!isObject(doc)) return bad(`document ${di} must be an object`);
    const problem = targetProblem(doc.target, true);
    if (problem) fail('bad-target', problem);
    if (targets.has(doc.target)) fail('duplicate-target', `duplicate target ${doc.target}`);
    targets.add(doc.target);
    if (doc.title !== null && (typeof doc.title !== 'string' || blank(doc.title) || doc.title.includes('\n'))) {
      bad(`${doc.target}: title must be one line or null`);
    }
    const meta = metadataLines(doc.meta, errors);
    if (meta && ids.has(doc.meta.id)) fail('duplicate-id', `duplicate id ${doc.meta.id}`);
    if (meta) ids.add(doc.meta.id);
    if (doc.image !== undefined && doc.image !== null) {
      const img = doc.image;
      if (!isObject(img) || typeof img.file !== 'string' || typeof img.target !== 'string' || typeof img.alt !== 'string') {
        bad(`${doc.target}: image needs file, target and alt`);
      } else {
        if (!ctx.walkedSet.has(img.file) || !isImage(img.file)) fail('missing-input', `image not found: ${img.file}`);
        const imageProblem = targetProblem(img.target, false);
        if (imageProblem) fail('bad-target', imageProblem);
      }
    }
    if (!Array.isArray(doc.parts)) return bad(`${doc.target}: parts must be a list`);
    doc.parts.forEach((part, k) => {
      if (isObject(part) && part.text !== undefined) {
        // Text part (spec 8.5): lines written as they are, no file, no link rewriting, no conventions.
        if (part.file !== undefined || part.from !== undefined || part.to !== undefined) {
          return bad(`${doc.target}: a text part has no file, from or to`);
        }
        if (typeof part.text !== 'string' || TEXT_PART_MARKERS.test(part.text)) {
          return bad(`${doc.target}: a text part must be a text without master markers or -->`);
        }
        if (!(part.heading === null || (typeof part.heading === 'string' && /^#{1,6}\s/.test(part.heading)))) {
          return bad(`${doc.target}: heading must be null or a heading line`);
        }
        if (part.master !== undefined && typeof part.master !== 'boolean') {
          return bad(`${doc.target}: master must be true or false`);
        }
        ctx.textParts.push({ doc, part });
        return;
      }
      if (!isObject(part) || typeof part.file !== 'string' || !isMarkdown(part.file)) {
        return bad(`${doc.target}: part needs a Markdown file`);
      }
      if (!ctx.walkedSet.has(part.file)) return fail('missing-input', `input file not found: ${part.file}`);
      const record = ctx.readRecord(part.file);
      if (record === null) return fail('missing-input', `input file unreadable: ${part.file}`);
      if (!Number.isInteger(part.from) || !Number.isInteger(part.to)
        || part.from < 1 || part.to < part.from || part.to > record.lines.length) {
        return bad(`${doc.target}: invalid line range in ${part.file}`);
      }
      if (!(part.heading === null || (typeof part.heading === 'string' && /^#{1,6}\s/.test(part.heading)))) {
        return bad(`${doc.target}: heading must be null or a heading line`);
      }
      if (!Number.isInteger(part.shift)) return bad(`${doc.target}: shift must be an integer`);
      if (part.master !== undefined && typeof part.master !== 'boolean') {
        return bad(`${doc.target}: master must be true or false`);
      }
      if (part.from < record.bodyStart) {
        return fail('frontmatter-overlap', `part ${part.file}:${part.from}-${part.to} overlaps the front-matter`);
      }
      ctx.parts.push({ doc, part, file: part.file, from: part.from, to: part.to, first: k === 0 });
    });
  });
  if (errors.length > 0) return ctx;

  // Overlap between parts of the same file.
  const byFile = new Map();
  for (const p of ctx.parts) {
    if (!byFile.has(p.file)) byFile.set(p.file, []);
    byFile.get(p.file).push(p);
  }
  for (const list of byFile.values()) {
    list.sort((a, b) => a.from - b.from);
    for (let i = 1; i < list.length; i++) {
      if (list[i - 1].to >= list[i].from) fail('overlap', `parts overlap in ${list[i].file}`);
    }
  }
  if (errors.length > 0) return ctx;

  // Conventions of every file used: each id has an entry; master ones never cross a border.
  for (const file of byFile.keys()) {
    const record = ctx.readRecord(file);
    const reported = new Set();
    for (const c of record.conventions) {
      if (plan.masterConventions[c.id] === undefined && !reported.has(c.id)) {
        reported.add(c.id);
        fail('missing-convention', `no entry in masterConventions for ${c.id} (${file})`);
      }
    }
  }
  for (const p of ctx.parts) {
    const record = ctx.readRecord(p.file);
    for (const c of record.conventions) {
      if (plan.masterConventions[c.id] !== 'master') continue;
      const crosses = c.start <= p.to && c.end >= p.from;
      const inside = c.start >= p.from && c.end <= p.to;
      if (crosses && !inside) fail('overlap', `convention ${c.id} crosses the part ${p.file}:${p.from}-${p.to}`);
    }
    const state = { shared: false };
    const prepared = preparePart(record, p.part, plan.masterConventions, plan.masterHeading, p.first, state);
    if (prepared.levelError) fail('bad-heading-level', `level-1 heading in ${p.file}:${p.from}-${p.to} with shift ${p.part.shift}`);
  }
  return ctx;
}

/** Context of the links: which parts hold each file, the image targets, the dropped headings. */
function linkIndex(ctx) {
  const partsOf = new Map();
  for (const p of ctx.parts) {
    if (!partsOf.has(p.file)) partsOf.set(p.file, []);
    partsOf.get(p.file).push(p);
  }
  const imageTargets = new Map();
  const imageAlts = new Map();
  for (const p of ctx.parts) {
    const img = p.doc.image;
    if (img && !imageTargets.has(img.file)) {
      imageTargets.set(img.file, img.target);
      imageAlts.set(img.file, img.alt);
    }
  }
  for (const img of ctx.plan.images ?? []) {
    if (!imageTargets.has(img.file)) imageTargets.set(img.file, img.target);
  }
  return { partsOf, imageTargets, imageAlts };
}

/**
 * Target of a link with an anchor (spec 8.5). The heading is found in the file of the link; the document
 * holding its line gives the anchor (none when the heading is the dropped title of that document), or else
 * the document whose first part starts right after the heading. Returns { doc, anchor }, 'missing' when no
 * heading matches, or 'no-doc' when the heading is in no part and no part follows it.
 */
function anchorTarget(ctx, index, file, anchor, form) {
  const record = ctx.readRecord(file);
  if (!record) return 'missing';
  const same = form === 'wiki'
    ? (text) => text.toLowerCase() === anchor.toLowerCase()
    : (text) => headingAnchor(text) === headingAnchor(anchor);
  const heading = record.headings.find((h) => same(h.text));
  if (heading === undefined) return 'missing';
  const line = heading.line;
  const owners = index.partsOf.get(file) ?? [];
  const holder = owners.find((p) => line >= p.from && line <= p.to);
  if (holder !== undefined) {
    const dropped = ctx.droppedLines.has(`${file}:${line}`);
    return { doc: holder.doc, anchor: dropped ? null : headingAnchor(heading.text) };
  }
  const after = owners
    .filter((p) => p.from > line && record.lines.slice(line, p.from - 1).every(blank))
    .sort((a, b) => a.from - b.from)[0];
  if (after !== undefined) return { doc: after.doc, anchor: null };
  return 'no-doc';
}

/** Replacement of one link: { out, plain?, note? }. Returns the text in place of the link. */
function linkPiece(ctx, index, doc, source, link, res, inMaster) {
  const textOf = link.form === 'wiki'
    ? (link.label ?? (lastSeg(link.target) || link.anchor || ''))
    : (link.label ?? '');
  const plain = (text, reason) => ({ out: text, plain: { raw: link.raw, text, reason } });

  if (link.embed && res.status === 'ok' && isImage(res.path)) {
    const target = index.imageTargets.get(res.path);
    if (target === undefined) return plain(path.posix.basename(res.path), 'image-not-copied');
    // An Obsidian size (300 or 300x200) is not a description: the alt is the mapped image's own alt.
    const label = link.label ?? '';
    const alt = /^\d+(x\d+)?$/.test(label) ? (index.imageAlts.get(res.path) ?? '') : label;
    return { out: `![${alt}](${hrefTo(doc.target, target)})` };
  }
  if (res.status === 'missing' || res.status === 'ambiguous') {
    return plain(link.embed ? lastSeg(link.target) : textOf, res.status);
  }
  if (!link.embed && isImage(res.path ?? '')) {
    const target = index.imageTargets.get(res.path);
    if (target === undefined) return plain(textOf, 'image-not-copied');
    return { out: `[${textOf}](${hrefTo(doc.target, target)})` };
  }
  if (ctx.routed.has(res.path)) return plain(textOf, 'skipped');

  const owners = index.partsOf.get(res.path) ?? [];
  if (res.status !== 'self' && owners.length === 0) return plain(textOf, 'skipped');

  // The target of an anchor: the document that holds the heading, or the one that starts right after it.
  let chosen = null;
  let anchor = null;
  if (link.anchor !== null) {
    const hit = anchorTarget(ctx, index, res.path, link.anchor, link.form);
    if (hit === 'missing' && res.status === 'self') return plain(textOf, 'missing-anchor');
    if (hit === 'missing') {
      // Non-self: the document of the file, without the anchor (as before).
      chosen = owners[0].doc;
    } else if (hit === 'no-doc') {
      return plain(textOf, 'missing-anchor');
    } else {
      chosen = hit.doc;
      anchor = hit.anchor;
    }
  }
  if (chosen === null) chosen = res.status === 'self' ? doc : owners[0].doc;

  // Same document: a bare `#anchor`, or the file name when there is no anchor.
  if (chosen === doc) {
    const href = anchor ? `#${anchor}` : path.posix.basename(doc.target);
    return { out: `[${textOf}](${href})`, note: link.embed };
  }
  if (!inMaster && ctx.isMasterOnly(chosen.target) && !ctx.isMasterOnly(doc.target)) {
    return plain(textOf, 'master-only');
  }
  const href = hrefTo(doc.target, chosen.target) + (anchor ? `#${anchor}` : '');
  return { out: `[${textOf}](${href})`, note: link.embed };
}

/**
 * Rewrites the links of some lines; returns the lines and the plain-text and note records.
 * A link inside another link's label (a linked image, `[![alt](img.png)](target.md)`) is rewritten first;
 * the outer link then takes the rewritten inner text as its label (spec 8.5).
 */
function rewriteLinks(ctx, index, doc, source, lines, inMaster) {
  const links = findLinks(lines, 1);
  const inside = (outer, inner) => inner.line === outer.line && outer.col <= inner.col && inner.end <= outer.end
    && (inner.col !== outer.col || inner.end !== outer.end);
  const memo = new Map();
  const pieceOf = (k) => {
    if (memo.has(k)) return memo.get(k);
    const link = links[k];
    // `[t](#x)`: the same file (the parser gives an empty target; resolveLink does not know markdown anchors).
    const res = link.form === 'markdown' && link.target === ''
      ? { path: source, status: 'self', candidates: [] }
      : resolveLink(link, source, ctx.walked);
    const kids = links.map((_, c) => c).filter((c) => c !== k && inside(link, links[c])
      && !links.some((_, d) => d !== k && d !== c && inside(link, links[d]) && inside(links[d], links[c])));
    let effective = link;
    if (kids.length > 0 && typeof link.label === 'string') {
      let label = link.label;
      const start = link.col + 1; // the label starts after the `[` of the outer link
      for (const c of kids.sort((a, b) => links[b].col - links[a].col)) {
        const child = pieceOf(c);
        label = label.slice(0, links[c].col - start) + child.out + label.slice(links[c].end - start);
      }
      effective = { ...link, label };
    }
    const piece = linkPiece(ctx, index, doc, source, effective, res, inMaster);
    memo.set(k, piece);
    return piece;
  };
  const plainLinks = [];
  let notes = 0;
  links.forEach((_, k) => {
    const piece = pieceOf(k);
    if (piece.plain) plainLinks.push(piece.plain);
    if (piece.note) notes++;
  });
  const out = lines.slice();
  for (let k = links.length - 1; k >= 0; k--) {
    if (links.some((_, d) => d !== k && inside(links[d], links[k]))) continue; // written inside its container
    const { line, col, end } = links[k];
    const i = line - 1;
    out[i] = out[i].slice(0, col) + pieceOf(k).out + out[i].slice(end);
  }
  return { lines: out, plainLinks, notes };
}

function emptyResult(errors) {
  return {
    ok: false,
    errors,
    files: [],
    sources: [],
    plainLinks: [],
    droppedKeys: [],
    features: [],
    masterBlocks: { moved: 0, fixed: 0 },
    uncovered: [],
    unrouted: [],
    textParts: [],
  };
}

/** Validates the whole plan. Returns the errors array (empty when the plan is valid). */
export function validatePlan(campaignRoot, plan) {
  return analyse(path.resolve(campaignRoot), plan).errors;
}

/**
 * Validates the plan and, when it is valid, writes the drafts and copies the images.
 * @returns {object} the result object of spec section 5
 */
export function applyPlan(campaignRoot, plan) {
  const root = path.resolve(campaignRoot);
  const ctx = analyse(root, plan);
  if (ctx.errors.length > 0) return emptyResult(ctx.errors);

  const { plan: p } = ctx;
  const index = linkIndex(ctx);
  ctx.droppedLines = new Set();

  // Pass 1: prepare every part, so the dropped headings are known before any link is resolved.
  const docs = p.documents.map((doc) => {
    const state = { shared: false };
    const parts = doc.parts.map((part, k) => {
      if (part.text !== undefined) {
        const texts = part.text === '' ? [] : part.text.split('\n');
        const body = trimBlank(texts);
        const chunks = part.master === true && body.length > 0
          ? [[...sharedHeading(state, p.masterHeading), ...body]] : [];
        return { part, prepared: { texts, chunks, fixed: 0, dropped: null } };
      }
      const record = ctx.readRecord(part.file);
      const prepared = preparePart(record, part, p.masterConventions, p.masterHeading, k === 0, state);
      if (prepared.dropped !== null) ctx.droppedLines.add(`${part.file}:${prepared.dropped}`);
      return { part, prepared };
    });
    return { doc, parts };
  });

  // Pass 2: links, features and the assembled text of every document.
  const drafts = [];
  const plainLinks = [];
  const features = [];
  const textParts = [];
  let moved = 0;
  let fixed = 0;
  for (const { doc, parts } of docs) {
    const lines = [];
    const counts = new Map();
    const chunkLines = [];
    let started = false;
    let chunkCount = 0;
    const bodyParts = [];

    for (const { part, prepared } of parts) {
      fixed += prepared.fixed;
      if (part.text !== undefined) {
        textParts.push({ document: doc.target, lines: prepared.texts.length });
        if (part.master === true) {
          if (prepared.chunks.length > 0) {
            chunkCount++;
            chunkLines.push(trimBlank(prepared.chunks[0]));
          }
        } else {
          bodyParts.push({ heading: part.heading, pieces: trimBlank(prepared.texts) });
        }
        continue;
      }
      if (part.master === true) {
        // A master part: its whole text (links rewritten, master-only targets allowed) goes to the reserved block.
        for (const chunk of prepared.chunks) {
          chunkCount++;
          const r = rewriteLinks(ctx, index, doc, part.file, chunk, true);
          for (const pl of r.plainLinks) plainLinks.push({ document: doc.target, ...pl });
          chunkLines.push(trimBlank(r.lines));
        }
        continue;
      }
      const rewritten = rewriteLinks(ctx, index, doc, part.file, prepared.texts, false);
      for (const pl of rewritten.plainLinks) plainLinks.push({ document: doc.target, ...pl });
      if (rewritten.notes) counts.set('note-embed', (counts.get('note-embed') ?? 0) + rewritten.notes);
      for (const f of findFeatures(rewritten.lines, 1)) counts.set(f.id, (counts.get(f.id) ?? 0) + 1);
      bodyParts.push({ heading: part.heading, pieces: trimBlank(rewritten.lines) });
      for (const chunk of prepared.chunks) {
        chunkCount++;
        const r = rewriteLinks(ctx, index, doc, part.file, chunk, true);
        for (const pl of r.plainLinks) plainLinks.push({ document: doc.target, ...pl });
        chunkLines.push(trimBlank(r.lines));
      }
    }
    moved += chunkCount;

    const meta = metadataLines(doc.meta, []) ?? [];
    // A null title writes no H1 (plot event files and session stubs); the body then follows the metadata block.
    lines.push(renderMetadata(meta));
    if (doc.title !== null) lines.push('', `# ${doc.title}`, '');
    if (doc.image) {
      if (lines.at(-1) !== '') lines.push('');
      lines.push(`![${doc.image.alt}](${hrefTo(doc.target, doc.image.target)})`, '');
    }
    for (const bp of bodyParts) {
      if (bp.heading === null && bp.pieces.length === 0) continue;
      if (started || lines.at(-1) !== '') lines.push('');
      if (bp.heading !== null) lines.push(bp.heading, '');
      lines.push(...bp.pieces);
      started = true;
    }
    // An item always has a master block (the item check requires it), even when nothing was moved to it.
    if (chunkLines.length > 0 || doc.meta?.template === 'item') {
      if (lines.at(-1) !== '') lines.push('');
      const block = ['<!-- master -->', '## Master', ''];
      if (chunkLines.length === 0) {
        block.push(`### ${p.masterHeading}`);
      } else {
        chunkLines.forEach((chunk, k) => {
          if (k > 0) block.push('');
          block.push(...chunk);
        });
      }
      block.push('<!-- /master -->');
      lines.push(...block);
    }
    drafts.push({ target: doc.target, text: `${lines.join('\n')}\n` });
    for (const [id, count] of [...counts].sort((a, b) => compareStrings(a[0], b[0]))) {
      features.push({ document: doc.target, id, count });
    }
  }

  // Pass 3: write. Nothing is written before this point.
  const sources = [];
  for (const { doc } of docs) {
    if (doc.image) sources.push({ from: doc.image.file, to: doc.image.target });
  }
  for (const img of p.images ?? []) sources.push({ from: img.file, to: img.target });

  for (const draft of drafts) {
    const file = path.join(root, '.campaign', 'drafts', draft.target);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, draft.text, 'utf8');
  }
  for (const s of sources) {
    const dest = path.join(root, s.to);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(p.input, s.from), dest);
  }

  const usedFiles = [...new Set(ctx.parts.map((x) => x.file))].sort(compareStrings);
  const droppedKeys = [];
  const uncovered = [];
  for (const file of usedFiles) {
    const record = ctx.readRecord(file);
    const keys = Object.keys(record.keys).filter((k) => k !== 'aliases').sort(compareStrings);
    if (keys.length > 0) droppedKeys.push({ file, keys });
    const covered = new Set();
    for (const part of ctx.parts.filter((x) => x.file === file)) {
      for (let n = part.from; n <= part.to; n++) covered.add(n);
    }
    const left = [];
    for (let n = record.bodyStart; n <= record.lines.length; n++) {
      if (!blank(record.lines[n - 1]) && !covered.has(n)) left.push(n);
    }
    if (left.length > 0) uncovered.push({ file, lines: left });
  }

  const usedSet = new Set(usedFiles);
  const unrouted = ctx.walked
    .filter((f) => isMarkdown(f) && !usedSet.has(f) && !ctx.routed.has(f))
    .sort(compareStrings);

  return {
    ok: true,
    errors: [],
    files: drafts.map((d) => d.target).sort(compareStrings),
    sources: sources.map((s) => s.to).sort(compareStrings),
    plainLinks,
    droppedKeys,
    features: features.sort((a, b) => compareStrings(a.document, b.document) || compareStrings(a.id, b.id)),
    masterBlocks: { moved, fixed },
    uncovered,
    unrouted,
    textParts,
  };
}
