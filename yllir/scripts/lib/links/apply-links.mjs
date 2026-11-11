// Validates the outcomes written by the reviewer agent and applies only the
// approved links (APPLY). Every write is checked against the original line
// before it is made, and the result proves that no other text changed:
// unexplained bare mentions are reported after the write.

import fs from 'node:fs';
import path from 'node:path';
import { planFromScan, scanCampaign } from './link-plan.mjs';

const OUTCOMES = new Set(['APPLY', 'FIX', 'OMIT', 'ASK']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** True when `rel` is a regular file inside the campaign folder. */
function isCampaignFile(campaignRoot, rel) {
  if (typeof rel !== 'string' || rel === '' || path.isAbsolute(rel)) return false;
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

function linkSyntax(proposal) {
  return `[${proposal.text}](${proposal.target})`;
}

/**
 * Checks each outcome against the plan. An entry is rejected when it is not an
 * object, its id is not a proposal of the plan, its id was already seen (the
 * first entry with an id wins, and later ones are rejected), one of its
 * file/occurrence/target differs from the proposal, its evidence does not point
 * to an existing campaign file, its outcome is not one of the four values, or
 * its reason is empty.
 * @returns {{ valid: object[], rejected: Array<{ entry: any, reason: string }> }}
 */
export function validateOutcomes(campaignRoot, plan, outcomes) {
  if (!Array.isArray(outcomes)) {
    return { valid: [], rejected: [{ entry: outcomes, reason: 'outcomes must be an array' }] };
  }

  const proposals = new Map(plan.proposals.map((p) => [p.pid, p]));
  const seen = new Set();
  const valid = [];
  const rejected = [];

  for (const entry of outcomes) {
    const reject = (reason) => rejected.push({ entry, reason });

    if (!isPlainObject(entry)) {
      reject('not an object');
      continue;
    }
    if (typeof entry.id !== 'string' || !proposals.has(entry.id)) {
      reject('unknown id');
      continue;
    }
    if (seen.has(entry.id)) {
      reject('duplicate id');
      continue;
    }
    seen.add(entry.id);

    const proposal = proposals.get(entry.id);
    if (entry.file !== proposal.file) {
      reject('file differs from the proposal');
      continue;
    }
    if (entry.occurrence !== `${proposal.line}:${proposal.col}`) {
      reject('occurrence differs from the proposal');
      continue;
    }
    if (entry.target !== proposal.target) {
      reject('target differs from the proposal');
      continue;
    }
    if (typeof entry.evidence !== 'string' || entry.evidence === '') {
      reject('evidence missing');
      continue;
    }
    const locator = /^(.*):(\d+)$/.exec(entry.evidence);
    const evidencePath = locator ? locator[1] : entry.evidence;
    if (!isCampaignFile(campaignRoot, evidencePath)) {
      reject('evidence path does not exist');
      continue;
    }
    if (!OUTCOMES.has(entry.outcome)) {
      reject('invalid outcome');
      continue;
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      reject('reason missing');
      continue;
    }
    valid.push(entry);
  }

  return { valid, rejected };
}

/**
 * Stable key of a mention that survives the insertion of links on its line:
 * file, line, subject, text and the ordinal among same-text mentions on that line.
 * @returns {Map<string, string>} "file|line|col" -> key
 */
function occurrenceKeys(occurrences) {
  const ordinals = new Map();
  const keys = new Map();
  for (const occ of occurrences) {
    const group = `${occ.file}|${occ.line}|${occ.text}`;
    const ordinal = ordinals.get(group) ?? 0;
    ordinals.set(group, ordinal + 1);
    const subject = occ.subject ?? '~';
    keys.set(
      `${occ.file}|${occ.line}|${occ.col}`,
      `${occ.file}|${occ.line}|${subject}|${occ.text}|${ordinal}`,
    );
  }
  return keys;
}

/**
 * Applies the APPLY outcomes of one file. Returns the applied pids and the
 * skipped ones with their reasons. Nothing is written when the safety check fails.
 */
function applyToFile(campaignRoot, file, proposals) {
  const applied = [];
  const skipped = [];

  if (!isCampaignFile(campaignRoot, file)) {
    for (const p of proposals) skipped.push({ pid: p.pid, reason: 'file not in campaign' });
    return { applied, skipped };
  }

  const raw = fs.readFileSync(path.join(campaignRoot, file), 'utf8');
  // Split on \n and keep each \r with its line, so the file keeps its exact line endings.
  const parts = raw.split('\n');
  const endings = parts.map((part) => (part.endsWith('\r') ? '\r' : ''));
  const lines = parts.map((part, i) => part.slice(0, part.length - endings[i].length));

  const candidates = [];
  for (const p of proposals) {
    const idx = p.line - 1;
    if (idx < 0 || idx >= lines.length || lines[idx] !== p.before) {
      skipped.push({ pid: p.pid, reason: 'line changed' });
      continue;
    }
    if (lines[idx].slice(p.col - 1, p.col - 1 + p.text.length) !== p.text) {
      skipped.push({ pid: p.pid, reason: 'text mismatch' });
      continue;
    }
    candidates.push(p);
  }
  if (candidates.length === 0) return { applied, skipped };

  // Several proposals on one line: right to left, so earlier columns stay valid.
  const byLine = new Map();
  for (const p of candidates) {
    const idx = p.line - 1;
    if (!byLine.has(idx)) byLine.set(idx, []);
    byLine.get(idx).push(p);
  }
  const updated = lines.slice();
  for (const [idx, props] of byLine) {
    const ordered = [...props].sort((a, b) => b.col - a.col);
    let text = lines[idx];
    for (const p of ordered) {
      text = text.slice(0, p.col - 1) + linkSyntax(p) + text.slice(p.col - 1 + p.text.length);
    }
    updated[idx] = text;
  }

  const safe =
    updated.length === lines.length &&
    [...byLine].every(([idx, props]) => lineIsSafe(lines[idx], updated[idx], props));
  if (!safe) {
    for (const p of candidates) skipped.push({ pid: p.pid, reason: 'safety check failed' });
    return { applied, skipped };
  }

  fs.writeFileSync(
    path.join(campaignRoot, file),
    updated.map((line, i) => line + endings[i]).join('\n'),
  );
  for (const p of candidates) applied.push(p.pid);
  return { applied, skipped };
}

/**
 * True when `updated` is `original` with the link syntax of `props` inserted at
 * the expected positions: removing the inserted syntax gives back `original` exactly.
 */
function lineIsSafe(original, updated, props) {
  const ascending = [...props].sort((a, b) => a.col - b.col);
  let offset = 0;
  let cursor = 0;
  let rebuilt = '';
  for (const p of ascending) {
    const syntax = linkSyntax(p);
    const start = p.col - 1 + offset;
    if (updated.slice(start, start + syntax.length) !== syntax) return false;
    rebuilt += updated.slice(cursor, start) + p.text;
    cursor = start + syntax.length;
    offset += syntax.length - p.text.length;
  }
  rebuilt += updated.slice(cursor);
  return rebuilt === original;
}

/**
 * Applies the approved links of a plan and reports what is left.
 * @param {string} campaignRoot absolute path to the campaign folder
 * @param {{ scope: string[], proposals: object[] }} plan result of planLinks
 * @param {object[]} outcomes the reviewer's outcomes
 */
export function applyLinks(campaignRoot, plan, outcomes) {
  // Keys of the mentions before any write, to match the proposals later.
  const pre = scanCampaign(campaignRoot);
  const preKeys = occurrenceKeys(pre.scan.occurrences);

  const { valid, rejected } = validateOutcomes(campaignRoot, plan, outcomes);
  const byPid = new Map(valid.map((entry) => [entry.id, entry]));
  const outcomeOf = (p) => (byPid.has(p.pid) ? byPid.get(p.pid).outcome : null);

  const missingOutcome = [];
  const omit = [];
  const ask = [];
  const fix = [];
  for (const p of plan.proposals) {
    const outcome = outcomeOf(p);
    if (outcome === null) missingOutcome.push(p.pid);
    else if (outcome === 'OMIT') omit.push(p.pid);
    else if (outcome === 'ASK') ask.push(p.pid);
    else if (outcome === 'FIX') fix.push(p.pid);
  }

  const applyByFile = new Map();
  for (const p of plan.proposals) {
    if (outcomeOf(p) !== 'APPLY') continue;
    if (!applyByFile.has(p.file)) applyByFile.set(p.file, []);
    applyByFile.get(p.file).push(p);
  }

  const appliedSet = new Set();
  const skipReason = new Map();
  for (const [file, props] of applyByFile) {
    const result = applyToFile(campaignRoot, file, props);
    for (const pid of result.applied) appliedSet.add(pid);
    for (const { pid, reason } of result.skipped) skipReason.set(pid, reason);
  }

  const applied = plan.proposals.filter((p) => appliedSet.has(p.pid)).map((p) => p.pid);
  const skipped = plan.proposals
    .filter((p) => skipReason.has(p.pid))
    .map((p) => ({ pid: p.pid, reason: skipReason.get(p.pid) }));

  // A bare mention left in the new plan is explained only by a decision not to link it.
  const explained = new Set();
  for (const p of plan.proposals) {
    const outcome = outcomeOf(p);
    const decided = outcome === 'OMIT' || outcome === 'ASK' || outcome === 'FIX';
    if (!decided && !skipReason.has(p.pid)) continue;
    const key = preKeys.get(`${p.file}|${p.line}|${p.col}`);
    if (key !== undefined) explained.add(key);
  }

  const post = scanCampaign(campaignRoot);
  const postKeys = occurrenceKeys(post.scan.occurrences);
  const postPlan = planFromScan(campaignRoot, post, { files: plan.scope });
  const residualUnexplained = postPlan.proposals.filter((p) => {
    const key = postKeys.get(`${p.file}|${p.line}|${p.col}`);
    return key === undefined || !explained.has(key);
  });

  const ok =
    rejected.length === 0 &&
    missingOutcome.length === 0 &&
    residualUnexplained.length === 0 &&
    !skipped.some((s) => s.reason === 'safety check failed');

  return {
    applied,
    skipped,
    rejected,
    missing_outcome: missingOutcome,
    omit,
    ask,
    fix,
    residual_unexplained: residualUnexplained,
    ok,
  };
}
