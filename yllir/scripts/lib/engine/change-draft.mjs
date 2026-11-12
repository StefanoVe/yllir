// Prepares the drafts of one whole-subject change as one batch: a rename (new
// title, new file name, every link retargeted, the old title kept as an alias) or
// a deletion (every link turned into its plain text). Every change is decided in
// memory first; drafts are written under .campaign/drafts/ only when the whole
// change is valid. The batch is then checked and saved by checkBatch and
// commitBatch (commit.mjs), as for any other batch. Documents of a chronicle
// category keep their text: only their link targets change. Unlinked mentions are
// not rewritten; they are returned as pending for the agent to judge.

import fs from 'node:fs';
import path from 'node:path';
import { DRAFT_DIR } from './commit.mjs';
import { changePlan } from './change-plan.mjs';
import { buildSubjectIndex, compareStrings } from '../subjects.mjs';
import { findMetadataBlock, parseFrontmatter } from '../frontmatter.mjs';
import { analyzeMarkdown } from '../zones.mjs';
import { foldForm } from '../fold.mjs';

const OPS = new Set(['rename', 'delete']);
const INVALID_FILE_CHARS = /[\/\\:*?"<>|]/g;

/**
 * @param {string} root absolute path to the campaign folder
 * @param {{ op: 'rename'|'delete', subject: string, title?: string }} request
 *   title is required for rename and forbidden for delete.
 * @returns {object} { ok: true, op, subject, files, deletes, pending, errors: [] }, or { ok: false, errors }
 *   with nothing written
 */
export function changeDraft(root, { op, subject, title } = {}) {
  const usage = usageProblem(op, subject, title);
  if (usage !== null) return failure([usage]);

  const plan = changePlan(root, subject);
  if (!plan.ok) return failure(plan.errors);
  const entry = buildSubjectIndex(root).subjects.find((candidate) => candidate.id === subject);
  if (entry?.external) {
    return failure([{ code: 'external-subject', message: `${subject} is an external document and is read-only` }]);
  }

  const decided = op === 'rename' ? decideRename(root, plan, title) : decideDelete(root, plan);
  if (decided.errors.length > 0) return failure(decided.errors);

  const drafts = [...decided.drafts].sort(([a], [b]) => compareStrings(a, b));
  for (const [rel, text] of drafts) writeDraft(root, rel, text);
  return {
    ok: true,
    op,
    subject,
    files: drafts.map(([rel]) => rel),
    deletes: decided.deletes,
    pending: { mentions: plan.mentions, homonyms: plan.homonyms },
    errors: [],
  };
}

function failure(errors) {
  return { ok: false, errors };
}

function usageProblem(op, subject, title) {
  if (!OPS.has(op)) return usage("op must be 'rename' or 'delete'");
  if (typeof subject !== 'string' || subject.trim() === '') return usage('subject is required');
  if (op === 'rename' && typeof title !== 'string') return usage('title is required for rename');
  if (op === 'delete' && title !== undefined) return usage('title is not allowed for delete');
  return null;
}

function usage(message) {
  return { code: 'usage', message };
}

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------

function decideRename(root, plan, rawTitle) {
  const newTitle = rawTitle.trim();
  const fileName = newTitle.replace(INVALID_FILE_CHARS, '').trim();
  if (fileName === '' || /[\r\n]/.test(newTitle)) {
    return failed('bad-title', `"${rawTitle}" is not a usable title (one line, with a file name left after cleaning)`);
  }
  const oldSheet = plan.subject.sheet;
  const oldTitle = plan.subject.title;
  const newSheet = path.posix.join(path.posix.dirname(oldSheet), `${fileName}.md`);
  if (pathExists(root, newSheet)) return failed('path-taken', `${newSheet} already exists`);

  const rewritten = new Map(); // campaign path of the old document -> text with the link edits
  for (const [file, links] of linksByFile(plan.links)) {
    const edit = renameEdit({
      from: file === oldSheet ? newSheet : file,
      newSheet,
      oldTitle,
      newTitle,
      history: links[0].history,
    });
    rewritten.set(file, rewriteLinks(readText(root, file), links, edit));
  }

  const sheetText = rewritten.get(oldSheet) ?? readText(root, oldSheet);
  const retitled = retitleSheet(sheetText, newTitle, oldTitle);
  if (retitled.error) return failed(retitled.error.code, retitled.error.message);

  const drafts = new Map([[newSheet, retitled.text]]);
  for (const [file, text] of rewritten) {
    if (file !== oldSheet) drafts.set(file, text);
  }
  return { errors: [], drafts, deletes: [oldSheet] };
}

/** The link edits of one document in a rename: the target always, the label only when it is the old title. */
function renameEdit({ from, newSheet, oldTitle, newTitle, history }) {
  return (span, lineText) => {
    const edits = [];
    const label = lineText.slice(span.labelStart, span.labelEnd);
    // A target with no path (only an anchor) points at the sheet itself and stays valid.
    if (span.target.split('#')[0] !== '') {
      const start = lineText.indexOf(span.target, span.labelEnd + 2);
      edits.push({ start, end: start + span.target.length, text: retargetedLink(span.target, from, newSheet) });
    }
    if (!history && label.toLowerCase() === oldTitle.toLowerCase()) {
      edits.push({ start: span.labelStart, end: span.labelEnd, text: newTitle });
    }
    return edits;
  };
}

/**
 * The new target of a link: the relative path from the linking document to the
 * new sheet, the anchor kept, and the percent-encoding style of the original.
 * A target is encoded when the original was, and also when the new path has a
 * space or a parenthesis: the link pattern of the framework (geographic-layout.mjs)
 * reads no whitespace or ')' inside a target, so a raw space would hide the link.
 */
function retargetedLink(target, fromFile, newSheet) {
  const hash = target.indexOf('#');
  const anchor = hash === -1 ? '' : target.slice(hash);
  const relative = path.posix.relative(path.posix.dirname(fromFile), newSheet);
  const encoded = /%[0-9A-Fa-f]{2}/.test(target.split('#')[0]) || /[\s)]/.test(relative);
  const shown = relative
    .split('/')
    .map((segment) => (encoded ? encodeURIComponent(segment) : segment))
    .join('/');
  return shown + anchor;
}

/**
 * Replaces the first level-1 heading (the title, as the subject index reads it)
 * with the new title, and adds the old title to the aliases. Everything else is kept.
 */
function retitleSheet(text, newTitle, oldTitle) {
  const { body, bodyStartLine } = parseFrontmatter(text);
  const heading = analyzeMarkdown(body, bodyStartLine).lines.find(
    (line) => line.block === 'heading' && line.level === 1,
  );
  if (heading === undefined) {
    return { error: { code: 'no-title', message: 'the sheet has no level-1 heading to rename' } };
  }
  const rawLines = text.split('\n');
  rawLines[heading.line - 1] = keepLineEnding(rawLines[heading.line - 1], `# ${newTitle}`);
  return addAlias(rawLines.join('\n'), oldTitle);
}

/** Adds `alias` to the aliases of the metadata block, unless one of them already has the same form. */
function addAlias(text, alias) {
  const { data } = parseFrontmatter(text);
  const current = data.aliases;
  if (current !== undefined && !Array.isArray(current)) {
    return { error: { code: 'bad-aliases', message: 'aliases must be a flow list [a, b] to be changed' } };
  }
  if ((current ?? []).some((item) => foldForm(item) === foldForm(alias))) return { text };

  const rawLines = text.split('\n');
  const lines = rawLines.map(stripCr);
  const block = findMetadataBlock(lines);
  const quoted = quoteItem(alias);
  const flowList = /^aliases:[ \t]*\[(.*)\][ \t]*$/;
  for (let i = 1; i < block.close; i++) {
    const match = flowList.exec(lines[i]);
    if (match === null) continue;
    const updated = match[1].trim() === ''
      ? `aliases: [${quoted}]`
      : lines[i].replace(/\][ \t]*$/, `, ${quoted}]`);
    rawLines[i] = keepLineEnding(rawLines[i], updated);
    return { text: rawLines.join('\n') };
  }
  const cr = rawLines[block.close].endsWith('\r') ? '\r' : '';
  rawLines.splice(block.close, 0, `aliases: [${quoted}]${cr}`);
  return { text: rawLines.join('\n') };
}

/** A flow-list item: quoted with single quotes (with '' for a quote) when the plain text would not read back as it is. */
function quoteItem(value) {
  return /^\s|\s$|[,[\]"'#:{}]/.test(value) ? `'${value.replace(/'/g, "''")}'` : value;
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

function decideDelete(root, plan) {
  if (plan.fields.length > 0) {
    const errors = plan.fields.map((field) => ({
      code: 'still-referenced',
      message: `${field.file} still holds the id in its ${field.field} field: change it before deleting`,
    }));
    return { errors, drafts: new Map(), deletes: [] };
  }
  const sheet = plan.subject.sheet;
  const drafts = new Map();
  for (const [file, links] of linksByFile(plan.links)) {
    if (file === sheet) continue; // the sheet itself is deleted
    // A link becomes its plain label text.
    const edit = (span, lineText) => [
      { start: span.start, end: span.end, text: lineText.slice(span.labelStart, span.labelEnd) },
    ];
    drafts.set(file, rewriteLinks(readText(root, file), links, edit));
  }
  return { errors: [], drafts, deletes: [sheet] };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function failed(code, message) {
  return { errors: [{ code, message }], drafts: new Map(), deletes: [] };
}

/** Census links grouped by the document that holds them, in the census order. */
function linksByFile(links) {
  const grouped = new Map();
  for (const link of links) {
    if (!grouped.has(link.file)) grouped.set(link.file, []);
    grouped.get(link.file).push(link);
  }
  return grouped;
}

/**
 * Applies the link edits of one document. `links` are the census entries of the
 * document; `edit(span, lineText)` returns the replacements, as { start, end, text }
 * positions in the line text, for one link span. Only spans that the census lists
 * (same line and same target) are edited; every other byte is kept.
 */
function rewriteLinks(text, links, edit) {
  const { body, bodyStartLine } = parseFrontmatter(text);
  const wanted = new Set(links.map((link) => `${link.line}\0${link.target}`));
  const replacements = new Map(); // line number -> replacements
  for (const line of analyzeMarkdown(body, bodyStartLine).lines) {
    for (const span of line.spans) {
      if (span.kind !== 'link' || !wanted.has(`${line.line}\0${span.target}`)) continue;
      replacements.set(line.line, [...(replacements.get(line.line) ?? []), ...edit(span, line.text)]);
    }
  }
  if (replacements.size === 0) return text;

  const rawLines = text.split('\n');
  for (const [lineNumber, edits] of replacements) {
    let content = stripCr(rawLines[lineNumber - 1]);
    for (const { start, end, text: replacement } of edits.sort((a, b) => b.start - a.start)) {
      content = content.slice(0, start) + replacement + content.slice(end);
    }
    rawLines[lineNumber - 1] = keepLineEnding(rawLines[lineNumber - 1], content);
  }
  return rawLines.join('\n');
}

function stripCr(line) {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/** `content` with the line ending (a \r, for CRLF files) of `original`. */
function keepLineEnding(original, content) {
  return original.endsWith('\r') ? `${content}\r` : content;
}

function pathExists(root, rel) {
  try {
    fs.lstatSync(path.join(root, rel));
    return true;
  } catch {
    return false;
  }
}

function readText(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function writeDraft(root, rel, text) {
  const full = path.join(root, DRAFT_DIR, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}
