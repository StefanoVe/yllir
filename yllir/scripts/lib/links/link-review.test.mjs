import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { planReview, applyReview } from './link-review.mjs';
import { ensureRepo, saveVersion, listVersions } from '../versions.mjs';

const CAMPAIGN = [
  'name: Test',
  'structure:',
  '  - id: people',
  '    folder: People',
  '    type: subjects',
  '  - id: plot',
  '    folder: Trama',
  '    type: plot',
  '',
].join('\n');

const SECRET = 'SEGRETO-DEL-MASTER';
const SHEET = `---\nid: teodo-marr\n---\n\n# Teodo Marr\n\n<!-- master -->\nNote riservate: ${SECRET}\n<!-- /master -->\n\nUn mercante.\n`;

/** Writes a temporary campaign (no git) and runs `fn` on its folder. */
function withCampaign(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-review-'));
  try {
    write(root, { 'campaign.yaml': CAMPAIGN, 'People/Teodo Marr.md': SHEET, ...files });
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Same, inside a git repo with one saved version (the campaign state before the review). */
function withRepo(files, fn) {
  return withCampaign(files, (root) => {
    ensureRepo(root);
    saveVersion(root, { message: 'Base', kind: 'framework' });
    return fn(root);
  });
}

function write(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

function read(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

/** Writes a reviewer outcomes file under .campaign/state/ and returns its campaign-relative path. */
function outcomesFile(root, entries) {
  const rel = '.campaign/state/outcomes.json';
  write(root, { [rel]: JSON.stringify(entries) });
  return rel;
}

const LINK = '[Teodo Marr](../People/Teodo%20Marr.md)';

test('plan output has evidence and sheet excerpt, and no master-only text', () => {
  withCampaign({ 'Trama/Nota.md': '# Nota\n\nIncontro con Teodo Marr oggi.\n' }, (root) => {
    const result = planReview(root, { files: ['Trama/Nota.md'] });
    assert.equal(result.ok, true);
    assert.equal(result.count, 1);
    assert.equal(result.plan_file, '.campaign/state/link-review.json');
    const [item] = result.proposals;
    assert.equal(item.pid, 'P001');
    assert.equal(item.file, 'Trama/Nota.md');
    assert.equal(item.line, 3);
    assert.equal(item.text, 'Teodo Marr');
    assert.equal(item.target, '../People/Teodo%20Marr.md');
    assert.equal(item.evidence, 'People/Teodo Marr.md:5');
    assert.equal(item.in_master, false);
    assert.equal(item.before, 'Incontro con Teodo Marr oggi.');
    assert.equal(item.after, `Incontro con ${LINK} oggi.`);
    assert.match(item.sheet_excerpt, /# Teodo Marr/);
    assert.equal(item.sheet_excerpt.includes(SECRET), false);
    assert.equal(JSON.stringify(result).includes(SECRET), false);
    assert.ok(fs.existsSync(path.join(root, '.campaign/state/link-review.json')));
  });
});

test('a proposal inside master-only text has empty before and after and is OMIT-only', () => {
  const line = `Riservato: Teodo Marr e' il traitore.`;
  withCampaign({ 'Trama/Nota.md': `# Nota\n\n<!-- master -->\n${line}\n<!-- /master -->\n` }, (root) => {
    const result = planReview(root, { files: ['Trama/Nota.md'] });
    assert.equal(result.count, 1);
    const [item] = result.proposals;
    assert.equal(item.in_master, true);
    assert.equal(item.before, '');
    assert.equal(item.after, '');
    assert.equal(JSON.stringify(result).includes('traitore'), false);
  });
});

test('files outside the scanned folders are ignored by the plan', () => {
  withCampaign({ 'Trama/Nota.md': '# Nota\n\nIncontro con Teodo Marr oggi.\n', 'Other/Libero.md': '# Libero\n\nTeodo Marr.\n' }, (root) => {
    const result = planReview(root, { files: ['Other/Libero.md'] });
    assert.equal(result.count, 0);
    assert.deepEqual(result.proposals, []);
  });
});

test('apply with APPLY inserts the link and saves exactly one version', () => {
  withRepo({ 'Trama/Nota.md': '# Nota\n\nIncontro con Teodo Marr oggi.\n' }, (root) => {
    const before = listVersions(root).length;
    const plan = planReview(root, { files: ['Trama/Nota.md'] });
    const pid = plan.proposals[0].pid;
    const outcomes = outcomesFile(root, [{ id: pid, outcome: 'APPLY', reason: 'the subject is named here' }]);
    const result = applyReview(root, { outcomesFile: outcomes, message: 'Links: Nota' });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.applied, [pid]);
    assert.equal(read(root, 'Trama/Nota.md'), `# Nota\n\nIncontro con ${LINK} oggi.\n`);
    assert.equal(listVersions(root).length, before + 1);
    assert.equal(typeof result.saved.hash, 'string');
    assert.equal(fs.existsSync(path.join(root, '.campaign/state/link-review.json')), false);
  });
});

test('OMIT and ASK leave the file unchanged, ASK is listed, and nothing is saved', () => {
  const original = '# Nota\n\nIncontro con Teodo Marr oggi.\n';
  withRepo({ 'Trama/Nota.md': original }, (root) => {
    const before = listVersions(root).length;
    const plan = planReview(root, { files: ['Trama/Nota.md'] });
    const pid = plan.proposals[0].pid;
    const outcomes = outcomesFile(root, [{ id: pid, outcome: 'ASK', reason: 'could be another person' }]);
    const result = applyReview(root, { outcomesFile: outcomes, message: 'Links: Nota' });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(read(root, 'Trama/Nota.md'), original);
    assert.deepEqual(result.applied, []);
    assert.deepEqual(result.ask, [
      { pid, file: 'Trama/Nota.md', line: 3, text: 'Teodo Marr', subject: plan.proposals[0].subject, sheet: 'People/Teodo Marr.md' },
    ]);
    assert.equal(result.saved, null);
    assert.equal(listVersions(root).length, before);

    // A successful apply deletes the plan, so the OMIT round plans again.
    const replan = planReview(root, { files: ['Trama/Nota.md'] });
    const omit = outcomesFile(root, [{ id: replan.proposals[0].pid, outcome: 'OMIT', reason: 'not a mention of the subject' }]);
    const second = applyReview(root, { outcomesFile: omit, message: 'Links: Nota' });
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.deepEqual(second.omit, [pid]);
    assert.equal(read(root, 'Trama/Nota.md'), original);
  });
});

test('an OMIT on a master-only proposal is accepted, and any other outcome on it is refused', () => {
  const line = `Riservato: Teodo Marr e' il traitore.`;
  const original = `# Nota\n\n<!-- master -->\n${line}\n<!-- /master -->\n`;
  withRepo({ 'Trama/Nota.md': original }, (root) => {
    const plan = planReview(root, { files: ['Trama/Nota.md'] });
    const pid = plan.proposals[0].pid;
    const apply = outcomesFile(root, [{ id: pid, outcome: 'APPLY', reason: 'looks linkable' }]);
    const refused = applyReview(root, { outcomesFile: apply, message: 'Links: Nota' });
    assert.equal(refused.ok, false);
    assert.equal(refused.rejected.length, 1);
    assert.equal(read(root, 'Trama/Nota.md'), original);

    // The plan was kept (not ok), so the same pid is still there to omit.
    const omit = outcomesFile(root, [{ id: pid, outcome: 'OMIT', reason: 'master-only line' }]);
    const accepted = applyReview(root, { outcomesFile: omit, message: 'Links: Nota' });
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    assert.equal(read(root, 'Trama/Nota.md'), original);
  });
});

test('an unknown id is rejected and the file is not changed', () => {
  const original = '# Nota\n\nIncontro con Teodo Marr oggi.\n';
  withRepo({ 'Trama/Nota.md': original }, (root) => {
    const plan = planReview(root, { files: ['Trama/Nota.md'] });
    const pid = plan.proposals[0].pid;
    const outcomes = outcomesFile(root, [
      { id: 'P999', outcome: 'APPLY', reason: 'invented' },
      { id: pid, outcome: 'OMIT', reason: 'left alone' },
    ]);
    const result = applyReview(root, { outcomesFile: outcomes, message: 'Links: Nota' });
    assert.equal(result.ok, false);
    assert.equal(result.rejected.length, 1);
    assert.equal(result.rejected[0].entry.id, 'P999');
    assert.equal(result.rejected[0].reason, 'unknown id');
    assert.equal(read(root, 'Trama/Nota.md'), original);
    assert.equal(fs.existsSync(path.join(root, '.campaign/state/link-review.json')), true);
  });
});

test('apply refuses a campaign that is not a git repository', () => {
  const original = '# Nota\n\nIncontro con Teodo Marr oggi.\n';
  withCampaign({ 'Trama/Nota.md': original }, (root) => {
    const plan = planReview(root, { files: ['Trama/Nota.md'] });
    const outcomes = outcomesFile(root, [{ id: plan.proposals[0].pid, outcome: 'APPLY', reason: 'x' }]);
    const result = applyReview(root, { outcomesFile: outcomes, message: 'Links: Nota' });
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, 'no-git');
    assert.equal(read(root, 'Trama/Nota.md'), original);
  });
});

test('apply refuses an outcomes file outside the state and drafts folders', () => {
  withRepo({ 'Trama/Nota.md': '# Nota\n\nIncontro con Teodo Marr oggi.\n' }, (root) => {
    planReview(root, { files: ['Trama/Nota.md'] });
    write(root, { 'Trama/outcomes.json': '[]' });
    const result = applyReview(root, { outcomesFile: 'Trama/outcomes.json', message: 'Links: Nota' });
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, 'bad-outcomes-file');
  });
});

test('a hand edit is saved in its own version before the link version, and only the link is in the framework version', () => {
  withRepo({ 'Trama/Nota.md': '# Nota\n\nIncontro con Teodo Marr oggi.\n' }, (root) => {
    const before = listVersions(root).length;
    const plan = planReview(root, { files: ['Trama/Nota.md'] });
    // The master edits another file by hand after the plan was made.
    write(root, { 'Trama/Altro.md': '# Altro\n\nUna nota scritta a mano.\n' });
    const outcomes = outcomesFile(root, [{ id: plan.proposals[0].pid, outcome: 'APPLY', reason: 'full name of the subject' }]);

    const result = applyReview(root, { outcomesFile: outcomes, message: 'Links: Nota' });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.manualChanges, ['Trama/Altro.md']);
    assert.equal(listVersions(root).length, before + 2);

    const [link, manual] = listVersions(root);
    assert.equal(link.kind, 'framework');
    assert.equal(manual.kind, 'manual');
    assert.equal(manual.message, 'Changes made by hand');
    const changed = execFileSync('git', ['show', '--name-only', '--format=', link.hash], { cwd: root, encoding: 'utf8' });
    assert.deepEqual(changed.trim().split('\n'), ['Trama/Nota.md']);
  });
});
