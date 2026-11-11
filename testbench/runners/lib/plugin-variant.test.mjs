// Tests for plugin-variant.mjs: the threshold rewrite of the delegation calibration. Works on temporary
// copies only; the real yllir/ folder is never written.
// Run: node --test testbench/runners/lib/plugin-variant.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DELEGATION_MODES,
  THRESHOLD_TARGETS,
  buildPluginVariant,
  parseDelegation,
  rewriteThresholdText,
} from './plugin-variant.mjs';
import { REPO_ROOT } from './case-common.mjs';

const REAL_PLUGIN = path.join(REPO_ROOT, 'yllir');
const AUTHORING = THRESHOLD_TARGETS.find((t) => t.file === 'skills/core/yllir/authoring.md');
const BUILD_WORLD = THRESHOLD_TARGETS.find((t) => t.file === 'skills/core/build-world/SKILL.md');

/** A small fake plugin folder with the two threshold files, in a temporary folder. */
function fakePlugin() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-variant-test-'));
  const source = path.join(root, 'yllir');
  fs.mkdirSync(path.join(source, 'skills/core/yllir'), { recursive: true });
  fs.mkdirSync(path.join(source, 'skills/core/build-world'), { recursive: true });
  fs.writeFileSync(
    path.join(source, 'skills/core/yllir/authoring.md'),
    '- Up to 3 full documents: write them yourself with the Write tool.\n- More than 3: launch one `yllir:sheet-expander` per full document, all in one message.\n',
  );
  fs.writeFileSync(
    path.join(source, 'skills/core/build-world/SKILL.md'),
    '**Full documents, up to 3.** Write each one yourself.\n\n**Full documents, more than 3.** Launch one `yllir:sheet-expander`.\n',
  );
  fs.writeFileSync(path.join(source, 'other.md'), 'Up to 3 full documents: write them yourself with the Write tool.\n');
  return { root, source };
}

test('parseDelegation accepts the three modes and rejects anything else', () => {
  assert.deepEqual(DELEGATION_MODES, ['auto', 'always', 'never']);
  for (const mode of DELEGATION_MODES) assert.equal(parseDelegation(mode), mode);
  assert.throws(() => parseDelegation('sometimes'), /--delegation must be one of auto, always, never/);
  assert.throws(() => parseDelegation(undefined), /--delegation/);
});

test('rewriteThresholdText sets the number of the authoring sentences to always (0) and never (999)', () => {
  const text = '- Up to 3 full documents: write them yourself with the Write tool.\n- More than 3: launch one `yllir:sheet-expander` per full document.\n';
  const always = rewriteThresholdText(text, AUTHORING.patterns, 0, 'authoring');
  assert.match(always, /Up to 0 full documents: write them yourself/);
  assert.match(always, /More than 0: launch one `yllir:sheet-expander`/);
  const never = rewriteThresholdText(text, AUTHORING.patterns, 999, 'authoring');
  assert.match(never, /Up to 999 full documents: write them yourself/);
  assert.match(never, /More than 999: launch one/);
  assert.equal(rewriteThresholdText(text, AUTHORING.patterns, 3, 'authoring'), text, 'value 3 gives the original text');
});

test('rewriteThresholdText rewrites the build-world bold headings and leaves the rest of the text alone', () => {
  const text = '**Full documents, up to 3.** Write each one yourself.\n\nOther 3 text.\n\n**Full documents, more than 3.** Launch.\n';
  const out = rewriteThresholdText(text, BUILD_WORLD.patterns, 0, 'build-world');
  assert.equal(out, '**Full documents, up to 0.** Write each one yourself.\n\nOther 3 text.\n\n**Full documents, more than 0.** Launch.\n');
});

test('rewriteThresholdText fails loudly when a threshold sentence is missing or appears twice', () => {
  assert.throws(() => rewriteThresholdText('nothing here', AUTHORING.patterns, 0, 'authoring'), /found 0 times \(want 1\)/);
  const twice = '- Up to 3 full documents: write them yourself\n- Up to 3 full documents: write them yourself\n- More than 3: launch one `yllir:sheet-expander`';
  assert.throws(() => rewriteThresholdText(twice, AUTHORING.patterns, 0, 'authoring'), /found 2 times/);
});

test('the real plugin contains every threshold sentence exactly once', () => {
  for (const target of THRESHOLD_TARGETS) {
    const text = fs.readFileSync(path.join(REAL_PLUGIN, target.file), 'utf8');
    for (const pattern of target.patterns) {
      const hits = text.match(new RegExp(pattern.source, 'g'))?.length ?? 0;
      assert.equal(hits, 1, `${target.file}: ${pattern.source}`);
    }
  }
});

test('buildPluginVariant auto returns the source plugin unchanged, with a no-op cleanup', () => {
  const variant = buildPluginVariant({ mode: 'auto', sourceDir: REAL_PLUGIN });
  assert.equal(variant.pluginDir, REAL_PLUGIN);
  assert.equal(variant.mode, 'auto');
  variant.cleanup();
  assert.ok(fs.existsSync(path.join(REAL_PLUGIN, 'skills/core/yllir/authoring.md')));
});

test('buildPluginVariant always copies the plugin, rewrites it to 0 and leaves the source untouched', () => {
  const { root, source } = fakePlugin();
  try {
    const before = fs.readFileSync(path.join(source, 'skills/core/yllir/authoring.md'), 'utf8');
    const variant = buildPluginVariant({ mode: 'always', sourceDir: source });
    assert.notEqual(variant.pluginDir, source);
    assert.match(fs.readFileSync(path.join(variant.pluginDir, 'skills/core/yllir/authoring.md'), 'utf8'), /Up to 0 full documents/);
    assert.match(fs.readFileSync(path.join(variant.pluginDir, 'skills/core/build-world/SKILL.md'), 'utf8'), /up to 0\./);
    assert.equal(fs.readFileSync(path.join(source, 'skills/core/yllir/authoring.md'), 'utf8'), before, 'the source is unchanged');
    // Files outside the two targets are copied as they are.
    assert.equal(fs.readFileSync(path.join(variant.pluginDir, 'other.md'), 'utf8'), fs.readFileSync(path.join(source, 'other.md'), 'utf8'));
    const copyRoot = path.dirname(variant.pluginDir);
    variant.cleanup();
    assert.equal(fs.existsSync(copyRoot), false, 'cleanup removes the temporary copy');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('buildPluginVariant never rewrites to 999 in the copy', () => {
  const { root, source } = fakePlugin();
  try {
    const variant = buildPluginVariant({ mode: 'never', sourceDir: source });
    assert.match(fs.readFileSync(path.join(variant.pluginDir, 'skills/core/yllir/authoring.md'), 'utf8'), /Up to 999 full documents/);
    variant.cleanup();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('buildPluginVariant fails loudly and removes its copy when a threshold sentence is missing', () => {
  const { root, source } = fakePlugin();
  try {
    fs.writeFileSync(path.join(source, 'skills/core/build-world/SKILL.md'), 'no thresholds left\n');
    assert.throws(() => buildPluginVariant({ mode: 'always', sourceDir: source }), /skills\/core\/build-world\/SKILL\.md|found 0 times/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('buildPluginVariant works on the real plugin for both forced modes, and the copies are removed', () => {
  for (const mode of ['always', 'never']) {
    const variant = buildPluginVariant({ mode, sourceDir: REAL_PLUGIN });
    const text = fs.readFileSync(path.join(variant.pluginDir, 'skills/core/yllir/authoring.md'), 'utf8');
    assert.match(text, mode === 'always' ? /Up to 0 full documents/ : /Up to 999 full documents/);
    variant.cleanup();
  }
});
