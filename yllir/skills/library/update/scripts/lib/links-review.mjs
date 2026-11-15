// Resumable state of the link pass of links-review-v1 (run after a framework update).
// The engine's links command reviews the mentions it did not link. This module plans them once,
// groups the files that have a proposal into chunks of files, and keeps the chunks and their status in
// .campaign/state/update/links-review.json, so an interrupted pass resumes where it stopped.
// It writes no campaign document: the guided part writes the links through the engine.
import fs from 'node:fs';
import path from 'node:path';
import { planLinks } from '../../../../../scripts/lib/links/link-plan.mjs';
import { compareStrings, readStructure } from '../../../../../scripts/lib/subjects.mjs';
import { isGenerated } from '../../../../../scripts/lib/mentions.mjs';

export const LINKS_REVIEW_STATE = '.campaign/state/update/links-review.json';
const CHUNK_SIZE = 6;
// Categories whose documents are never scanned for mentions (same rule as the engine's links command).
const UNSCANNED_TYPES = new Set(['notes', 'sources', 'external']);

/**
 * Prepares the chunks of the pass. An existing state file is kept as it is (its status is
 * recomputed from its chunks). Otherwise the whole campaign is planned and, with persist, the
 * state file is written.
 * @param {string} root campaign folder
 * @param {{ persist?: boolean }} [options]
 * @returns {{ status: 'complete'|'pending', chunks: object[], pending: number } | { status: 'failed', errors: object[] }}
 */
export function prepareLinksReview(root, { persist = true } = {}) {
  const campaign = path.resolve(root);
  const existing = readState(campaign);
  if (existing !== null) return view(stateOf(existing.chunks));

  let planned;
  try {
    planned = planChunks(campaign);
  } catch (err) {
    return { status: 'failed', errors: [{ code: 'links-plan-failed', message: err.message }] };
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
    return { status: 'failed', errors: [{ code: 'no-links-review', message: 'the links review has not been prepared' }] };
  }
  const chunk = existing.chunks.find((item) => item.id === chunkId);
  if (chunk === undefined) {
    return { status: 'failed', errors: [{ code: 'unknown-chunk', message: `no chunk ${chunkId} in the links review` }] };
  }
  chunk.status = 'done';
  const state = stateOf(existing.chunks);
  writeState(campaign, state);
  return view(state);
}

/** Plans the campaign and groups the files that have a proposal into chunks of CHUNK_SIZE files. */
function planChunks(campaign) {
  const plan = planLinks(campaign, { files: null, subjects: null });
  if (plan.errors.length > 0) {
    return { errors: plan.errors.map((err) => ({ code: 'links-plan-error', message: err.message ?? 'the link plan has an error', file: err.file })) };
  }
  const linkable = new Set(linkableFiles(campaign, plan.proposals.map((proposal) => proposal.file)));
  const files = [...new Set(plan.proposals.map((proposal) => proposal.file).filter((file) => linkable.has(file)))].sort(compareStrings);
  const chunks = [];
  for (let i = 0; i < files.length; i += CHUNK_SIZE) {
    chunks.push({ id: `c${chunks.length + 1}`, files: files.slice(i, i + CHUNK_SIZE), status: 'pending' });
  }
  return { errors: [], chunks };
}

/** Files the linker scans: inside a scanned category and not generated. Same rule as the engine's links command. */
function linkableFiles(campaign, files) {
  const structure = readStructure(campaign).structure ?? [];
  const folders = structure
    .filter((category) => typeof category.folder === 'string' && !UNSCANNED_TYPES.has(category.type))
    .map((category) => path.posix.normalize(category.folder).replace(/\/+$/, ''));
  return files.filter(
    (file) => folders.some((folder) => file === folder || file.startsWith(`${folder}/`)) && !isGenerated(campaign, file),
  );
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
    const value = JSON.parse(fs.readFileSync(path.join(campaign, LINKS_REVIEW_STATE), 'utf8'));
    return value !== null && typeof value === 'object' && Array.isArray(value.chunks) ? value : null;
  } catch {
    return null;
  }
}

function writeState(campaign, state) {
  const file = path.join(campaign, LINKS_REVIEW_STATE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
