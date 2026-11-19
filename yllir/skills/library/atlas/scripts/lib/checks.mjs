// Checks of the players' export, run on the text of the build before it replaces the old folder.
// Each check returns { id, status: 'pass' | 'fail', message }. Pure: the caller reads the files and
// passes their text. The master's export is not checked (the list is empty for it).

import { MASTER_MARKER } from '../../../../../scripts/lib/public-text.mjs';

const MIN_RESERVED_LENGTH = 12;

/**
 * Comparable form of a text: JSON and HTML escapes decoded, lowercase, whitespace collapsed.
 * Used on both sides of the reserved-text check, so an escaped copy of a line still matches it.
 */
export function normalizeText(text) {
  let s = String(text);
  s = s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  s = s.replace(/\\(["\\/])/g, '$1');
  s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * The reserved lines of a master block: the non-empty lines of the text after the first master marker,
 * at least 12 characters long after trimming. The text is the whole sheet body when there is no marker.
 * @param {string} body the body of a campaign document (metadata already removed)
 * @returns {string[]} the lines, as written
 */
export function reservedLinesOf(body) {
  const text = String(body);
  const at = text.indexOf(MASTER_MARKER);
  if (at < 0) return [];
  return text.slice(at + MASTER_MARKER.length)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= MIN_RESERVED_LENGTH);
}

/** Ids of every feature with master visibility, across the layers. */
export function masterIdsOf(layers = {}) {
  const ids = new Set();
  for (const layer of Object.values(layers)) {
    const features = Array.isArray(layer?.features) ? layer.features : [];
    for (const feature of features) {
      if (feature?.visibility === 'master' && typeof feature.id === 'string') ids.add(feature.id);
    }
  }
  return ids;
}

const DATA_RE = /<script type="application\/json" id="atlas-data">([\s\S]*?)<\/script>/;

/**
 * Runs the three players' checks.
 * @param {object} input
 * @param {{ rel: string, text: string }[]} input.outputs the text files of the build (html, json, css, js, svg)
 * @param {Record<string, object>} [input.layers] the atlas layers, used for the master ids when masterIds is omitted
 * @param {string[]} [input.reservedLines] reserved lines (see reservedLinesOf)
 * @param {Iterable<string>} [input.masterIds] ids of the master-visibility features
 * @returns {{ id: string, status: 'pass' | 'fail', message: string }[]}
 */
export function runAtlasChecks({ outputs = [], layers = {}, reservedLines = [], masterIds } = {}) {
  const ids = [...(masterIds ?? masterIdsOf(layers))];
  const results = [];
  const result = (id, leaks, failMessage, passMessage) => results.push({
    id,
    status: leaks.length === 0 ? 'pass' : 'fail',
    message: leaks.length === 0 ? passMessage : failMessage(leaks),
  });

  // 1. No master marker in any output (an escaped one in the data is not a marker).
  const markers = outputs.filter((o) => o.text.includes(MASTER_MARKER) || o.text.includes('<!-- /master'));
  result('no-master-marker', markers, (list) => `master marker found in ${list.map((o) => o.rel).join(', ')}`,
    'no master marker in the output');

  // 2. No reserved line of a master block in any output, compared in normalized form.
  const reserved = reservedLines.map(normalizeText).filter((line) => line !== '');
  const normalized = outputs.map((o) => ({ rel: o.rel, text: normalizeText(o.text) }));
  const leaked = [];
  for (const line of reserved) {
    for (const output of normalized) {
      if (output.text.includes(line)) leaked.push(`${output.rel}: "${line.slice(0, 40)}"`);
    }
  }
  result('no-reserved-text', leaked, (list) => `reserved text found in ${list.join('; ')}`,
    'no reserved text in the output');

  // 3. No master-visibility feature shows: not as data-place, not as a place in the data.
  const shown = [];
  for (const id of ids) {
    if (outputs.some((o) => o.text.includes(`data-place="${id}"`))) shown.push(`data-place="${id}"`);
  }
  for (const output of outputs.filter((o) => o.rel.endsWith('.html'))) {
    const match = DATA_RE.exec(output.text);
    if (!match) continue;
    let data;
    try {
      data = JSON.parse(match[1]);
    } catch {
      shown.push(`unreadable data in ${output.rel}`);
      continue;
    }
    const listed = (Array.isArray(data.places) ? data.places : []).map((p) => p.id);
    for (const id of ids) if (listed.includes(id)) shown.push(`places[] lists ${id}`);
  }
  result('no-master-features', shown, (list) => `master features in the output: ${list.join(', ')}`,
    'no master feature in the output');

  return results;
}
