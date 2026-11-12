import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyOp, getCombat } from './combat-store.mjs';
import { pluginRootFromHere } from '../../../../../scripts/lib/adapter.mjs';

const INIT = path.join(pluginRootFromHere(), 'skills', 'library', 'new-campaign', 'scripts', 'init-campaign.mjs');
const SESSION = '2026-11-12';
const NOW = '2026-11-12T10:00:00.000Z';

// A campaign folder in the temp directory, with the D&D 2024 adapter, and a live session open.
function makeCampaign(adapter = 'dnd-2024') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'combat-store-'));
  const run = spawnSync(process.execPath, [INIT, root, '--name', 'T', '--language', 'en', '--register', 'plain', '--world', 'W', '--seed', 'World seed.md', '--adapter', adapter], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout);
  return root;
}

function openLive(root, id = SESSION) {
  const dir = path.join(root, '.campaign', 'state', 'live', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ id, title: 'Test', startedAt: NOW }, null, 2));
  fs.writeFileSync(path.join(root, '.campaign', 'state', 'live', 'active.json'), JSON.stringify({ sessionId: id }));
}

function combatPath(root, id = SESSION) {
  return path.join(root, '.campaign', 'state', 'live', id, 'combat.json');
}

describe('combat store', () => {
  let root;
  before(() => {
    root = makeCampaign();
    fs.mkdirSync(path.join(root, 'people'), { recursive: true });
    fs.writeFileSync(path.join(root, 'people', 'goblin.md'), '# Goblin\n');
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  test('no live session: getCombat and applyOp refuse with no-live-session', async () => {
    const empty = makeCampaign();
    try {
      assert.equal(getCombat(empty).error.code, 'no-live-session');
      assert.equal((await applyOp(empty, { op: 'start' }, { now: NOW })).error.code, 'no-live-session');
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  test('a live session without a combat file gives a null combat', () => {
    openLive(root);
    const got = getCombat(root);
    assert.equal(got.ok, true);
    assert.equal(got.combat, null);
  });

  test('an operation before the start refuses with no-combat and saves nothing', async () => {
    const result = await applyOp(root, { op: 'add', name: 'Goblin 1', side: 'enemy', hp: 7 }, { now: NOW });
    assert.equal(result.error.code, 'no-combat');
    assert.equal(fs.existsSync(combatPath(root)), false);
  });

  test('start creates the combat active, and a second start is refused', async () => {
    const first = await applyOp(root, { op: 'start' }, { now: NOW });
    assert.equal(first.ok, true);
    assert.equal(first.combat.active, true);
    assert.equal(first.combat.round, 0);
    const second = await applyOp(root, { op: 'start' }, { now: NOW });
    assert.equal(second.error.code, 'already-active');
  });

  test('the saved file is written atomically with mode 0600, and no temp file is left behind', async () => {
    const added = await applyOp(root, { op: 'add', name: 'Goblin 1', side: 'enemy', initiative: 12, hp: 7, sheet: 'people/goblin.md' }, { now: NOW });
    assert.equal(added.ok, true);
    assert.equal(fs.statSync(combatPath(root)).mode & 0o777, 0o600);
    const leftovers = fs.readdirSync(path.dirname(combatPath(root))).filter((name) => name.endsWith('.tmp'));
    assert.deepEqual(leftovers, []);
    const onDisk = JSON.parse(fs.readFileSync(combatPath(root), 'utf8'));
    assert.equal(onDisk.combatants[0].sheet, 'people/goblin.md');
    assert.deepEqual(getCombat(root).combat, onDisk);
  });

  test('a sheet outside the campaign, with .. or missing is refused with bad-sheet', async () => {
    for (const sheet of ['../outside.md', '/etc/passwd', 'people/missing.md', 'people/..', 'people\\goblin.md']) {
      const result = await applyOp(root, { op: 'add', name: 'X', side: 'enemy', hp: 1, sheet }, { now: NOW });
      assert.equal(result.error.code, 'bad-sheet', sheet);
    }
  });

  test('an invalid resulting state is not saved', async () => {
    const before = fs.readFileSync(combatPath(root), 'utf8');
    const broken = JSON.parse(before);
    broken.combatants[0].conditions.push({ id: 'dazed', duration: 'until_removed' });
    fs.writeFileSync(combatPath(root), JSON.stringify(broken, null, 2));
    const saved = fs.readFileSync(combatPath(root), 'utf8');
    const result = await applyOp(root, { op: 'note', id: 'c-1', text: 'Watches the door' }, { now: NOW });
    assert.equal(result.error.code, 'invalid-state');
    assert.match(result.error.message, /unknown condition dazed/);
    assert.equal(fs.readFileSync(combatPath(root), 'utf8'), saved);
    fs.writeFileSync(combatPath(root), before);
  });

  test('a refused rule leaves the saved state as it was', async () => {
    const before = fs.readFileSync(combatPath(root), 'utf8');
    const result = await applyOp(root, { op: 'condition-add', id: 'c-1', condition: 'dazed' }, { now: NOW });
    assert.equal(result.error.code, 'unknown-condition');
    assert.equal(fs.readFileSync(combatPath(root), 'utf8'), before);
  });

  test('the campaign files are never touched by the tracker', async () => {
    const campaignYaml = fs.readFileSync(path.join(root, 'campaign.yaml'), 'utf8');
    const sheet = fs.readFileSync(path.join(root, 'people', 'goblin.md'), 'utf8');
    await applyOp(root, { op: 'damage', id: 'c-1', amount: 2 }, { now: NOW });
    assert.equal(fs.readFileSync(path.join(root, 'campaign.yaml'), 'utf8'), campaignYaml);
    assert.equal(fs.readFileSync(path.join(root, 'people', 'goblin.md'), 'utf8'), sheet);
  });

  test('end keeps the state and marks it inactive', async () => {
    const ended = await applyOp(root, { op: 'end' }, { now: NOW });
    assert.equal(ended.ok, true);
    assert.equal(ended.combat.active, false);
    assert.equal(ended.combat.combatants.length, 1);
    assert.equal(getCombat(root).combat.active, false);
  });
});

describe('combat store with no adapter', () => {
  test('a campaign without game rules refuses with no-adapter', async () => {
    const root = makeCampaign('none');
    try {
      openLive(root);
      assert.equal((await applyOp(root, { op: 'start' }, { now: NOW })).error.code, 'no-adapter');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('an unknown adapter in campaign.yaml refuses with no-adapter', async () => {
    const root = makeCampaign();
    try {
      openLive(root);
      const yaml = path.join(root, 'campaign.yaml');
      fs.writeFileSync(yaml, fs.readFileSync(yaml, 'utf8').replace('adapter: dnd-2024', 'adapter: not-installed'));
      assert.equal((await applyOp(root, { op: 'start' }, { now: NOW })).error.code, 'no-adapter');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('combat store file location', () => {
  test('the file of the combat is the one of the open session', async () => {
    const root = makeCampaign();
    try {
      openLive(root, '2026-11-12-2');
      const result = await applyOp(root, { op: 'start' }, { now: NOW });
      assert.equal(result.sessionId, '2026-11-12-2');
      assert.equal(fs.existsSync(combatPath(root, '2026-11-12-2')), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
