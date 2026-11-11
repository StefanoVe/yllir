import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFrontmatter,
  findMetadataBlock,
  renderMetadata,
  toCommentMetadata,
  METADATA_OPEN,
  METADATA_CLOSE,
} from './frontmatter.mjs';

// Converts a dashes fixture to the comment form and fails if that is not possible.
function toComment(text) {
  const converted = toCommentMetadata(text);
  assert.notEqual(converted, null, `expected a closed dashes block: ${JSON.stringify(text)}`);
  return converted;
}

// Existing fixtures, all in the dashes form, covering every kind of input.
const DASHES_FIXTURES = [
  '---\nid: torre\ntags: [a, b]\nempty: []\n---\nBody text\n',
  '---\nid: evento\nappearances:\n  - subject: ferry\n    location: [harbor, north] \n---\nBody\n',
  '---\nid: a\nrelations:\n  - to: gilda-del-sale\n    type: ally-of\n  - to: b\n    type: kin-of\n---\nBody\n',
  '---\nid: teodo-marr\nkind: character\nlocation: [borgo-cenere]\nappearances:\n  - subject: ferry\n    location: [harbor]\nrelations:\n  - to: gilda-del-sale\n    type: depends-on\n---\nBody',
  '---\ntitle: "Torre: dell\'Ascia"\nalias: \'x y\'\nq: "a\'\nlist: ["one", \'two\']\n---\n',
  "---\nalias: 'dell''Ascia'\n---\n",
  "---\nlist: [ 'l''orso', b ]\n---\n",
  '---\nlist: ["a, b", c]\n---\n',
  '---\nid: a\n  name: b\n---\n',
  '---\nid: a\n- item\n---\n',
  '---\nid:a\n---\n',
  '---\nid: a\nid: b\n---\n',
  '---\nid:\n---\n',
  '---\ntags: [a,,b]\n---\n',
  '---\nrelations:\n  - to: b\n    type: [x,, y]\n---\n',
  '---\nrelations:\n  - to: b\n    type: ally-of\nrelations: []\n---\n',
  '---\n# comment\n\n   \nid: a\n  # indented comment\n---\nbody',
  '---\r\nid: a\r\ntags: [x, y]\r\n---\r\nBody\r\n',
  '---\nid: a\n---',
  '---\n---\nx',
];

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

test('relations accepts a block list of mappings', () => {
  const result = parseFrontmatter('---\nid: a\nrelations:\n  - to: gilda-del-sale\n    type: ally-of\n  - to: b\n    type: kin-of\n---\nBody\n');
  assert.deepEqual(result.data, {
    id: 'a',
    relations: [
      { to: 'gilda-del-sale', type: 'ally-of' },
      { to: 'b', type: 'kin-of' },
    ],
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.bodyStartLine, 9);
});

test('appearances and relations blocks work in the same frontmatter', () => {
  const text = [
    '---',
    'id: teodo-marr',
    'kind: character',
    'location: [borgo-cenere]',
    'appearances:',
    '  - subject: ferry',
    '    location: [harbor]',
    'relations:',
    '  - to: gilda-del-sale',
    '    type: depends-on',
    '  - to: borgo-cenere',
    '    type: member-of',
    '---',
    'Body',
  ].join('\n');
  const result = parseFrontmatter(text);
  assert.deepEqual(result.data, {
    id: 'teodo-marr',
    kind: 'character',
    location: ['borgo-cenere'],
    appearances: [{ subject: 'ferry', location: ['harbor'] }],
    relations: [
      { to: 'gilda-del-sale', type: 'depends-on' },
      { to: 'borgo-cenere', type: 'member-of' },
    ],
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.body, 'Body');
});

test('relations block syntax reports malformed YAML with its source line', () => {
  const result = parseFrontmatter('---\nid: a\nrelations:\n  - to: b\n    type: [x,, y]\n---\n');
  assert.deepEqual(result.errors, [{ line: 5, message: 'empty list item' }]);
});

test('a duplicate relations key is reported', () => {
  const result = parseFrontmatter('---\nrelations:\n  - to: b\n    type: ally-of\nrelations: []\n---\n');
  assert.deepEqual(result.errors, [{ line: 5, message: 'duplicate key relations' }]);
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

test('findMetadataBlock finds the comment form', () => {
  assert.deepEqual(findMetadataBlock([METADATA_OPEN, 'id: a', METADATA_CLOSE, 'x']), { format: 'comment', close: 2 });
  assert.deepEqual(findMetadataBlock(['<!-- yllir', '---', '-->']), { format: 'comment', close: 2 });
});

test('findMetadataBlock finds the dashes form', () => {
  assert.deepEqual(findMetadataBlock(['---', 'id: a', '---']), { format: 'dashes', close: 2 });
  // The dashes form does not close on -->.
  assert.deepEqual(findMetadataBlock(['---', '-->']), { format: 'dashes', close: -1 });
});

test('findMetadataBlock reports an unclosed block with close -1', () => {
  assert.deepEqual(findMetadataBlock([METADATA_OPEN, 'id: a']), { format: 'comment', close: -1 });
  assert.deepEqual(findMetadataBlock(['---', 'id: a']), { format: 'dashes', close: -1 });
});

test('findMetadataBlock returns null when line 0 opens no block', () => {
  assert.equal(findMetadataBlock(['# Title', '---']), null);
  assert.equal(findMetadataBlock(['--- ', 'id: a', '---']), null);
  assert.equal(findMetadataBlock([]), null);
});

test('renderMetadata writes the comment form without a trailing newline', () => {
  assert.equal(renderMetadata(['id: a', 'location: [x]']), '<!-- yllir\nid: a\nlocation: [x]\n-->');
});

test('renderMetadata with no content lines is an empty comment block', () => {
  assert.equal(renderMetadata([]), '<!-- yllir\n-->');
});

test('renderMetadata output parses back to the same data', () => {
  const text = renderMetadata(['id: a', 'tags: [x, y]']) + '\nBody';
  const result = parseFrontmatter(text);
  assert.deepEqual(result.data, { id: 'a', tags: ['x', 'y'] });
  assert.equal(result.body, 'Body');
  assert.equal(result.format, 'comment');
  assert.deepEqual(result.errors, []);
});

test('toCommentMetadata replaces only the two delimiter lines and keeps the body byte-identical', () => {
  const text = '---\nid: a\nlocation: [x]\n---\nBody line\n\n- item\n---\nmore\n';
  assert.equal(
    toCommentMetadata(text),
    '<!-- yllir\nid: a\nlocation: [x]\n-->\nBody line\n\n- item\n---\nmore\n',
  );
});

test('toCommentMetadata keeps \\r\\n line endings', () => {
  assert.equal(toCommentMetadata('---\r\nid: a\r\n---\r\nBody\r\n'), '<!-- yllir\r\nid: a\r\n-->\r\nBody\r\n');
});

test('toCommentMetadata returns null on comment-form text', () => {
  assert.equal(toCommentMetadata('<!-- yllir\nid: a\n-->\nBody'), null);
});

test('toCommentMetadata returns null when there is no block', () => {
  assert.equal(toCommentMetadata('# Title\n\nBody\n'), null);
});

test('toCommentMetadata returns null when the dashes block is not closed', () => {
  assert.equal(toCommentMetadata('---\nid: a\nBody'), null);
});

for (const dashes of DASHES_FIXTURES) {
  test(`both forms parse identically: ${JSON.stringify(dashes).slice(0, 80)}`, () => {
    const comment = toComment(dashes);
    const fromDashes = parseFrontmatter(dashes);
    const fromComment = parseFrontmatter(comment);
    assert.equal(fromDashes.format, 'dashes');
    assert.equal(fromComment.format, 'comment');
    assert.deepEqual(fromComment.data, fromDashes.data);
    assert.equal(fromComment.body, fromDashes.body);
    assert.equal(fromComment.bodyStartLine, fromDashes.bodyStartLine);
    assert.deepEqual(fromComment.errors, fromDashes.errors);
  });
}

test('CRLF input is handled in the comment form', () => {
  const text = '<!-- yllir\r\nid: a\r\ntags: [x, y]\r\n-->\r\nBody\r\n';
  const result = parseFrontmatter(text);
  assert.deepEqual(result.data, { id: 'a', tags: ['x', 'y'] });
  assert.deepEqual(result.errors, []);
  assert.equal(result.body, 'Body\r\n');
  assert.equal(result.bodyStartLine, 5);
  assert.equal(result.format, 'comment');
});

test('unclosed comment block', () => {
  const text = '<!-- yllir\nid: a\n';
  const result = parseFrontmatter(text);
  assert.equal(result.data, null);
  assert.equal(result.body, text);
  assert.equal(result.bodyStartLine, 1);
  assert.deepEqual(result.errors, [{ line: 1, message: 'frontmatter is not closed' }]);
  assert.equal(result.format, 'comment');
});

test('a comment-form value containing --> is an error', () => {
  const result = parseFrontmatter('<!-- yllir\ntitle: a --> b\n-->\nBody');
  assert.deepEqual(result.data, { title: 'a --> b' });
  assert.deepEqual(result.errors, [{ line: 2, message: 'metadata line contains -->' }]);
  assert.equal(result.body, 'Body');
});

test('a dashes-form value containing --> is not an error', () => {
  const result = parseFrontmatter('---\ntitle: a --> b\n---\nBody');
  assert.deepEqual(result.data, { title: 'a --> b' });
  assert.deepEqual(result.errors, []);
});
