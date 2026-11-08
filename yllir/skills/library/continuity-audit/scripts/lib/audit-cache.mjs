// Cache of the facts extracted from campaign documents, keyed by the hash of the
// document's bytes and the hash of the attribute vocabulary. Extracted facts depend
// only on those two inputs, so an unchanged document is not read again by the
// extractor agents. The cache is derived data: it can be deleted at any time.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_VOCAB = fileURLToPath(new URL('../../audit-vocabulary.yaml', import.meta.url));

/**
 * Looks up the scope documents in the cache and writes the facts files of the hits.
 * A facts file that already exists is never touched (`present`).
 * @param {string} root absolute path to the campaign folder
 * @param {{ scope: { files: Array<{fid: string, document: string}> }, factsDir: string, cacheDir: string, vocabPath?: string }} options
 * @returns {{ hits: string[], misses: string[], present: string[] }}
 */
export function fillFromCache(root, { scope, factsDir, cacheDir, vocabPath = DEFAULT_VOCAB }) {
  const vocabSha = vocabSha16(vocabPath);
  const hits = [];
  const misses = [];
  const present = [];

  for (const { fid, document } of scope.files) {
    const factsFile = path.join(factsDir, `${fid}.json`);
    if (fs.existsSync(factsFile)) {
      present.push(fid);
      continue;
    }

    const docSha = documentSha(path.join(root, document));
    const facts = docSha === null ? null : readEntryFacts(cacheDir, docSha, vocabSha);
    if (facts === null) {
      misses.push(fid);
      continue;
    }

    fs.mkdirSync(factsDir, { recursive: true });
    const factsJson = { fid, document, read: true, facts };
    fs.writeFileSync(factsFile, `${JSON.stringify(factsJson, null, 2)}\n`);
    hits.push(fid);
  }

  return { hits, misses, present };
}

/**
 * Stores the facts of a validated facts result (the output of validateFacts) in the
 * cache, under the current hash of each document. Metadata facts are not stored:
 * validateFacts regenerates them.
 * @param {string} root absolute path to the campaign folder
 * @param {{ factsJson: object, cacheDir: string, vocabPath?: string }} options
 * @returns {{ stored: string[], skipped: Array<{document: string, reason: string}> }}
 */
export function storeToCache(root, { factsJson, cacheDir, vocabPath = DEFAULT_VOCAB }) {
  if (!isPlainObject(factsJson) || !Array.isArray(factsJson.coverage) ||
      !Array.isArray(factsJson.facts) || !Array.isArray(factsJson.discarded)) {
    throw new Error('not a facts result: coverage, facts and discarded must be lists');
  }
  const vocabSha = vocabSha16(vocabPath);
  const discardedFids = new Set(factsJson.discarded.map((entry) => entry.fid));
  const stored = [];
  const skipped = [];

  for (const entry of factsJson.coverage) {
    const { fid, document, status } = entry;
    if (status !== 'extracted' && status !== 'read') {
      skipped.push({ document, reason: 'not-read' });
      continue;
    }
    if (discardedFids.has(fid)) {
      skipped.push({ document, reason: 'has-discards' });
      continue;
    }
    const docSha = documentSha(path.join(root, document));
    if (docSha === null) {
      skipped.push({ document, reason: 'document-missing' });
      continue;
    }

    const facts = factsJson.facts
      .filter((fact) => fact.document === document && fact.from_metadata !== true)
      .map((fact) => ({
        subject: fact.subject,
        attribute: fact.attribute,
        value: fact.value,
        source_type: fact.source_type,
        quote: fact.quote,
        line: fact.line,
      }));

    const cacheEntry = { doc_sha256: docSha, vocab_sha16: vocabSha, facts };
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(entryPath(cacheDir, docSha, vocabSha), `${JSON.stringify(cacheEntry, null, 2)}\n`);
    stored.push(document);
  }

  return { stored, skipped };
}

function entryPath(cacheDir, docSha, vocabSha) {
  return path.join(cacheDir, `${docSha}-${vocabSha}.json`);
}

/** The facts list of the cache entry, or null when there is no usable entry. */
function readEntryFacts(cacheDir, docSha, vocabSha) {
  let entry;
  try {
    entry = JSON.parse(fs.readFileSync(entryPath(cacheDir, docSha, vocabSha), 'utf8'));
  } catch {
    return null;
  }
  if (!isPlainObject(entry) || !Array.isArray(entry.facts)) return null;
  return entry.facts;
}

/** sha256 hex of the document's bytes, or null when the document cannot be read. */
function documentSha(absolute) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
  } catch {
    return null;
  }
}

/** First 16 hex chars of the sha256 of the vocabulary file. Throws when it cannot be read. */
function vocabSha16(vocabPath) {
  return crypto.createHash('sha256').update(fs.readFileSync(vocabPath)).digest('hex').slice(0, 16);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
