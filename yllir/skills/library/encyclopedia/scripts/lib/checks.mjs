// Pre-publish checks of the encyclopedia. Each check returns { id, status, message }
// with status pass, fail or skipped. The checks read the generated files, not the
// sources, so a leak that the generator missed is still found. Any fail stops the
// build: nothing replaces the previous good build.

import path from 'node:path';
import { MASTER_MARKER } from '../../../../../scripts/lib/public-text.mjs';
import { matchForm, privateChecker } from './entries.mjs';
import { findMetadata } from './images.mjs';
import { checkText } from './strings.mjs';

const ATTRIBUTE_SECRETS = /\s(data-cipher|data-salt|data-iv)="[^"]*"/g;
const TEXT_EXTENSIONS = ['.html', '.json', '.css', '.js', '.txt'];
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN /,
  /(?<![A-Za-z0-9])(?=[A-Za-z0-9+]*\d)(?=[A-Za-z0-9+]*[A-Za-z])[A-Za-z0-9+]{41,}={0,2}(?![A-Za-z0-9])/,
];
const ENTITY = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" };

/** Text of an output file as it is searched: encrypted attribute values removed, entities decoded. */
export function scannableText(file) {
  if (!TEXT_EXTENSIONS.some((ext) => file.rel.endsWith(ext))) return null;
  return file.bytes
    .toString('utf8')
    .replace(ATTRIBUTE_SECRETS, ' ')
    .replace(/&(amp|lt|gt|quot|#39|#x27);/g, (entity) => ENTITY[entity]);
}

const isImage = (rel) => rel.startsWith('assets/img/');

function extensionOf(rel) {
  return (path.posix.extname(rel).slice(1) || '').toLowerCase();
}

/**
 * Runs every pre-publish check.
 * @param {object} input
 * @param {string} input.lang campaign language (it or en)
 * @param {Array<{rel: string, bytes: Buffer}>} input.outputs every generated file (report.json excluded)
 * @param {object} input.collected result of collectEntries
 * @param {object} input.structure the structure list of campaign.yaml
 * @param {Array<{ok: boolean}>} input.roundtrip results of the unlock self-test, one per locked text
 * @param {{ first: boolean, added: number, removed: number, changed: number }} input.change comparison with the previous build
 * @returns {{ checks: Array<{id: string, status: string, message: string}>, warnings: Array<{code: string, message: string}> }}
 */
export function runChecks({ lang, outputs, collected, structure, roundtrip, change }) {
  const text = checkText(lang);
  const checks = [];
  const add = (id, status, message) => checks.push({ id, status, message });
  const texts = outputs.map((file) => ({ rel: file.rel, text: scannableText(file) })).filter((f) => f.text !== null);
  const everything = texts.map((f) => f.text).join('\n');
  const everythingForm = matchForm(everything);

  // 1. Reserved text: master marker, reserved sentences, hidden titles and codes.
  {
    let leaks = 0;
    if (everything.includes(MASTER_MARKER) || everything.includes('<!-- /master')) leaks += 1;
    for (const line of collected.reserved.lines) {
      if (everythingForm.includes(matchForm(line))) leaks += 1;
    }
    for (const line of collected.reserved.lockedLines) {
      if (everythingForm.includes(matchForm(line))) leaks += 1;
    }
    for (const title of collected.reserved.titles) {
      if (everythingForm.includes(matchForm(title))) leaks += 1;
    }
    for (const { code } of collected.reserved.codes) {
      const form = matchForm(code);
      if (form.trim() === '' ? everything.includes(code) : everythingForm.includes(form)) leaks += 1;
    }
    if (leaks === 0) add('no-reserved-text', 'pass', text['no-reserved-text'].ok);
    else add('no-reserved-text', 'fail', text['no-reserved-text'].fail(leaks));
  }

  // 2. Private folders: no source of an output file is a private folder or a sources/notes category.
  {
    const isPrivate = privateChecker(structure);
    const bad = collected.sources.filter((rel) => isPrivate(rel));
    if (bad.length === 0) add('no-private-folders', 'pass', text['no-private-folders'].ok);
    else add('no-private-folders', 'fail', text['no-private-folders'].fail);
  }

  // 3. Secret shapes in the text of every output file.
  {
    let found = 0;
    for (const file of texts) {
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.test(file.text)) found += 1;
      }
    }
    if (found === 0) add('no-secret-shapes', 'pass', text['no-secret-shapes'].ok);
    else add('no-secret-shapes', 'fail', text['no-secret-shapes'].fail(found));
  }

  // 4. Image metadata of every copied picture.
  {
    let dirty = 0;
    for (const file of outputs.filter((f) => isImage(f.rel))) {
      const ext = extensionOf(file.rel);
      const format = ext === 'png' ? 'png' : ext === 'gif' ? 'gif' : ext === 'webp' ? 'webp' : 'jpeg';
      const found = findMetadata(file.bytes, format);
      if (found === null || found.length > 0) dirty += 1;
    }
    if (dirty === 0) add('no-image-metadata', 'pass', text['no-image-metadata'].ok);
    else add('no-image-metadata', 'fail', text['no-image-metadata'].fail(dirty));
  }

  // 5. No link to a reserved note.
  {
    const bad = texts.filter((f) => /href="[^"]*#master/i.test(f.text)).length;
    if (bad === 0) add('no-master-links', 'pass', text['no-master-links'].ok);
    else add('no-master-links', 'fail', text['no-master-links'].fail);
  }

  // 6. Every locked text has a valid code in its reserved part.
  {
    const problems = collected.lockedProblems;
    if (problems.length === 0) {
      add('locked-codes', 'pass', text['locked-codes'].ok);
    } else {
      const list = problems
        .map((p) => `«${p.title}»: ${lockedDetail(p, lang, text)}`)
        .join('; ');
      add('locked-codes', 'fail', text['locked-codes'].fail(list));
    }
  }

  // 7. Locked texts open with their codes (the self-test of the build).
  {
    const bad = roundtrip.filter((r) => !r.ok).length;
    if (bad === 0) add('locked-roundtrip', 'pass', text['locked-roundtrip'].ok);
    else add('locked-roundtrip', 'fail', text['locked-roundtrip'].fail);
  }

  add('real-player-names', 'skipped', text['real-player-names'].skipped);
  add('no-player-references', 'skipped', text['no-player-references'].skipped);

  // 8. Change summary: informative only, never a failure.
  const warnings = [];
  if (change.first) {
    add('change-summary', 'pass', text['change-summary'].first);
    warnings.push({ code: 'change-summary', message: text['change-summary'].first });
  } else {
    add('change-summary', 'pass', text['change-summary'].ok);
    warnings.push({ code: 'change-summary', message: text['change-summary'].diff(change.added, change.removed, change.changed) });
  }

  return { checks, warnings };
}

function lockedDetail(problem, lang, text) {
  const t = text['locked-codes'];
  if (problem.code === 'locked-missing') return t.missing(problem.message);
  if (problem.code === 'locked-short') return t.short;
  if (problem.code === 'locked-label') return lang === 'it' ? 'nome del blocco protetto non valido o ripetuto' : 'block name invalid or repeated';
  return lang === 'it' ? 'blocco protetto non chiuso' : 'locked block not closed';
}
