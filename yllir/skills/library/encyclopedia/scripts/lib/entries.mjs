// Chooses the entries of the public encyclopedia from the campaign sheets.
// An entry is a canonical sheet of a category of type places, subjects, objects
// or free that has a metadata id, is public, and has public text with a public
// title. Everything else is listed in `excluded` with a plain reason. The
// function also collects what must never appear in the output (the reserved
// text, the titles of the hidden subjects and the codes), so the checks can scan
// the generated files for it.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseFrontmatter } from '../../../../../scripts/lib/frontmatter.mjs';
import { MASTER_MARKER, publicBody, isPublicDocument } from '../../../../../scripts/lib/public-text.mjs';
import { listCanonicalSheets, compareStrings } from '../../../../../scripts/lib/subjects.mjs';
import { readRetiredIds } from '../../../../../scripts/lib/engine/retired-ids.mjs';
import { splitLocked, parseCodes, LABEL_RE, MIN_CODE_LENGTH } from './locked.mjs';
import { plainText } from './render.mjs';
import { prepareImage, formatOf, ALLOWED_EXTENSIONS } from './images.mjs';
import { reportText } from './strings.mjs';

export const ENTRY_TYPES = ['places', 'subjects', 'objects', 'free'];
export const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PRIVATE_NAMES = ['giocatori', 'players', 'fonti', 'sources', 'appunti', 'notes'];
const PRIVATE_TYPES = ['sources', 'notes'];
const MIN_RESERVED_LENGTH = 24;

/**
 * Lower-cased, letters and digits only, words separated by single spaces and padded
 * with a space on each side, so that whole-word and whole-phrase matching works on it.
 */
export function matchForm(text) {
  const words = String(text).normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return words === '' ? '' : ` ${words} `;
}

/** Category ids are shown as titles: `luoghi-minori` becomes `Luoghi minori`. */
export function categoryTitle(id) {
  const words = id.split('-').filter(Boolean).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** True when a campaign-relative path is private: a private folder name, or inside a sources or notes category. */
export function privateChecker(structure) {
  const privateFolders = structure
    .filter((c) => PRIVATE_TYPES.includes(c.type) && typeof c.folder === 'string')
    .map((c) => path.posix.normalize(c.folder).replace(/\/+$/, ''));
  return (rel) => {
    const first = rel.split('/')[0].toLowerCase();
    if (PRIVATE_NAMES.includes(first)) return true;
    return privateFolders.some((folder) => rel === folder || rel.startsWith(`${folder}/`));
  };
}

/** The first top-level heading of a Markdown text (outside code fences), as plain text, or null. */
export function firstHeading(markdown) {
  let fence = false;
  for (const line of String(markdown).split('\n')) {
    if (/^ {0,3}(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const match = /^ {0,3}#[ \t]+(.*?)[ \t]*#*[ \t]*$/.exec(line);
    if (match) {
      const title = plainText(match[1]);
      return title === '' ? null : title;
    }
  }
  return null;
}

/** Text after the first master marker, or '' when there is none. */
function masterPart(body) {
  const at = body.indexOf(MASTER_MARKER);
  return at >= 0 ? body.slice(at) : '';
}

const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const LINK_RE = /(?<!!)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/** Relative target of a link or image, resolved to a campaign path, or null (external, absolute, escaping). */
function resolveRelative(fromDir, rawUrl) {
  let url = rawUrl.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//') || url.startsWith('/') || url.startsWith('#')) return null;
  url = url.split('#')[0];
  try {
    url = decodeURIComponent(url);
  } catch {
    return null;
  }
  const joined = path.posix.normalize(path.posix.join(fromDir, url));
  if (joined === '..' || joined.startsWith('../') || joined === '.' || path.posix.isAbsolute(joined)) return null;
  return joined;
}

/**
 * Collects the entries of a campaign.
 * @param {string} root campaign folder
 * @param {object} config validated campaign.yaml (its `config` from validateConfig)
 * @returns {{
 *   entries: object[], excluded: Array<{path:string, reason:string}>, warnings: Array<{code:string, path?:string, message:string}>,
 *   reserved: { lines: string[], titles: string[], codes: Array<{label:string, code:string}>, lockedLines: string[] },
 *   lockedProblems: Array<{code:string, message:string}>, images: Map<string, {bytes: Buffer, ext: string, hash: string}>,
 *   sources: string[], retired: string[], lang: string
 * }}
 */
export function collectEntries(root, config) {
  const lang = config.language?.main ?? 'en';
  const text = reportText(lang);
  const structure = Array.isArray(config.structure) ? config.structure : [];
  const isPrivate = privateChecker(structure);
  const excluded = [];
  const warnings = [];
  const candidates = [];
  const reservedLines = []; // raw lines of reserved text (checked later against the public text)
  const reservedTitles = [];
  const reservedCodes = [];
  const lockedProblems = [];
  const lockedLines = [];
  const publicParts = []; // public text of every included candidate (for the line test)
  const sources = [];
  const images = new Map();
  const seenFolders = new Set();

  const exclude = (rel, reason) => excluded.push({ path: rel, reason });
  const excludeFolder = (folder, reason) => {
    const key = `${folder}|${reason}`;
    if (seenFolders.has(key)) return;
    seenFolders.add(key);
    excluded.push({ path: folder, reason });
  };
  const readSheet = (rel) => {
    try {
      return fs.readFileSync(path.join(root, rel), 'utf8');
    } catch {
      return null;
    }
  };

  // The world seed is reserved as a whole.
  const seed = config.campaign?.seed;
  if (typeof seed === 'string' && seed !== '') {
    const seedText = readSheet(seed);
    if (seedText !== null) {
      reservedLines.push(...seedText.split('\n'));
      const seedTitle = firstHeading(parseFrontmatter(seedText).body);
      if (seedTitle) reservedTitles.push(seedTitle);
    }
    exclude(seed, text.reasonSeed);
  }

  for (const category of structure) {
    if (typeof category.folder !== 'string' || typeof category.type !== 'string') continue;
    const folder = path.posix.normalize(category.folder).replace(/\/+$/, '');

    if (category.type === 'external') {
      excludeFolder(folder, text.reasonExternal);
      continue;
    }
    if (category.type === 'master-only') {
      excludeFolder(folder, text.reasonMasterCategory);
      for (const rel of listCanonicalSheets(root, folder)) {
        const body = readSheet(rel);
        if (body === null) continue;
        reservedLines.push(...body.split('\n'));
        const title = firstHeading(parseFrontmatter(body).body);
        if (title) reservedTitles.push(title);
        for (const [label, code] of parseCodes(body)) reservedCodes.push({ label, code });
      }
      continue;
    }
    if (PRIVATE_TYPES.includes(category.type) || isPrivate(`${folder}/`)) {
      excludeFolder(folder, text.reasonPrivateFolder);
      continue;
    }
    if (!ENTRY_TYPES.includes(category.type)) continue;

    for (const rel of listCanonicalSheets(root, folder)) {
      const raw = readSheet(rel);
      if (raw === null) {
        exclude(rel, text.reasonUnreadable);
        continue;
      }
      processSheet(rel, raw, category, folder);
    }
  }

  function processSheet(rel, raw, category, folder) {
    const { data, body } = parseFrontmatter(raw);
    const master = masterPart(body);
    // Master text of every sheet is reserved, whatever happens to the sheet.
    reservedLines.push(...master.split('\n'));
    for (const [label, code] of parseCodes(master)) reservedCodes.push({ label, code });

    if (!data) {
      exclude(rel, text.reasonNoMetadata);
      return;
    }
    const wholeReserved = () => {
      reservedLines.push(...raw.split('\n'));
      const title = firstHeading(body);
      if (title) reservedTitles.push(title);
    };
    if (!isPublicDocument(rel, config)) {
      wholeReserved();
      exclude(rel, text.reasonMasterCategory);
      return;
    }
    if (data.public === false || data.public === 'false') {
      wholeReserved();
      excludeFolder(folder, text.reasonPublicFalse);
      return;
    }
    if (data.sketch === true || data.sketch === 'true') {
      exclude(rel, text.reasonSketch);
      return;
    }
    if (rel.split('/').some((part) => part === 'drafts' || part === 'bozze' || part.startsWith('.')) || data.draft === true || data.draft === 'true') {
      exclude(rel, text.reasonDraft);
      return;
    }
    if (typeof data.id !== 'string' || data.id === '') {
      exclude(rel, text.reasonNoId);
      return;
    }
    if (!ID_RE.test(data.id)) {
      exclude(rel, text.reasonInvalidId);
      return;
    }

    const publicText = publicBody(raw).trim();
    if (publicText === '') {
      wholeReserved();
      excludeFolder(folder, text.reasonNoPublicText);
      return;
    }
    const title = firstHeading(publicText);
    if (title === null) {
      exclude(rel, text.reasonNoPublicTitle);
      return;
    }
    candidates.push({ rel, id: data.id, title, category, body: publicText, fullBody: body, data });
  }

  // Duplicate ids: neither sheet is published.
  const byId = new Map();
  for (const candidate of candidates) {
    if (!byId.has(candidate.id)) byId.set(candidate.id, []);
    byId.get(candidate.id).push(candidate);
  }
  const kept = [];
  for (const [id, group] of byId) {
    if (group.length > 1) {
      for (const candidate of group) exclude(candidate.rel, text.reasonDuplicateId);
      warnings.push({ code: 'duplicate-id', message: `${text.duplicateIdPath} (${id})` });
      continue;
    }
    kept.push(group[0]);
  }

  const categoryOrder = new Map(structure.map((c, index) => [c.id, index]));
  kept.sort((a, b) =>
    (categoryOrder.get(a.category.id) ?? 0) - (categoryOrder.get(b.category.id) ?? 0) ||
    compareStrings(a.title.toLowerCase(), b.title.toLowerCase()) ||
    compareStrings(a.id, b.id),
  );

  const idByRel = new Map(kept.map((c) => [c.rel, c.id]));
  const retiredResult = readRetiredIds(root);
  const retired = retiredResult.ok ? retiredResult.ids : [];

  const entries = kept.map((candidate) => {
    const { rel, id, title, category, body, fullBody, data } = candidate;
    const dir = path.posix.dirname(rel);
    const { segments, problems } = splitLocked(body);
    const codes = parseCodes(masterPart(fullBody));
    for (const problem of problems) lockedProblems.push({ ...problem, title });
    const lockedInEntry = segments.filter((s) => s.type === 'locked');
    for (const block of lockedInEntry) {
      if (!LABEL_RE.test(block.label)) continue;
      const code = codes.get(block.label);
      if (code === undefined) {
        lockedProblems.push({ code: 'locked-missing', message: block.label, title });
      } else if (code.length < MIN_CODE_LENGTH) {
        lockedProblems.push({ code: 'locked-short', message: block.label, title });
      }
      lockedLines.push(...plainTextLines(block.text));
    }

    // Images: copied only when they are public, supported and clean.
    const imageSrc = new Map();
    const imageUsed = [];
    for (const match of body.matchAll(IMAGE_RE)) {
      const url = match[2];
      const imageRel = resolveRelative(dir, url);
      if (imageRel === null) continue;
      if (imageSrc.has(url)) continue;
      const ext = (imageRel.split('.').pop() ?? '').toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext) || !formatOf(ext)) {
        warnings.push({ code: 'image-skipped', path: rel, message: text.imageUnsupported(imageRel) });
        continue;
      }
      if (isPrivate(imageRel)) {
        warnings.push({ code: 'image-skipped', path: rel, message: text.imagePrivate(imageRel) });
        continue;
      }
      let bytes;
      try {
        bytes = fs.readFileSync(path.join(root, imageRel));
      } catch {
        warnings.push({ code: 'image-skipped', path: rel, message: text.imageMissing(imageRel) });
        continue;
      }
      const prepared = prepareImage(bytes, ext);
      if (!prepared.ok) {
        const why = prepared.reason === 'metadata-not-removable'
          ? lang === 'it' ? 'contiene dati nascosti, esportala di nuovo senza' : 'hidden data inside, export it again without it'
          : lang === 'it' ? 'file non leggibile' : 'file cannot be read';
        warnings.push({ code: 'image-skipped', path: rel, message: text.imageSkipped(imageRel, why) });
        continue;
      }
      const hash = crypto.createHash('sha256').update(prepared.bytes).digest('hex').slice(0, 16);
      images.set(imageRel, { bytes: prepared.bytes, ext, hash });
      imageSrc.set(url, `../../assets/img/${hash}.${ext}`);
      imageUsed.push(imageRel);
    }

    const links = new Set();
    for (const match of body.matchAll(LINK_RE)) {
      const target = resolveRelative(dir, match[2]);
      if (target !== null && idByRel.has(target)) links.add(idByRel.get(target));
    }

    const merged = Array.isArray(data.merged_ids) ? data.merged_ids.filter((x) => typeof x === 'string' && x !== '') : [];
    const plain = segments
      .filter((s) => s.type === 'md')
      .map((s) => plainText(s.text))
      .join('\n')
      .trim();
    publicParts.push(body);
    sources.push(rel, ...imageUsed);

    return {
      id,
      title,
      category: category.id,
      categoryTitle: categoryTitle(category.id),
      sheet: rel,
      segments,
      markdown: body,
      plain,
      images: imageUsed,
      imageSrc,
      codes: Object.fromEntries(codes),
      links: [...links].sort(compareStrings),
      merged: [...new Set(merged)].filter((x) => ID_RE.test(x)).sort(compareStrings),
      linkHref(url) {
        // Relative link from this entry: to another included entry, or plain text.
        const anchor = url.includes('#') ? url.slice(url.indexOf('#')) : '';
        if (/#master\b/i.test(url)) return null;
        const target = resolveRelative(dir, url);
        if (target === null || !idByRel.has(target)) return null;
        const targetId = idByRel.get(target);
        return `../${targetId}/${anchor.replace(/[^#A-Za-z0-9_.~%-]/g, '')}`;
      },
    };
  });

  // The public text is the one that may repeat a reserved line: a line also in public text is not reserved.
  const publicMatch = matchForm(publicParts.join('\n'));
  const reservedKept = [...new Set(reservedLines)].filter((line) => {
    const form = matchForm(line);
    return form.trim().length >= MIN_RESERVED_LENGTH && !publicMatch.includes(form);
  });
  const lockedKept = [...new Set(lockedLines)].filter((line) => matchForm(line).trim().length >= MIN_RESERVED_LENGTH);
  const titleKept = [...new Set(reservedTitles)].filter((title) => matchForm(title).trim().length >= 3);

  return {
    entries,
    excluded: excluded.sort((a, b) => compareStrings(a.path, b.path) || compareStrings(a.reason, b.reason)),
    warnings,
    reserved: {
      lines: reservedKept,
      titles: titleKept,
      codes: uniqueCodes(reservedCodes),
      lockedLines: lockedKept,
    },
    lockedProblems,
    images,
    sources: [...new Set(sources)].sort(compareStrings),
    retired,
    lang,
  };
}

/** Plain lines of a locked text (its Markdown), for the reserved-text check. */
function plainTextLines(markdown) {
  return plainText(markdown)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function uniqueCodes(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = `${item.label}\0${item.code}`;
    if (seen.has(key) || item.code === '') continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

