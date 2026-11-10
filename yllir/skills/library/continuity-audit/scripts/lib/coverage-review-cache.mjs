import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Hashes every input visible to the coverage reviewer. */
export function coverageReviewKey({ root, factsFile, scopeFile, vocabularyFile, instructionsFile }) {
  const scope = JSON.parse(fs.readFileSync(scopeFile, 'utf8'));
  const hash = crypto.createHash('sha256');
  const add = (name, bytes) => {
    hash.update(name).update('\0').update(bytes).update('\0');
  };
  add('facts', fs.readFileSync(factsFile));
  add('vocabulary', fs.readFileSync(vocabularyFile));
  add('reviewer-instructions', fs.readFileSync(instructionsFile));
  for (const entry of [...(scope.files ?? [])].sort((a, b) => a.document.localeCompare(b.document))) {
    add(`document:${entry.document}`, fs.readFileSync(path.join(root, entry.document)));
  }
  return hash.digest('hex');
}

export function reusableCoverageReview({ facts, review }) {
  return facts?.complete === true && facts.coverage?.every((entry) => entry.status === 'read' || entry.status === 'extracted') &&
    facts.discarded?.length === 0 && review?.verdict === 'CONFIRMED' && Array.isArray(review.missed) && review.missed.length === 0;
}

export function readCoverageReviewCache(cacheDir, key) {
  try {
    const entry = JSON.parse(fs.readFileSync(path.join(cacheDir, `${key}.json`), 'utf8'));
    return entry.key === key && reusableCoverageReview({ facts: entry.certificate, review: entry.review }) ? entry.review : null;
  } catch {
    return null;
  }
}

export function storeCoverageReviewCache({ cacheDir, key, facts, review, expectedKey = key }) {
  if (key !== expectedKey) return false;
  if (!reusableCoverageReview({ facts, review })) return false;
  fs.mkdirSync(cacheDir, { recursive: true });
  const certificate = { complete: facts.complete, coverage: facts.coverage, discarded: facts.discarded };
  fs.writeFileSync(path.join(cacheDir, `${key}.json`), `${JSON.stringify({ key, certificate, review }, null, 2)}\n`);
  return true;
}
