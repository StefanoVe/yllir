import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitLocked, parseCodes, encryptLocked, decryptLocked, ITERATIONS } from './locked.mjs';

test('splitLocked separates Markdown from locked blocks and keeps their label', () => {
  const body = 'Open text.\n\n<!-- locked: diario -->\nSecret line.\n<!-- /locked -->\n\nMore open text.';
  const { segments, problems } = splitLocked(body);
  assert.deepEqual(problems, []);
  assert.deepEqual(segments.map((s) => s.type), ['md', 'locked', 'md']);
  assert.equal(segments[1].label, 'diario');
  assert.equal(segments[1].text.trim(), 'Secret line.');
});

test('an unclosed block, a bad label and a repeated label are problems', () => {
  assert.deepEqual(splitLocked('<!-- locked: a -->\ntext').problems.map((p) => p.code), ['locked-open']);
  assert.deepEqual(splitLocked('<!-- locked: Bad Label -->\n<!-- /locked -->').problems.map((p) => p.code), ['locked-label']);
  const twice = '<!-- locked: a -->\nx\n<!-- /locked -->\n<!-- locked: a -->\ny\n<!-- /locked -->';
  assert.deepEqual(splitLocked(twice).problems.map((p) => p.code), ['locked-label']);
});

test('parseCodes reads only the list under Codici or Codes', () => {
  const master = [
    '## Master',
    '- stray: not-a-code',
    '### Codici',
    '- diario: ascia-9',
    '- sigillo: 4242',
    '### Altro',
    '- other: nope',
    '### Codes',
    '- later: ignored-first-wins',
  ].join('\n');
  const codes = parseCodes(master);
  assert.equal(codes.get('diario'), 'ascia-9');
  assert.equal(codes.get('sigillo'), '4242');
  assert.equal(codes.has('stray'), false);
  assert.equal(codes.has('other'), false);
  assert.equal(codes.has('later'), true);
});

test('encryption is deterministic and round-trips through the Web Crypto path', async () => {
  const input = { code: 'ascia-9', label: 'diario', text: '<p>The lamp was lit.</p>' };
  const first = encryptLocked(input);
  const second = encryptLocked(input);
  assert.deepEqual(first, second);
  assert.equal(Buffer.from(first.salt, 'base64').length, 16);
  assert.equal(Buffer.from(first.iv, 'base64').length, 12);
  assert.equal(first.cipher.includes('lamp'), false);
  assert.equal(await decryptLocked({ code: 'ascia-9', ...first }), input.text);
});

test('a wrong code does not open the text', async () => {
  const sealed = encryptLocked({ code: 'ascia-9', label: 'diario', text: 'secret' });
  await assert.rejects(decryptLocked({ code: 'ascia-8', ...sealed }));
});

test('the iteration count is the agreed 200000', () => {
  assert.equal(ITERATIONS, 200000);
});
