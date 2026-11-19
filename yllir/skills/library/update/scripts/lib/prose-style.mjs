// Resumable state of the prose pass of prose-style-v1 (run after a framework update).
// It finds, in the documents the framework generated, the abbreviated names (findShortNamesInFiles)
// and the lines that the player hears or reads (read-aloud paragraphs, direct speech). In the documents
// the master wrote (provenance master) it finds only the abbreviated names, after a yes of the master.
// It plans them once, groups the files into chunks of one kind, and keeps the chunks and their status
// in .campaign/state/update/prose-style.json, so an interrupted pass resumes where it stopped.
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
 * @returns {{ status: 'complete'|'pending', masterConfirmation?: 'pending'|'yes'|'no', chunks: object[], pending: number } | { status: 'failed', errors: object[] }}
 */
export function prepareProseStyle(root, { persist = true } = {}) {
  const campaign = path.resolve(root);
  const existing = readState(campaign);
  if (existing !== null) return view(stateOf(existing.chunks, existing.masterConfirmation));

  let planned;
  try {
    planned = planChunks(campaign);
  } catch (err) {
    return { status: 'failed', errors: [{ code: 'prose-style-plan-failed', message: err.message }] };
  }
  if (planned.errors.length > 0) return { status: 'failed', errors: planned.errors };

  const state = stateOf(planned.chunks, planned.masterConfirmation);
  if (persist) writeState(campaign, state);
  return view(state);
}

/**
 * Marks one chunk of the pass as done, recomputes the status and saves the state file.
 * A master chunk is marked done only after the master said yes.
 * @param {string} root campaign folder
 * @param {string} chunkId for example c1
 * @returns {{ status: 'complete'|'pending', masterConfirmation?: 'pending'|'yes'|'no', chunks: object[], pending: number } | { status: 'failed', errors: object[] }}
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
  if (chunk.kind === 'master' && existing.masterConfirmation !== 'yes') {
    return { status: 'failed', errors: [{ code: 'master-not-confirmed', message: `${chunkId} holds the master's documents and the master has not said yes` }] };
  }
  chunk.status = 'done';
  const state = stateOf(existing.chunks, existing.masterConfirmation);
  writeState(campaign, state);
  return view(state);
}

/**
 * Records the master's answer to the question about the names in the documents the master wrote.
 * On no, every master chunk is marked done. On yes, the master chunks stay pending.
 * @param {string} root campaign folder
 * @param {'yes'|'no'} answer
 * @returns {{ status: 'complete'|'pending', masterConfirmation: 'yes'|'no', chunks: object[], pending: number } | { status: 'failed', errors: object[] }}
 */
export function recordMasterAnswer(root, answer) {
  const campaign = path.resolve(root);
  const existing = readState(campaign);
  if (existing === null) {
    return { status: 'failed', errors: [{ code: 'no-prose-style', message: 'the prose pass has not been prepared' }] };
  }
  if (answer !== 'yes' && answer !== 'no') {
    return { status: 'failed', errors: [{ code: 'bad-answer', message: `the answer must be yes or no, not ${String(answer)}` }] };
  }
  if (existing.masterConfirmation === undefined) {
    return { status: 'failed', errors: [{ code: 'no-master-chunks', message: 'the pass has no documents of the master to confirm' }] };
  }
  if (existing.masterConfirmation !== 'pending' && existing.masterConfirmation !== answer) {
    return { status: 'failed', errors: [{ code: 'answer-already-recorded', message: `the master already said ${existing.masterConfirmation}` }] };
  }
  if (answer === 'no') {
    for (const chunk of existing.chunks) {
      if (chunk.kind === 'master') chunk.status = 'done';
    }
  }
  const state = stateOf(existing.chunks, answer);
  writeState(campaign, state);
  return view(state);
}

/**
 * Plans the campaign. Generated documents: the abbreviated names and the spoken lines. Master documents:
 * only the abbreviated names, and only when there are some. Chunks hold one kind of document each,
 * generated chunks first, in chunks of CHUNK_SIZE files.
 */
function planChunks(campaign) {
  const index = buildSubjectIndex(campaign);
  const configErrors = index.errors.filter((error) => error.file === 'campaign.yaml');
  if (configErrors.length > 0) {
    return { errors: configErrors.map((error) => ({ code: 'prose-style-plan-failed', message: error.message, file: error.file })) };
  }

  const generated = new Map();
  const master = new Map();
  for (const file of candidateFiles(campaign)) {
    const text = fs.readFileSync(path.join(campaign, file), 'utf8');
    const kind = documentKind(text);
    if (kind === null) continue;
    const shortNames = findShortNamesInFiles(campaign, index, [file], { readText: () => text });
    const spoken = kind === 'generated' ? spokenLines(text) : [];
    if (shortNames.length === 0 && spoken.length === 0) continue;
    (kind === 'generated' ? generated : master).set(file, { shortNames, spoken });
  }

  const generatedChunks = chunksOf('generated', generated, 1);
  const masterChunks = chunksOf('master', master, generatedChunks.length + 1);
  return {
    errors: [],
    chunks: [...generatedChunks, ...masterChunks],
    masterConfirmation: masterChunks.length > 0 ? 'pending' : undefined,
  };
}

/** Groups the planned files of one kind into chunks of CHUNK_SIZE files, numbered from firstNumber. */
function chunksOf(kind, items, firstNumber) {
  const files = [...items.keys()].sort(compareStrings);
  const chunks = [];
  for (let i = 0; i < files.length; i += CHUNK_SIZE) {
    const chunkFiles = files.slice(i, i + CHUNK_SIZE);
    chunks.push({
      id: `c${firstNumber + chunks.length}`,
      kind,
      files: chunkFiles,
      status: 'pending',
      items: Object.fromEntries(chunkFiles.map((file) => [file, items.get(file)])),
    });
  }
  return chunks;
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

/**
 * The kind of pass a document gets: 'generated' (provenance generated and not marked generated: true),
 * 'master' (provenance master), or null for every other document (played, or no provenance).
 */
function documentKind(text) {
  const { data } = parseFrontmatter(text);
  if (data?.provenance === 'master') return 'master';
  if (data?.provenance === 'generated' && data?.generated !== 'true') return 'generated';
  return null;
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
function stateOf(chunks, masterConfirmation) {
  const status = chunks.every((chunk) => chunk.status === 'done') ? 'complete' : 'pending';
  return masterConfirmation === undefined ? { status, chunks } : { status, masterConfirmation, chunks };
}

/** What the callers get: the status, the master's confirmation when there are master chunks, the chunks and how many are not done. */
function view(state) {
  const pending = state.chunks.filter((chunk) => chunk.status !== 'done').length;
  return state.masterConfirmation === undefined
    ? { status: state.status, chunks: state.chunks, pending }
    : { status: state.status, masterConfirmation: state.masterConfirmation, chunks: state.chunks, pending };
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
