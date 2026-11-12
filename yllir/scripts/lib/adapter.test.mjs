import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { battleGrid, listAdapters, loadAdapter, pluginRootFromHere } from './adapter.mjs';

const root = pluginRootFromHere();
const manifest = path.join(root, 'modules/systems/dnd-2024/adapter.yaml');
const source = fs.readFileSync(manifest, 'utf8');

function withRoot(fn) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-adapter-'));
  try { return fn(temp); } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
function write(temp, id, content) {
  const dir = path.join(temp, 'modules/systems', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'adapter.yaml'), content);
}
function replace(text, before, after) {
  assert.ok(text.includes(before), `fixture should contain ${before}`);
  return text.replace(before, after);
}

test('discovers installed adapters in sorted order and loads the D&D manifest', () => {
  assert.deepEqual(listAdapters(root), ['dnd-2024']);
  const loaded = loadAdapter(root, 'dnd-2024');
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.adapter.id, 'dnd-2024');
  assert.equal(loaded.adapter.name, 'D&D 2024');
  assert.deepEqual(loaded.adapter.headings, {
    statistics: { it: 'Statistiche', en: 'Statistics' },
    description: { it: 'Descrizione', en: 'Description' },
    effects: { it: 'Effetti', en: 'Effects' },
    brief: { it: 'In breve', en: 'In brief' },
  });
  assert.equal(loaded.adapter.creature_sheet.required.length, 9);
  assert.deepEqual(loaded.adapter.item_sheet.printable_fields, ['title', 'description']);
  assert.deepEqual(battleGrid(loaded.adapter), { square: 5, unit: 'ft' });
});

test('missing systems folder returns an empty list; unknown adapter returns an issue', () => {
  withRoot((temp) => {
    assert.deepEqual(listAdapters(temp), []);
    const loaded = loadAdapter(temp, 'missing');
    assert.equal(loaded.ok, false);
    assert.equal(loaded.errors[0].code, 'unknown-adapter');
  });
});

test('malformed yaml reports bad-yaml', () => {
  withRoot((temp) => {
    write(temp, 'bad', 'id: [\n');
    assert.equal(loadAdapter(temp, 'bad').errors[0].code, 'bad-yaml');
  });
});

test('validates manifest identity, required values, and unknown top-level keys', () => {
  withRoot((temp) => {
    write(temp, 'dnd-2024', `${source}unexpected: value\n`);
    let errors = loadAdapter(temp, 'dnd-2024').errors;
    assert.ok(errors.some((e) => e.code === 'unknown-key' && e.path === 'unexpected'));
    fs.rmSync(path.join(temp, 'modules/systems/dnd-2024'), { recursive: true, force: true });
    write(temp, 'different-folder', source);
    assert.deepEqual(listAdapters(temp), ['dnd-2024']);
    errors = loadAdapter(temp, 'dnd-2024').errors;
    assert.ok(errors.some((e) => e.code === 'id-mismatch'));
    assert.equal(loadAdapter(temp, 'different-folder').errors[0].code, 'unknown-adapter');
    fs.rmSync(path.join(temp, 'modules/systems/different-folder'), { recursive: true, force: true });
    write(temp, 'dnd-2024', replace(source, 'id: dnd-2024', 'id: Bad_ID'));
    errors = loadAdapter(temp, 'dnd-2024').errors;
    assert.ok(errors.some((e) => e.path === 'id' && e.code === 'bad-value'));
    write(temp, 'dnd-2024', replace(source, 'name: "D&D 2024"', 'name: ""'));
    assert.ok(loadAdapter(temp, 'dnd-2024').errors.some((e) => e.path === 'name'));
    write(temp, 'dnd-2024', replace(source, 'version: 1', 'version: 1.5'));
    assert.ok(loadAdapter(temp, 'dnd-2024').errors.some((e) => e.path === 'version'));
    write(temp, 'dnd-2024', replace(source, 'encounters: turn-based', 'encounters: maybe'));
    assert.ok(loadAdapter(temp, 'dnd-2024').errors.some((e) => e.path === 'encounters'));
    write(temp, 'dnd-2024', replace(source, 'method: milestone', 'method: ""'));
    assert.ok(loadAdapter(temp, 'dnd-2024').errors.some((e) => e.path === 'progression.method'));
  });
});

test('validates required creature fields, unique ids, printable fields and do_not', () => {
  withRoot((temp) => {
    let broken = replace(source, 'label_en: AC', 'label_en: ""');
    write(temp, 'dnd-2024', broken);
    assert.ok(loadAdapter(temp, 'dnd-2024').errors.some((e) => e.path === 'creature_sheet.required[0].label_en'));
    broken = replace(source, 'id: hp\n      label_it: PF', 'id: ac\n      label_it: PF');
    write(temp, 'dnd-2024', broken);
    assert.ok(loadAdapter(temp, 'dnd-2024').errors.some((e) => e.code === 'duplicate-field-id'));
    broken = replace(source, 'printable_fields: [title, description]', 'printable_fields: []');
    write(temp, 'dnd-2024', broken);
    assert.ok(loadAdapter(temp, 'dnd-2024').errors.some((e) => e.path === 'item_sheet.printable_fields'));
    broken = replace(source, 'do_not:\n  - roll dice for the master\n  - choose targets\n  - decide the outcome of attacks, saves or checks\n  - add resistances, immunities or reductions the sheet does not declare\n  - rewrite a player character sheet', 'do_not: []');
    write(temp, 'dnd-2024', broken);
    assert.ok(loadAdapter(temp, 'dnd-2024').errors.some((e) => e.path === 'do_not'));
  });
});

test('validates heading keys and nonempty Italian and English labels', () => {
  withRoot((temp) => {
    let broken = replace(source, '    it: Statistiche', '    it: ""');
    write(temp, 'dnd-2024', broken);
    assert.ok(loadAdapter(temp, 'dnd-2024').errors.some((e) => e.path === 'headings.statistics.it'));

    broken = replace(source, '    en: Description', '    en: ""');
    write(temp, 'dnd-2024', broken);
    assert.ok(loadAdapter(temp, 'dnd-2024').errors.some((e) => e.path === 'headings.description.en'));

    broken = replace(source, '  effects:\n    it: Effetti\n    en: Effects', '  unexpected:\n    it: Effetti\n    en: Effects');
    write(temp, 'dnd-2024', broken);
    assert.ok(loadAdapter(temp, 'dnd-2024').errors.some((e) => e.path === 'headings.unexpected' && e.code === 'unknown-key'));

    broken = replace(source, '    en: Effects', '    fr: Effects');
    write(temp, 'dnd-2024', broken);
    const errors = loadAdapter(temp, 'dnd-2024').errors;
    assert.ok(errors.some((e) => e.path === 'headings.effects.en' && e.code === 'bad-value'));
    assert.ok(errors.some((e) => e.path === 'headings.effects.fr' && e.code === 'unknown-key'));
  });
});

test('optional battle_grid is validated and battleGrid gives the square size', () => {
  withRoot((temp) => {
    const plain = replace(source, 'battle_grid:\n  square: 5\n  unit: ft\n', '');
    const block = 'battle_grid:\n  square: 5\n  unit: ft\n';
    fs.mkdirSync(path.join(temp, 'modules/systems/dnd-2024'), { recursive: true });
    fs.writeFileSync(path.join(temp, 'modules/systems/dnd-2024/checks.mjs'), 'export {};\n');
    write(temp, 'dnd-2024', replace(plain, 'encounters: turn-based\n', `encounters: turn-based\n${block}`));
    let loaded = loadAdapter(temp, 'dnd-2024');
    assert.deepEqual(loaded.errors, []);
    assert.deepEqual(battleGrid(loaded.adapter), { square: 5, unit: 'ft' });

    write(temp, 'dnd-2024', plain);
    loaded = loadAdapter(temp, 'dnd-2024');
    assert.deepEqual(loaded.errors, []);
    assert.deepEqual(battleGrid(loaded.adapter), { square: 1, unit: null });
    assert.deepEqual(battleGrid(null), { square: 1, unit: null });

    const cases = [
      ['battle_grid:\n  square: 0\n  unit: ft\n', 'battle_grid.square'],
      ['battle_grid:\n  square: "5"\n  unit: ft\n', 'battle_grid.square'],
      ['battle_grid:\n  square: 5\n  unit: yd\n', 'battle_grid.unit'],
      ['battle_grid:\n  square: 5\n  unit: ft\n  extra: 1\n', 'battle_grid.extra'],
      ['battle_grid: 5\n', 'battle_grid'],
    ];
    for (const [block, at] of cases) {
      write(temp, 'dnd-2024', replace(plain, 'encounters: turn-based\n', `encounters: turn-based\n${block}`));
      const errors = loadAdapter(temp, 'dnd-2024').errors;
      assert.ok(errors.some((e) => e.path === at && e.code === (at.includes('.extra') ? 'unknown-key' : 'bad-value')), `${block} -> ${at}`);
    }
  });
});

test('optional checks key must name an existing .mjs file in the adapter folder', () => {
  withRoot((temp) => {
    const dir = path.join(temp, 'modules/systems/dnd-2024');
    const base = replace(source, 'checks: checks.mjs\n', '');
    write(temp, 'dnd-2024', base);
    assert.equal(loadAdapter(temp, 'dnd-2024').adapter.checksPath, undefined);

    write(temp, 'dnd-2024', `${base}checks: checks.mjs\n`);
    let loaded = loadAdapter(temp, 'dnd-2024');
    assert.ok(loaded.errors.some((e) => e.code === 'missing-file' && e.path === 'checks'));

    fs.writeFileSync(path.join(dir, 'checks.mjs'), 'export function checkCreature() { return []; }\n');
    loaded = loadAdapter(temp, 'dnd-2024');
    assert.deepEqual(loaded.errors, []);
    assert.equal(loaded.adapter.checksPath, path.join(dir, 'checks.mjs'));

    for (const bad of ['../checks.mjs', 'sub/checks.mjs', 'checks.js']) {
      write(temp, 'dnd-2024', `${base}checks: ${bad}\n`);
      const errors = loadAdapter(temp, 'dnd-2024').errors;
      assert.ok(errors.some((e) => e.code === 'bad-value' && e.path === 'checks'), bad);
      assert.equal(loadAdapter(temp, 'dnd-2024').adapter.checksPath, undefined, bad);
    }
  });
});
