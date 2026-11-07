import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMarkdown } from './zones.mjs';

const blocks = (body, firstLine) => analyzeMarkdown(body, firstLine).lines.map((l) => l.block);
const messages = (body, firstLine) => analyzeMarkdown(body, firstLine).errors.map((e) => e.message);
const spansOf = (body) => analyzeMarkdown(body).lines[0].spans;

test('fenced code block', () => {
  const r = analyzeMarkdown('a\n```\nx = 1\n```\nb');
  assert.deepEqual(r.lines.map((l) => l.block), ['paragraph', 'fence-open', 'code', 'fence-close', 'paragraph']);
  assert.deepEqual(r.errors, []);
});

test('mermaid fenced block', () => {
  const r = analyzeMarkdown('```mermaid\ngraph TD\n```');
  assert.deepEqual(r.lines.map((l) => l.block), ['fence-open', 'mermaid', 'fence-close']);
  assert.deepEqual(r.errors, []);
});

test('unclosed fence reports error at opening line', () => {
  const r = analyzeMarkdown('```\nx', 5);
  assert.deepEqual(r.lines.map((l) => l.block), ['fence-open', 'code']);
  assert.deepEqual(r.errors, [{ line: 5, message: 'code fence is not closed' }]);
});

test('multi-line HTML comment', () => {
  assert.deepEqual(blocks('<!-- start\nmiddle\nend -->\nafter'), ['comment', 'comment', 'comment', 'paragraph']);
});

test('unclosed HTML comment', () => {
  const r = analyzeMarkdown('<!-- start\nno end');
  assert.deepEqual(r.errors, [{ line: 1, message: 'HTML comment is not closed' }]);
});

test('valid master block', () => {
  const body = [
    '<!-- master -->',
    '## Master',
    '',
    'Secret text',
    '### Notes',
    '<!-- /master -->',
  ].join('\n');
  const r = analyzeMarkdown(body);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.lines.map((l) => l.block), [
    'master-open', 'heading', 'blank', 'paragraph', 'heading', 'master-close',
  ]);
  assert.deepEqual(r.lines.map((l) => l.inMaster), [false, true, true, true, true, false]);
});

test('master error: more than one master block (open while open)', () => {
  assert.deepEqual(
    messages('<!-- master -->\n## Master\n<!-- master -->\n<!-- /master -->'),
    ['more than one master block'],
  );
});

test('master error: more than one master block (second block after first)', () => {
  assert.ok(messages('<!-- master -->\n## Master\n<!-- /master -->\n<!-- master -->').includes('more than one master block'));
});

test('master error: closed but never opened', () => {
  assert.deepEqual(messages('<!-- /master -->'), ['master block closed but never opened']);
});

test('master error: not closed, reported at opening line', () => {
  assert.deepEqual(analyzeMarkdown('<!-- master -->\n## Master\ntext').errors, [
    { line: 1, message: 'master block is not closed' },
  ]);
});

test('master error: must start with ## Master', () => {
  assert.deepEqual(analyzeMarkdown('<!-- master -->\ntext\n<!-- /master -->').errors, [
    { line: 2, message: 'master block must start with ## Master' },
  ]);
});

test('master error: level 1 or 2 heading inside master block', () => {
  const r = analyzeMarkdown('<!-- master -->\n## Master\n## Another\n# Top\n<!-- /master -->');
  assert.deepEqual(r.errors, [
    { line: 3, message: 'only ### or lower headings allowed in master block' },
    { line: 4, message: 'only ### or lower headings allowed in master block' },
  ]);
});

test('master error: content after master block', () => {
  assert.deepEqual(analyzeMarkdown('<!-- master -->\n## Master\n<!-- /master -->\n\nPublic').errors, [
    { line: 5, message: 'content after master block' },
  ]);
});

test('heading level and headingText, trailing hashes removed', () => {
  const h = analyzeMarkdown('## Costa di Selce ##').lines[0];
  assert.equal(h.block, 'heading');
  assert.equal(h.level, 2);
  assert.equal(h.headingText, 'Costa di Selce');
  const h3 = analyzeMarkdown('### Plain').lines[0];
  assert.equal(h3.level, 3);
  assert.equal(h3.headingText, 'Plain');
  assert.equal(analyzeMarkdown('#nospace').lines[0].block, 'paragraph');
});

test('table lines', () => {
  assert.deepEqual(blocks('| a | b |\n|---|---|'), ['table', 'table']);
});

test('quote lines', () => {
  assert.deepEqual(blocks('> note'), ['quote']);
});

test('list lines', () => {
  assert.deepEqual(blocks('- a\n1. a\n2) a'), ['list', 'list', 'list']);
});

test('italic narrative paragraph, single line', () => {
  const l = analyzeMarkdown('_Whispers in the dark._').lines[0];
  assert.equal(l.block, 'paragraph');
  assert.equal(l.italic, true);
});

test('italic narrative paragraph, multi-line', () => {
  const r = analyzeMarkdown('_First line\nsecond line_\n\nplain');
  assert.deepEqual(r.lines.map((l) => l.italic), [true, true, undefined, false]);
});

test('not italic: bold, and underscore only at start', () => {
  assert.equal(analyzeMarkdown('__bold__').lines[0].italic, false);
  assert.equal(analyzeMarkdown('_only start').lines[0].italic, false);
});

test('inline code span', () => {
  const text = 'Use `code` here';
  assert.deepEqual(spansOf(text), [{ kind: 'code', start: 4, end: 10 }]);
});

test('double-backtick code span containing a single backtick', () => {
  const text = '``a ` b`` end';
  const spans = spansOf(text);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].kind, 'code');
  assert.equal(text.slice(spans[0].start, spans[0].end), '``a ` b``');
});

test('comment span', () => {
  const text = 'x <!-- note --> y';
  const spans = spansOf(text);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].kind, 'comment');
  assert.equal(text.slice(spans[0].start, spans[0].end), '<!-- note -->');
});

test('image span with target', () => {
  const text = '![alt text](img/a.png)';
  const spans = spansOf(text);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].kind, 'image');
  assert.equal(spans[0].target, 'img/a.png');
  assert.equal(text.slice(spans[0].start, spans[0].end), text);
});

test('link span with label indexes', () => {
  const text = 'See [the Map](maps/x.md) now';
  const spans = spansOf(text);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].kind, 'link');
  assert.equal(spans[0].target, 'maps/x.md');
  assert.equal(text.slice(spans[0].labelStart, spans[0].labelEnd), 'the Map');
  assert.equal(text.slice(spans[0].start, spans[0].end), '[the Map](maps/x.md)');
});

test('link inside code span is not a link', () => {
  assert.deepEqual(spansOf('`[x](y)`').map((s) => s.kind), ['code']);
});

test('bracket without target is not a link', () => {
  assert.deepEqual(spansOf('[not a link]'), []);
});

test('firstLine offset is applied to line numbers', () => {
  const r = analyzeMarkdown('a\nb', 10);
  assert.deepEqual(r.lines.map((l) => l.line), [10, 11]);
  assert.deepEqual(analyzeMarkdown('```\nx', 20).errors, [{ line: 20, message: 'code fence is not closed' }]);
});

test('CRLF line breaks', () => {
  const r = analyzeMarkdown('# T\r\n\r\ntext\r\n');
  assert.deepEqual(r.lines.map((l) => l.text), ['# T', '', 'text']);
  assert.deepEqual(r.lines.map((l) => l.block), ['heading', 'blank', 'paragraph']);
  assert.equal(r.lines[0].headingText, 'T');
  assert.deepEqual(r.errors, []);
});
