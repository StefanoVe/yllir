// Quality grid (Q-grid) for the creative content of a world case. A model distinct from the
// agent under test reads the new documents and the seed, and scores three criteria from 1 to 5:
// specific, playable, coherent with the seed. The judge judges canon, so it reads the whole text,
// master-only block included. It gets the texts inline in the prompt and no tools: the strict
// permissions of runClaude grant none, so the judge cannot write or read anything else. Built-ins only.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runClaude } from './case-common.mjs';

export const CRITERIA = ['specific', 'playable', 'coherent'];
export const DEFAULT_JUDGE_MODEL = 'opus';
export const DEFAULT_QUALITY_MIN = 3.5;
const JUDGE_TIMEOUT_MS = 600000;

export const RUBRIC = [
  'specific: the content names concrete people, places, objects and details. Generic types ("un mercante", "un luogo misterioso") score low.',
  'playable: a master can use the content at the table. It offers hooks, goals, secrets or tensions that a player can touch.',
  'coherent: the content agrees with the seed (genre, tone, factions, naming conventions, what to avoid) and with the other documents shown.',
];

/**
 * The judge prompt. seed is the text of the world seed; documents is a non-empty list of
 * { path, text } for the new documents. The reply contract is the JSON object of parseJudgeReply.
 */
export function buildJudgePrompt({ seed, documents }) {
  if (typeof seed !== 'string' || seed.trim() === '') throw new Error('judge prompt: seed text is missing');
  if (!Array.isArray(documents) || documents.length === 0) throw new Error('judge prompt: no document to judge');
  for (const doc of documents) {
    if (typeof doc.path !== 'string' || typeof doc.text !== 'string') throw new Error('judge prompt: each document needs path and text');
  }
  const docs = documents.map((doc) => `<document path="${doc.path}">\n${doc.text.trimEnd()}\n</document>`).join('\n\n');
  return [
    'You are an independent judge of the creative content of a tabletop campaign. Judge only the text below. Do not use any tool: everything you need is here.',
    '',
    'Score each criterion from 1 (very weak) to 5 (excellent), as a whole number. The criteria:',
    ...RUBRIC.map((line) => `- ${line}`),
    '',
    'The world seed (it holds the master notes, which you may read):',
    `<seed>\n${seed.trimEnd()}\n</seed>`,
    '',
    'The new documents:',
    docs,
    '',
    'Answer with one JSON object only, with no text before or after it, with exactly these keys:',
    '{"specific": <1-5>, "playable": <1-5>, "coherent": <1-5>, "notes": "<one or two sentences in English about the weakest point>"}',
  ].join('\n');
}

const fail = (error) => ({ ok: false, scores: null, notes: null, error });

/**
 * Parses the judge reply strictly. The reply is a JSON object with exactly the keys of CRITERIA
 * and notes; each score is an integer from 1 to 5; notes is a nonempty string. The object may be
 * wrapped in one fenced code block. Returns { ok, scores, notes, error }.
 */
export function parseJudgeReply(text) {
  if (typeof text !== 'string') return fail('the judge gave no text');
  let body = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(body);
  if (fenced) body = fenced[1].trim();
  let obj;
  try {
    obj = JSON.parse(body);
  } catch {
    return fail('the judge reply is not JSON');
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return fail('the judge reply is not a JSON object');
  const want = [...CRITERIA, 'notes'].sort();
  const got = Object.keys(obj).sort();
  if (got.join(',') !== want.join(',')) return fail(`the judge reply has keys ${got.join(', ')} (want ${want.join(', ')})`);
  const scores = {};
  for (const criterion of CRITERIA) {
    const value = obj[criterion];
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      return fail(`${criterion} is ${JSON.stringify(value)} (want a whole number from 1 to 5)`);
    }
    scores[criterion] = value;
  }
  if (typeof obj.notes !== 'string' || obj.notes.trim() === '') return fail('notes must be a nonempty string');
  return { ok: true, scores, notes: obj.notes.trim(), error: null };
}

/** The mean of the three scores. */
export function qualityMean(scores) {
  return CRITERIA.reduce((sum, criterion) => sum + scores[criterion], 0) / CRITERIA.length;
}

/**
 * The Q-grid check. quality is the result of runQualityJudge (or null when no judge ran).
 * Passes when the judge replied and the mean is at least min. Returns { id, ok, reasons, mean }.
 */
export function qualityCheck(quality, min = DEFAULT_QUALITY_MIN) {
  if (quality === null || quality === undefined) return { id: 'Q-grid', ok: false, reasons: ['no judge reply'], mean: null };
  if (!quality.ok) return { id: 'Q-grid', ok: false, reasons: [quality.error ?? 'judge failed'], mean: null };
  const mean = qualityMean(quality.scores);
  const ok = mean >= min;
  return { id: 'Q-grid', ok, reasons: ok ? [] : [`mean ${mean.toFixed(2)} (want at least ${min})`], mean };
}

/** Throws unless the judge model differs from the model under test. */
export function assertDistinctJudge(agentModel, judgeModel) {
  if (String(judgeModel).trim().toLowerCase() === String(agentModel).trim().toLowerCase()) {
    throw new Error(`the judge model must differ from the model under test (${agentModel}); give --judge-model`);
  }
}

/**
 * Runs the judge with `claude -p` in cwd, with no plugin (an empty plugin folder, removed after the
 * call). documents is [{ path, text }]. Never throws: returns { model, ok, scores, notes, error,
 * mean, reply, cost_usd, duration_ms }.
 */
export function runQualityJudge({ cwd, seed, documents, model = DEFAULT_JUDGE_MODEL, timeoutMs = JUDGE_TIMEOUT_MS }) {
  const prompt = buildJudgePrompt({ seed, documents });
  const emptyPlugin = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-judge-'));
  let run;
  try {
    run = runClaude({ cwd, prompt, model, timeoutMs, pluginDir: emptyPlugin });
  } finally {
    fs.rmSync(emptyPlugin, { recursive: true, force: true });
  }
  if (!run.ok) {
    return { model, ok: false, scores: null, notes: null, error: `judge run failed: ${run.error}`, mean: null, reply: null, cost_usd: run.cost_usd, duration_ms: run.duration_ms };
  }
  const parsed = parseJudgeReply(run.report);
  return {
    model,
    ok: parsed.ok,
    scores: parsed.scores,
    notes: parsed.notes,
    error: parsed.error,
    mean: parsed.ok ? qualityMean(parsed.scores) : null,
    reply: run.report,
    cost_usd: run.cost_usd,
    duration_ms: run.duration_ms,
  };
}
