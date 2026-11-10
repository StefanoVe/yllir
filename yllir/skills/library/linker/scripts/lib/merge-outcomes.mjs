// Merges a reviewer's saved response into the current outcomes without letting
// a light-path or retry response replace decisions outside its assigned PIDs.
import fs from 'node:fs';
import path from 'node:path';
import { validateOutcomes } from './apply-links.mjs';

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`cannot read ${label} ${file}: ${err.message}`, { cause: err });
  }
}

function validateArray(root, plan, entries, label) {
  if (!Array.isArray(entries)) throw new Error(`${label} must be a JSON array`);
  const checked = validateOutcomes(root, plan, entries);
  if (checked.rejected.length) {
    const reasons = checked.rejected.map(({ entry, reason }) => `${entry?.id ?? '(no id)'}: ${reason}`);
    throw new Error(`${label} has invalid entries: ${reasons.join('; ')}`);
  }
}

/**
 * Merge reviewer outcomes. mode=all accepts all plan proposals; mode=scoped
 * accepts only the supplied PIDs and replaces only those IDs in the base.
 */
export function mergeOutcomes(root, plan, base, response, { mode, pids = [] }) {
  if (!plan || !Array.isArray(plan.proposals)) throw new Error('plan must contain a proposals array');
  if (!Array.isArray(base)) throw new Error('base outcomes must be a JSON array');
  validateArray(root, plan, response, 'reviewer response');
  if (!['all', 'scoped'].includes(mode)) throw new Error('mode must be all or scoped');

  if (mode === 'all') return [...response];

  const scope = new Set(pids);
  if (mode === 'scoped') {
    if (!Array.isArray(pids) || pids.length === 0 || scope.size !== pids.length) {
      throw new Error('scoped mode requires a non-empty list of unique PIDs');
    }
    const known = new Set(plan.proposals.map((proposal) => proposal.pid));
    for (const pid of pids) if (!known.has(pid)) throw new Error(`unknown scoped PID: ${pid}`);
  }

  // Retry entries can be precisely the entries that apply-links rejected.
  // Remove those IDs before validating the retained decisions so a bad entry
  // can be repaired without weakening checks on anything outside the retry.
  const retained = base.filter((entry) => !scope.has(entry?.id));
  validateArray(root, plan, retained, 'retained base outcomes');

  for (const entry of response) {
    if (!scope.has(entry.id)) {
      throw new Error(`reviewer response contains out-of-scope PID: ${entry.id}`);
    }
  }
  const replacements = new Map(response.map((entry) => [entry.id, entry]));
  const merged = base.map((entry) => replacements.get(entry?.id) ?? entry);
  const existing = new Set(retained.map((entry) => entry.id));
  for (const entry of response) if (!existing.has(entry.id)) {
    const originalIndex = base.findIndex((old) => old?.id === entry.id);
    if (originalIndex === -1) merged.push(entry);
    else merged[originalIndex] = entry;
  }
  return merged;
}

/** Write JSON through a sibling temporary file so invalid input never truncates the old result. */
export function writeJsonAtomic(file, value) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    fs.renameSync(temp, target);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

export function mergeFiles(root, planFile, baseFile, responseFile, outFile, options) {
  const plan = readJson(planFile, 'plan');
  if (options.mode === 'all') {
    const response = readJson(responseFile, 'reviewer response');
    const merged = mergeOutcomes(root, plan, [], response, options);
    writeJsonAtomic(outFile, merged);
    return merged;
  }
  let base;
  try { base = readJson(baseFile, 'base outcomes'); }
  catch (err) {
    if (err.cause?.code === 'ENOENT') throw err;
    else throw err;
  }
  const response = readJson(responseFile, 'reviewer response');
  const merged = mergeOutcomes(root, plan, base, response, options);
  writeJsonAtomic(outFile, merged);
  return merged;
}
