import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compareFacts, exclusionsFromConfig, norm } from './audit-compare.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'audit-compare.mjs');

let seq = 0;
/** Builds a fact with defaults; `id` is generated when not given. */
function fact(over) {
  seq++;
  return {
    id: `f${seq}`,
    subject: 'oria',
    attribute: 'date.founding',
    value: '',
    source_type: 'source-claim',
    quote: '',
    document: 'Mondo/a.md',
    line: 1,
    section: '',
    in_master: false,
    forced_hypothesis: false,
    from_metadata: false,
    ...over,
  };
}

test('date mismatch across two places is a value-mismatch candidate', () => {
  const r = compareFacts([
    fact({ value: 'anno 298', document: 'Mondo/a.md', line: 3 }),
    fact({ value: '312', document: 'Trama/b.md', line: 9 }),
  ]);
  assert.equal(r.candidates.length, 1);
  const [c] = r.candidates;
  assert.equal(c.cid, 'C001');
  assert.equal(c.kind, 'value-mismatch');
  assert.equal(c.subject, 'oria');
  assert.equal(c.attribute, 'date.founding');
  assert.deepEqual(c.values, ['298', '312']);
  assert.equal(c.facts.length, 2);
});

test('number 45 and 45.0 are equal, no candidate', () => {
  assert.equal(norm('number.hp', '45.0'), norm('number.hp', '45'));
  const r = compareFacts([
    fact({ attribute: 'number.hp', value: '45', document: 'a.md', line: 1 }),
    fact({ attribute: 'number.hp', value: '45.0', document: 'b.md', line: 2 }),
  ]);
  assert.equal(r.candidates.length, 0);
});

test('non-numeric number values are not treated as equal', () => {
  const r = compareFacts([
    fact({ attribute: 'number.count', value: 'molti', document: 'a.md', line: 1 }),
    fact({ attribute: 'number.count', value: 'pochi', document: 'b.md', line: 1 }),
  ]);
  assert.equal(r.candidates.length, 1);
});

test('same value in two places is not a candidate', () => {
  const r = compareFacts([
    fact({ value: '312', document: 'a.md', line: 1 }),
    fact({ value: 'anno 312', document: 'b.md', line: 2 }),
  ]);
  assert.equal(r.candidates.length, 0);
});

test('different values from the same document:line are not a candidate', () => {
  const r = compareFacts([
    fact({ value: '298', document: 'a.md', line: 4 }),
    fact({ value: '312', document: 'a.md', line: 4 }),
  ]);
  assert.equal(r.candidates.length, 0);
});

test('status values are folded before comparison', () => {
  const r = compareFacts([
    fact({ attribute: 'status.life', value: 'Vivo', document: 'a.md', line: 1 }),
    fact({ attribute: 'status.life', value: '  vivo ', document: 'b.md', line: 1 }),
  ]);
  assert.equal(r.candidates.length, 0);
});

test('overlapping location sets are not a conflict', () => {
  const r = compareFacts([
    fact({ attribute: 'location.current', value: 'Lago, Torre', document: 'a.md', line: 1 }),
    fact({ attribute: 'location.current', value: 'Torre', document: 'b.md', line: 2 }),
  ]);
  assert.equal(r.candidates.length, 0);
});

test('disjoint location sets from different places are a location-conflict', () => {
  const r = compareFacts([
    fact({ attribute: 'location.current', value: 'Lago', document: 'a.md', line: 1 }),
    fact({ attribute: 'location.current', value: 'Bosco', document: 'b.md', line: 2 }),
  ]);
  assert.equal(r.candidates.length, 1);
  const [c] = r.candidates;
  assert.equal(c.kind, 'location-conflict');
  assert.equal(c.attribute, 'location.current');
  assert.deepEqual(c.values, ['bosco', 'lago']);
  assert.equal(c.facts.length, 2);
});

test('disjoint location sets from the same place are not a conflict', () => {
  const r = compareFacts([
    fact({ attribute: 'location.current', value: 'Lago', document: 'a.md', line: 1 }),
    fact({ attribute: 'location.current', value: 'Bosco', document: 'a.md', line: 1 }),
  ]);
  assert.equal(r.candidates.length, 0);
});

test('parent-of against parent-of in opposite directions is a relation-conflict', () => {
  const r = compareFacts([
    fact({ subject: 'Bruno', attribute: 'relation.parent-of', value: 'Ada', document: 'a.md', line: 1 }),
    fact({ subject: 'Ada', attribute: 'relation.parent-of', value: 'Bruno', document: 'b.md', line: 2 }),
  ]);
  assert.equal(r.candidates.length, 1);
  const [c] = r.candidates;
  assert.equal(c.kind, 'relation-conflict');
  assert.equal(c.subject, 'Ada');
  assert.equal(c.attribute, 'relation.parent-of');
  assert.deepEqual(c.values, ['Ada→Bruno', 'Bruno→Ada']);
  assert.equal(c.facts.length, 2);
});

test('parent-of against child-of in opposite directions is a relation-conflict', () => {
  const r = compareFacts([
    // Ada parent-of Bruno: Ada -> Bruno
    fact({ subject: 'Ada', attribute: 'relation.parent-of', value: 'Bruno', document: 'a.md', line: 1 }),
    // Ada child-of Bruno: Bruno -> Ada
    fact({ subject: 'Ada', attribute: 'relation.child-of', value: 'Bruno', document: 'b.md', line: 2 }),
  ]);
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].kind, 'relation-conflict');
  assert.deepEqual(r.candidates[0].values, ['Ada→Bruno', 'Bruno→Ada']);
});

test('same-direction parent and child facts are not a conflict', () => {
  const r = compareFacts([
    fact({ subject: 'Ada', attribute: 'relation.parent-of', value: 'Bruno', document: 'a.md', line: 1 }),
    fact({ subject: 'Bruno', attribute: 'relation.child-of', value: 'Ada', document: 'b.md', line: 2 }),
  ]);
  assert.equal(r.candidates.length, 0);
});

test('sibling-of is never compared', () => {
  const r = compareFacts([
    fact({ subject: 'Ada', attribute: 'relation.sibling-of', value: 'Bruno', document: 'a.md', line: 1 }),
    fact({ subject: 'Bruno', attribute: 'relation.sibling-of', value: 'Ada', document: 'b.md', line: 2 }),
    fact({ subject: 'Bruno', attribute: 'relation.parent-of', value: 'Ada', document: 'c.md', line: 3 }),
  ]);
  assert.equal(r.candidates.length, 0);
});

test('hypothesis facts take no part in comparison and are listed unchanged', () => {
  const hyp = fact({
    value: '312',
    source_type: 'hypothesis',
    document: 'b.md',
    line: 2,
  });
  const r = compareFacts([fact({ value: '298', document: 'a.md', line: 1 }), hyp]);
  assert.equal(r.candidates.length, 0);
  assert.equal(r.hypotheses.length, 1);
  assert.deepEqual(r.hypotheses[0], hyp);
  assert.equal(r.stats.facts, 2);
  assert.equal(r.stats.compared, 1);
  assert.equal(r.stats.hypotheses, 1);
});

test('an exclusion covering the values moves the candidate to excluded', () => {
  const r = compareFacts(
    [
      fact({ value: '298', document: 'a.md', line: 1 }),
      fact({ value: '312', document: 'b.md', line: 2 }),
    ],
    [{ subject: 'oria', attribute: 'date.founding', values: ['312', 298], reason: 'calendar change' }],
  );
  assert.equal(r.candidates.length, 0);
  assert.equal(r.excluded.length, 1);
  assert.equal(r.excluded[0].exclusion, 0);
  assert.equal(r.excluded[0].reason, 'calendar change');
  assert.equal(r.excluded[0].kind, 'value-mismatch');
  assert.deepEqual(r.excluded[0].values, ['298', '312']);
  assert.equal(r.stats.excluded, 1);
  assert.equal(r.stats.candidates, 0);
});

test('an exclusion with different values does not cover the candidate', () => {
  const r = compareFacts(
    [
      fact({ value: '298', document: 'a.md', line: 1 }),
      fact({ value: '312', document: 'b.md', line: 2 }),
    ],
    [{ subject: 'oria', attribute: 'date.founding', values: ['298', '999'], reason: 'other' }],
  );
  assert.equal(r.candidates.length, 1);
  assert.equal(r.excluded.length, 0);
});

test('an exclusion for another subject or attribute does not cover', () => {
  const facts = [
    fact({ value: '298', document: 'a.md', line: 1 }),
    fact({ value: '312', document: 'b.md', line: 2 }),
  ];
  const other = compareFacts(facts, [{ subject: 'altro', attribute: 'date.founding', values: ['298', '312'], reason: '' }]);
  assert.equal(other.candidates.length, 1);
  const attr = compareFacts(facts, [{ subject: 'oria', attribute: 'date.death', values: ['298', '312'], reason: '' }]);
  assert.equal(attr.candidates.length, 1);
});

test('location exclusion compares joined normalized sets', () => {
  const r = compareFacts(
    [
      fact({ attribute: 'location.current', value: 'Lago', document: 'a.md', line: 1 }),
      fact({ attribute: 'location.current', value: 'Bosco', document: 'b.md', line: 2 }),
    ],
    [{ subject: 'oria', attribute: 'location.current', values: ['bosco', 'Lago'], reason: 'ok' }],
  );
  assert.equal(r.candidates.length, 0);
  assert.equal(r.excluded.length, 1);
});

test('numbering is deterministic and sorted by subject, attribute, kind', () => {
  const input = () => [
    fact({ id: 'n1', subject: 'zeta', value: '1', document: 'a.md', line: 1 }),
    fact({ id: 'n2', subject: 'zeta', value: '2', document: 'b.md', line: 1 }),
    fact({ id: 'n3', subject: 'alfa', value: '5', document: 'a.md', line: 1 }),
    fact({ id: 'n4', subject: 'alfa', value: '6', document: 'b.md', line: 1 }),
    fact({ id: 'n5', subject: 'mid', attribute: 'location.current', value: 'X', document: 'a.md', line: 1 }),
    fact({ id: 'n6', subject: 'mid', attribute: 'location.current', value: 'Y', document: 'b.md', line: 1 }),
  ];
  const first = compareFacts(input());
  const second = compareFacts(input());
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.candidates.map((c) => [c.cid, c.subject, c.kind]),
    [
      ['C001', 'alfa', 'value-mismatch'],
      ['C002', 'mid', 'location-conflict'],
      ['C003', 'zeta', 'value-mismatch'],
    ],
  );
});

test('facts inside a candidate are sorted by document, line, id', () => {
  const r = compareFacts([
    fact({ id: 'b', value: '2', document: 'z.md', line: 1 }),
    fact({ id: 'c', value: '1', document: 'a.md', line: 5 }),
    fact({ id: 'a', value: '1', document: 'a.md', line: 2 }),
  ]);
  assert.deepEqual(
    r.candidates[0].facts.map((f) => f.id),
    ['a', 'c', 'b'],
  );
});

test('exclusionsFromConfig: missing section means no exclusions', () => {
  assert.deepEqual(exclusionsFromConfig({}), []);
  assert.deepEqual(exclusionsFromConfig({ audit: {} }), []);
});

test('exclusionsFromConfig: reads and stringifies values', () => {
  assert.deepEqual(
    exclusionsFromConfig({
      audit: { exclusions: [{ subject: 'oria', attribute: 'date.founding', values: [298, '312'], reason: 'r' }] },
    }),
    [{ subject: 'oria', attribute: 'date.founding', values: ['298', '312'], reason: 'r' }],
  );
});

test('exclusionsFromConfig: malformed section throws', () => {
  assert.throws(() => exclusionsFromConfig({ audit: 'x' }));
  assert.throws(() => exclusionsFromConfig({ audit: { exclusions: {} } }));
  assert.throws(() => exclusionsFromConfig({ audit: { exclusions: [{ subject: 'a', attribute: 'b' }] } }));
});

// --- CLI ---

function makeCampaign(t, { campaign = 'name: Test\n', facts, complete = true }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'campaign.yaml'), campaign);
  const factsFile = path.join(root, 'facts.json');
  if (facts !== undefined) {
    fs.writeFileSync(factsFile, JSON.stringify({ mode: 'full', complete, coverage: [], discarded: [], facts }));
  }
  return { root, factsFile, out: path.join(root, 'out', 'candidates.json') };
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

test('CLI: complete input writes the result and exits 0', (t) => {
  const { root, factsFile, out } = makeCampaign(t, {
    facts: [
      fact({ value: '298', document: 'a.md', line: 1 }),
      fact({ value: '312', document: 'b.md', line: 2 }),
    ],
  });
  const res = runCli([root, '--facts', factsFile, '--out', out]);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /^facts: 2, candidates: 1, excluded: 0, hypotheses: 0\n/);
  assert.match(res.stdout, /C001 value-mismatch oria date\.founding 298 \| 312/);
  const written = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(written.candidates[0].cid, 'C001');
  assert.equal(written.stats.candidates, 1);
});

test('CLI: incomplete coverage warns, still writes, and exits 1', (t) => {
  const { root, factsFile, out } = makeCampaign(t, {
    complete: false,
    facts: [fact({ value: '298', document: 'a.md', line: 1 }), fact({ value: '312', document: 'b.md', line: 2 })],
  });
  const res = runCli([root, '--facts', factsFile, '--out', out]);
  assert.equal(res.status, 1, res.stderr);
  assert.equal(res.stdout.split('\n')[0], 'WARNING: coverage incomplete');
  assert.ok(fs.existsSync(out));
});

test('CLI: usage error exits 2', () => {
  assert.equal(runCli([]).status, 2);
  assert.equal(runCli(['somewhere', '--facts', 'f.json']).status, 2);
});

test('CLI: unreadable facts file exits 2', (t) => {
  const { root, out } = makeCampaign(t, {});
  const res = runCli([root, '--facts', path.join(root, 'missing.json'), '--out', out]);
  assert.equal(res.status, 2);
});

test('CLI: malformed campaign.yaml exits 2', (t) => {
  const { root, factsFile, out } = makeCampaign(t, {
    campaign: 'audit:\n  exclusions: nope\n',
    facts: [],
  });
  const res = runCli([root, '--facts', factsFile, '--out', out]);
  assert.equal(res.status, 2);
});
