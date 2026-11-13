import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ScreenSettingsPatch } from '../../../shared/src/types.js';
// The framework's yaml-lite is plain JavaScript without a declaration file.
// @ts-expect-error untyped framework module
import { parseYamlLite } from '../../../../yllir/scripts/lib/yaml-lite.mjs';
import { DEFAULT_SETTINGS, explicitPaths, LEAVES, mergeSettings, sanitizeStored } from './schema.js';
import { serializeSettings } from './store.js';

// Every setting, each set to a value different from its default.
const FULL_PATCH: ScreenSettingsPatch = {
  live: { model: 'sonnet' },
  combat: {
    model: 'opus',
    showMaps: false,
    panels: { initiative: false, turn: false, chat: true, music: false },
    autoHide: false,
    autoHideSeconds: 9,
  },
  music: { volume: 35, fadeSeconds: 7, loop: false, dock: 'playing' },
  ui: {
    density: 'compact',
    motion: 'reduced',
    startPage: 'plot',
    rail: { plot: false, docs: false, music: false, encyclopedia: false, print: false },
  },
};

describe('sanitizeStored', () => {
  it('keeps valid values as they are', () => {
    const { settings, explicit } = sanitizeStored({
      live: { model: 'sonnet' },
      combat: { show_maps: false, auto_hide_seconds: 9, panels: { chat: true } },
      music: { volume: 35, loop: false, dock: 'playing' },
      ui: { start_page: 'docs', rail: { print: false } },
    });
    assert.equal(settings.live.model, 'sonnet');
    assert.equal(settings.combat.showMaps, false);
    assert.equal(settings.combat.autoHideSeconds, 9);
    assert.equal(settings.combat.panels.chat, true);
    assert.equal(settings.music.volume, 35);
    assert.equal(settings.music.loop, false);
    assert.equal(settings.music.dock, 'playing');
    assert.equal(settings.ui.startPage, 'docs');
    assert.equal(settings.ui.rail.print, false);
    assert.deepEqual(
      explicit.sort(),
      [
        'combat.autoHideSeconds',
        'combat.panels.chat',
        'combat.showMaps',
        'live.model',
        'music.dock',
        'music.loop',
        'music.volume',
        'ui.rail.print',
        'ui.startPage',
      ],
    );
  });

  it('accepts the string forms of booleans and integers', () => {
    const { settings, explicit } = sanitizeStored({
      combat: { show_maps: 'false', auto_hide_seconds: '7' },
      music: { loop: 'false', volume: '50' },
    });
    assert.equal(settings.combat.showMaps, false);
    assert.equal(settings.combat.autoHideSeconds, 7);
    assert.equal(settings.music.loop, false);
    assert.equal(settings.music.volume, 50);
    assert.ok(explicit.includes('combat.autoHideSeconds'));
    assert.ok(explicit.includes('music.loop'));
  });

  it('falls back to the default for out-of-range, wrong-type and unknown values', () => {
    const { settings, explicit } = sanitizeStored({
      combat: { auto_hide_seconds: 99, show_maps: 'maybe', model: 'gpt' },
      music: { volume: 101, fade_seconds: 0, dock: 'never' },
      ui: { density: 'huge', rail: { print: 'yes' } },
      unknown_section: { anything: true },
    });
    assert.deepEqual(settings, DEFAULT_SETTINGS);
    assert.deepEqual(explicit, []);
  });

  it('rejects non-integer numbers for integer settings', () => {
    const { settings } = sanitizeStored({ combat: { auto_hide_seconds: 4.5 } });
    assert.equal(settings.combat.autoHideSeconds, DEFAULT_SETTINGS.combat.autoHideSeconds);
  });

  it('never throws on any input', () => {
    for (const input of [undefined, null, 'text', 42, [1, 2], { combat: 'x' }, { ui: { rail: null } }]) {
      assert.deepEqual(sanitizeStored(input).settings, DEFAULT_SETTINGS);
    }
  });
});

describe('mergeSettings', () => {
  it('returns a new object and leaves the base and the patch unchanged', () => {
    const base = structuredClone(DEFAULT_SETTINGS);
    const patch: ScreenSettingsPatch = { combat: { autoHideSeconds: 7 }, ui: { rail: { print: false } } };
    const patchCopy = structuredClone(patch);
    const merged = mergeSettings(base, patch);
    assert.equal(merged.combat.autoHideSeconds, 7);
    assert.equal(merged.ui.rail.print, false);
    assert.equal(merged.ui.rail.plot, true);
    assert.notEqual(merged, base);
    assert.deepEqual(base, DEFAULT_SETTINGS);
    assert.deepEqual(patch, patchCopy);
  });
});

describe('explicitPaths', () => {
  it('lists the dotted leaf paths of a patch', () => {
    assert.deepEqual(explicitPaths({ combat: { autoHideSeconds: 7, panels: { chat: true } } }), [
      'combat.autoHideSeconds',
      'combat.panels.chat',
    ]);
  });
});

describe('serializeSettings and the real yaml-lite', () => {
  it('writes the explicit keys only, with a header comment and snake_case keys', () => {
    const text = serializeSettings({ combat: { autoHideSeconds: 7 }, ui: { rail: { print: false } } });
    assert.equal(
      text,
      [
        '# Master screen settings. Written by the master screen; safe to edit by hand.',
        'combat:',
        '  auto_hide_seconds: 7',
        'ui:',
        '  rail:',
        '    print: false',
        '',
      ].join('\n'),
    );
  });

  it('writes every key of the mapping table, and yaml-lite reads each one back', () => {
    const text = serializeSettings(FULL_PATCH);
    for (const leaf of LEAVES) {
      const key = leaf.file.split('.').pop() as string;
      assert.ok(text.includes(`${key}:`), `file has ${key}`);
    }
    const parsed = parseYamlLite(text);
    assert.deepEqual(parsed.errors, []);
    const { settings, explicit } = sanitizeStored(parsed.data);
    assert.deepEqual(settings, mergeSettings(DEFAULT_SETTINGS, FULL_PATCH));
    assert.deepEqual(explicit.sort(), LEAVES.map((leaf) => leaf.path).sort());
  });

  it('round-trips an empty patch to the defaults', () => {
    const parsed = parseYamlLite(serializeSettings({}));
    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(sanitizeStored(parsed.data).settings, DEFAULT_SETTINGS);
  });
});

describe('start page', () => {
  it('defaults to the plot', () => {
    assert.equal(DEFAULT_SETTINGS.ui.startPage, 'plot');
  });

  it('maps a saved start_page: home (no longer offered) to the default plot', () => {
    const parsed = parseYamlLite('ui:\n  start_page: home\n');
    assert.deepEqual(parsed.errors, []);
    const { settings, explicit } = sanitizeStored(parsed.data);
    assert.equal(settings.ui.startPage, 'plot');
    assert.ok(!explicit.includes('ui.startPage'));
  });
});
