import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChecks } from './checks.mjs';
import { makeJpeg, makePng } from './test-support.mjs';

const STRUCTURE = [
  { id: 'luoghi', folder: 'Mondo', type: 'places' },
  { id: 'riservato', folder: 'Giocatori', type: 'master-only' },
];

const CLEAN_PAGE = '<!doctype html><html><body><main><h1>Porto</h1><p>A grey harbour.</p></main></body></html>';

function run({ html = CLEAN_PAGE, extra = [], reserved = {}, sources = ['Mondo/porto.md'], problems = [], roundtrip = [{ ok: true }], change = { first: true, added: 0, removed: 0, changed: 0 } } = {}) {
  const outputs = [{ rel: 'e/porto/index.html', bytes: Buffer.from(html) }, ...extra];
  return runChecks({
    lang: 'en',
    outputs,
    collected: {
      reserved: { lines: [], titles: [], codes: [], lockedLines: [], ...reserved },
      lockedProblems: problems,
      sources,
    },
    structure: STRUCTURE,
    roundtrip,
    change,
  });
}

const statusOf = (result, id) => result.checks.find((c) => c.id === id).status;

test('a clean site passes every active check; the two unavailable checks are skipped', () => {
  const result = run();
  for (const id of ['no-reserved-text', 'no-private-folders', 'no-secret-shapes', 'no-image-metadata', 'no-master-links', 'locked-codes', 'locked-roundtrip']) {
    assert.equal(statusOf(result, id), 'pass', id);
  }
  assert.equal(statusOf(result, 'real-player-names'), 'skipped');
  assert.equal(statusOf(result, 'no-player-references'), 'skipped');
  assert.equal(result.checks.length, 10);
});

test('no-reserved-text fails on a planted reserved sentence', () => {
  const html = '<p>The pier hides a smuggler route nobody mentions.</p>';
  const result = run({ html, reserved: { lines: ['The pier hides a smuggler route nobody mentions.'] } });
  assert.equal(statusOf(result, 'no-reserved-text'), 'fail');
});

test('no-reserved-text fails on a planted master marker and on a hidden subject title', () => {
  assert.equal(statusOf(run({ html: '<p><!-- master --> x</p>' }), 'no-reserved-text'), 'fail');
  const titled = run({ html: '<p>Vettore Nero rides at dawn</p>', reserved: { titles: ['Vettore Nero'] } });
  assert.equal(statusOf(titled, 'no-reserved-text'), 'fail');
  const whole = run({ html: '<p>Vettore Neroso</p>', reserved: { titles: ['Vettore Nero'] } });
  assert.equal(statusOf(whole, 'no-reserved-text'), 'pass', 'titles match as whole words');
});

test('no-reserved-text fails when a code from the reserved part appears in a public file', () => {
  const result = run({ html: '<p>The code is ascia-9, read it.</p>', reserved: { codes: [{ label: 'diario', code: 'ascia-9' }] } });
  assert.equal(statusOf(result, 'no-reserved-text'), 'fail');
});

test('no-reserved-text fails when a locked text (plain) leaks into a page', () => {
  const result = run({ html: '<p>Ilde wrote in the ledger that the lamp was lit.</p>', reserved: { lockedLines: ['Ilde wrote in the ledger that the lamp was lit'] } });
  assert.equal(statusOf(result, 'no-reserved-text'), 'fail');
});

test('no-reserved-text ignores the encrypted attribute values', () => {
  const sealed = '<div class="locked" data-label="diario" data-salt="ascia9ascia9" data-iv="ascia9" data-cipher="ascia9ascia9ascia9"></div>';
  assert.equal(statusOf(run({ html: sealed, reserved: { codes: [{ label: 'diario', code: 'ascia9' }] } }), 'no-reserved-text'), 'pass');
});

test('no-private-folders fails when a source comes from a private folder', () => {
  assert.equal(statusOf(run({ sources: ['Giocatori/Traditore.md'] }), 'no-private-folders'), 'fail');
  assert.equal(statusOf(run({ sources: ['Appunti/nota.md'] }), 'no-private-folders'), 'fail');
  assert.equal(statusOf(run({ sources: ['Mondo/porto.md'] }), 'no-private-folders'), 'pass');
});

test('no-secret-shapes fails on key shapes and long tokens, and passes on the encrypted attributes', () => {
  const shapes = [
    '<p>sk-abcdefghijklmnop1234</p>',
    '<p>AKIAABCDEFGHIJKLMNOP</p>',
    '<p>-----BEGIN PRIVATE KEY-----</p>',
    '<p>token a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1</p>',
  ];
  for (const html of shapes) assert.equal(statusOf(run({ html }), 'no-secret-shapes'), 'fail', html);
  const long = `<div data-cipher="${'Ab1'.repeat(30)}"></div>`;
  assert.equal(statusOf(run({ html: long }), 'no-secret-shapes'), 'pass');
});

test('no-image-metadata fails on a copied picture with EXIF, and passes on a clean one', () => {
  const dirty = makeJpeg([[0xe1, 'Exif\0\0GPS']]);
  const clean = makeJpeg([[0xe0, 'JFIF\0']]);
  assert.equal(statusOf(run({ extra: [{ rel: 'assets/img/a.jpg', bytes: dirty }] }), 'no-image-metadata'), 'fail');
  assert.equal(statusOf(run({ extra: [{ rel: 'assets/img/a.jpg', bytes: clean }] }), 'no-image-metadata'), 'pass');
  const pngText = makePng([['tEXt', 'Author\0x']]);
  assert.equal(statusOf(run({ extra: [{ rel: 'assets/img/b.png', bytes: pngText }] }), 'no-image-metadata'), 'fail');
});

test('no-master-links fails on any href pointing at a #master anchor', () => {
  assert.equal(statusOf(run({ html: '<p><a href="../x/index.html#master">x</a></p>' }), 'no-master-links'), 'fail');
  assert.equal(statusOf(run({ html: '<p><a href="../x/#master">x</a></p>' }), 'no-master-links'), 'fail');
});

test('locked-codes fails with the problem list in plain words, and the self-test fails on a broken block', () => {
  const result = run({ problems: [{ code: 'locked-missing', message: 'diario', title: 'Ilde' }], roundtrip: [{ ok: false }] });
  assert.equal(statusOf(result, 'locked-codes'), 'fail');
  assert.match(result.checks.find((c) => c.id === 'locked-codes').message, /Ilde/);
  assert.equal(statusOf(result, 'locked-roundtrip'), 'fail');
});

test('change-summary never fails and says the counts as an information warning', () => {
  const first = run({ change: { first: true, added: 0, removed: 0, changed: 0 } });
  assert.equal(statusOf(first, 'change-summary'), 'pass');
  assert.match(first.warnings[0].message, /First version|Prima versione/);
  const later = run({ change: { first: false, added: 2, removed: 1, changed: 3 } });
  assert.equal(later.warnings[0].code, 'change-summary');
  assert.match(later.warnings[0].message, /2 new entries, 1 removed, 3 changed/);
});

test('the Italian messages are used for an Italian campaign', () => {
  const result = runChecks({
    lang: 'it',
    outputs: [{ rel: 'index.html', bytes: Buffer.from('<p>ciao</p>') }],
    collected: { reserved: { lines: [], titles: [], codes: [], lockedLines: [] }, lockedProblems: [], sources: [] },
    structure: STRUCTURE,
    roundtrip: [],
    change: { first: true, added: 0, removed: 0, changed: 0 },
  });
  assert.equal(result.checks.find((c) => c.id === 'no-reserved-text').message, 'Nessun testo riservato compare nei file generati.');
});
