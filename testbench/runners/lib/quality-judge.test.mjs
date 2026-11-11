// Tests for quality-judge.mjs: the judge prompt, the strict parser of its reply, the Q-grid threshold
// and the distinct-model rule. The model is never called here.
// Run: node --test testbench/runners/lib/quality-judge.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CRITERIA,
  DEFAULT_JUDGE_MODEL,
  DEFAULT_QUALITY_MIN,
  RUBRIC,
  assertDistinctJudge,
  buildJudgePrompt,
  parseJudgeReply,
  qualityCheck,
  qualityMean,
} from './quality-judge.mjs';

const GOOD = '{"specific": 4, "playable": 3, "coherent": 5, "notes": "La locanda è generica."}';

test('the defaults: opus as judge and 3.5 as the minimum mean', () => {
  assert.equal(DEFAULT_JUDGE_MODEL, 'opus');
  assert.equal(DEFAULT_QUALITY_MIN, 3.5);
  assert.deepEqual(CRITERIA, ['specific', 'playable', 'coherent']);
  assert.equal(RUBRIC.length, 3);
});

test('parseJudgeReply accepts the exact object and returns the scores and notes', () => {
  const parsed = parseJudgeReply(GOOD);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.scores, { specific: 4, playable: 3, coherent: 5 });
  assert.equal(parsed.notes, 'La locanda è generica.');
  assert.equal(parsed.error, null);
});

test('parseJudgeReply accepts one fenced json block around the object', () => {
  assert.equal(parseJudgeReply('```json\n' + GOOD + '\n```').ok, true);
  assert.equal(parseJudgeReply('  ' + GOOD + '\n').ok, true);
});

test('parseJudgeReply rejects text around the object, arrays and non-text replies', () => {
  assert.equal(parseJudgeReply('Ecco il voto: ' + GOOD).ok, false);
  assert.match(parseJudgeReply('Ecco il voto: ' + GOOD).error, /not JSON/);
  assert.match(parseJudgeReply('[1,2,3]').error, /not a JSON object/);
  assert.match(parseJudgeReply(null).error, /no text/);
  assert.match(parseJudgeReply('').error, /not JSON/);
});

test('parseJudgeReply rejects missing or extra keys', () => {
  assert.match(parseJudgeReply('{"specific":4,"playable":3,"notes":"x"}').error, /keys/);
  assert.match(parseJudgeReply('{"specific":4,"playable":3,"coherent":5,"notes":"x","extra":1}').error, /keys/);
});

test('parseJudgeReply rejects scores that are not whole numbers from 1 to 5', () => {
  for (const bad of ['0', '6', '3.5', '"4"', 'null', 'true']) {
    const text = `{"specific": ${bad}, "playable": 3, "coherent": 5, "notes": "x"}`;
    assert.equal(parseJudgeReply(text).ok, false, bad);
    assert.match(parseJudgeReply(text).error, /specific is/);
  }
});

test('parseJudgeReply rejects empty or non-string notes', () => {
  assert.match(parseJudgeReply('{"specific":4,"playable":3,"coherent":5,"notes":""}').error, /notes/);
  assert.match(parseJudgeReply('{"specific":4,"playable":3,"coherent":5,"notes":7}').error, /notes/);
});

test('qualityMean is the arithmetic mean of the three criteria', () => {
  assert.equal(qualityMean({ specific: 4, playable: 3, coherent: 4 }), 11 / 3);
  assert.equal(qualityMean({ specific: 5, playable: 5, coherent: 5 }), 5);
});

test('qualityCheck passes at the threshold and fails just below it', () => {
  // The mean of {4,3,4} is 11/3: it passes when the minimum is exactly 11/3, and fails just above it.
  const scores = { specific: 4, playable: 3, coherent: 4 };
  const atMin = qualityCheck({ ok: true, scores }, 11 / 3);
  assert.equal(atMin.ok, true);
  assert.equal(atMin.id, 'Q-grid');
  assert.equal(qualityCheck({ ok: true, scores }, 11 / 3 + 0.01).ok, false);
  // The default minimum is 3.5: {4,4,3} (mean 3.67) passes, {3,3,4} (mean 3.33) fails.
  assert.equal(qualityCheck({ ok: true, scores: { specific: 4, playable: 4, coherent: 3 } }, DEFAULT_QUALITY_MIN).ok, true);
  const low = qualityCheck({ ok: true, scores: { specific: 3, playable: 3, coherent: 4 } }, DEFAULT_QUALITY_MIN);
  assert.equal(low.ok, false);
  assert.match(low.reasons[0], /mean 3\.33 \(want at least 3\.5\)/);
});

test('qualityCheck fails when there is no reply or the judge failed', () => {
  assert.equal(qualityCheck(null, 3.5).ok, false);
  assert.match(qualityCheck(null, 3.5).reasons[0], /no judge reply/);
  const failed = qualityCheck({ ok: false, error: 'judge run failed: timeout' }, 3.5);
  assert.equal(failed.ok, false);
  assert.match(failed.reasons[0], /timeout/);
});

test('buildJudgePrompt puts the rubric, the seed, every document and the reply contract in the prompt', () => {
  const prompt = buildJudgePrompt({
    seed: 'Una valle coperta di cenere.\n<!-- master -->\nNota del master.\n<!-- /master -->',
    documents: [
      { path: 'Mondo/Canneti.md', text: '# Canneti\n\nUn villaggio.' },
      { path: 'Personaggi/Ada Calmane.md', text: '# Ada Calmane\n\nLa capo.' },
    ],
  });
  for (const line of RUBRIC) assert.ok(prompt.includes(line), line);
  assert.ok(prompt.includes('Una valle coperta di cenere.'));
  assert.ok(prompt.includes('Nota del master.'), 'the master block is read by the judge');
  assert.ok(prompt.includes('<document path="Mondo/Canneti.md">'));
  assert.ok(prompt.includes('<document path="Personaggi/Ada Calmane.md">'));
  assert.ok(prompt.includes('{"specific": <1-5>, "playable": <1-5>, "coherent": <1-5>, "notes":'));
  assert.ok(prompt.includes('Do not use any tool'));
});

test('buildJudgePrompt refuses to judge nothing, or a seed that is missing', () => {
  assert.throws(() => buildJudgePrompt({ seed: 'x', documents: [] }), /no document/);
  assert.throws(() => buildJudgePrompt({ seed: '  ', documents: [{ path: 'a.md', text: 'x' }] }), /seed text is missing/);
  assert.throws(() => buildJudgePrompt({ seed: 'x', documents: [{ path: 'a.md' }] }), /path and text/);
});

test('assertDistinctJudge throws when the judge is the model under test, in any case', () => {
  assert.throws(() => assertDistinctJudge('opus', 'Opus'), /must differ/);
  assert.throws(() => assertDistinctJudge('sonnet', 'sonnet'), /must differ/);
  assert.doesNotThrow(() => assertDistinctJudge('sonnet', 'opus'));
});
