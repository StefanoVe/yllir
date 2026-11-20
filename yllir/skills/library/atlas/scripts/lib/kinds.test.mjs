// Every place kind has an icon in the viewer and a name in both languages (issue #5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ICONS } from './model.mjs';
import { STRINGS } from './strings.mjs';

const CSS = fs.readFileSync(new URL('../../site/viewer.css', import.meta.url), 'utf8');

const URBAN = ['shop', 'market', 'inn', 'workshop', 'mine', 'arena', 'tower', 'government', 'temple', 'warehouse', 'pier', 'district', 'wasteland'];

test('the kinds for settlement and district plans exist', () => {
  for (const kind of URBAN) assert.ok(ICONS.includes(kind), `${kind} is missing from ICONS`);
});

test('every kind has its own marker glyph in viewer.css', () => {
  for (const kind of ICONS) {
    const rule = new RegExp(`\\.marker\\[data-kind="${kind}"\\]::before\\s*\\{[^}]*mask`);
    assert.match(CSS, rule, `${kind} has no glyph`);
  }
});

test('every kind has a name in Italian and in English', () => {
  for (const lang of ['it', 'en']) {
    for (const kind of ICONS) {
      const word = STRINGS[lang].kind[kind];
      assert.ok(typeof word === 'string' && word.length > 0, `${lang} has no name for ${kind}`);
    }
  }
});
