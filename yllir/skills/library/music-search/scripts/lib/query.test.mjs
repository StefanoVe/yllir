import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildMusicQuery } from './query.mjs';

const CAMPAIGN = [
  'schema: 1',
  'campaign:',
  '  name: "T"',
  '  seed: "World seed.md"',
  'language:',
  '  main: en',
  'structure:',
  '  - id: places',
  '    folder: Places',
  '    type: places',
  '  - id: secrets',
  '    folder: Secrets',
  '    type: master-only',
  'modules:',
  '  music: true',
  '',
].join('\n');

const PLACE = `<!-- yllir
id: sette-vele-inn
kind: place
provenance: master
location: []
-->

# Sette Vele Inn

## Description

The common room is crowded, the rain beats on the shutters, and fog rises from the pier at night.

<!-- master -->
## Master

### Master notes

The inn is run for Ilde Varno, a smuggler who keeps a cellar full of contraband.

### Music

- [Old link](https://youtu.be/abc) — stale
<!-- /master -->
`;

const SECRET = `<!-- yllir
id: ilde-varno
kind: character
template: npc
provenance: master
location: []
aliases: [Night]
-->

# Ilde Varno

Master-only.
`;

function makeCampaign(files, { campaign = CAMPAIGN } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-query-'));
  fs.writeFileSync(path.join(dir, 'campaign.yaml'), campaign);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

test('query uses the public part, the atmosphere lexicon and the title', () => {
  const root = makeCampaign({ 'Places/Sette Vele Inn.md': PLACE, 'Secrets/Ilde Varno.md': SECRET });
  const result = buildMusicQuery({ root, place: 'Places/Sette Vele Inn.md' });
  assert.equal(result.ok, true);
  assert.match(result.query, /^sette vele inn /);
  assert.ok(result.query.endsWith(' ambience soundtrack'));
  for (const term of ['rain', 'fog', 'pier', 'crowded']) assert.ok(result.mood_words.includes(term), term);
});

test('nothing from the master-only block reaches the query', () => {
  const root = makeCampaign({ 'Places/Sette Vele Inn.md': PLACE, 'Secrets/Ilde Varno.md': SECRET });
  const result = buildMusicQuery({ root, place: 'Places/Sette Vele Inn.md' });
  for (const secret of ['smuggler', 'contraband', 'cellar', 'varno', 'stale', 'youtu']) {
    assert.doesNotMatch(result.query, new RegExp(secret));
  }
});

test('a secret alias that also appears as a public word is dropped and listed as excluded', () => {
  const root = makeCampaign({ 'Places/Sette Vele Inn.md': PLACE, 'Secrets/Ilde Varno.md': SECRET });
  const result = buildMusicQuery({ root, place: 'Places/Sette Vele Inn.md' });
  assert.ok(!result.mood_words.includes('night'));
  assert.ok(!result.query.split(' ').includes('night'));
  assert.deepEqual(result.excluded, [{ term: 'night', reason: 'name of another subject of the campaign' }]);
});

test('a secret name that only sits in the master-only part is never gathered', () => {
  const root = makeCampaign({ 'Places/Sette Vele Inn.md': PLACE, 'Secrets/Ilde Varno.md': SECRET });
  const result = buildMusicQuery({ root, place: 'Places/Sette Vele Inn.md' });
  assert.equal(result.excluded.some((e) => e.term === 'ilde' || e.term === 'varno'), false);
});

test('the module must be on', () => {
  const off = CAMPAIGN.replace('music: true', 'music: false');
  const root = makeCampaign({ 'Places/Sette Vele Inn.md': PLACE }, { campaign: off });
  assert.equal(buildMusicQuery({ root, place: 'Places/Sette Vele Inn.md' }).error, 'module-off');
});

test('a master-only sheet cannot be searched', () => {
  const root = makeCampaign({ 'Secrets/Ilde Varno.md': SECRET });
  assert.equal(buildMusicQuery({ root, place: 'Secrets/Ilde Varno.md' }).error, 'not-public');
});

test('paths outside the campaign and missing sheets are refused', () => {
  const root = makeCampaign({ 'Places/Sette Vele Inn.md': PLACE });
  assert.equal(buildMusicQuery({ root, place: '../outside.md' }).error, 'not-found');
  assert.equal(buildMusicQuery({ root, place: 'Places/Missing.md' }).error, 'not-found');
});

test('a campaign whose index has errors is refused (fail closed)', () => {
  const root = makeCampaign({ 'Places/Sette Vele Inn.md': PLACE }, { campaign: 'schema: 1\n' });
  assert.equal(buildMusicQuery({ root, place: 'Places/Sette Vele Inn.md' }).ok, false);
});

test('a sheet with no usable public words is refused', () => {
  const bare = '<!-- yllir\nid: x-y\nkind: place\nprovenance: master\nlocation: []\n-->\n\n# Ab\n';
  const root = makeCampaign({ 'Places/Ab.md': bare });
  assert.equal(buildMusicQuery({ root, place: 'Places/Ab.md' }).error, 'no-terms');
});
