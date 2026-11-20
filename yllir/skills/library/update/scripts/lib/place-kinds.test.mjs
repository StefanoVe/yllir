import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { markReviewed, placeKindCandidates, STATE_FILE } from './place-kinds.mjs';
import { apply } from '../../migrations/place-kinds-v1/deterministic.mjs';
import { complete } from '../../migrations/place-kinds-v1/complete.mjs';
import {
  campaignYaml, cleanupCampaigns, emptyLabels, makeCampaign, writeAtlas,
} from '../../../atlas/scripts/lib/test-support.mjs';

after(() => cleanupCampaigns());

/** A labels item for a place; provenance defaults to 'document'. */
function item(id, kind, provenance = 'document') {
  return { id, place: `${id}-sheet`, x: 10, y: 10, kind, provenance, sources: [], visibility: 'public' };
}

/** A campaign with an atlas whose labels hold the given places. */
function atlasCampaign(places) {
  const root = makeCampaign({});
  writeAtlas(root, { labels: emptyLabels({ places }) });
  return root;
}

test('no atlas: no candidates, apply and complete are complete', () => {
  const root = makeCampaign({}, { yaml: campaignYaml([{ id: 'luoghi', folder: 'World', type: 'places' }]) });
  assert.deepEqual(placeKindCandidates(root), []);
  assert.deepEqual(apply(root), { status: 'complete', changed: [], errors: [] });
  assert.deepEqual(complete(root), { status: 'complete', errors: [] });
});

test('a landmark chosen by the document is a candidate; a landmark chosen by the master is not; a shop is not', () => {
  const root = atlasCampaign([
    item('forge', 'landmark', 'document'),
    item('keep', 'landmark', 'master'),
    item('stall', 'shop', 'document'),
    item('town', 'town', 'document'),
  ]);
  assert.deepEqual(placeKindCandidates(root), [{ id: 'forge', place: 'forge-sheet' }]);
});

test('with candidates: apply is pending, changes nothing and creates no file', () => {
  const root = atlasCampaign([item('forge', 'landmark')]);
  assert.deepEqual(apply(root), { status: 'pending', changed: [], errors: [] });
  assert.equal(fs.existsSync(path.join(root, '.campaign')), false);
  assert.equal(complete(root).status, 'pending');
  assert.equal(complete(root).errors[0].code, 'place-kind-pending');
});

test('markReviewed records the id; afterwards nothing is pending and complete passes', () => {
  const root = atlasCampaign([item('forge', 'landmark'), item('well', 'landmark')]);
  const result = markReviewed(root);
  assert.deepEqual(result, { status: 'complete', reviewed: ['forge', 'well'] });
  assert.deepEqual(placeKindCandidates(root), []);
  assert.deepEqual(complete(root), { status: 'complete', errors: [] });

  const saved = JSON.parse(fs.readFileSync(path.join(root, STATE_FILE), 'utf8'));
  assert.deepEqual(saved, { reviewed: ['forge', 'well'] });
  assert.equal(fs.readFileSync(path.join(root, STATE_FILE), 'utf8').endsWith('}\n'), true);
});

test('markReviewed called twice keeps one copy of each id, sorted', () => {
  const root = atlasCampaign([item('well', 'landmark'), item('forge', 'landmark')]);
  markReviewed(root);
  const again = markReviewed(root);
  assert.deepEqual(again, { status: 'complete', reviewed: [] });
  const saved = JSON.parse(fs.readFileSync(path.join(root, STATE_FILE), 'utf8'));
  assert.deepEqual(saved.reviewed, ['forge', 'well']);
});

test('an invalid state file is treated as empty', () => {
  const root = atlasCampaign([item('forge', 'landmark')]);
  fs.mkdirSync(path.dirname(path.join(root, STATE_FILE)), { recursive: true });
  fs.writeFileSync(path.join(root, STATE_FILE), 'this is { not json');
  assert.deepEqual(placeKindCandidates(root), [{ id: 'forge', place: 'forge-sheet' }]);
});
