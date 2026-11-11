import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter } from './frontmatter.mjs';

test('no frontmatter returns the whole text as body', () => {
  const text = '# Title\n\nSome body\n';
  const result = parseFrontmatter(text);
  assert.deepEqual(result, { data: null, body: text, bodyStartLine: 1, errors: [] });
});

test('line 1 with trailing space is not frontmatter', () => {
  const text = '--- \nid: a\n---\nbody';
  const result = parseFrontmatter(text);
  assert.equal(result.data, null);
  assert.equal(result.body, text);
  assert.deepEqual(result.errors, []);
});

test('valid frontmatter with id, list and empty list', () => {
  const text = '---\nid: torre\ntags: [a, b]\nempty: []\n---\nBody text\n';
  const result = parseFrontmatter(text);
  assert.deepEqual(result.data, { id: 'torre', tags: ['a', 'b'], empty: [] });
  assert.equal(result.body, 'Body text\n');
  assert.equal(result.bodyStartLine, 6);
  assert.deepEqual(result.errors, []);
});

test('appearances accepts a block list of mappings', () => {
  const result = parseFrontmatter('---\nid: evento\nappearances:\n  - subject: ferry\n    location: [harbor, north] \n---\nBody\n');
  assert.deepEqual(result.data, {
    id: 'evento',
    appearances: [{ subject: 'ferry', location: ['harbor', 'north'] }],
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.bodyStartLine, 7);
});

test('appearances block syntax reports malformed YAML with its source line', () => {
  const result = parseFrontmatter('---\nid: evento\nappearances:\n  - subject: ferry\n    location: [harbor,, north]\n---\n');
  assert.deepEqual(result.errors, [{ line: 5, message: 'empty list item' }]);
});

test('a duplicate appearances key is still reported', () => {
  const result = parseFrontmatter('---\nappearances:\n  - subject: ferry\nappearances: []\n---\n');
  assert.deepEqual(result.errors, [{ line: 4, message: 'duplicate key appearances' }]);
});

test('values are always strings', () => {
  const result = parseFrontmatter('---\nn: 1\nb: true\n---\n');
  assert.deepEqual(result.data, { n: '1', b: 'true' });
});

test('quoted values are unquoted without escape processing', () => {
  const text = '---\ntitle: "Torre: dell\'Ascia"\nalias: \'x y\'\nq: "a\'\nlist: ["one", \'two\']\n---\n';
  const result = parseFrontmatter(text);
  assert.deepEqual(result.data, {
    title: "Torre: dell'Ascia",
    alias: 'x y',
    q: `"a'`,
    list: ['one', 'two'],
  });
  assert.deepEqual(result.errors, []);
});

test('single-quoted scalar: doubled quote is one literal quote', () => {
  const result = parseFrontmatter("---\nalias: 'dell''Ascia'\n---\n");
  assert.deepEqual(result.data, { alias: "dell'Ascia" });
  assert.deepEqual(result.errors, []);
});

test('double-quoted scalar: doubled single quote is kept as-is', () => {
  const result = parseFrontmatter('---\nalias: "dell\'\'Ascia"\n---\n');
  assert.deepEqual(result.data, { alias: "dell''Ascia" });
});

test('single-quoted flow list items with doubled quote', () => {
  const result = parseFrontmatter("---\nlist: [ 'l''orso', b ]\n---\n");
  assert.deepEqual(result.data, { list: ["l'orso", 'b'] });
  assert.deepEqual(result.errors, []);
});

test('comma inside a double-quoted flow list item does not split', () => {
  const result = parseFrontmatter('---\nlist: ["a, b", c]\n---\n');
  assert.deepEqual(result.data, { list: ['a, b', 'c'] });
  assert.deepEqual(result.errors, []);
});

test('comma inside a single-quoted flow list item does not split', () => {
  const result = parseFrontmatter("---\nlist: ['a, b', c]\n---\n");
  assert.deepEqual(result.data, { list: ['a, b', 'c'] });
});

test('apostrophe inside an unquoted flow list item is literal', () => {
  const result = parseFrontmatter("---\nlist: [dell'Ascia, b]\n---\n");
  assert.deepEqual(result.data, { list: ["dell'Ascia", 'b'] });
});

test('empty item is still an error when quotes are present', () => {
  const result = parseFrontmatter("---\nlist: ['a',,'b']\n---\n");
  assert.deepEqual(result.data, {});
  assert.deepEqual(result.errors, [{ line: 2, message: 'empty list item' }]);
});

test('unclosed frontmatter', () => {
  const text = '---\nid: a\n';
  const result = parseFrontmatter(text);
  assert.equal(result.data, null);
  assert.equal(result.body, text);
  assert.equal(result.bodyStartLine, 1);
  assert.deepEqual(result.errors, [{ line: 1, message: 'frontmatter is not closed' }]);
});

test('indented line is unsupported syntax', () => {
  const result = parseFrontmatter('---\nid: a\n  name: b\n---\n');
  assert.deepEqual(result.data, { id: 'a' });
  assert.deepEqual(result.errors, [{ line: 3, message: 'unsupported YAML syntax' }]);
});

test('list item line is unsupported syntax', () => {
  const result = parseFrontmatter('---\nid: a\n- item\n---\n');
  assert.deepEqual(result.data, { id: 'a' });
  assert.deepEqual(result.errors, [{ line: 3, message: 'unsupported YAML syntax' }]);
});

test('key without space after colon is unsupported syntax', () => {
  const result = parseFrontmatter('---\nid:a\n---\n');
  assert.deepEqual(result.data, {});
  assert.deepEqual(result.errors, [{ line: 2, message: 'unsupported YAML syntax' }]);
});

test('duplicate key keeps the first value', () => {
  const result = parseFrontmatter('---\nid: a\nid: b\n---\n');
  assert.deepEqual(result.data, { id: 'a' });
  assert.deepEqual(result.errors, [{ line: 3, message: 'duplicate key id' }]);
});

test('missing value', () => {
  const result = parseFrontmatter('---\nid:\n---\n');
  assert.deepEqual(result.data, {});
  assert.deepEqual(result.errors, [{ line: 2, message: 'missing value for key id' }]);
});

test('empty list item', () => {
  const result = parseFrontmatter('---\ntags: [a,,b]\n---\n');
  assert.deepEqual(result.data, {});
  assert.deepEqual(result.errors, [{ line: 2, message: 'empty list item' }]);
});

test('comments and blank lines are ignored', () => {
  const text = '---\n# comment\n\n   \nid: a\n  # indented comment\n---\nbody';
  const result = parseFrontmatter(text);
  assert.deepEqual(result.data, { id: 'a' });
  assert.deepEqual(result.errors, []);
  assert.equal(result.body, 'body');
});

test('CRLF input is handled like LF', () => {
  const text = '---\r\nid: a\r\ntags: [x, y]\r\n---\r\nBody\r\n';
  const result = parseFrontmatter(text);
  assert.deepEqual(result.data, { id: 'a', tags: ['x', 'y'] });
  assert.deepEqual(result.errors, []);
  assert.equal(result.body, 'Body\r\n');
  assert.equal(result.bodyStartLine, 5);
});

test('bodyStartLine for a 3-line frontmatter block', () => {
  const result = parseFrontmatter('---\nid: a\n---\nBody');
  assert.equal(result.bodyStartLine, 4);
  assert.equal(result.body, 'Body');
});

test('empty frontmatter block', () => {
  const result = parseFrontmatter('---\n---\nx');
  assert.deepEqual(result.data, {});
  assert.equal(result.bodyStartLine, 3);
  assert.equal(result.body, 'x');
});

test('frontmatter with nothing after closing line has empty body', () => {
  const result = parseFrontmatter('---\nid: a\n---');
  assert.deepEqual(result.data, { id: 'a' });
  assert.equal(result.body, '');
  assert.equal(result.bodyStartLine, 4);
});
