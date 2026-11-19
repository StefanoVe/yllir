import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAtlasChecks, normalizeText, reservedLinesOf, masterIdsOf } from './checks.mjs';

const byId = (checks) => Object.fromEntries(checks.map((c) => [c.id, c]));
const page = (html, dataJson = '{"places":[]}') => `${html}\n<script type="application/json" id="atlas-data">${dataJson}</script>`;

test('normalizeText lowercases, collapses spaces and decodes escapes on both sides', () => {
  assert.equal(normalizeText('  The  DUKE &amp; the &lt;cellar&gt; '), 'the duke & the <cellar>');
  assert.equal(normalizeText('He said &quot;hi&quot; &#39;x&#39;'), 'he said "hi" \'x\'');
  assert.equal(normalizeText('He said \\"hi\\" \\u003cb\\u003e'), 'he said "hi" <b>');
});

test('reservedLinesOf takes the non-empty lines of length 12 or more after the master marker', () => {
  const body = 'Public text.\n\n<!-- master -->\nShort.\n\nThe duke is the cult leader.\n   \nAnother secret line here.\n';
  assert.deepEqual(reservedLinesOf(body), ['The duke is the cult leader.', 'Another secret line here.']);
  assert.deepEqual(reservedLinesOf('No marker, so nothing is reserved at all.'), []);
});

test('masterIdsOf lists the ids of master-visibility features of every layer', () => {
  const ids = masterIdsOf({
    places: { features: [{ id: 'north', visibility: 'public' }, { id: 'hold', visibility: 'master' }] },
    water: { features: [{ id: 'silver', visibility: 'master' }] },
  });
  assert.deepEqual([...ids].sort(), ['hold', 'silver']);
});

test('no-master-marker fails on the master marker and on a closing master comment, and passes on a clean build', () => {
  const leaking = runAtlasChecks({ outputs: [{ rel: 'index.html', text: page('<p><!-- master --></p>') }] });
  assert.equal(byId(leaking)['no-master-marker'].status, 'fail');
  const closing = runAtlasChecks({ outputs: [{ rel: 'index.html', text: page('<!-- /master -->') }] });
  assert.equal(byId(closing)['no-master-marker'].status, 'fail');
  const clean = runAtlasChecks({ outputs: [{ rel: 'index.html', text: page('<p>clean</p>') }] });
  assert.equal(byId(clean)['no-master-marker'].status, 'pass');
});

test('no-reserved-text fails when a reserved line appears, escaped or not, and passes otherwise', () => {
  const reservedLines = ['The duke is the cult leader.'];
  const leaked = runAtlasChecks({ outputs: [{ rel: 'index.html', text: page('<p>The DUKE   is the cult leader.</p>') }], reservedLines });
  assert.equal(byId(leaked)['no-reserved-text'].status, 'fail');
  assert.match(byId(leaked)['no-reserved-text'].message, /index\.html/);
  const inJson = runAtlasChecks({
    outputs: [{ rel: 'index.html', text: page('<p>x</p>', '{"places":[{"summary":"The duke is the cult leader."}]}') }],
    reservedLines,
  });
  assert.equal(byId(inJson)['no-reserved-text'].status, 'fail');
  const clean = runAtlasChecks({ outputs: [{ rel: 'index.html', text: page('<p>Only public text.</p>') }], reservedLines });
  assert.equal(byId(clean)['no-reserved-text'].status, 'pass');
});

test('no-master-features fails on data-place or a places entry of a master id, and passes otherwise', () => {
  const masterIds = ['hold'];
  const shown = runAtlasChecks({ outputs: [{ rel: 'index.html', text: page('<g class="place" data-place="hold"></g>') }], masterIds });
  assert.equal(byId(shown)['no-master-features'].status, 'fail');
  const listed = runAtlasChecks({
    outputs: [{ rel: 'index.html', text: page('<p>x</p>', '{"places":[{"id":"hold"}]}') }],
    masterIds,
  });
  assert.equal(byId(listed)['no-master-features'].status, 'fail');
  const clean = runAtlasChecks({
    outputs: [{ rel: 'index.html', text: page('<g class="place" data-place="north"></g>', '{"places":[{"id":"north"}]}') }],
    masterIds,
  });
  assert.equal(byId(clean)['no-master-features'].status, 'pass');
});

test('the three checks are always returned, in order, with a status and a message', () => {
  const checks = runAtlasChecks({ outputs: [] });
  assert.deepEqual(checks.map((c) => c.id), ['no-master-marker', 'no-reserved-text', 'no-master-features']);
  for (const check of checks) {
    assert.equal(check.status, 'pass');
    assert.equal(typeof check.message, 'string');
  }
});
