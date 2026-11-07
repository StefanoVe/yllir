import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYamlLite } from './yaml-lite.mjs';

const UNSUPPORTED_MESSAGE = 'unsupported YAML syntax';

const lines = (...rows) => rows.join('\n');

const SAMPLE = lines(
  'schema: 1',
  '',
  'campaign:                        # identity',
  '  name: "Le ceneri della valle"',
  '  slug: ceneri-della-valle',
  '  created: 2026-11-07',
  '',
  'language:',
  '  main: it',
  '  other: []',
  '',
  'system:',
  '  adapter: none',
  '  options: {}',
  '',
  'structure:',
  '  - id: trama',
  '    folder: Trama',
  '    type: plot',
  '  - id: oggetti',
  '    folder: Oggetti',
  '    type: objects',
  '    cards: true',
  '',
  'scope_note: >',
  '  first line',
  '  second line',
);

const SAMPLE_EXPECTED = {
  schema: 1,
  campaign: {
    name: 'Le ceneri della valle',
    slug: 'ceneri-della-valle',
    created: '2026-11-07',
  },
  language: { main: 'it', other: [] },
  system: { adapter: 'none', options: {} },
  structure: [
    { id: 'trama', folder: 'Trama', type: 'plot' },
    { id: 'oggetti', folder: 'Oggetti', type: 'objects', cards: true },
  ],
  scope_note: 'first line second line\n',
};

function assertOk(text, expected) {
  const result = parseYamlLite(text);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.data, expected);
}

function assertError(text, line, message) {
  const result = parseYamlLite(text);
  assert.equal(result.data, null);
  assert.deepEqual(result.errors, [{ line, message }]);
}

test('full sample parses to the expected object', () => {
  assertOk(SAMPLE, SAMPLE_EXPECTED);
});

test('CRLF input parses the same as LF input', () => {
  assertOk(SAMPLE.replace(/\n/g, '\r\n'), SAMPLE_EXPECTED);
});

test('empty document and comment-only document give an empty object', () => {
  assertOk('', {});
  assertOk('# only a comment\n\n# another\n', {});
});

test('scalar types', () => {
  assertOk(
    lines(
      'a: 42',
      'b: -7',
      'c: true',
      'd: false',
      'e: null',
      'f: ~',
      'g: 2026-11-07',
      'h: hello world',
      "i: 'single'",
      'j: "double"',
      'k: 1.5',
      'l: "42"',
      'm:   padded   ',
    ),
    {
      a: 42,
      b: -7,
      c: true,
      d: false,
      e: null,
      f: null,
      g: '2026-11-07',
      h: 'hello world',
      i: 'single',
      j: 'double',
      k: '1.5',
      l: '42',
      m: 'padded',
    },
  );
});

test('nested mapping', () => {
  assertOk(
    lines('a:', '  b:', '    c: 1', '  d: 2', 'e: 3'),
    { a: { b: { c: 1 }, d: 2 }, e: 3 },
  );
});

test('list of scalars', () => {
  assertOk(
    lines('items:', '  - one', '  - 2', '  - "three"', '  - false'),
    { items: ['one', 2, 'three', false] },
  );
});

test('list of mappings', () => {
  assertOk(
    lines(
      'items:',
      '  - id: a',
      '    n: 1',
      '  - id: b',
    ),
    { items: [{ id: 'a', n: 1 }, { id: 'b' }] },
  );
});

test('flow list', () => {
  assertOk(
    lines('tags: [a, "b, c", 3, true]', 'empty: []'),
    { tags: ['a', 'b, c', 3, true], empty: [] },
  );
});

test('empty flow mapping', () => {
  assertOk('options: {}', { options: {} });
});

test('literal block scalar keeps line breaks and removes block indentation', () => {
  assertOk(
    lines('literal: |', '  line one', '    indented', '  line three', 'after: 1'),
    { literal: 'line one\n  indented\nline three\n', after: 1 },
  );
});

test('folded block scalar joins lines with a space', () => {
  assertOk(
    lines('folded: >', '  one', '  two', 'after: 1'),
    { folded: 'one two\n', after: 1 },
  );
});

test('block scalar keeps # lines as content', () => {
  assertOk(lines('text: |', '  # not a comment'), { text: '# not a comment\n' });
});

test('block scalar drops trailing blank lines', () => {
  assertOk(lines('text: |', '  a', '', ''), { text: 'a\n' });
});

test('trailing comments are removed, # inside quotes is kept', () => {
  assertOk(
    lines(
      'a: 1 # note',
      'b: "x # kept"',
      "c: 'y # kept' # gone",
      '# full line comment',
      '',
      'd: plain#notcomment',
    ),
    { a: 1, b: 'x # kept', c: 'y # kept', d: 'plain#notcomment' },
  );
});

test('flow list with trailing comment', () => {
  assertOk('tags: [a, b] # comment', { tags: ['a', 'b'] });
});

test("single quotes: doubled '' in the middle is one literal quote", () => {
  assertOk("a: 'it''s here'", { a: "it's here" });
});

test("single quotes: '' at the end before the closing quote", () => {
  assertOk("a: 'it''s'", { a: "it's" });
});

test("single quotes: '''' is one literal quote", () => {
  assertOk("a: ''''", { a: "'" });
});

test("single quotes: '' inside a flow list item", () => {
  assertOk("a: ['it''s', b]", { a: ["it's", 'b'] });
});

test("single quotes: leading spaces inside the quotes are kept", () => {
  assertOk(
    `snippet: '    A["Torre dell''Ascia"] --> B'`,
    { snippet: '    A["Torre dell\'Ascia"] --> B' },
  );
});

test("single quotes: '' does not hide a trailing comment after the real closing quote", () => {
  assertOk("a: 'x''y' # note", { a: "x'y" });
});

test('error: single-quoted string with no real closing quote', () => {
  assertError("a: 'abc''", 1, UNSUPPORTED_MESSAGE);
});

test('error: tab in indentation', () => {
  assertError(lines('a:', '\tb: 1'), 2, 'tabs are not allowed');
});

test('error: odd indentation', () => {
  assertError(lines('a:', '   b: 1'), 2, 'indentation must be a multiple of 2 spaces');
});

test('error: duplicate key', () => {
  assertError(lines('a: 1', 'b: 2', 'a: 3'), 3, 'duplicate key a');
});

test('error: missing value for key followed by a sibling', () => {
  assertError(lines('a:', 'b: 1'), 1, 'missing value for key a');
});

test('error: missing value for key at end of document', () => {
  assertError(lines('x: 1', 'a:'), 2, 'missing value for key a');
});

test('error: empty item in flow list', () => {
  assertError('a: [1, , 2]', 1, 'empty list item');
});

test('error: empty block list item', () => {
  assertError(lines('a:', '  -'), 2, 'empty list item');
});

test('error: non-empty flow mapping', () => {
  assertError('a: {a: 1}', 1, UNSUPPORTED_MESSAGE);
});

test('error: anchor', () => {
  assertError('a: &x 1', 1, UNSUPPORTED_MESSAGE);
});

test('error: alias', () => {
  assertError(lines('a: 1', 'b: *x'), 2, UNSUPPORTED_MESSAGE);
});

test('error: tag', () => {
  assertError('a: !!str 1', 1, UNSUPPORTED_MESSAGE);
});

test('error: document marker', () => {
  assertError(lines('a: 1', '---', 'b: 2'), 2, UNSUPPORTED_MESSAGE);
});

test('error: nested list item', () => {
  assertError(lines('a:', '  - - x'), 2, UNSUPPORTED_MESSAGE);
});

test('error: key with a space', () => {
  assertError('my key: 1', 1, UNSUPPORTED_MESSAGE);
});

test('error: quoted key', () => {
  assertError('"a": 1', 1, UNSUPPORTED_MESSAGE);
});

test('error: unexpected deeper indentation after a value', () => {
  assertError(lines('a: 1', '  b: 2'), 2, 'unexpected indentation');
});

test('error: top-level list', () => {
  assertError('- a', 1, 'top-level value must be a mapping');
});
