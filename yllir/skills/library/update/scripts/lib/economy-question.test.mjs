import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ECONOMY_STATE, applyEconomyQuestion, completeEconomyQuestion, deferEconomy, detectEconomyQuestion, economyStatus } from './economy-question.mjs';

const roots = [];
after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

const CAMPAIGN = ['campaign:', '  name: "Test"', 'language:', '  main: it', 'structure:', '  - id: storia', '    folder: Storia', '    type: free', ''].join('\n');
const ECONOMY = '<!-- yllir\nid: economia\nprovenance: master\n-->\n\n# Economia\n';

/** A temporary campaign, with the economy document when `economy` is true. */
function campaign({ economy = false, state = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-economy-question-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'campaign.yaml'), CAMPAIGN);
  fs.mkdirSync(path.join(root, 'Storia'), { recursive: true });
  if (economy) fs.writeFileSync(path.join(root, 'Storia/Economia.md'), ECONOMY);
  if (state !== null) {
    fs.mkdirSync(path.join(root, path.dirname(ECONOMY_STATE)), { recursive: true });
    fs.writeFileSync(path.join(root, ECONOMY_STATE), state);
  }
  return root;
}

test('a campaign with no economy document and no answer is open', () => {
  const root = campaign();
  assert.equal(economyStatus(root), 'open');
  assert.equal(detectEconomyQuestion(root), true);
  assert.equal(applyEconomyQuestion(root).status, 'pending');
  assert.equal(completeEconomyQuestion(root).status, 'pending');
});

test('an economy document makes the question present, whatever the state file says', () => {
  const root = campaign({ economy: true, state: '{ "status": "deferred" }' });
  assert.equal(economyStatus(root), 'present');
  assert.equal(detectEconomyQuestion(root), false);
  assert.equal(applyEconomyQuestion(root).status, 'complete');
  assert.equal(completeEconomyQuestion(root).status, 'complete');
});

test('deferring records the answer, and the campaign is then not open', () => {
  const root = campaign();
  assert.deepEqual(deferEconomy(root), { status: 'deferred' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, ECONOMY_STATE), 'utf8')).status, 'deferred');
  assert.equal(detectEconomyQuestion(root), false);
  assert.equal(applyEconomyQuestion(root).status, 'complete');
  assert.equal(completeEconomyQuestion(root).status, 'complete');
});

test('deferring a campaign that already has an economy document writes no state file', () => {
  const root = campaign({ economy: true });
  assert.deepEqual(deferEconomy(root), { status: 'present' });
  assert.equal(fs.existsSync(path.join(root, ECONOMY_STATE)), false);
});

test('an unreadable state file counts as open, not as deferred', () => {
  const root = campaign({ state: '{ not json' });
  assert.equal(economyStatus(root), 'open');
  const other = campaign({ state: '{ "status": "something" }' });
  assert.equal(economyStatus(other), 'open');
});
