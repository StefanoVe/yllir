// Draft of the structured plan (issue #138, spec section 8.2 and 8.5). From the structure report, the
// rules and the overrides written by the agent, it builds the full plan of spec section 4 and a small
// summary. It reads the input Markdown files and campaign.yaml, and writes nothing: the CLI writes.
// Deterministic: the same inputs give the same plan and summary.

import fs from 'node:fs';
import path from 'node:path';
import { compareStrings } from '../../../../scripts/lib/subjects.mjs';
import { slugify, plainHeadingText } from '../../../../scripts/lib/normalize.mjs';
import { parseYamlLite } from '../../../../scripts/lib/yaml-lite.mjs';
import { findLinks, headings, resolveLink } from './vault-parse.mjs';

const ROUTES = ['move', 'plot', 'source', 'skip', 'full'];
const IMAGE_ROLES = new Set(['under-title', 'battlemap', 'atlas', 'none']);
const OVERRIDE_RULE_FIELDS = ['route', 'kind', 'template', 'item_type', 'target'];
const LOCATION_KINDS = new Set(['place', 'character', 'creature', 'item']);
const FORBIDDEN_IN_NAMES = /[/\\:*?"<>|]/g;
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg)$/i;
const DEPENDS_LINE = /^\s*(\*\*\s*)?(dipende da|depends on)/i;
const DEPENDS_SCAN_LINES = 15;
// Required sections of the sheet templates, per language of campaign.yaml, in template order (spec 8.2, 8.5).
const SECTION_NAMES = {
  it: {
    npc: ['Ruolo', 'Aspetto e modi', 'Al tavolo', 'Statistiche'],
    vendor: ['Ruolo', 'Aspetto e modi', 'Al tavolo', 'Statistiche', 'Assortimento'],
    enemy: ['Natura', 'Statistiche'],
    creature: ['Natura', 'Statistiche'],
    item: ['In breve', 'Descrizione', 'Effetti'],
  },
  en: {
    npc: ['Role', 'Appearance and manner', 'At the table', 'Statistics'],
    vendor: ['Role', 'Appearance and manner', 'At the table', 'Statistics', 'Stock'],
    enemy: ['Nature', 'Statistics'],
    creature: ['Nature', 'Statistics'],
    item: ['In brief', 'Description', 'Effects'],
  },
};
// The section that `replace` overrides may touch (spec 8.5).
const STATISTICS_SECTION = { it: 'Statistiche', en: 'Statistics' };

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const filled = (v) => typeof v === 'string' && v.trim() !== '';
const own = (obj, key) => (isObject(obj) && Object.hasOwn(obj, key) ? obj[key] : undefined);
const norm = (text) => text.replace(/\s+/g, ' ').trim().toLowerCase();
const headingText = (text) => plainHeadingText(text).trim();
const cleanName = (text) => text.replace(FORBIDDEN_IN_NAMES, '').trim();
const failure = (errors) => ({ ok: false, errors, plan: null, summary: null });

/** Adds ` 2`, ` 3`... to a name until it is not in the set, then records it. */
function uniqueIn(used, name) {
  let candidate = name;
  let n = 2;
  while (used.has(candidate)) candidate = `${name} ${n++}`;
  used.add(candidate);
  return candidate;
}

function isBlankRange(lines, from, to) {
  for (let n = from; n <= to; n++) {
    if (lines[n - 1].trim() !== '') return false;
  }
  return true;
}

function firstNonBlank(lines, from, to) {
  for (let n = from; n <= to; n++) {
    if (lines[n - 1].trim() !== '') return n;
  }
  return null;
}

/** A part of a generated document. `auto` marks it for the shift step; it is removed before output. */
function newPart(file, from, to, heading) {
  return { file, from, to, heading, shift: 0, auto: true };
}

/** Validates the shape of rules and overrides, without the report. Returns the errors (empty when valid). */
export function validateRules(rules, overrides = {}) {
  const errors = [];
  const bad = (message) => errors.push({ code: 'bad-rules', message });
  const badOv = (message) => errors.push({ code: 'bad-overrides', message });
  if (!isObject(rules)) {
    bad('rules must be an object');
    return errors;
  }
  if (typeof rules.input !== 'string' || !path.isAbsolute(rules.input)) bad('input must be an absolute path');
  if (!filled(rules.masterHeading)) bad('masterHeading must be a text');
  if (!isObject(rules.masterConventions)) {
    bad('masterConventions must be an object');
  } else {
    for (const [id, value] of Object.entries(rules.masterConventions)) {
      if (value !== 'master' && value !== 'public') bad(`masterConventions.${id} must be master or public`);
    }
  }
  if (rules.plotFolder !== undefined && !filled(rules.plotFolder)) bad('plotFolder must be a folder path');
  if (rules.headingAliases !== undefined) {
    if (!isObject(rules.headingAliases)) {
      bad('headingAliases must be an object');
    } else {
      for (const [template, map] of Object.entries(rules.headingAliases)) {
        if (!isObject(map) || Object.values(map).some((v) => typeof v !== 'string')) {
          bad(`headingAliases.${template} must map texts to texts`);
        }
      }
    }
  }
  if (!Array.isArray(rules.folders)) {
    bad('folders must be a list');
  } else {
    rules.folders.forEach((rule, i) => {
      if (!isObject(rule) || typeof rule.path !== 'string') {
        bad(`folders[${i}] needs a path`);
        return;
      }
      const where = `folders[${i}] (${rule.path})`;
      if (!ROUTES.includes(rule.route)) {
        bad(`${where}: unknown route ${JSON.stringify(rule.route)}`);
        return;
      }
      if (rule.route === 'move') {
        if (!filled(rule.kind)) bad(`${where}: a move rule needs kind`);
        if (!filled(rule.target)) bad(`${where}: a move rule needs target`);
      }
      if (rule.route === 'plot' && !filled(rules.plotFolder)) bad(`${where}: a plot rule needs plotFolder`);
      for (const key of ['template', 'item_type']) {
        if (rule[key] !== undefined && typeof rule[key] !== 'string') bad(`${where}: ${key} must be a text`);
      }
    });
  }

  if (!isObject(overrides)) {
    badOv('overrides must be an object');
    return errors;
  }
  if (overrides.files !== undefined) {
    if (!isObject(overrides.files)) {
      badOv('files must be an object');
    } else {
      for (const [file, o] of Object.entries(overrides.files)) {
        if (!isObject(o)) {
          badOv(`${file}: override must be an object`);
          continue;
        }
        if (o.route !== undefined && !ROUTES.includes(o.route)) badOv(`${file}: unknown route`);
        for (const key of ['kind', 'template', 'item_type', 'target']) {
          if (o[key] !== undefined && typeof o[key] !== 'string') badOv(`${file}: ${key} must be a text`);
        }
        if (o.meta !== undefined && !isObject(o.meta)) badOv(`${file}: meta must be an object`);
        if (o.documents !== undefined && !Array.isArray(o.documents)) badOv(`${file}: documents must be a list`);
        if (o.replace !== undefined) {
          if (!Array.isArray(o.replace)) {
            badOv(`${file}: replace must be a list`);
          } else {
            o.replace.forEach((rep, i) => {
              if (!isObject(rep) || !Number.isInteger(rep.from) || !Number.isInteger(rep.to) || rep.from < 1
                || typeof rep.text !== 'string') {
                badOv(`${file}: replace[${i}] needs from, to and text`);
              } else if (rep.from > rep.to) {
                badOv(`${file}: replace[${i}]: from is after to`);
              }
            });
          }
        }
      }
    }
  }
  if (overrides.masterRanges !== undefined) {
    if (!Array.isArray(overrides.masterRanges)) {
      badOv('masterRanges must be a list');
    } else {
      overrides.masterRanges.forEach((range, i) => {
        if (!isObject(range) || typeof range.file !== 'string' || !Number.isInteger(range.from)
          || !Number.isInteger(range.to) || range.from < 1) {
          badOv(`masterRanges[${i}] needs file, from and to`);
        } else if (range.from > range.to) {
          badOv(`masterRanges[${i}]: from is after to`);
        }
      });
    }
  }
  if (overrides.setAside !== undefined
    && (!Array.isArray(overrides.setAside) || overrides.setAside.some((f) => typeof f !== 'string'))) {
    badOv('setAside must be a list of paths');
  }
  if (overrides.images !== undefined) {
    if (!isObject(overrides.images)) {
      badOv('images must be an object');
    } else {
      for (const [image, entry] of Object.entries(overrides.images)) {
        if (!isObject(entry) || !IMAGE_ROLES.has(entry.role)) {
          badOv(`${image}: unknown image role`);
          continue;
        }
        if ((entry.role === 'under-title' || entry.role === 'battlemap') && !filled(entry.document)) {
          badOv(`${image}: ${entry.role} needs document`);
        }
        if (entry.alt !== undefined && typeof entry.alt !== 'string') badOv(`${image}: alt must be a text`);
      }
    }
  }
  return errors;
}

/** The folder rule with the longest matching path (`""` matches every file), or null. */
function folderRuleFor(folders, file) {
  let best = null;
  for (const rule of folders) {
    const prefix = rule.path.replace(/\/+$/, '');
    if ((prefix === '' || file.startsWith(`${prefix}/`)) && (best === null || prefix.length > best.length)) {
      best = { rule, length: prefix.length };
    }
  }
  return best === null ? null : best.rule;
}

/** The campaign language (language.main of campaign.yaml), or null when it cannot be read. */
function readLanguage(campaignRoot) {
  let content;
  try {
    content = fs.readFileSync(path.join(campaignRoot, 'campaign.yaml'), 'utf8');
  } catch {
    return null;
  }
  const { data, errors } = parseYamlLite(content);
  if (errors.length > 0 || !isObject(data) || !isObject(data.language) || typeof data.language.main !== 'string') {
    return null;
  }
  return data.language.main;
}

/** Aliases of a front-matter value (text or list), only non-empty ones. */
function aliasList(value) {
  const list = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  return list.filter((item) => typeof item === 'string' && item.trim() !== '');
}

/**
 * Parts of a move file. Templates with required sections are cut at their `##` headings: the mapped
 * sections go in template order; an unmapped section is attached after the mapped section that
 * precedes it in the input (after the first required section when none does), with its heading line
 * and shift 1. The text before the first `##` goes under the first required heading.
 */
function movePartsOf(file, lines, bodyStart, fileHeadings, sectionNames, aliasMap, statsName, template) {
  const end = lines.length;
  if (sectionNames.length === 0) {
    return {
      parts: bodyStart <= end ? [newPart(file, bodyStart, end, null)] : [],
      sketch: false,
      missingFirst: false,
      missingSection: false,
      statsRange: null,
    };
  }
  const level2 = fileHeadings.filter((h) => h.level === 2);
  const h1 = fileHeadings.find((h) => h.level === 1 && (level2.length === 0 || h.line < level2[0].line));
  const start = h1 ? h1.line + 1 : bodyStart;
  const preambleEnd = level2.length > 0 ? level2[0].line - 1 : end;
  const sections = level2.map((h, i) => ({
    line: h.line,
    to: i + 1 < level2.length ? level2[i + 1].line - 1 : end,
    key: norm(headingText(h.text)),
    mapped: null,
  }));

  // A section maps to a required heading by its own text, else by the template's headingAliases.
  const aliasEntries = Object.entries(aliasMap).map(([from, to]) => [norm(headingText(from)), to]);
  const claimed = new Set();
  for (const section of sections) {
    let target = sectionNames.find((name) => norm(name) === section.key) ?? null;
    if (target === null) {
      const alias = aliasEntries.find(([from]) => from === section.key);
      if (alias !== undefined) target = sectionNames.find((name) => norm(name) === norm(alias[1])) ?? null;
    }
    if (target !== null && !claimed.has(target)) {
      claimed.add(target);
      section.mapped = target;
    }
  }

  const firstName = sectionNames[0];
  const hasPreamble = !isBlankRange(lines, start, preambleEnd);
  const mappedPart = new Map();
  for (const section of sections) {
    if (section.mapped !== null && !isBlankRange(lines, section.line + 1, section.to)) {
      mappedPart.set(section.mapped, newPart(file, section.line + 1, section.to, null));
    }
  }
  // Unmapped sections attach to the nearest mapped section before them in the input.
  const attached = new Map();
  let anchor = firstName;
  for (const section of sections) {
    if (section.mapped !== null) {
      anchor = section.mapped;
      continue;
    }
    const { auto, ...plain } = newPart(file, section.line, section.to, null);
    attached.set(anchor, [...(attached.get(anchor) ?? []), { ...plain, shift: 1 }]);
  }

  const parts = [];
  if (hasPreamble) parts.push(newPart(file, start, preambleEnd, `## ${firstName}`));
  for (const name of sectionNames) {
    const part = mappedPart.get(name);
    if (part !== undefined) {
      // Under the preamble's heading the first section continues without a second heading.
      parts.push({ ...part, heading: hasPreamble && name === firstName ? null : `## ${name}` });
    }
    parts.push(...(attached.get(name) ?? []));
  }

  const present = (name) => (name === firstName && hasPreamble) || mappedPart.has(name);
  const missing = sectionNames.filter((name) => !present(name));
  const noSketch = template === 'item';
  const stats = sections.find((s) => s.mapped !== null && s.mapped === statsName);
  return {
    parts,
    sketch: !noSketch && missing.length > 0,
    missingFirst: missing.includes(firstName),
    missingSection: noSketch && missing.some((name) => name !== firstName),
    statsRange: stats === undefined ? null : [stats.line + 1, stats.to],
  };
}

/**
 * Scene cuts of a plot file. A body with exactly one level-1 heading, first in the body, is the session
 * title: it is skipped and the cut is made at level 2. Else the cut is at level 1, then at level 2.
 */
function scenesOf(file, lines, bodyStart, fileHeadings) {
  const end = lines.length;
  const level1 = fileHeadings.filter((h) => h.level === 1);
  const titled = level1.length === 1 && fileHeadings[0] === level1[0];
  const contentStart = titled ? level1[0].line + 1 : bodyStart;
  let cutLevel = 0;
  if (titled) {
    if (fileHeadings.some((h) => h.level === 2)) cutLevel = 2;
  } else if (level1.length > 0) {
    cutLevel = 1;
  } else if (fileHeadings.some((h) => h.level === 2)) {
    cutLevel = 2;
  }
  if (cutLevel === 0) {
    const whole = contentStart <= end && !isBlankRange(lines, contentStart, end);
    return { noScenes: true, scenes: [{ name: null, parts: whole ? [newPart(file, contentStart, end, null)] : [] }] };
  }
  const cuts = fileHeadings.filter((h) => h.level === cutLevel);
  const scenes = cuts.map((h, i) => {
    const to = i + 1 < cuts.length ? cuts[i + 1].line - 1 : end;
    const parts = [];
    if (i === 0 && !isBlankRange(lines, contentStart, h.line - 1)) {
      parts.push(newPart(file, contentStart, h.line - 1, null));
    }
    if (!isBlankRange(lines, h.line + 1, to)) parts.push(newPart(file, h.line + 1, to, null));
    return { name: headingText(h.text), parts };
  });
  return { noScenes: false, scenes };
}

/** Stub ids of the plot files that a `Dipende da` line of the first lines points to, in order. */
function dependsOf(file, lines, bodyStart, allPaths, stubIdOf) {
  const deps = [];
  const last = Math.min(lines.length, bodyStart + DEPENDS_SCAN_LINES - 1);
  for (let n = bodyStart; n <= last; n++) {
    const line = lines[n - 1];
    if (!DEPENDS_LINE.test(line)) continue;
    for (const link of findLinks([line], n)) {
      const resolved = resolveLink(link, file, allPaths);
      if (resolved.status !== 'ok' || resolved.path === file || !stubIdOf.has(resolved.path)) continue;
      const id = stubIdOf.get(resolved.path);
      if (!deps.includes(id)) deps.push(id);
    }
  }
  return deps;
}

/** Shift of a generated part: 1 when it holds a level-1 heading that is not the dropped title. */
function shiftFor(lines, part, isFirst) {
  const level1 = headings(lines.slice(part.from - 1, part.to), part.from).filter((h) => h.level === 1);
  if (level1.length === 0) return 0;
  let dropped = null;
  if (isFirst && part.master !== true) {
    const first = firstNonBlank(lines, part.from, part.to);
    if (first !== null && level1.some((h) => h.line === first)) dropped = first;
  }
  return level1.some((h) => h.line !== dropped) ? 1 : 0;
}

/** Cuts the parts of a file range out into a master part (public before and after stay). */
function splitForMaster(parts, file, from, to) {
  const out = [];
  for (const part of parts) {
    if (part.file !== file || part.master === true || part.to < from || part.from > to) {
      out.push(part);
      continue;
    }
    if (part.from < from) out.push({ ...part, to: from - 1 });
    out.push({ ...part, from: Math.max(part.from, from), to: Math.min(part.to, to), heading: null, master: true });
    if (part.to > to) out.push({ ...part, from: to + 1, heading: null });
  }
  return out;
}

/**
 * Replaces the lines from..to of a file inside its part by a text part, in place. The text part keeps the
 * part's heading when it starts the part. Returns the parts and whether a part held the lines.
 */
function replaceLines(parts, file, from, to, text) {
  const out = [];
  let hit = false;
  for (const part of parts) {
    if (part.file !== file || part.from > to || part.to < from) {
      out.push(part);
      continue;
    }
    hit = true;
    if (part.from < from) out.push({ ...part, to: from - 1 });
    out.push({ text, heading: part.from < from ? null : part.heading });
    if (part.to > to) out.push({ ...part, from: to + 1, heading: null });
  }
  return { parts: out, hit };
}

/** Relative href from the folder of `fromTarget` to `toTarget`, each segment encoded as the apply does. */
function hrefTo(fromTarget, toTarget) {
  const encode = (text) => encodeURIComponent(text).replace(/\(/g, '%28').replace(/\)/g, '%29');
  return path.posix.relative(path.posix.dirname(fromTarget), toTarget).split('/').map(encode).join('/');
}

/** Removes the given line numbers from the parts of one file (a part left with no line disappears). */
function cutLines(parts, file, lineNumbers) {
  if (lineNumbers.length === 0) return parts;
  const cut = new Set(lineNumbers);
  const out = [];
  for (const part of parts) {
    if (part.file !== file) {
      out.push(part);
      continue;
    }
    let heading = part.heading;
    let run = null;
    const flush = () => {
      if (run !== null) {
        out.push({ ...part, from: run[0], to: run[1], heading });
        heading = null;
        run = null;
      }
    };
    for (let n = part.from; n <= part.to; n++) {
      if (cut.has(n)) {
        flush();
      } else if (run === null) {
        run = [n, n];
      } else {
        run[1] = n;
      }
    }
    flush();
  }
  return out;
}

/** Line numbers in from..to whose whole text is an embed of the image (the line is only that embed). */
function embedLinesOf(lines, file, imagePath, allPaths, from, to) {
  const found = [];
  for (let n = from; n <= to; n++) {
    const line = lines[n - 1];
    if (line === undefined) continue;
    for (const link of findLinks([line], n)) {
      if (link.embed && line.trim() === link.raw && resolveLink(link, file, allPaths).path === imagePath) {
        found.push(n);
      }
    }
  }
  return found;
}

/** Image entries of the embeds of the parts: the first document that embeds an image gives its folder. */
function imagesOf(documents, linesOf, allPaths) {
  const byFile = new Map();
  const usedTargets = new Set();
  for (const doc of documents) {
    for (const part of doc.parts ?? []) {
      if (part.text !== undefined) continue;
      const lines = linesOf(part.file);
      for (const link of findLinks(lines.slice(part.from - 1, part.to), part.from)) {
        if (!link.embed) continue;
        const resolved = resolveLink(link, part.file, allPaths);
        if (resolved.status !== 'ok' || !IMAGE_FILE.test(resolved.path) || byFile.has(resolved.path)) continue;
        const folder = path.posix.dirname(doc.target);
        const name = path.posix.basename(resolved.path).replace(/ /g, '-');
        const ext = path.posix.extname(name);
        const stem = name.slice(0, name.length - ext.length);
        let target = `${folder}/img/${name}`;
        for (let n = 2; usedTargets.has(target); n++) target = `${folder}/img/${stem}-${n}${ext}`;
        usedTargets.add(target);
        byFile.set(resolved.path, target);
      }
    }
  }
  return [...byFile].map(([file, target]) => ({ file, target })).sort((a, b) => compareStrings(a.file, b.file));
}

/**
 * Drafts the plan of the structured convert.
 * @param {{ campaignRoot: string, report: object, rules: object, overrides?: object }} args
 * @returns {{ ok: boolean, errors: object[], plan: object|null, summary: object|null }}
 */
export function draftPlan({ campaignRoot, report, rules, overrides = {} }) {
  const ov = overrides;
  const errors = validateRules(rules, ov);
  if (errors.length > 0) return failure(errors);
  if (path.resolve(rules.input) !== report.input) {
    return failure([{ code: 'bad-rules', message: 'rules.input is not the folder of the report' }]);
  }
  const language = readLanguage(campaignRoot);
  if (language === null) return failure([{ code: 'bad-campaign', message: 'campaign.yaml has no language.main' }]);

  const reportByPath = new Map(report.files.map((f) => [f.path, f]));
  const reportFiles = [...reportByPath.keys()].sort(compareStrings);
  const allPaths = [...reportFiles, ...report.images.map((i) => i.path)].sort(compareStrings);
  const aside = new Set(ov.setAside ?? []);
  for (const file of Object.keys(ov.files ?? {})) {
    if (!reportByPath.has(file)) errors.push({ code: 'bad-overrides', message: `${file}: not in the report` });
  }
  for (const range of ov.masterRanges ?? []) {
    if (!reportByPath.has(range.file)) {
      errors.push({ code: 'bad-overrides', message: `masterRanges: ${range.file} is not in the report` });
    }
  }
  for (const file of aside) {
    if (!reportByPath.has(file)) errors.push({ code: 'bad-overrides', message: `setAside: ${file} is not in the report` });
  }

  const plotFolder = filled(rules.plotFolder) ? rules.plotFolder.replace(/\/+$/, '') : null;
  const effective = new Map();
  for (const file of reportFiles) {
    const base = folderRuleFor(rules.folders ?? [], file);
    const picked = {};
    for (const key of OVERRIDE_RULE_FIELDS) {
      const value = own(ov.files?.[file], key);
      if (value !== undefined) picked[key] = value;
    }
    const rule = { ...(base ?? {}), ...picked };
    effective.set(file, { rule, route: rule.route ?? 'full', unrouted: rule.route === undefined });
    if (rule.route === 'move' && (!filled(rule.kind) || !filled(rule.target))) {
      errors.push({ code: 'bad-overrides', message: `${file}: a move document needs kind and target` });
    }
    if (rule.route === 'plot' && plotFolder === null) {
      errors.push({ code: 'bad-rules', message: `${file}: a plot file needs plotFolder` });
    }
  }
  const replaced = new Set(reportFiles.filter((f) => Array.isArray(own(ov.files?.[f], 'documents'))));
  for (const file of replaced) {
    const route = effective.get(file).route;
    if (route !== 'move' && route !== 'plot') {
      errors.push({ code: 'bad-overrides', message: `${file}: documents need a move or plot route` });
    }
  }
  for (const [image, entry] of Object.entries(ov.images ?? {})) {
    if (!report.images.some((i) => i.path === image)) {
      errors.push({ code: 'bad-overrides', message: `images: ${image} is not an image of the report` });
    }
    if ((entry.role === 'under-title' || entry.role === 'battlemap')
      && (effective.get(entry.document)?.route !== 'move' || replaced.has(entry.document))) {
      errors.push({ code: 'bad-overrides', message: `${image}: document ${entry.document} is not a move file` });
    }
  }
  if (errors.length > 0) return failure(errors);

  const lineCache = new Map();
  const linesOf = (file) => {
    if (!reportByPath.has(file)) return [];
    if (!lineCache.has(file)) {
      const content = fs.readFileSync(path.join(report.input, file), 'utf8');
      const lines = content.split(/\r?\n/);
      if (lines.at(-1) === '') lines.pop();
      lineCache.set(file, lines);
    }
    return lineCache.get(file);
  };

  const exceptions = new Map();
  const addException = (file, reason) => exceptions.set(`${file}\u0000${reason}`, { file, reason });
  for (const file of reportFiles) {
    if (effective.get(file).unrouted) addException(file, 'unrouted');
  }
  for (const link of report.links.ambiguous) addException(link.file, 'ambiguous-link');

  const usedIds = new Set();
  const allocId = (base) => {
    const root = slugify(base) || 'doc';
    let id = root;
    for (let n = 2; usedIds.has(id); n++) id = `${root}-${n}`;
    usedIds.add(id);
    return id;
  };
  const entries = new Map(); // input file -> [{ origin, file, doc }]
  const statsRanges = new Map(); // move file -> [from, to] of its statistics section, or null

  // Move documents: title, file name, homonyms (two rounds), ids.
  const moves = reportFiles
    .filter((f) => !replaced.has(f) && effective.get(f).route === 'move')
    .map((file) => {
      const info = reportByPath.get(file);
      const rule = effective.get(file).rule;
      const h1 = info.headings.find((h) => h.level === 1);
      const base = path.posix.basename(file, '.md');
      const title = (h1 ? headingText(h1.text) : '') || base;
      const dir = path.posix.dirname(file);
      return {
        file,
        rule,
        title,
        name: cleanName(title) || cleanName(base) || 'Documento',
        parent: dir === '.' ? '' : path.posix.basename(dir),
        homonym: false,
      };
    });
  const targetOf = (m) => `${m.rule.target.replace(/\/+$/, '')}/${m.name}.md`;
  const collisions = (list) => {
    const byTarget = new Map();
    for (const m of list) {
      const key = targetOf(m);
      if (!byTarget.has(key)) byTarget.set(key, []);
      byTarget.get(key).push(m);
    }
    return [...byTarget.values()].filter((group) => group.length > 1);
  };
  for (const group of collisions(moves)) {
    for (const m of group) {
      m.homonym = true;
      if (m.parent !== '') m.name = `${m.name} (${m.parent})`;
    }
  }
  for (const group of collisions(moves)) {
    group.forEach((m, i) => {
      m.homonym = true;
      if (i > 0) m.name = `${m.name} ${i + 1}`;
    });
  }
  for (const m of moves) {
    const info = reportByPath.get(m.file);
    const meta = { id: allocId(m.name), kind: m.rule.kind };
    if (m.rule.template !== undefined) meta.template = m.rule.template;
    if (m.rule.item_type !== undefined) meta.item_type = m.rule.item_type;
    meta.provenance = 'master';
    if (LOCATION_KINDS.has(m.rule.kind)) meta.location = [];
    const aliases = aliasList(info.frontmatter.aliases);
    if (aliases.length > 0) meta.aliases = aliases;
    const sectionNames = own(SECTION_NAMES[language], m.rule.template ?? '') ?? [];
    const aliasMap = own(rules.headingAliases, m.rule.template ?? '') ?? {};
    const generated = movePartsOf(
      m.file, linesOf(m.file), info.bodyStart, info.headings, sectionNames, aliasMap,
      STATISTICS_SECTION[language], m.rule.template,
    );
    if (generated.sketch) meta.sketch = true;
    if (generated.missingFirst) addException(m.file, 'missing-first-section');
    if (generated.missingSection) addException(m.file, 'missing-section');
    if (m.homonym) addException(m.file, 'homonym');
    if (info.hints.includes('multi-subject')) addException(m.file, 'multi-subject');
    if (info.hints.includes('long')) addException(m.file, 'long');
    statsRanges.set(m.file, generated.statsRange);
    entries.set(m.file, [{
      origin: 'move',
      file: m.file,
      doc: { target: targetOf(m), title: m.name, meta, parts: generated.parts },
    }]);
  }

  // Plot: one stub per session file first (ids and depends_on need them), then the scenes.
  const sessionNames = new Set();
  const sessions = reportFiles
    .filter((f) => !replaced.has(f) && effective.get(f).route === 'plot')
    .map((file) => {
      const name = uniqueIn(sessionNames, cleanName(path.posix.basename(file, '.md')) || 'Sessione');
      return { file, name, stubId: allocId(name) };
    });
  const stubIdOf = new Map(sessions.map((s) => [s.file, s.stubId]));
  for (const s of sessions) {
    const info = reportByPath.get(s.file);
    const lines = linesOf(s.file);
    const stub = {
      target: `${plotFolder}/${s.name}/${s.name}.md`,
      title: null,
      meta: {
        id: s.stubId,
        depends_on: dependsOf(s.file, lines, info.bodyStart, allPaths, stubIdOf),
        provenance: 'master',
      },
      parts: [],
    };
    const cut = scenesOf(s.file, lines, info.bodyStart, info.headings);
    if (cut.noScenes) addException(s.file, 'no-scenes');
    const sceneNames = new Set();
    let previousId = null;
    const scenes = cut.scenes.map((scene, i) => {
      const name = uniqueIn(sceneNames, cleanName(scene.name ?? s.name) || `Scena ${i + 1}`);
      const id = allocId(`${s.name}-${name}`);
      const meta = {
        id,
        session: s.stubId,
        depends_on: previousId === null ? [] : [previousId],
        provenance: 'master',
      };
      previousId = id;
      return {
        origin: 'scene',
        file: s.file,
        doc: { target: `${plotFolder}/${s.name}/Eventi/${name}.md`, title: null, meta, parts: scene.parts },
      };
    });
    entries.set(s.file, [{ origin: 'stub', file: s.file, doc: stub }, ...scenes]);
  }

  // Overrides: documents replace the generated ones of a file (copies, so the input is not changed).
  for (const file of replaced) {
    const route = effective.get(file).route;
    const documents = JSON.parse(JSON.stringify(ov.files[file].documents));
    entries.set(file, documents.map((doc) => {
      let origin = 'other';
      if (route === 'move') origin = 'move';
      else if (route === 'plot') origin = doc.meta?.session !== undefined ? 'scene' : 'stub';
      return { origin, file, doc };
    }));
  }
  // Overrides of meta are merged into the documents of their file (not into replaced documents).
  for (const file of reportFiles) {
    const meta = own(ov.files?.[file], 'meta');
    if (meta === undefined || replaced.has(file)) continue;
    for (const e of entries.get(file) ?? []) e.doc.meta = { ...e.doc.meta, ...meta };
  }

  // Overrides of replace: only lines of the statistics section, each becomes a text part in place.
  for (const file of reportFiles) {
    const reps = own(ov.files?.[file], 'replace');
    if (reps === undefined) continue;
    if (replaced.has(file)) {
      errors.push({ code: 'bad-overrides', message: `${file}: replace cannot be combined with documents` });
      continue;
    }
    const range = statsRanges.get(file) ?? null;
    const sorted = [...reps].sort((a, b) => a.from - b.from);
    sorted.forEach((rep, i) => {
      if (range === null) {
        errors.push({ code: 'bad-overrides', message: `${file}: replace outside a statistics section` });
      } else if (rep.from < range[0] || rep.to > range[1]) {
        errors.push({
          code: 'bad-overrides',
          message: `${file}: replace ${rep.from}-${rep.to} is outside the statistics section (${range[0]}-${range[1]})`,
        });
      } else if (i > 0 && rep.from <= sorted[i - 1].to) {
        errors.push({ code: 'bad-overrides', message: `${file}: replace ranges overlap at line ${rep.from}` });
      }
    });
  }
  if (errors.length > 0) return failure(errors);
  for (const file of reportFiles) {
    const reps = own(ov.files?.[file], 'replace');
    if (reps === undefined) continue;
    const sorted = [...reps].sort((a, b) => a.from - b.from);
    for (const rep of sorted) {
      for (const e of entries.get(file) ?? []) {
        const result = replaceLines(e.doc.parts ?? [], file, rep.from, rep.to, rep.text);
        if (!result.hit) {
          errors.push({ code: 'bad-overrides', message: `${file}: replace ${rep.from}-${rep.to} holds no text` });
        }
        e.doc.parts = result.parts;
      }
    }
  }
  if (errors.length > 0) return failure(errors);

  let all = reportFiles.flatMap((f) => entries.get(f) ?? []);
  for (const range of ov.masterRanges ?? []) {
    for (const e of all) e.doc.parts = splitForMaster(e.doc.parts ?? [], range.file, range.from, range.to);
  }

  // Set aside: the documents go, their ids leave the depends_on lists.
  const asideIds = new Set();
  for (const e of all) {
    if (aside.has(e.file) && e.doc.meta?.id !== undefined) asideIds.add(e.doc.meta.id);
  }
  all = all.filter((e) => !aside.has(e.file));
  for (const e of all) {
    if (Array.isArray(e.doc.meta?.depends_on)) {
      e.doc.meta.depends_on = e.doc.meta.depends_on.filter((id) => !asideIds.has(id));
    }
    e.doc.parts = (e.doc.parts ?? []).map((part, k) => {
      if (part.auto !== true) return part;
      const { auto, ...rest } = part;
      return { ...rest, shift: shiftFor(linesOf(part.file), part, k === 0) };
    });
  }

  // Routes: every file that is not a document source. Files with no document and no route are unrouted.
  const routes = { source: [], skip: [], full: [], atlas: [] };
  for (const file of reportFiles) {
    const route = aside.has(file) ? 'source' : effective.get(file).route;
    if (route === 'move' || route === 'plot') continue;
    routes[route].push(file);
  }
  const partFiles = new Set(all.flatMap((e) => (e.doc.parts ?? []).filter((p) => p.file !== undefined).map((p) => p.file)));
  const routed = new Set([...routes.source, ...routes.skip, ...routes.full]);
  for (const file of reportFiles) {
    if (!routed.has(file) && !partFiles.has(file)) addException(file, 'unrouted');
  }
  for (const key of Object.keys(routes)) routes[key].sort(compareStrings);

  const documents = all.map((e) => e.doc);
  let images = imagesOf(documents, linesOf, allPaths);
  // Image roles (spec 8.6): the default copies of 8.2 change only for the images that have an entry.
  const imageRoles = ov.images ?? {};
  const usedTargets = new Set(images.map((i) => i.target));
  for (const image of Object.keys(imageRoles).sort(compareStrings)) {
    const entry = imageRoles[image];
    const existing = images.find((i) => i.file === image);
    images = images.filter((i) => i.file !== image);
    if (entry.role === 'none') continue;
    if (entry.role === 'atlas') {
      routes.atlas.push(image);
      continue;
    }
    const owner = all.find((e) => e.origin === 'move' && e.file === entry.document);
    if (owner === undefined) {
      errors.push({ code: 'bad-overrides', message: `${image}: document ${entry.document} is not a move document of the plan` });
      continue;
    }
    const doc = owner.doc;
    let target = existing?.target;
    if (target === undefined) {
      const name = path.posix.basename(image).replace(/ /g, '-');
      const folder = path.posix.dirname(doc.target);
      const ext = path.posix.extname(name);
      const stem = name.slice(0, name.length - ext.length);
      target = `${folder}/img/${name}`;
      for (let n = 2; usedTargets.has(target); n++) target = `${folder}/img/${stem}-${n}${ext}`;
    }
    usedTargets.add(target);
    const alt = entry.alt ?? '';
    if (entry.role === 'under-title') {
      doc.image = { file: image, target, alt };
      // The embed is left out only when it is the first non-blank line after the H1.
      const info = reportByPath.get(entry.document);
      const lines = linesOf(entry.document);
      const h1 = info.headings.find((h) => h.level === 1);
      const first = firstNonBlank(lines, h1 ? h1.line + 1 : info.bodyStart, lines.length);
      if (first !== null) {
        doc.parts = cutLines(doc.parts ?? [], entry.document, embedLinesOf(lines, entry.document, image, allPaths, first, first));
      }
    } else {
      images.push({ file: image, target });
      let parts = doc.parts ?? [];
      for (const file of new Set(parts.filter((p) => p.file !== undefined).map((p) => p.file))) {
        const lines = linesOf(file);
        const found = parts.filter((p) => p.file === file)
          .flatMap((p) => embedLinesOf(lines, file, image, allPaths, p.from, p.to));
        parts = cutLines(parts, file, found);
      }
      const heading = language === 'en' ? '## Map' : '## Mappa';
      doc.parts = [...parts, { text: `${heading}\n\n![${alt}](${hrefTo(doc.target, target)})`, heading: null }];
    }
  }
  if (errors.length > 0) return failure(errors);
  images.sort((a, b) => compareStrings(a.file, b.file));
  routes.atlas.sort(compareStrings);

  const count = (origin) => all.filter((e) => e.origin === origin).length;
  const kinds = new Map();
  for (const doc of documents) {
    if (typeof doc.meta?.kind === 'string') kinds.set(doc.meta.kind, (kinds.get(doc.meta.kind) ?? 0) + 1);
  }
  const summary = {
    counts: {
      move: count('move'),
      plot: count('stub'),
      scenes: count('scene'),
      source: routes.source.length,
      skip: routes.skip.length,
      full: routes.full.length,
      images: images.length,
      atlas: routes.atlas.length,
    },
    kinds: Object.fromEntries([...kinds].sort((a, b) => compareStrings(a[0], b[0]))),
    sketches: documents.filter((d) => d.meta?.sketch === true).length,
    exceptions: [...exceptions.values()].sort((a, b) => compareStrings(a.file, b.file) || compareStrings(a.reason, b.reason)),
  };

  const plan = {
    input: rules.input,
    masterHeading: rules.masterHeading,
    masterConventions: Object.fromEntries(
      Object.entries(rules.masterConventions).sort((a, b) => compareStrings(a[0], b[0])),
    ),
    documents,
    images,
    routes,
  };
  return { ok: true, errors: [], plan, summary };
}
