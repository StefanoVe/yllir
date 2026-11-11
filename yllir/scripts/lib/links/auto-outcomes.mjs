// Accepts without the reviewer the proposals that are obviously safe, and leaves
// every other proposal UNCERTAIN, for the reviewer agent. A safe proposal is a full
// proper name of one subject, outside master-only text, whose sheet is a regular
// file of the campaign, and whose position no other proposal shares. Nothing here
// writes a file: the caller saves the outcomes and applies them with applyLinks.

import fs from 'node:fs';
import path from 'node:path';

const PROPER_WORD = /^\p{Lu}/u;

/** True when `rel` is a relative path with no `..` segment. */
function isRelativeWithoutDotDot(rel) {
  if (typeof rel !== 'string' || rel === '' || path.isAbsolute(rel)) return false;
  return !rel.split(/[\\/]/).includes('..');
}

/** True when `rel` is a regular file inside the campaign folder. */
function isCampaignFile(campaignRoot, rel) {
  if (!isRelativeWithoutDotDot(rel)) return false;
  const full = path.resolve(campaignRoot, rel);
  const back = path.relative(campaignRoot, full);
  if (back === '' || back === '..' || back.startsWith(`..${path.sep}`) || path.isAbsolute(back)) {
    return false;
  }
  try {
    return fs.statSync(full).isFile();
  } catch {
    return false;
  }
}

/** True when the text has at least two words and every word starts with an uppercase letter. */
function isFullProperName(text) {
  if (typeof text !== 'string') return false;
  const words = text.trim().split(/\s+/).filter((word) => word !== '');
  return words.length >= 2 && words.every((word) => PROPER_WORD.test(word));
}

/** 1-based line of the first line of the sheet that starts with `# `, or 1 when there is none. */
function titleLineOf(campaignRoot, sheet) {
  const lines = fs.readFileSync(path.join(campaignRoot, sheet), 'utf8').split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith('# '));
  return index === -1 ? 1 : index + 1;
}

/**
 * Decides the safe proposals of a plan.
 * @param {string} campaignRoot absolute path to the campaign folder
 * @param {{ proposals: object[] }} plan result of planLinks, or the plan file read as JSON
 * @returns {{ outcomes: object[], uncertain: string[] }} APPLY entries for the safe
 *   proposals (in plan order) and the pids of all the others (in plan order)
 */
export function autoOutcomes(campaignRoot, plan) {
  if (plan === null || typeof plan !== 'object' || !Array.isArray(plan.proposals)) {
    throw new Error('not a link plan: missing proposals');
  }

  const positionCount = new Map();
  for (const p of plan.proposals) {
    const key = `${p.file}|${p.line}|${p.col}`;
    positionCount.set(key, (positionCount.get(key) ?? 0) + 1);
  }

  const outcomes = [];
  const uncertain = [];
  for (const p of plan.proposals) {
    const samePosition = positionCount.get(`${p.file}|${p.line}|${p.col}`);
    const safe =
      p.in_master === false &&
      isFullProperName(p.text) &&
      samePosition === 1 &&
      isCampaignFile(campaignRoot, p.sheet);
    if (!safe) {
      uncertain.push(p.pid);
      continue;
    }
    outcomes.push({
      id: p.pid,
      file: p.file,
      occurrence: `${p.line}:${p.col}`,
      target: p.target,
      evidence: `${p.sheet}:${titleLineOf(campaignRoot, p.sheet)}`,
      outcome: 'APPLY',
      reason: 'deterministic: full proper name of one subject',
    });
  }

  return { outcomes, uncertain };
}
