import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listStyles, loadStyle, resolveStyleId, validateStyleJson, STYLES_DIR, DEFAULT_STYLE } from './styles.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../');
const IDS = ['antique-parchment', 'dark-fantasy', 'fantasy-color'];

function tempStyles(ids) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-styles-'));
  for (const id of ids) {
    fs.mkdirSync(path.join(root, id));
    fs.copyFileSync(path.join(STYLES_DIR, id, 'style.json'), path.join(root, id, 'style.json'));
  }
  return root;
}

test('all three styles load with their schema 2 settings', () => {
  for (const id of IDS) {
    const { style, dir } = loadStyle(id);
    assert.equal(style.id, id);
    assert.equal(style.schema, 2);
    assert.equal(dir, path.join(STYLES_DIR, id));
    assert.deepEqual(validateStyleJson(style), []);
  }
});

test('listing returns every style sorted by id, with names and repaint', () => {
  const list = listStyles();
  assert.deepEqual(list.map((s) => s.id), IDS);
  assert.equal(list.find((s) => s.id === 'fantasy-color').names.it, 'Fantasy colorato');
  assert.equal(list.find((s) => s.id === 'antique-parchment').names.en, 'Antique parchment');
});

test('every style has repaint as a nonempty English string', () => {
  for (const { id, repaint } of listStyles()) {
    assert.equal(typeof repaint, 'string', id);
    assert.ok(repaint.trim() !== '', id);
    assert.match(repaint, /^[\x20-\x7e]+$/, id);
  }
});

test('an unknown id is refused with code unknown-style', () => {
  assert.throws(() => loadStyle('no-such-style'), (e) => e.code === 'unknown-style');
  assert.throws(() => loadStyle('Dark Fantasy'), (e) => e.code === 'unknown-style');
  assert.throws(() => loadStyle(undefined), (e) => e.code === 'unknown-style');
});

test('a style whose id differs from its folder is refused', () => {
  const root = tempStyles(['dark-fantasy']);
  fs.renameSync(path.join(root, 'dark-fantasy'), path.join(root, 'other-style'));
  assert.throws(() => loadStyle('other-style', { root }), (e) => e.code === 'invalid-style');
  assert.deepEqual(listStyles({ root }), []);
});

test('validateStyleJson reports missing, unknown and wrong values', () => {
  const style = JSON.parse(fs.readFileSync(path.join(STYLES_DIR, 'dark-fantasy', 'style.json'), 'utf8'));
  assert.deepEqual(validateStyleJson(style), []);
  const broken = structuredClone(style);
  delete broken.labels.fill;
  broken.labels.haloOpacity = 2;
  broken.borders.extra = 1;
  broken.repaint = '';
  broken.markers.fill = 'red';
  const messages = validateStyleJson(broken).map((p) => p.path);
  assert.ok(messages.includes('labels.fill'));
  assert.ok(messages.includes('labels.haloOpacity'));
  assert.ok(messages.includes('borders.extra'));
  assert.ok(messages.includes('repaint'));
  assert.ok(messages.includes('markers.fill'));
  assert.ok(validateStyleJson({ ...style, schema: 1 }).some((p) => p.path === 'schema'));
});

test('resolution: a valid master choice wins over the adapter and the default', () => {
  const resolved = resolveStyleId({ atlasStyle: 'dark-fantasy', campaignConfig: { system: { adapter: 'dnd-2024' } }, pluginRoot: PLUGIN_ROOT });
  assert.deepEqual(resolved, { id: 'dark-fantasy', source: 'master', requested: null });
});

test('resolution: auto or no choice uses the adapter style, then the default', () => {
  const config = { system: { adapter: 'dnd-2024' } };
  assert.deepEqual(resolveStyleId({ atlasStyle: 'auto', campaignConfig: config, pluginRoot: PLUGIN_ROOT }), { id: 'fantasy-color', source: 'adapter', requested: null });
  assert.deepEqual(resolveStyleId({ campaignConfig: config, pluginRoot: PLUGIN_ROOT }), { id: 'fantasy-color', source: 'adapter', requested: null });
  assert.deepEqual(resolveStyleId({ atlasStyle: '', pluginRoot: PLUGIN_ROOT }), { id: DEFAULT_STYLE, source: 'default', requested: null });
});

test('resolution: an unusable master choice falls back and says what was asked', () => {
  const resolved = resolveStyleId({ atlasStyle: 'no-such-style', pluginRoot: PLUGIN_ROOT });
  assert.deepEqual(resolved, { id: DEFAULT_STYLE, source: 'default', requested: 'no-such-style' });
});

test('resolution: an adapter style missing from the styles folder falls back to the default', () => {
  const root = tempStyles(['dark-fantasy']);
  const resolved = resolveStyleId({ campaignConfig: { system: { adapter: 'dnd-2024' } }, pluginRoot: PLUGIN_ROOT, root });
  assert.deepEqual(resolved, { id: DEFAULT_STYLE, source: 'default', requested: 'fantasy-color' });
  const master = resolveStyleId({ atlasStyle: 'dark-fantasy', campaignConfig: { system: { adapter: 'dnd-2024' } }, pluginRoot: PLUGIN_ROOT, root });
  assert.deepEqual(master, { id: 'dark-fantasy', source: 'master', requested: null });
});
