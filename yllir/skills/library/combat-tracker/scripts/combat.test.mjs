import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pluginRootFromHere } from '../../../../scripts/lib/adapter.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, 'combat.mjs');
const INIT = path.join(pluginRootFromHere(), 'skills', 'library', 'new-campaign', 'scripts', 'init-campaign.mjs');
const SESSION = '2026-11-12';

// Runs the CLI and splits its output: the JSON document and the final `exit:` line.
function cli(args) {
  const run = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  const lines = run.stdout.trimEnd().split('\n');
  const last = lines.pop();
  assert.match(last, /^exit: \d+$/, `last line was ${last}`);
  const code = Number(last.slice('exit: '.length));
  assert.equal(run.status, code);
  const json = lines.length ? JSON.parse(lines.join('\n')) : null;
  return { code, json };
}

describe('combat CLI exit codes', () => {
  let root;
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'combat-cli-'));
    const run = spawnSync(process.execPath, [INIT, root, '--name', 'T', '--language', 'en', '--register', 'plain', '--world', 'W', '--seed', 'World seed.md', '--adapter', 'dnd-2024'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout);
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  test('usage errors exit with 2', () => {
    assert.equal(cli([]).code, 2);
    assert.equal(cli(['fly', root]).code, 2);
    assert.equal(cli(['start']).code, 2);
    assert.equal(cli(['add', root, '--name', 'X']).code, 2); // side missing
    assert.equal(cli(['damage', root, '--id', 'c-1']).code, 2); // amount missing
    assert.equal(cli(['damage', root, '--id', 'c-1', '--amount', '1.5']).code, 2);
    assert.equal(cli(['add', root, '--name', 'X', '--side', 'enemy', '--hp', 'ten']).code, 2);
    assert.equal(cli(['start', root, '--bogus', '1']).code, 2);
    assert.equal(cli(['start', root, '--hp']).code, 2);
  });

  test('a usage error still prints a JSON document before the exit line', () => {
    const { json, code } = cli(['fly', root]);
    assert.equal(code, 2);
    assert.equal(json.ok, false);
    assert.equal(json.error.code, 'usage');
  });

  test('a domain error with no game in progress exits with 1', () => {
    const { code, json } = cli(['status', root]);
    assert.equal(code, 1);
    assert.equal(json.error.code, 'no-live-session');
  });

  test('a negative whole number is accepted for initiative', () => {
    const dir = path.join(root, '.campaign', 'state', 'live', SESSION);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(root, '.campaign', 'state', 'live', 'active.json'), JSON.stringify({ sessionId: SESSION }));
    assert.equal(cli(['start', root]).code, 0);
    const added = cli(['add', root, '--name', 'Slow', '--side', 'enemy', '--initiative', '-2', '--hp', '3']);
    assert.equal(added.code, 0);
    assert.equal(added.json.combat.combatants[0].initiative, -2);
  });
});

describe('a full scripted encounter through the CLI', () => {
  let root;
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'combat-full-'));
    const run = spawnSync(process.execPath, [INIT, root, '--name', 'T', '--language', 'en', '--register', 'plain', '--world', 'W', '--seed', 'World seed.md', '--adapter', 'dnd-2024'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout);
    const dir = path.join(root, '.campaign', 'state', 'live', SESSION);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ id: SESSION, title: 'Test', startedAt: '2026-11-12T10:00:00.000Z' }, null, 2));
    fs.writeFileSync(path.join(root, '.campaign', 'state', 'live', 'active.json'), JSON.stringify({ sessionId: SESSION }));
    fs.mkdirSync(path.join(root, 'people'), { recursive: true });
    fs.writeFileSync(path.join(root, 'people', 'goblin.md'), '# Goblin\n');
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  test('runs a whole fight and every step exits as expected', () => {
    const steps = [
      [['start', root], 0],
      [['add', root, '--name', 'Ilde', '--side', 'pc', '--initiative', '14', '--hp', '12'], 0],
      [['add', root, '--name', 'Goblin 1', '--side', 'enemy', '--initiative', '14', '--hp', '7', '--ac', '15', '--sheet', 'people/goblin.md'], 0],
      [['add', root, '--name', 'Goblin 2', '--side', 'enemy', '--initiative', '9', '--hp', '7'], 0],
      [['next', root], 0],
      [['damage', root, '--id', 'c-2', '--amount', '5'], 0],
      [['condition-add', root, '--id', 'c-2', '--condition', 'poisoned', '--duration', 'rounds', '--rounds', '1'], 0],
      [['condition-add', root, '--id', 'c-2', '--condition', 'dazed'], 1],
      [['next', root], 0],
      [['next', root], 0],
      [['damage', root, '--id', 'c-3', '--amount', '9'], 0],
      [['damage', root, '--id', 'c-1', '--amount', '12'], 0],
      [['heal', root, '--id', 'c-1', '--amount', '3'], 0],
      [['resource', root, '--id', 'c-2', '--resource', 'hp', '--delta', '1'], 1],
      [['resource', root, '--id', 'c-2', '--resource', 'spell_slots', '--value', '1'], 0],
      [['remove', root, '--id', 'c-3'], 0],
      [['end', root], 0],
      [['next', root], 1],
      [['status', root], 0],
    ];
    for (const [args, expected] of steps) {
      const { code, json } = cli(args);
      assert.equal(code, expected, `${args.join(' ')} gave ${JSON.stringify(json)}`);
    }
  });

  test('the state after the fight shows the rules at work', () => {
    const { json, code } = cli(['status', root]);
    assert.equal(code, 0);
    const combat = json.combat;
    assert.equal(combat.active, false);
    assert.equal(combat.round, 1);
    const ilde = combat.combatants.find((c) => c.name === 'Ilde');
    assert.equal(ilde.hp, 3);
    assert.deepEqual(ilde.conditions, []);
    assert.equal(combat.combatants.some((c) => c.name === 'Goblin 2'), false);
    assert.equal(combat.combatants.find((c) => c.name === 'Goblin 1').sheet, 'people/goblin.md');
    assert.equal(combat.events.at(-1).text, 'Combat ends in round 1');
  });

  test('a second combat can start after the first ends', () => {
    const { code, json } = cli(['start', root]);
    assert.equal(code, 0);
    assert.equal(json.combat.active, true);
    assert.equal(json.combat.combatants.length, 0);
  });

  test('a bad sheet path is a domain error', () => {
    const { code, json } = cli(['add', root, '--name', 'X', '--side', 'enemy', '--hp', '1', '--sheet', '../x.md']);
    assert.equal(code, 1);
    assert.equal(json.error.code, 'bad-sheet');
  });
});

describe('notices in the CLI output', () => {
  let root;
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'combat-notice-'));
    const run = spawnSync(process.execPath, [INIT, root, '--name', 'T', '--language', 'en', '--register', 'plain', '--world', 'W', '--seed', 'World seed.md', '--adapter', 'dnd-2024'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout);
    const dir = path.join(root, '.campaign', 'state', 'live', SESSION);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(root, '.campaign', 'state', 'live', 'active.json'), JSON.stringify({ sessionId: SESSION }));
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  test('a damage to 0 shows a defeated notice in the output', () => {
    assert.equal(cli(['start', root]).code, 0);
    assert.equal(cli(['add', root, '--name', 'Goblin 1', '--side', 'enemy', '--hp', '3']).code, 0);
    const { code, json } = cli(['damage', root, '--id', 'c-1', '--amount', '3']);
    assert.equal(code, 0);
    assert.deepEqual(json.notices, [{ kind: 'defeated', id: 'c-1', name: 'Goblin 1' }]);
  });
});
