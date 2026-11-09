import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { stripExitLine } from '../../../../scripts/lib/cli-exit.mjs';

const CLI = new URL('./adapter-run.mjs', import.meta.url);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-adapter-run-'));
const root = path.join(temp, 'campaign'); fs.mkdirSync(root);
const config = (adapter = 'dnd-2024', lang = 'it') => `schema: 1\ncampaign:\n  name: Test\n  slug: test\n  created: 2026-11-07\nlanguage:\n  main: ${lang}\n  other: []\nprose:\n  register: plain\nsystem:\n  adapter: ${adapter}\n`;
const full = `# Sample\n\n## Statistiche\nCA 12; PF 8; Velocità 6; FOR 10; DES 11; COS 12; INT 9; SAG 10; CAR 8\n\n## Descrizione\nA synthetic entry.\n\n## Effetti\nSynthetic effect text.\n`;
function setup(yaml = config()) { fs.writeFileSync(path.join(root, 'campaign.yaml'), yaml); }
function run(args, expectStatus = 0) {
  let stdout;
  try { stdout = execFileSync(process.execPath, [CLI.pathname, root, ...args], { encoding: 'utf8' }); }
  catch (error) { assert.equal(error.status, expectStatus, error.stderr); stdout = error.stdout; }
  assert.match(stdout, new RegExp(`exit: ${expectStatus}\\n$`));
  return stdout;
}
function report(args) {
  run(args); const text = fs.readFileSync(path.join(root, 'report.txt'), 'utf8');
  assert.match(text, /^ADAPTER REPORT\nstatus: /); assert.match(text, /\nresult: \{/);
  return text;
}
test('complete creature sheet validates and report has the required header', () => {
  setup(); fs.writeFileSync(path.join(root, 'creature.md'), full);
  const text = report(['validate-sheet', 'creature', 'creature.md', '--out', 'report.txt']);
  assert.match(text, /^ADAPTER REPORT\nstatus: OK\nadapter: dnd-2024\noperation: validate-sheet\nlanguage: it\nresult: \{"ok":true/);
});
test('missing COS needs attention and is reported', () => {
  setup(); fs.writeFileSync(path.join(root, 'creature.md'), full.replace('COS 12; ', ''));
  const text = report(['validate-sheet', 'creature', 'creature.md', '--out', 'report.txt']);
  assert.match(text, /^status: NEEDS_ATTENTION/m); assert.match(text, /missing field: con/); assert.match(text, /^problem: missing-field: missing field: con$/m);
});
test('item card-fields returns printable fields', () => {
  setup(); fs.writeFileSync(path.join(root, 'item.md'), full);
  const text = report(['card-fields', 'item.md', '--out', 'report.txt']);
  const result = JSON.parse(text.match(/^result: (.+)$/m)[1]);
  assert.deepEqual(Object.keys(result.fields).sort(), ['description', 'title']);
  assert.deepEqual(result.fields, { title: 'Sample', description: 'A synthetic entry.' });
});
test('progression event only marks a declared milestone', () => {
  setup();
  assert.match(report(['progression-event', 'milestone', '--declared-by-master', '--out', 'report.txt']), /"milestone":true/);
  assert.match(report(['progression-event', 'milestone', '--out', 'report.txt']), /"milestone":false/);
});
test('info reports adapter metadata', () => {
  setup(); const text = report(['info', '--out', 'report.txt']);
  assert.match(text, /^status: OK$/m);
  const result = JSON.parse(text.match(/^result: (.+)$/m)[1]);
  assert.deepEqual(Object.keys(result).sort(), ['conditions', 'do_not', 'encounters', 'id', 'name', 'version']);
  assert.equal(result.id, 'dnd-2024'); assert.equal(result.name, 'D&D 2024'); assert.equal(result.version, 1);
  assert.equal(result.encounters, 'turn-based'); assert.equal(result.conditions.length, 15);
  assert.deepEqual(result.do_not, ['roll dice for the master', 'choose targets', 'decide the outcome of attacks, saves or checks', 'add resistances, immunities or reductions the sheet does not declare', 'rewrite a player character sheet']);
});
test('adapter none is not applicable', () => {
  setup(config('none')); const text = report(['info', '--out', 'report.txt']);
  assert.match(text, /^status: NOT_APPLICABLE/m);
  assert.deepEqual(JSON.parse(text.match(/^result: (.+)$/m)[1]), {});
});
test('check-drafts validates eligible templates, skips other templates, and preserves paths with spaces', () => {
  setup();
  const drafts = path.join(root, 'drafts'); fs.mkdirSync(drafts, { recursive: true });
  const creature = `---\nid: draft-enemy\ntemplate: enemy\n---\n\n${full}`;
  const item = `---\nid: draft-item\ntemplate: item\n---\n\n# Token\n\n## Descrizione\n\nUn token.\n\n## Effetti\n\nNessun effetto.`;
  const place = `---\nid: draft-place\ntemplate: place\n---\n\n# Luogo\n\n## Descrizione\n\nUn luogo inventato.`;
  fs.writeFileSync(path.join(drafts, 'enemy one.md'), creature);
  fs.writeFileSync(path.join(drafts, 'item.md'), item);
  fs.writeFileSync(path.join(drafts, 'place.md'), place);
  fs.writeFileSync(path.join(drafts, 'other.md'), '# Untyped draft');
  const files = 'drafts/enemy one.md,drafts/item.md,drafts/place.md,drafts/other.md';
  const text = report(['check-drafts', files, '--out', 'report.txt']);
  assert.match(text, /^operation: check-drafts$/m);
  assert.match(text, /^status: OK$/m);
  const result = JSON.parse(text.match(/^result: (.+)$/m)[1]);
  assert.deepEqual(result, {
    checked: [
      { file: 'drafts/enemy one.md', kind: 'creature', ok: true },
      { file: 'drafts/item.md', kind: 'item', ok: true },
    ],
    skipped: ['drafts/place.md', 'drafts/other.md'],
  });
});
test('check-drafts reports a missing COS as NEEDS_ATTENTION with file and field problem', () => {
  setup();
  fs.writeFileSync(path.join(root, 'enemy.md'), `---\nid: draft-enemy\ntemplate: enemy\n---\n\n${full.replace('COS 12; ', '')}`);
  const text = report(['check-drafts', 'enemy.md', '--out', 'report.txt']);
  assert.match(text, /^status: NEEDS_ATTENTION$/m);
  const result = JSON.parse(text.match(/^result: (.+)$/m)[1]);
  assert.deepEqual(result, { checked: [{ file: 'enemy.md', kind: 'creature', ok: false }], skipped: [] });
  assert.match(text, /^problem: enemy\.md: missing-field: missing field: con$/m);
});
test('check-drafts with no adapter is not applicable', () => {
  setup(config('none'));
  const text = report(['check-drafts', 'absent.md', '--out', 'report.txt']);
  assert.match(text, /^status: NOT_APPLICABLE$/m);
});
test('check-drafts with only skipped drafts is OK', () => {
  setup();
  fs.writeFileSync(path.join(root, 'place.md'), '---\nid: draft-place\ntemplate: place\n---\n\n# Luogo');
  fs.writeFileSync(path.join(root, 'untyped.md'), '# Untyped draft');
  const text = report(['check-drafts', 'place.md,untyped.md', '--out', 'report.txt']);
  assert.match(text, /^status: OK$/m);
  assert.deepEqual(JSON.parse(text.match(/^result: (.+)$/m)[1]), {
    checked: [], skipped: ['place.md', 'untyped.md'],
  });
});
test('check-drafts rejects empty, missing, and escaping file lists in the report', () => {
  setup();
  for (const files of ['', 'missing.md', '../x.md']) {
    const text = report(['check-drafts', files, '--out', 'report.txt']);
    assert.match(text, /^status: FAILED$/m, `expected failure for ${JSON.stringify(files)}`);
    assert.match(text, /^problem: .+/m, `expected problem for ${JSON.stringify(files)}`);
  }
});
test('missing config writes failed report', () => {
  fs.rmSync(path.join(root, 'campaign.yaml'), { force: true });
  const text = report(['info', '--out', 'report.txt']);
  assert.match(text, /^status: FAILED/m); assert.match(text, /campaign.yaml does not exist/); setup();
});
test('outside and unreadable inputs write failed reports', () => {
  fs.writeFileSync(path.join(temp, 'outside.md'), full);
  let text = report(['card-fields', '../outside.md', '--out', 'report.txt']);
  assert.match(text, /^status: FAILED/m); assert.match(text, /escapes campaign root/);
  text = report(['card-fields', 'missing.md', '--out', 'report.txt']);
  assert.match(text, /^status: FAILED/m); assert.match(text, /ENOENT|no such file/i);
});
test('usage error exits 2 without writing a report', () => {
  fs.rmSync(path.join(root, 'report.txt'), { force: true });
  const stdout = run(['card-fields', 'item.md'], 2);
  assert.equal(stripExitLine(stdout).trim(), ''); assert.equal(fs.existsSync(path.join(root, 'report.txt')), false);
});
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));
