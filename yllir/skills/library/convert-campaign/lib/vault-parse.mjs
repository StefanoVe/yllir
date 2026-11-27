// Pure parsing of Obsidian and Markdown text for the structured convert: front-matter,
// code fences, links, master-only conventions, features, headings and link resolution.
// Line numbers are 1-based (firstLine + index). No file system, no clock, no network.

import path from 'node:path';
import { compareStrings } from '../../../../scripts/lib/subjects.mjs';

const FENCE_OPEN = /^\s*(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;
const HEADING = /^(#{1,6})(?:\s+(.*))?$/;
const CALLOUT = /^> ?\[!([A-Za-z-]+)\]/;
const LINK = /!?\[\[([^\]\n]*)\]\]|!?\[([^\]\n]*)\]\((<[^>\n]*>|[^)\s]+)(?:\s+"[^"\n]*")?\)/g;
// A linked image: [![alt](img)](target). The outer link's label is the inner image as written.
const NESTED_IMAGE_LINK = /\[(!\[[^\]\n]*\]\((?:<[^>\n]*>|[^)\s]+)(?:\s+"[^"\n]*")?\))\]\((<[^>\n]*>|[^)\s]+)(?:\s+"[^"\n]*")?\)/g;
const TAG = /(?<=^|\s)#[\p{L}\p{N}_\/-]*\p{L}[\p{L}\p{N}_\/-]*/gu;
const BLOCK_REF = /(?:^|\s)\^[A-Za-z0-9-]+\s*$/;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const MASTER_OPEN = '<!-- master -->';
const MASTER_CLOSE = '<!-- /master -->';
const FENCE_CONVENTIONS = new Set(['secret', 'segreto', 'segreti', 'master', 'private', 'privato', 'gm', 'dm']);
// Heading keywords match as whole words (a letter on either side breaks the match).
const HEADING_MASTER_WORD = /(?<!\p{L})(?:master|gm|dm)(?!\p{L})/u;
const HEADING_SECRET_WORD = /(?<!\p{L})(?:segret|secret)/u;
// First inner line of a fence that marks it as master-only (the keyword ends at end, space or punctuation).
const FENCE_MASTER_NOTE_LINE = /^(?:solo per il master|per il master|note del master|master|gm|dm|segreto|segreti|secret)(?:$|[\s\p{P}])/u;

/** Convention id of a heading text (lowercased and matched as whole words), or null. */
function headingConvention(text) {
  const lower = text.toLowerCase();
  if (HEADING_MASTER_WORD.test(lower)) return 'heading:master';
  if (HEADING_SECRET_WORD.test(lower)) return 'heading:segreti';
  return null;
}

/** Removes one pair of matching quotes around a value. */
function unquote(text) {
  if (text.length >= 2 && (text[0] === '"' || text[0] === "'") && text.at(-1) === text[0]) {
    return text.slice(1, -1);
  }
  return text;
}

/** Splits the inside of a flow list `[a, "b c"]` on commas outside quotes. */
function parseFlowList(inner) {
  const items = [];
  let quote = null;
  let current = '';
  for (const ch of inner) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ',') {
      items.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  items.push(current);
  return items.map((item) => item.trim()).filter((item) => item !== '').map(unquote);
}

/** Value of a `key: value` front-matter line: a flow list or a scalar. */
function parseValue(raw) {
  if (raw.startsWith('[') && raw.endsWith(']')) return parseFlowList(raw.slice(1, -1));
  return unquote(raw);
}

/**
 * Front-matter of a Markdown text: a first line `---` closed by the next `---` line.
 * @param {string} text the whole file
 * @returns {{ keys: object, bodyStart: number }} bodyStart is the 1-based line after the block
 */
export function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  const none = { keys: {}, bodyStart: 1 };
  if (lines[0] !== '---') return none;
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      close = i;
      break;
    }
  }
  if (close === -1) return none;

  const keys = {};
  let current = null; // key whose block list is being read
  for (const line of lines.slice(1, close)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item !== null && current !== null) {
      if (!Array.isArray(keys[current])) keys[current] = [];
      keys[current].push(unquote(item[1].trim()));
      continue;
    }
    const colon = line.indexOf(':');
    if (colon > 0 && !/^\s/.test(line)) {
      const key = line.slice(0, colon).trim();
      const rest = line.slice(colon + 1).trim();
      current = rest === '' ? key : null;
      keys[key] = rest === '' ? '' : parseValue(rest);
    } else {
      current = null;
    }
  }
  return { keys, bodyStart: close + 2 };
}

/**
 * Fenced blocks of the lines, with 0-based indexes. An unclosed fence runs to the last line.
 * @returns {{ open: number, close: number, closed: boolean, info: string }[]}
 */
function scanFences(lines) {
  const fences = [];
  let i = 0;
  while (i < lines.length) {
    const open = FENCE_OPEN.exec(lines[i]);
    if (open === null) {
      i++;
      continue;
    }
    const marker = open[1];
    const info = open[2].trim().toLowerCase();
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const m = FENCE_CLOSE.exec(lines[j]);
      if (m !== null && m[1][0] === marker[0] && m[1].length >= marker.length) {
        close = j;
        break;
      }
    }
    if (close === -1) {
      fences.push({ open: i, close: lines.length - 1, closed: false, info });
      break;
    }
    fences.push({ open: i, close, closed: true, info });
    i = close + 1;
  }
  return fences;
}

/**
 * Lines inside a fenced block, the fence lines included.
 * @param {string[]} lines
 * @returns {boolean[]} one per line, 0-based
 */
export function codeMask(lines) {
  const mask = lines.map(() => false);
  for (const fence of scanFences(lines)) {
    for (let k = fence.open; k <= fence.close; k++) mask[k] = true;
  }
  return mask;
}

/** Characters of one line that sit inside an inline code span (backtick runs). */
function inlineCodeMask(line) {
  const mask = new Array(line.length).fill(false);
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') {
      i++;
      continue;
    }
    let run = i;
    while (run < line.length && line[run] === '`') run++;
    const size = run - i;
    let close = -1;
    let j = run;
    while (j < line.length && close === -1) {
      if (line[j] === '`') {
        let k = j;
        while (k < line.length && line[k] === '`') k++;
        if (k - j === size) close = k;
        j = k;
      } else {
        j++;
      }
    }
    if (close === -1) {
      i = run;
    } else {
      mask.fill(true, i, close);
      i = close;
    }
  }
  return mask;
}

/** Percent-decodes a path or anchor; keeps the raw text when decoding fails. */
function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function nonEmpty(text) {
  return text === '' ? null : text;
}

/** Fields of a wiki link `[[...]]` given its raw text and its inside. */
function wikiFields(raw, inner) {
  const pipe = inner.indexOf('|');
  const targetPart = pipe >= 0 ? inner.slice(0, pipe) : inner;
  const hash = targetPart.indexOf('#');
  return {
    form: 'wiki',
    target: (hash >= 0 ? targetPart.slice(0, hash) : targetPart).trim(),
    anchor: hash >= 0 ? nonEmpty(targetPart.slice(hash + 1).trim()) : null,
    label: pipe >= 0 ? inner.slice(pipe + 1).trim() : null,
    embed: raw.startsWith('!'),
  };
}

/** Fields of a Markdown link, or null when it points outside the campaign or to the same file. */
function markdownFields(raw, label, targetRaw) {
  const target = targetRaw.startsWith('<') && targetRaw.endsWith('>') ? targetRaw.slice(1, -1) : targetRaw;
  if (SCHEME.test(target)) return null;
  const hash = target.indexOf('#');
  return {
    form: 'markdown',
    target: safeDecode(hash >= 0 ? target.slice(0, hash) : target),
    anchor: hash >= 0 ? nonEmpty(safeDecode(target.slice(hash + 1))) : null,
    label,
    embed: raw.startsWith('!'),
  };
}

/**
 * Links of the lines (wiki, markdown and embeds), outside fences and inline code.
 * @param {string[]} lines
 * @param {number} firstLine line number of lines[0]
 * @returns {object[]} { line, col, end, raw, form, target, anchor, label, embed } in line and column order
 */
export function findLinks(lines, firstLine) {
  const fenced = codeMask(lines);
  const links = [];
  lines.forEach((line, i) => {
    if (fenced[i]) return;
    const inline = inlineCodeMask(line);
    // The outer brackets of a linked image are blanked, so the inner image is read alone.
    const blank = line.split('');
    const outers = [];
    for (const m of line.matchAll(NESTED_IMAGE_LINK)) {
      const col = m.index;
      const end = col + m[0].length;
      const labelClose = col + 1 + m[1].length;
      blank[col] = ' ';
      for (let k = labelClose; k < end; k++) blank[k] = ' ';
      if (inline.slice(col, end).some(Boolean)) continue;
      const fields = markdownFields(m[0], m[1], m[2]);
      if (fields === null) continue;
      outers.push({ col, end, raw: m[0], fields, inner: [] });
    }
    const found = [];
    for (const m of blank.join('').matchAll(LINK)) {
      const col = m.index;
      const end = col + m[0].length;
      if (inline.slice(col, end).some(Boolean)) continue;
      const fields = m[1] !== undefined
        ? wikiFields(m[0], m[1])
        : markdownFields(m[0], m[2], m[3]);
      if (fields === null) continue;
      const entry = { line: firstLine + i, col, end, raw: line.slice(col, end), ...fields };
      const outer = outers.find((o) => col >= o.col && end <= o.end);
      if (outer !== undefined) {
        entry.nested = true;
        outer.inner.push(entry);
      }
      found.push(entry);
    }
    for (const o of outers) {
      const entry = { line: firstLine + i, col: o.col, end: o.end, raw: o.raw, ...o.fields, contains: o.inner.length };
      found.push(entry);
    }
    found.sort((a, b) => a.col - b.col);
    links.push(...found);
  });
  return links;
}

/** ATX headings outside fences, with 0-based indexes. */
function headingIndexes(lines, fenced) {
  const found = [];
  lines.forEach((line, idx) => {
    if (fenced[idx]) return;
    const m = HEADING.exec(line);
    if (m === null) return;
    const text = (m[2] ?? '').replace(/\s+#+\s*$/, '').trim();
    found.push({ idx, level: m[1].length, text });
  });
  return found;
}

/**
 * ATX headings outside fences.
 * @returns {{ line: number, level: number, text: string }[]}
 */
export function headings(lines, firstLine) {
  const fenced = codeMask(lines);
  return headingIndexes(lines, fenced).map((h) => ({ line: firstLine + h.idx, level: h.level, text: h.text }));
}

/** Next occurrence of a token from a position, skipping fenced lines and inline code. */
function nextToken(lines, fenced, inline, fromLine, fromCol, token) {
  for (let l = fromLine; l < lines.length; l++) {
    if (fenced[l]) continue;
    const start = l === fromLine ? fromCol : 0;
    let idx = lines[l].indexOf(token, start);
    while (idx !== -1 && inline[l][idx]) idx = lines[l].indexOf(token, idx + 1);
    if (idx !== -1) return { line: l, col: idx };
  }
  return null;
}

/**
 * Candidate master-only conventions of the text.
 * @param {string[]} lines
 * @param {number} firstLine line number of lines[0]
 * @returns {{ id: string, start: number, end: number, inner: number[] | null, heading: string | null }[]}
 */
export function findConventions(lines, firstLine) {
  const n = lines.length;
  const fenced = codeMask(lines);
  const inline = lines.map(inlineCodeMask);
  const found = []; // { id, s, e, inner: [s, e] | null, heading } with 0-based indexes
  const masterRanges = [];

  for (let i = 0; i < n; i++) {
    if (fenced[i] || lines[i].trim() !== MASTER_OPEN) continue;
    let j = i + 1;
    while (j < n && lines[j].trim() !== MASTER_CLOSE) j++;
    if (j >= n) continue;
    masterRanges.push([i, j]);
    found.push({ id: 'html-master', s: i, e: j, inner: j - 1 >= i + 1 ? [i + 1, j - 1] : null, heading: null });
    i = j;
  }
  const inMaster = (idx) => masterRanges.some(([a, b]) => idx >= a && idx <= b);

  const all = headingIndexes(lines, fenced);
  let coveredUntil = -1; // last line of the reported heading section; nested headings are covered by it
  all.forEach((h, k) => {
    if (h.idx <= coveredUntil || inMaster(h.idx)) return;
    const id = headingConvention(h.text);
    if (id === null) return;
    let end = n - 1;
    for (const next of all.slice(k + 1)) {
      if (next.level <= h.level) {
        end = next.idx - 1;
        break;
      }
    }
    coveredUntil = end;
    found.push({
      id,
      s: h.idx,
      e: end,
      inner: end > h.idx ? [h.idx + 1, end] : null,
      heading: h.text,
    });
  });

  for (let i = 0; i < n; i++) {
    if (fenced[i]) continue;
    const m = CALLOUT.exec(lines[i]);
    if (m === null) continue;
    let j = i;
    while (j + 1 < n && !fenced[j + 1] && lines[j + 1].startsWith('>')) j++;
    found.push({ id: `callout:${m[1].toLowerCase()}`, s: i, e: j, inner: [i, j], heading: null });
    i = j;
  }

  let cursor = { line: 0, col: 0 };
  for (;;) {
    const open = nextToken(lines, fenced, inline, cursor.line, cursor.col, '%%');
    if (open === null) break;
    const close = nextToken(lines, fenced, inline, open.line, open.col + 2, '%%');
    if (close === null) break;
    found.push({ id: 'obsidian-comment', s: open.line, e: close.line, inner: [open.line, close.line], heading: null });
    cursor = { line: close.line, col: close.col + 2 };
  }

  cursor = { line: 0, col: 0 };
  for (;;) {
    const open = nextToken(lines, fenced, inline, cursor.line, cursor.col, '<!--');
    if (open === null) break;
    const close = nextToken(lines, fenced, inline, open.line, open.col + 4, '-->');
    if (close === null) break;
    const opening = lines[open.line].slice(open.col);
    const single = open.line === close.line ? lines[open.line].slice(open.col, close.col + 3).trim() : '';
    const isMaster = single === MASTER_OPEN || single === MASTER_CLOSE;
    const isMetadata = /^<!--\s*yllir\b/.test(opening);
    if (!isMaster && !isMetadata) {
      found.push({ id: 'html-comment', s: open.line, e: close.line, inner: [open.line, close.line], heading: null });
    }
    cursor = { line: close.line, col: close.col + 3 };
  }

  for (const fence of scanFences(lines)) {
    if (!fence.closed) continue;
    const inner = fence.close - 1 >= fence.open + 1 ? [fence.open + 1, fence.close - 1] : null;
    let id = null;
    if (FENCE_CONVENTIONS.has(fence.info)) {
      id = `fence:${fence.info}`;
    } else if (inner !== null) {
      const first = lines.slice(inner[0], inner[1] + 1).find((l) => l.trim() !== '');
      if (first !== undefined && FENCE_MASTER_NOTE_LINE.test(first.trim().toLowerCase())) id = 'fence:master-note';
    }
    if (id === null) continue;
    found.push({ id, s: fence.open, e: fence.close, inner, heading: null });
  }

  return found
    .map((c) => ({
      id: c.id,
      start: firstLine + c.s,
      end: firstLine + c.e,
      inner: c.inner === null ? null : [firstLine + c.inner[0], firstLine + c.inner[1]],
      heading: c.heading,
    }))
    .sort((a, b) => a.start - b.start || compareStrings(a.id, b.id));
}

/**
 * Features of the text: dataview fences, block references and tags. Heading lines hold no tag.
 * @returns {{ id: string, line: number }[]} in line order, then id
 */
export function findFeatures(lines, firstLine) {
  const fenced = codeMask(lines);
  const inline = lines.map(inlineCodeMask);
  const found = [];
  for (const fence of scanFences(lines)) {
    if (fence.info === 'dataview' || fence.info === 'dataviewjs') {
      found.push({ id: 'dataview', line: firstLine + fence.open });
    }
  }
  lines.forEach((line, i) => {
    if (fenced[i]) return;
    const ref = BLOCK_REF.exec(line);
    if (ref !== null && !inline[i][ref.index + ref[0].indexOf('^')]) {
      found.push({ id: 'block-ref', line: firstLine + i });
    }
    if (HEADING.test(line)) return;
    for (const m of line.matchAll(TAG)) {
      if (!inline[i][m.index]) found.push({ id: 'tag', line: firstLine + i });
    }
  });
  return found.sort((a, b) => a.line - b.line || compareStrings(a.id, b.id));
}

/**
 * Resolves a link to one walked path.
 * @param {object} link a link of findLinks
 * @param {string} fromPath campaign-relative path of the file holding the link
 * @param {string[]} allPaths every walked path (Markdown and images)
 * @returns {{ path: string|null, status: string, candidates: string[] }}
 */
export function resolveLink(link, fromPath, allPaths) {
  const known = new Set(allPaths);
  const found = (p) => ({ path: p, status: 'ok', candidates: [] });
  const missing = { path: null, status: 'missing', candidates: [] };

  if (link.form === 'markdown') {
    if (link.target === '') return { path: fromPath, status: 'self', candidates: [] };
    const joined = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), link.target));
    if (known.has(joined)) return found(joined);
    if (path.posix.extname(joined) === '' && known.has(`${joined}.md`)) return found(`${joined}.md`);
    return missing;
  }

  if (link.target === '') return { path: fromPath, status: 'self', candidates: [] };
  const target = link.target;
  if (known.has(target)) return found(target);
  if (known.has(`${target}.md`)) return found(`${target}.md`);

  const segments = target.split('/');
  const name = segments.pop().toLowerCase();
  const wantedNames = new Set([name, `${name}.md`]);
  const folder = segments.map((s) => s.toLowerCase());
  const matches = [...known].filter((p) => {
    const parts = p.split('/');
    const base = parts.pop().toLowerCase();
    if (!wantedNames.has(base)) return false;
    if (folder.length === 0) return true;
    if (folder.length > parts.length) return false;
    const tail = parts.slice(parts.length - folder.length).map((s) => s.toLowerCase());
    return folder.every((f, k) => f === tail[k]);
  }).sort(compareStrings);

  if (matches.length === 0) return missing;
  if (matches.length === 1) return found(matches[0]);
  return { path: null, status: 'ambiguous', candidates: matches };
}
