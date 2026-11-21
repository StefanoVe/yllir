// Reads and writes the Codex settings of a campaign: the `encyclopedia:` block of
// campaign.yaml (kinds, flavour_text, list). The write edits the file as text, so every
// other line, comment and key stays as it was; it is validated again after the write and
// committed as one saved version. A failed step puts the previous text back.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateConfig } from '../../../../../scripts/lib/config.mjs';
import { saveFilesVersion } from '../../../../../scripts/lib/versions.mjs';
import { codexSettings } from './entries.mjs';

const FILE = 'campaign.yaml';
const KINDS = ['place', 'character', 'creature', 'item', 'faction', 'event'];
const LIST_MODES = ['full', 'discovered'];
const KEYS = ['kinds', 'flavour_text', 'list'];
const HEADER_RE = /^encyclopedia:\s*(#.*)?$/;
const EMPTY_FLOW_RE = /^encyclopedia:\s*\{\s*\}\s*(#.*)?$/;

/** Settings of the Codex as the framework reads them, with the validation errors of campaign.yaml. */
export function readCodexSettings(root) {
  const validated = validateConfig(root);
  return { ...codexSettings(validated.config ?? {}), errors: validated.errors };
}

/**
 * Writes the Codex settings into campaign.yaml and saves them as a version.
 * @param {string} root campaign folder
 * @param {{ kinds: string[], flavourText: boolean, list: string }} input
 * @returns {{ ok: true, settings: object, saved: boolean } | { ok: false, error: string, message: string }}
 */
export function writeCodexSettings(root, input) {
  const problem = checkInput(input);
  if (problem !== null) return { ok: false, error: 'bad-settings', message: problem };

  const file = path.join(root, FILE);
  let before;
  try {
    before = fs.readFileSync(file, 'utf8');
  } catch {
    return { ok: false, error: 'invalid-after-write', message: 'campaign.yaml cannot be read' };
  }
  const lang = validateConfig(root).config?.language?.main === 'it' ? 'it' : 'en';

  replaceFile(file, editEncyclopediaBlock(before, input));
  const after = validateConfig(root);
  const broken = after.errors.find((e) => e.path === 'encyclopedia' || String(e.path ?? '').startsWith('encyclopedia.'));
  if (broken || after.config === null) {
    replaceFile(file, before);
    const first = broken ?? after.errors[0];
    return { ok: false, error: 'invalid-after-write', message: first?.message ?? 'campaign.yaml is not valid after the change' };
  }

  let saved;
  try {
    saved = saveFilesVersion(root, [FILE], {
      message: lang === 'it' ? 'Impostazioni del Codex' : 'Codex settings',
      kind: 'framework',
    });
  } catch (err) {
    replaceFile(file, before);
    return { ok: false, error: 'save-failed', message: err.message };
  }
  return { ok: true, settings: codexSettings(after.config), saved: saved.saved };
}

function checkInput(input) {
  if (!input || typeof input !== 'object') return 'settings must be an object with kinds, flavourText and list';
  const { kinds, flavourText, list } = input;
  if (!Array.isArray(kinds) || kinds.length === 0 || !kinds.every((kind) => KINDS.includes(kind))) {
    return `kinds must be a non-empty list of: ${KINDS.join(', ')}`;
  }
  if (new Set(kinds).size !== kinds.length) return 'kinds must not repeat a value';
  if (typeof flavourText !== 'boolean') return 'flavourText must be true or false';
  if (!LIST_MODES.includes(list)) return 'list must be full or discovered';
  return null;
}

/** Writes text to a temporary file next to the target, then renames it over the target. */
function replaceFile(file, text) {
  const tmp = `${file}.tmp-${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function renderKeys(values, indent) {
  return {
    kinds: `${indent}kinds: [${values.kinds.join(', ')}]`,
    flavour_text: `${indent}flavour_text: ${values.flavourText ? 'true' : 'false'}`,
    list: `${indent}list: ${values.list}`,
  };
}

function isChildKey(line, indent, key) {
  if (!line.startsWith(indent)) return false;
  const rest = line.slice(indent.length);
  if (!rest.startsWith(`${key}:`)) return false;
  const after = rest[key.length + 1];
  return after === undefined || /\s/.test(after);
}

const leadingSpaces = (line) => /^ */.exec(line)[0].length;

/**
 * Returns the campaign.yaml text with the `encyclopedia:` block set to the given values.
 * Lines of the block that are not one of the three keys stay untouched; a missing key is
 * appended after the last line of the block, before its trailing blank lines.
 */
export function editEncyclopediaBlock(text, values) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(eol);
  const idx = lines.findIndex((line) => HEADER_RE.test(line) || EMPTY_FLOW_RE.test(line));

  if (idx < 0) {
    const head = text === '' || text.endsWith(eol) ? text : `${text}${eol}`;
    const keys = renderKeys(values, '  ');
    return `${head}${['encyclopedia:', ...KEYS.map((key) => keys[key])].join(eol)}${eol}`;
  }
  if (EMPTY_FLOW_RE.test(lines[idx])) lines[idx] = 'encyclopedia:';

  const blockStart = idx + 1;
  let end = blockStart;
  while (end < lines.length && (lines[end].trim() === '' || /^\s/.test(lines[end]))) end++;

  const firstKey = lines.slice(blockStart, end).find((line) => line.trim() !== '' && !line.trim().startsWith('#'));
  const indent = firstKey === undefined ? '  ' : /^\s*/.exec(firstKey)[0];
  const rendered = renderKeys(values, indent);

  const block = [];
  const done = new Set();
  for (let i = blockStart; i < end; i++) {
    const key = KEYS.find((k) => isChildKey(lines[i], indent, k));
    if (key === undefined) {
      block.push(lines[i]);
      continue;
    }
    let j = i + 1;
    while (j < end && lines[j].trim() !== '' && leadingSpaces(lines[j]) > indent.length) j++;
    if (!done.has(key)) {
      block.push(rendered[key]);
      done.add(key);
    }
    i = j - 1;
  }

  let at = block.length;
  while (at > 0 && block[at - 1].trim() === '') at--;
  const missing = KEYS.filter((key) => !done.has(key)).map((key) => rendered[key]);
  block.splice(at, 0, ...missing);

  return [...lines.slice(0, blockStart), ...block, ...lines.slice(end)].join(eol);
}
