import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { completeItemDescriptions, prepareItemDescriptions, stageItemDescriptionDraft, verifyItemDescriptionDrafts } from './item-descriptions.mjs';
import { toCommentMetadata } from '../../../../../scripts/lib/frontmatter.mjs';

const roots = [];
after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));
function campaign(items = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-item-desc-')); roots.push(root);
  fs.mkdirSync(path.join(root, 'Objects'));
  fs.writeFileSync(path.join(root, 'campaign.yaml'), 'structure:\n  - id: objects\n    folder: Objects\n    type: objects\n');
  for (const [name, body] of items) fs.writeFileSync(path.join(root, 'Objects', name), body);
  return root;
}
const sheet = (brief = 'A silver key.') => `---\nid: key\ntemplate: item\nlocation: []\n---\n\n# Key\n\n## In breve\n\n${brief}\n\n## Descrizione\n\nA key made of silver.\n\n## Effetti\n\nNo game effect.\n\n<!-- master -->\n## Master\nsecret\n<!-- /master -->\n`;

test('activation inventories legacy items including those without In breve; empty campaigns complete', () => {
  const root = campaign([['key.md', sheet().replace(/## In breve[\s\S]*?## Descrizione/, '## Descrizione')]]);
  const result = prepareItemDescriptions(root);
  assert.equal(result.status, 'pending'); assert.deepEqual(result.items.map((x) => x.file), ['Objects/key.md']);
  const empty = campaign(); assert.equal(prepareItemDescriptions(empty).status, 'complete');
});

test('draft verification permits missing brief insertion and preserves effects, master bytes and other sections', () => {
  const original = sheet().replace(/## In breve[\s\S]*?## Descrizione/, '## Descrizione');
  const root = campaign([['key.md', original]]);
  prepareItemDescriptions(root);
  const draft = original.replace('## Descrizione', '## In breve\n\nA silver key.\n\n## Descrizione\n\nIt opens the old gate.');
  assert.equal(stageItemDescriptionDraft(root, 'Objects/key.md', draft).status, 'staged');
  assert.equal(verifyItemDescriptionDrafts(root, ['Objects/key.md']).status, 'verified');
  const published = path.join(root, 'Objects/key.md'); fs.writeFileSync(published, draft);
  assert.equal(completeItemDescriptions(root, ['Objects/key.md']).status, 'complete');
  assert.match(fs.readFileSync(published, 'utf8'), /secret/);
});

test('source changes stop staging and cannot be silently rebased on a later inventory', () => {
  const root = campaign([['key.md', sheet()]]); prepareItemDescriptions(root);
  fs.appendFileSync(path.join(root, 'Objects/key.md'), '\nMaster edit\n');
  assert.equal(prepareItemDescriptions(root).items[0].status, 'changed');
  assert.equal(stageItemDescriptionDraft(root, 'Objects/key.md', sheet()).status, 'failed');
  assert.equal(prepareItemDescriptions(root).items[0].status, 'changed');
});

test('effects changes are rejected and unchanged reviewed sheets can be completed without rewrite', () => {
  const root = campaign([['key.md', sheet()]]); prepareItemDescriptions(root);
  const bad = sheet().replace('No game effect.', 'Burns the holder.');
  assert.equal(stageItemDescriptionDraft(root, 'Objects/key.md', bad).errors[0].code, 'outside-description-changed');
  assert.equal(stageItemDescriptionDraft(root, 'Objects/key.md', sheet()).status, 'staged');
  assert.equal(verifyItemDescriptionDrafts(root, ['Objects/key.md']).status, 'verified');
  assert.equal(completeItemDescriptions(root, ['Objects/key.md']).status, 'complete');
});

test('completion requires a published sheet matching its verified draft', () => {
  const root = campaign([['key.md', sheet()]]); prepareItemDescriptions(root);
  stageItemDescriptionDraft(root, 'Objects/key.md', sheet()); verifyItemDescriptionDrafts(root, ['Objects/key.md']);
  fs.writeFileSync(path.join(root, 'Objects/key.md'), sheet('A changed key.'));
  assert.equal(completeItemDescriptions(root, ['Objects/key.md']).status, 'pending');
});

function completeSheet(root, file) {
  prepareItemDescriptions(root);
  assert.equal(stageItemDescriptionDraft(root, file, fs.readFileSync(path.join(root, file), 'utf8')).status, 'staged');
  assert.equal(verifyItemDescriptionDrafts(root, [file]).status, 'verified');
  return completeItemDescriptions(root, [file]);
}

test('a complete item moved byte-identical to a new folder stays complete', () => {
  const root = campaign([['key.md', sheet()]]);
  assert.equal(completeSheet(root, 'Objects/key.md').status, 'complete');
  fs.mkdirSync(path.join(root, 'Objects/Sub'));
  fs.renameSync(path.join(root, 'Objects/key.md'), path.join(root, 'Objects/Sub/key.md'));
  const result = prepareItemDescriptions(root);
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.items.map((x) => [x.file, x.status]), [['Objects/Sub/key.md', 'complete']]);
});

test('a moved item whose bytes also changed becomes a new pending item', () => {
  const root = campaign([['key.md', sheet()]]);
  assert.equal(completeSheet(root, 'Objects/key.md').status, 'complete');
  fs.mkdirSync(path.join(root, 'Objects/Sub'));
  fs.renameSync(path.join(root, 'Objects/key.md'), path.join(root, 'Objects/Sub/key.md'));
  fs.appendFileSync(path.join(root, 'Objects/Sub/key.md'), '\nEdited after the move.\n');
  const result = prepareItemDescriptions(root);
  assert.equal(result.status, 'pending');
  assert.deepEqual(result.items.map((x) => [x.file, x.status]), [['Objects/Sub/key.md', 'pending']]);
});

test('ambiguous moves with the same bytes are not reused', () => {
  const root = campaign([['a.md', sheet()], ['b.md', sheet()]]);
  assert.equal(completeSheet(root, 'Objects/a.md').status, 'pending');
  assert.equal(completeSheet(root, 'Objects/b.md').status, 'complete');
  fs.rmSync(path.join(root, 'Objects/a.md'));
  fs.rmSync(path.join(root, 'Objects/b.md'));
  fs.mkdirSync(path.join(root, 'Objects/Sub'));
  fs.writeFileSync(path.join(root, 'Objects/Sub/key.md'), sheet());
  const result = prepareItemDescriptions(root);
  assert.equal(result.status, 'pending');
  assert.deepEqual(result.items.map((x) => [x.file, x.status]), [['Objects/Sub/key.md', 'pending']]);
});

test('completion reports a listed file that does not exist as unverified instead of throwing', () => {
  const root = campaign([['key.md', sheet()]]);
  prepareItemDescriptions(root);
  assert.deepEqual(completeItemDescriptions(root, ['Objects/missing.md']), {
    status: 'pending',
    errors: [{ code: 'unverified-publication', file: 'Objects/missing.md' }],
  });
});

const K = 'item-knowledge-v1';
function knowledgeComplete(root, file, draftText) {
  prepareItemDescriptions(root, { migration: K });
  assert.equal(stageItemDescriptionDraft(root, file, draftText, K).status, 'staged');
  assert.equal(verifyItemDescriptionDrafts(root, [file], K).status, 'verified');
  return completeItemDescriptions(root, [file], K);
}

test('knowledge: moving a public fact into the master block verifies and completes', () => {
  const source = sheet().replace('A key made of silver.', 'A key made of silver. It is cursed.');
  const root = campaign([['key.md', source]]);
  const draft = source.replace(' It is cursed.', '').replace('secret\n<!-- /master -->', 'secret\nIt is cursed.\n<!-- /master -->');
  prepareItemDescriptions(root, { migration: K });
  assert.equal(stageItemDescriptionDraft(root, 'Objects/key.md', draft, K).status, 'staged');
  assert.equal(verifyItemDescriptionDrafts(root, ['Objects/key.md'], K).status, 'verified');
  const published = path.join(root, 'Objects/key.md'); fs.writeFileSync(published, draft);
  assert.equal(completeItemDescriptions(root, ['Objects/key.md'], K).status, 'complete');
  assert.ok(fs.existsSync(path.join(root, '.campaign/state/update/item-knowledge.json')));
  assert.equal(fs.existsSync(path.join(root, '.campaign/state/update/item-descriptions.json')), false);
});

test('knowledge: effects may change, but the title may not', () => {
  const root = campaign([['key.md', sheet()]]);
  prepareItemDescriptions(root, { migration: K });
  assert.equal(stageItemDescriptionDraft(root, 'Objects/key.md', sheet().replace('No game effect.', 'Nessun effetto di gioco'), K).status, 'staged');
  const bad = stageItemDescriptionDraft(root, 'Objects/key.md', sheet().replace('# Key', '# Big key'), K);
  assert.equal(bad.status, 'failed');
  assert.equal(bad.errors[0].code, 'head-changed');
});

test('knowledge: dropping a master line fails with master-notes-lost', () => {
  const root = campaign([['key.md', sheet()]]);
  prepareItemDescriptions(root, { migration: K });
  const draft = sheet().replace('secret\n<!-- /master -->', 'other\n<!-- /master -->');
  assert.equal(stageItemDescriptionDraft(root, 'Objects/key.md', draft, K).status, 'staged');
  const result = verifyItemDescriptionDrafts(root, ['Objects/key.md'], K);
  assert.equal(result.status, 'failed');
  assert.equal(result.errors[0].code, 'master-notes-lost');
});

test('knowledge: empty Effects fails with public-sections-missing', () => {
  const root = campaign([['key.md', sheet()]]);
  prepareItemDescriptions(root, { migration: K });
  const draft = sheet().replace('No game effect.', '');
  assert.equal(stageItemDescriptionDraft(root, 'Objects/key.md', draft, K).status, 'staged');
  const result = verifyItemDescriptionDrafts(root, ['Objects/key.md'], K);
  assert.equal(result.status, 'failed');
  assert.equal(result.errors[0].code, 'public-sections-missing');
});

test('knowledge: text after the master block fails with master-block-invalid', () => {
  const root = campaign([['key.md', sheet()]]);
  prepareItemDescriptions(root, { migration: K });
  const draft = `${sheet()}Trailing text.\n`;
  assert.equal(stageItemDescriptionDraft(root, 'Objects/key.md', draft, K).status, 'staged');
  const result = verifyItemDescriptionDrafts(root, ['Objects/key.md'], K);
  assert.equal(result.status, 'failed');
  assert.equal(result.errors[0].code, 'master-block-invalid');
});

test('converting the metadata block to the comment form does not mark items changed', () => {
  const root = campaign([['key.md', sheet()]]);
  const file = path.join(root, 'Objects/key.md');
  assert.equal(prepareItemDescriptions(root).items[0].status, 'pending');
  fs.writeFileSync(file, toCommentMetadata(fs.readFileSync(file, 'utf8')));
  assert.equal(prepareItemDescriptions(root).items[0].status, 'pending');
  fs.appendFileSync(file, '\nMaster edit\n');
  assert.equal(prepareItemDescriptions(root).items[0].status, 'changed');
});

test('an inventory saved with the old plain hash is upgraded, not marked changed', () => {
  const root = campaign([['key.md', sheet()]]);
  const file = 'Objects/key.md';
  const stateFile = path.join(root, '.campaign/state/update/item-descriptions.json');
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const oldHash = createHash('sha256').update(sheet()).digest('hex');
  fs.writeFileSync(stateFile, JSON.stringify({ migration_id: 'item-descriptions-v1', items: [{ file, source: oldHash, status: 'pending' }] }, null, 2));
  fs.writeFileSync(path.join(root, file), toCommentMetadata(sheet()));
  const result = prepareItemDescriptions(root);
  assert.equal(result.items[0].status, 'pending');
  assert.equal('legacy' in result.items[0], false);
  assert.equal('legacy' in JSON.parse(fs.readFileSync(stateFile, 'utf8')).items[0], false);
});

test('the two migrations keep separate inventories', () => {
  const root = campaign([['key.md', sheet()]]);
  assert.equal(knowledgeComplete(root, 'Objects/key.md', sheet()).status, 'complete');
  assert.equal(prepareItemDescriptions(root, { migration: K }).status, 'complete');
  assert.equal(prepareItemDescriptions(root).status, 'pending');
});
