// Changes the print state (`print:` in the metadata block) of one card. Only that line of
// the sheet changes. The changed sheet is written as a draft and saved through the write
// cycle of the framework (engine `commit`), never by a direct write into the campaign.

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { findMetadataBlock } from '../../../../../scripts/lib/frontmatter.mjs';
import { stripExitLine } from '../../../../../scripts/lib/cli-exit.mjs';
import { ENGINE_SCRIPT, DRAFTS_DIR } from './paths.mjs';
import { PRINT_STATES, collectCards } from './cards.mjs';
import { readCampaignConfig, readPrintSettings } from './settings.mjs';

const execFileAsync = promisify(execFile);
const KEY_LINE = /^([a-z][a-z0-9_]*):/;
// Keys that come before `print` in a card's metadata, in the order the format uses.
const KEYS_BEFORE_PRINT = ['id', 'template', 'location'];

/**
 * Returns the sheet text with its `print:` line set to `state`. The line is replaced in
 * place; when there is none it is added after the last of id, template and location that
 * the block has (or first in the block). Line endings are kept.
 * @param {string} markdown full file content
 * @param {string} state one of PRINT_STATES
 * @returns {{ ok: true, text: string, changed: boolean } | { ok: false, code: string, message: string }}
 */
export function rewritePrintState(markdown, state) {
  const lines = markdown.split('\n');
  const stripped = lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  const block = findMetadataBlock(stripped);
  if (block === null) return { ok: false, code: 'no-metadata', message: 'the sheet has no metadata block' };
  if (block.close === -1) return { ok: false, code: 'metadata-not-closed', message: 'the metadata block is not closed' };

  const cr = (line) => (line.endsWith('\r') ? '\r' : '');
  const printLine = `print: ${state}`;
  const existing = stripped.findIndex((line, i) => i > 0 && i < block.close && /^print:/.test(line));
  if (existing >= 0) {
    if (stripped[existing] === printLine) return { ok: true, text: markdown, changed: false };
    const next = lines.slice();
    next[existing] = `${printLine}${cr(lines[existing])}`;
    return { ok: true, text: next.join('\n'), changed: true };
  }

  let insertAt = 1;
  for (let i = 1; i < block.close; i++) {
    const match = KEY_LINE.exec(stripped[i]);
    if (match && KEYS_BEFORE_PRINT.includes(match[1])) insertAt = i + 1;
  }
  const next = lines.slice();
  next.splice(insertAt, 0, `${printLine}${cr(lines[0])}`);
  return { ok: true, text: next.join('\n'), changed: true };
}

/**
 * Sets the print state of a card and saves it through the write cycle.
 * @param {string} root campaign folder
 * @param {string} id metadata id of the card
 * @param {string} state one of PRINT_STATES
 * @returns {Promise<object>} the engine's result (ok, errors, saved, manualChanges, ...) with
 *   id, state and path added; `unchanged: true` when the card already had that state (nothing saved)
 */
export async function setPrintState(root, id, state) {
  if (!PRINT_STATES.includes(state)) {
    return { ok: false, errors: [{ code: 'bad-state', message: `state must be one of ${PRINT_STATES.join(', ')}` }] };
  }
  const config = readCampaignConfig(root);
  if (!config.ok) return { ok: false, errors: [{ code: 'config', message: config.message }] };
  const settings = readPrintSettings(config.config);
  const { records, errors } = collectCards(root, settings);
  if (errors.length > 0) return { ok: false, errors };
  const matches = records.filter((record) => record.id === id);
  if (matches.length === 0) return { ok: false, errors: [{ code: 'not-found', message: `no card with id ${id}` }] };
  if (matches.length > 1) return { ok: false, errors: [{ code: 'duplicate-id', message: `more than one card has id ${id}` }] };
  const [record] = matches;

  const markdown = fs.readFileSync(path.join(root, record.path), 'utf8');
  const rewritten = rewritePrintState(markdown, state);
  if (!rewritten.ok) return { ok: false, errors: [{ code: rewritten.code, message: rewritten.message }] };
  if (!rewritten.changed) {
    return { ok: true, errors: [], unchanged: true, id, state, path: record.path };
  }

  const draft = path.join(root, DRAFTS_DIR, record.path);
  fs.mkdirSync(path.dirname(draft), { recursive: true });
  fs.writeFileSync(draft, rewritten.text);

  const message = `Print state: ${record.title} -> ${state}`;
  const first = await runEngine(['commit', root, '--files', record.path, '--message', message]);
  const hasCode = (result, code) => (result.errors ?? []).some((error) => error.code === code);
  if (first.ok || !hasCode(first, 'review-missing')) {
    return { ...first, id, state, path: finalPathOf(first, record) };
  }
  // The write cycle wants a model review of this draft before it saves. Check the draft
  // (this writes the check the review must follow), and report what the caller must do.
  const checked = await runEngine(['check', root, '--files', record.path]);
  if (!checked.ok) return { ...checked, id, state, path: record.path };
  return {
    ok: false,
    id,
    state,
    path: record.path,
    reviewRequired: true,
    finalFiles: first.finalFiles ?? [record.path],
    errors: [{
      code: 'review-required',
      message: 'the change needs a model review before it is saved: run the batch reviewer on the draft, save its answer as the review, then set the state again',
    }],
  };
}

/** The path the write cycle saved the sheet at: it may differ from the draft's path (the layout of the framework places sheets). */
function finalPathOf(engine, record) {
  return Array.isArray(engine.finalFiles) && engine.finalFiles.length === 1 ? engine.finalFiles[0] : record.path;
}

/**
 * Runs one engine command and returns its JSON result. A refusal (exit 1) still has JSON.
 * @returns {Promise<object>}
 */
export async function runEngine(args) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(process.execPath, [ENGINE_SCRIPT, ...args], {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120000,
    }));
  } catch (err) {
    stdout = err.stdout ?? '';
    if (stdout.trim() === '') return { ok: false, errors: [{ code: 'engine', message: String(err.message ?? err) }] };
  }
  try {
    return JSON.parse(stripExitLine(stdout));
  } catch {
    return { ok: false, errors: [{ code: 'engine-output', message: 'the write cycle returned no result' }] };
  }
}
