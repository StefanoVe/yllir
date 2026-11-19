import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listStyles, loadStyle, resolveStyleId, validateStyleJson, STYLES_DIR } from './styles.mjs';
import { pluginRootFromHere } from '../../../../../scripts/lib/adapter.mjs';

const PLUGIN = pluginRootFromHere();
const SHIPPED = ['fantasy-color', 'antique-parchment', 'dark-fantasy'];
const ADAPTER_CONFIG = { system: { adapter: 'dnd-2024' } };

function withTemp(fn) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-styles-'));
  try { return fn(temp); } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

// A temporary plugin with a D&D adapter that declares the given atlas_style.
function pluginWithAdapterStyle(temp, style) {
  const dir = path.join(temp, 'modules/systems/dnd-2024');
  fs.mkdirSync(dir, { recursive: true });
  const source = fs.readFileSync(path.join(PLUGIN, 'modules/systems/dnd-2024/adapter.yaml'), 'utf8');
  fs.writeFileSync(path.join(dir, 'adapter.yaml'), source.replace('atlas_style: fantasy-color', `atlas_style: ${style}`));
  fs.copyFileSync(path.join(PLUGIN, 'modules/systems/dnd-2024/checks.mjs'), path.join(dir, 'checks.mjs'));
  return temp;
}

// A temporary copy of the styles folder. The copy's manifest.json of each listed style is removed,
// so that style is declared but not installed. The real folder is never changed.
function stylesCopyWithout(temp, uninstalled = []) {
  const root = path.join(temp, 'styles');
  fs.cpSync(STYLES_DIR, root, { recursive: true });
  for (const id of uninstalled) fs.rmSync(path.join(root, id, 'manifest.json'), { force: true });
  return root;
}

function readShipped(id) {
  return JSON.parse(fs.readFileSync(path.join(STYLES_DIR, id, 'style.json'), 'utf8'));
}

test('each shipped style.json validates', () => {
  for (const id of SHIPPED) {
    assert.deepEqual(validateStyleJson(readShipped(id)), [], `${id} should validate`);
  }
});

test('validateStyleJson refuses a bad colour, a negative size, a missing key and an unknown key', () => {
  const good = readShipped('fantasy-color');
  const paths = (obj) => validateStyleJson(obj).map((p) => p.path);
  assert.deepEqual(paths({ ...good, coast: { ...good.coast, color: 'brown' } }), ['coast.color']);
  assert.deepEqual(paths({ ...good, coast: { ...good.coast, width: -1 } }), ['coast.width']);
  const { vignette, ...missing } = good;
  assert.deepEqual(paths(missing), ['vignette']);
  assert.deepEqual(paths({ ...good, extra: 1 }), ['extra']);
  assert.deepEqual(paths({ ...good, labels: { ...good.labels, realmDarken: -0.2 } }), [], 'realmDarken may be negative');
  assert.deepEqual(paths({ ...good, fonts: { ...good.fonts, place: 'Comic Sans' } }), ['fonts.place']);
});

test('listStyles shows the three styles sorted, all installed', () => {
  const list = listStyles();
  assert.deepEqual(list.map((s) => s.id), ['antique-parchment', 'dark-fantasy', 'fantasy-color']);
  const byId = Object.fromEntries(list.map((s) => [s.id, s]));
  for (const id of SHIPPED) assert.equal(byId[id].installed, true, `${id} should be installed`);
  assert.deepEqual(byId['antique-parchment'].names, { it: 'Pergamena antica', en: 'Antique parchment' });
});

test('listStyles reports a declared style without a manifest as not installed', () => withTemp((temp) => {
  const root = stylesCopyWithout(temp, ['dark-fantasy']);
  const byId = Object.fromEntries(listStyles({ root }).map((s) => [s.id, s]));
  assert.equal(byId['dark-fantasy'].installed, false);
  assert.equal(byId['antique-parchment'].installed, true);
}));

test('loadStyle returns the style, its manifest and folder for every installed style', () => {
  const loaded = loadStyle('fantasy-color');
  assert.equal(loaded.style.id, 'fantasy-color');
  assert.equal(loaded.manifest.stamps.length > 0, true);
  assert.equal(loaded.dir, path.join(STYLES_DIR, 'fantasy-color'));
  for (const id of ['antique-parchment', 'dark-fantasy']) {
    assert.equal(loadStyle(id).style.id, id, `${id} should load`);
  }
  assert.throws(() => loadStyle('no-such-style'), (e) => e.code === 'unknown-style');
  assert.throws(() => loadStyle('../fantasy-color'), (e) => e.code === 'unknown-style');
});

test('loadStyle refuses a declared style whose manifest is missing, in a temporary copy', () => withTemp((temp) => {
  const root = stylesCopyWithout(temp, ['antique-parchment']);
  assert.throws(() => loadStyle('antique-parchment', { root }), (e) => e.code === 'style-not-installed');
  assert.equal(loadStyle('dark-fantasy', { root }).style.id, 'dark-fantasy');
}));

test('resolution: a master style that is installed wins over the adapter', () => {
  assert.deepEqual(resolveStyleId({ atlasStyle: 'fantasy-color', campaignConfig: ADAPTER_CONFIG }), {
    id: 'fantasy-color', source: 'master', requested: null,
  });
  assert.deepEqual(resolveStyleId({ atlasStyle: 'dark-fantasy', campaignConfig: ADAPTER_CONFIG }), {
    id: 'dark-fantasy', source: 'master', requested: null,
  });
});

test('resolution: auto or no choice uses the adapter style, then the default', () => {
  assert.deepEqual(resolveStyleId({ atlasStyle: 'auto', campaignConfig: ADAPTER_CONFIG }), {
    id: 'fantasy-color', source: 'adapter', requested: null,
  });
  assert.deepEqual(resolveStyleId({ campaignConfig: { system: { adapter: 'missing-system' } } }), {
    id: 'fantasy-color', source: 'default', requested: null,
  });
  assert.deepEqual(resolveStyleId({}), { id: 'fantasy-color', source: 'default', requested: null });
});

test('fallback: a master style that is not installed falls back and says what was asked for', () => withTemp((temp) => {
  const root = stylesCopyWithout(temp, ['dark-fantasy']);
  assert.deepEqual(resolveStyleId({ atlasStyle: 'dark-fantasy', campaignConfig: ADAPTER_CONFIG, root }), {
    id: 'fantasy-color', source: 'adapter', requested: 'dark-fantasy',
  });
  assert.deepEqual(resolveStyleId({ atlasStyle: 'no-such-style' }), {
    id: 'fantasy-color', source: 'default', requested: 'no-such-style',
  });
}));

test('fallback: an adapter style that is not installed falls back to the default', () => withTemp((temp) => {
  pluginWithAdapterStyle(temp, 'antique-parchment');
  const root = stylesCopyWithout(temp, ['antique-parchment']);
  assert.deepEqual(resolveStyleId({ campaignConfig: ADAPTER_CONFIG, pluginRoot: temp, root }), {
    id: 'fantasy-color', source: 'default', requested: 'antique-parchment',
  });
}));

test('resolution: an installed adapter style is used when the master chose nothing', () => withTemp((temp) => {
  pluginWithAdapterStyle(temp, 'antique-parchment');
  assert.deepEqual(resolveStyleId({ campaignConfig: ADAPTER_CONFIG, pluginRoot: temp }), {
    id: 'antique-parchment', source: 'adapter', requested: null,
  });
  assert.deepEqual(resolveStyleId({ atlasStyle: 'dark-fantasy', campaignConfig: ADAPTER_CONFIG, pluginRoot: temp }), {
    id: 'dark-fantasy', source: 'master', requested: null,
  });
}));
