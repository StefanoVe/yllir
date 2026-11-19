// Resumable state of the prose pass of prose-style-v1 (run after a framework update).
// It finds, in the documents the framework generated, the abbreviated names (findShortNamesInFiles)
// and the lines that the player hears or reads (read-aloud paragraphs, direct speech). It plans them
// once, groups the files into chunks, and keeps the chunks and their status in
// .campaign/state/update/prose-style.json, so an interrupted pass resumes where it stopped.
// It writes no campaign document: the guided part writes the drafts through the write cycle.
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '../../../../../scripts/lib/frontmatter.mjs';
import { analyzeMarkdown } from '../../../../../scripts/lib/zones.mjs';
import { buildSubjectIndex, compareStrings, listCanonicalSheets, readStructure } from '../../../../../scripts/lib/subjects.mjs';
import { findShortNamesInFiles } from '../../../../../scripts/lib/short-names.mjs';

export const PROSE_STYLE_STATE = '.campaign/state/update/prose-style.json';
const CHUNK_SIZE = 4;
// Categories whose documents are not scanned (same rule as the links pass).
const UNSCANNED_TYPES = new Set(['notes', 'sources', 'external']);
// Block kinds whose lines can hold a read-aloud paragraph or speech.
const SPEECH_BLOCKS = new Set(['paragraph', 'quote', 'list']);

/**
 * Prepares the chunks of the pass. An existing state file is kept as it is (its status is
 * recomputed from its chunks). Otherwise the campaign is planned and, with persist, the state file
 * is written.
 * @param {string} root campaign folder
 * @param {{ persist?: boolean }} [options]
 * @returns {{ status: 'complete'|'pending', chunks: object[], pending: number } | { status: 'failed', errors: object[] }}
 */
export function prepareProseStyle(root, { persist = true } = {}) {
  const campaign = path.resolve(root);
  const existing = readState(campaign);
  if (existing !== null) return view(stateOf(existing.chunks));

  let planned;
  try {
    planned = planChunks(campaign);
  } catch (err) {
    return { status: 'failed', errors: [{ code: 'prose-style-plan-failed', message: err.message }] };
  }
  if (planned.errors.length > 0) return { status: 'failed', errors: planned.errors };

  const state = stateOf(planned.chunks);
  if (persist) writeState(campaign, state);
  return view(state);
}

/**
 * Marks one chunk of the pass as done, recomputes the status and saves the state file.
 * @param {string} root campaign folder
 * @param {string} chunkId for example c1
 * @returns {{ status: 'complete'|'pending', chunks: object[], pending: number } | { status: 'failed', errors: object[] }}
 */
export function markChunkDone(root, chunkId) {
  const campaign = path.resolve(root);
  const existing = readState(campaign);
  if (existing === null) {
    return { status: 'failed', errors: [{ code: 'no-prose-style', message: 'the prose pass has not been prepared' }] };
  }
  const chunk = existing.chunks.find((item) => item.id === chunkId);
  if (chunk === undefined) {
    return { status: 'failed', errors: [{ code: 'unknown-chunk', message: `no chunk ${chunkId} in the prose pass` }] };
  }
  chunk.status = 'done';
  const state = stateOf(existing.chunks);
  writeState(campaign, state);
  return view(state);
}

/** Plans the campaign: the generated documents with a short name or a spoken line, in chunks of CHUNK_SIZE files. */
function planChunks(campaign) {
  const index = buildSubjectIndex(campaign);
  const configErrors = index.errors.filter((error) => error.file === 'campaign.yaml');
  if (configErrors.length > 0) {
    return { errors: configErrors.map((error) => ({ code: 'prose-style-plan-failed', message: error.message, file: error.file })) };
  }

  const items = new Map();
  for (const file of candidateFiles(campaign)) {
    const text = fs.readFileSync(path.join(campaign, file), 'utf8');
    if (!isGeneratedDocument(text)) continue;
    const shortNames = findShortNamesInFiles(campaign, index, [file], { readText: () => text });
    const spoken = spokenLines(text);
    if (shortNames.length === 0 && spoken.length === 0) continue;
    items.set(file, { shortNames, spoken });
  }

  const files = [...items.keys()].sort(compareStrings);
  const chunks = [];
  for (let i = 0; i < files.length; i += CHUNK_SIZE) {
    const chunkFiles = files.slice(i, i + CHUNK_SIZE);
    chunks.push({
      id: `c${chunks.length + 1}`,
      files: chunkFiles,
      status: 'pending',
      items: Object.fromEntries(chunkFiles.map((file) => [file, items.get(file)])),
    });
  }
  return { errors: [], chunks };
}

/** Canonical documents of every category the pass scans, sorted. */
function candidateFiles(campaign) {
  const { structure } = readStructure(campaign);
  const categories = (structure ?? []).filter(
    (category) => typeof category.folder === 'string' && !UNSCANNED_TYPES.has(category.type),
  );
  const files = new Set();
  for (const category of categories) {
    for (const file of listCanonicalSheets(campaign, category.folder)) files.add(file);
  }
  return [...files].sort(compareStrings);
}

/** True when the document is generated by the framework (provenance generated) and not marked generated: true. */
function isGeneratedDocument(text) {
  const { data } = parseFrontmatter(text);
  return data?.provenance === 'generated' && data?.generated !== 'true';
}

/** Line numbers (1-based, in the file) of the public lines that are read aloud or hold direct speech. */
function spokenLines(text) {
  const { body, bodyStartLine } = parseFrontmatter(text);
  const { lines } = analyzeMarkdown(body, bodyStartLine);
  return lines.filter(isSpokenLine).map((line) => line.line);
}

/** A public line of a paragraph, quote or list that is read aloud (an italic paragraph) or has direct speech. */
function isSpokenLine(line) {
  if (line.inMaster || !SPEECH_BLOCKS.has(line.block)) return false;
  const trimmed = line.text.trim();
  if (line.block === 'paragraph' && (line.italic === true || (trimmed.length >= 2 && trimmed.startsWith('_') && trimmed.endsWith('_')))) {
    return true;
  }
  return hasDirectSpeech(trimmed);
}

/** A «, a “, or a pair of straight double quotes. */
function hasDirectSpeech(text) {
  return text.includes('«') || text.includes('“') || text.split('"').length - 1 >= 2;
}

/** The status of a list of chunks: complete when every chunk is done (an empty list is complete). */
function stateOf(chunks) {
  return { status: chunks.every((chunk) => chunk.status === 'done') ? 'complete' : 'pending', chunks };
}

/** What the callers get: the status, the chunks and how many are not done. */
function view(state) {
  return { status: state.status, chunks: state.chunks, pending: state.chunks.filter((chunk) => chunk.status !== 'done').length };
}

/** The saved state, or null when the file is missing or does not parse. */
function readState(campaign) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(campaign, PROSE_STYLE_STATE), 'utf8'));
    return value !== null && typeof value === 'object' && Array.isArray(value.chunks) ? value : null;
  } catch {
    return null;
  }
}

function writeState(campaign, state) {
  const file = path.join(campaign, PROSE_STYLE_STATE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
