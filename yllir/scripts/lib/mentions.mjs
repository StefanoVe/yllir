// Finds mentions of known subjects in the campaign text. Deterministic: it
// reports candidate matches and their state; judging the ambiguous ones is
// left to the agent.

import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from './frontmatter.mjs';
import { analyzeMarkdown } from './zones.mjs';
import { foldText } from './fold.mjs';
import { readStructure, listCanonicalSheets, compareStrings } from './subjects.mjs';

const SKIPPED_BLOCKS = new Set([
  'blank',
  'fence-open',
  'fence-close',
  'master-open',
  'master-close',
]);

const STATES = [
  'bare',
  'linked',
  'linked-elsewhere',
  'ambiguous',
  'self',
  'excluded-title',
  'excluded-italic',
  'excluded-code',
  'excluded-comment',
  'excluded-image',
  'excluded-diagram',
];

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** True when the file frontmatter says generated: true. Unreadable files count as not generated. */
function isGenerated(campaignRoot, file) {
  try {
    return parseFrontmatter(fs.readFileSync(path.join(campaignRoot, file), 'utf8')).data?.generated === 'true';
  } catch {
    return false;
  }
}

/**
 * @param {string} campaignRoot absolute path to the campaign folder
 * @param {{ subjects: object[] }} index result of buildSubjectIndex
 * @param {{ includeNotes?: boolean }} [options] includeNotes also scans the notes folders
 * Files whose frontmatter says generated: true (session main files, rebuilt by the engine) are
 * never scanned: the engine regenerates them, so a link added there would be lost.
 * @returns {{ files: string[], occurrences: object[], summary: Record<string, number> }}
 */
export function scanMentions(campaignRoot, index, { includeNotes = false } = {}) {
  const { structure } = readStructure(campaignRoot);
  const scanned = new Set();
  for (const category of structure ?? []) {
    if (typeof category.folder !== 'string') continue;
    if (category.type === 'sources') continue;
    if (category.type === 'external') continue; // read-only originals: link targets, never scanned
    if (category.type === 'notes' && !includeNotes) continue;
    for (const sheet of listCanonicalSheets(campaignRoot, category.folder)) scanned.add(sheet);
  }
  const files = [...scanned].filter((file) => !isGenerated(campaignRoot, file)).sort(compareStrings);

  const forms = [];
  for (const subject of index.subjects) {
    for (const form of subject.forms) {
      forms.push({ subject, form });
    }
  }

  const occurrences = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(campaignRoot, file), 'utf8');
    const { body, bodyStartLine } = parseFrontmatter(text);
    const { lines } = analyzeMarkdown(body, bodyStartLine);

    for (const line of lines) {
      if (SKIPPED_BLOCKS.has(line.block)) continue;
      const { folded, map } = foldText(line.text);
      const candidates = findCandidates(folded, forms);
      for (const group of keepLongest(candidates)) {
        const occurrence = classifyGroup(group, line, map, file, campaignRoot, index);
        if (occurrence !== null) occurrences.push(occurrence);
      }
    }
  }

  occurrences.sort(
    (a, b) =>
      compareStrings(a.file, b.file) || a.line - b.line || a.col - b.col,
  );

  const summary = Object.fromEntries(STATES.map((state) => [state, 0]));
  for (const occurrence of occurrences) summary[occurrence.state] += 1;

  return { files, occurrences, summary };
}

/** True when the character is a letter or a number (empty string: false). */
function isWordChar(ch) {
  return ch !== '' && WORD_CHAR.test(ch);
}

/** True when folded[start, end) is not glued to a letter or number on either side. */
function isWholeWord(folded, start, end) {
  const before = start > 0 ? folded[start - 1] : '';
  const after = end < folded.length ? folded[end] : '';
  return !isWordChar(before) && !isWordChar(after);
}

/** Every whole-word occurrence of every form in one folded line. */
function findCandidates(folded, forms) {
  const found = [];
  for (const entry of forms) {
    const needle = entry.form.folded;
    let from = 0;
    for (;;) {
      const start = folded.indexOf(needle, from);
      if (start < 0) break;
      const end = start + needle.length;
      if (isWholeWord(folded, start, end)) {
        found.push({ start, end, subject: entry.subject, form: entry.form });
      }
      from = start + 1;
    }
  }
  return found;
}

/**
 * Longest match wins. Candidates with the same range are kept together
 * (a homonym group); any other candidate overlapping a kept range is dropped.
 * @returns {{ start: number, end: number, members: object[] }[]}
 */
function keepLongest(candidates) {
  const sorted = [...candidates].sort(
    (a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start,
  );
  const groups = [];
  for (const candidate of sorted) {
    const same = groups.find((g) => g.start === candidate.start && g.end === candidate.end);
    if (same) {
      same.members.push(candidate);
      continue;
    }
    const overlaps = groups.some(
      (g) => candidate.start < g.end && g.start < candidate.end,
    );
    if (!overlaps) {
      groups.push({ start: candidate.start, end: candidate.end, members: [candidate] });
    }
  }
  return groups;
}

/**
 * Turns one kept group into one occurrence (or null when the match is dropped,
 * i.e. it lies in the target part of a link).
 */
function classifyGroup(group, line, map, file, campaignRoot, index) {
  const colStart = map[group.start];
  const lastOrigin = map[group.end - 1];
  const colEnd = lastOrigin + String.fromCodePoint(line.text.codePointAt(lastOrigin)).length;
  const text = line.text.slice(colStart, colEnd);

  const memberIds = [...new Set(group.members.map((m) => m.subject.id))].sort(compareStrings);
  const isHomonym = memberIds.length > 1;
  const member = group.members[0];

  const base = {
    file,
    line: line.line,
    col: colStart + 1,
    text,
    subject: isHomonym ? null : member.subject.id,
    form: isHomonym ? null : member.form.text,
    ...(isHomonym ? { candidates: memberIds } : {}),
  };
  const finish = (state, extra = {}) => ({
    ...base,
    state,
    ...extra,
    in_master: line.inMaster,
  });

  // Rules 1-4: the block decides. Table lines fall through to the span rules.
  if (line.block === 'heading') return finish('excluded-title');
  if (line.block === 'code') return finish('excluded-code');
  if (line.block === 'mermaid') return finish('excluded-diagram');
  if (line.block === 'comment') return finish('excluded-comment');

  // Rule 6: inline spans.
  const span = line.spans.find((s) => s.start <= colStart && colEnd <= s.end);
  if (span) {
    if (span.kind === 'code') return finish('excluded-code');
    if (span.kind === 'comment') return finish('excluded-comment');
    if (span.kind === 'image') return finish('excluded-image');
    if (span.kind === 'link') {
      const inLabel = span.labelStart <= colStart && colEnd <= span.labelEnd;
      if (!inLabel) return null; // inside the target (or the link syntax): not a mention
      const target = resolveLinkTarget(span.target, file, campaignRoot);
      if (isHomonym) {
        const sameSheet = memberIds.some((id) => {
          const subject = subjectOf(index, id);
          return subject !== null && isSameSheet(target, subject, campaignRoot);
        });
        return sameSheet
          ? finish('linked')
          : finish('linked-elsewhere', { link_target: target });
      }
      return isSameSheet(target, member.subject, campaignRoot)
        ? finish('linked')
        : finish('linked-elsewhere', { link_target: target });
    }
  }

  // Rule 7: narrative italic paragraph.
  if (line.block === 'paragraph' && line.italic) return finish('excluded-italic');

  // Rule 8: the subject's own sheet (single subjects only).
  if (!isHomonym && (member.subject.sheet === file || member.subject.paths?.includes(file))) return finish('self');

  // Rule 9: homonyms.
  if (isHomonym) return finish('ambiguous', { candidates: memberIds });

  // Rule 10: an alias that is also a word inside another subject's form.
  if (member.form.kind === 'alias') {
    const others = otherSubjectsSharing(member.form.folded, member.subject.id, index.subjects);
    if (others.length > 0) {
      const candidates = [member.subject.id, ...others].sort(compareStrings);
      return finish('ambiguous', { candidates });
    }
  }

  // Rule 11.
  return finish('bare');
}

function subjectOf(index, id) {
  return index.subjects.find((s) => s.id === id) ?? null;
}

/**
 * True when a link target reaches the subject's original document. Internal
 * geographic aliases and external ingest symlinks both resolve to that file.
 */
export function isSameSheet(target, subject, campaignRoot) {
  const sheet = subject.sheet;
  if (target === sheet || subject.paths?.includes(target)) return true;
  if (!subject.external) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return false; // external URL
  const real = realpathOrNull(path.join(campaignRoot, target));
  return real !== null && real === realpathOrNull(path.join(campaignRoot, sheet));
}

function realpathOrNull(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

/** Ids of the other subjects with a form that contains `needle` as whole words. */
function otherSubjectsSharing(needle, subjectId, subjects) {
  const ids = new Set();
  for (const subject of subjects) {
    if (subject.id === subjectId) continue;
    for (const form of subject.forms) {
      if (containsWholeWord(form.folded, needle)) {
        ids.add(subject.id);
        break;
      }
    }
  }
  return [...ids].sort(compareStrings);
}

function containsWholeWord(haystack, needle) {
  let from = 0;
  for (;;) {
    const start = haystack.indexOf(needle, from);
    if (start < 0) return false;
    if (isWholeWord(haystack, start, start + needle.length)) return true;
    from = start + 1;
  }
}

/**
 * Resolves a Markdown link target to a path relative to the campaign root
 * (with `/` separators). Anchors are dropped; an empty target means the file
 * itself; external URLs are returned as written.
 */
export function resolveLinkTarget(target, file, campaignRoot) {
  const withoutAnchor = target.split('#')[0];
  let decoded;
  try {
    decoded = decodeURIComponent(withoutAnchor);
  } catch {
    decoded = withoutAnchor;
  }
  if (decoded === '') return file;
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded)) return decoded;
  const absolute = path.resolve(campaignRoot, path.dirname(file), decoded);
  return path.relative(campaignRoot, absolute).split(path.sep).join('/');
}
