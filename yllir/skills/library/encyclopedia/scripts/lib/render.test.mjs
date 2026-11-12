import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, escapeHtml, plainText } from './render.mjs';

const r = (md, options) => renderMarkdown(md, options);

test('text is escaped: script tags and raw HTML never pass through', () => {
  const html = r('<script>alert(1)</script> and <img src=x onerror=alert(1)> & "quotes"');
  assert.equal(html.includes('<script'), false);
  assert.equal(html.includes('<img'), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&quot;quotes&quot;/);
  assert.equal(escapeHtml(`'"<&>`), '&#39;&quot;&lt;&amp;&gt;');
});

test('HTML comments are removed, closed or not', () => {
  assert.equal(r('a <!-- hidden --> b'), '<p>a  b</p>');
  assert.equal(r('a <!-- never closed'), '<p>a</p>');
});

test('javascript:, data:, mailto:, protocol-relative and #master links become plain text', () => {
  const resolveLink = () => 'should-not-be-used';
  for (const url of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'mailto:someone@example.org',
    '//evil.example/x',
    'Note.md#master',
    'Note.md#Master',
  ]) {
    const html = r(`[label](${url})`, { resolveLink });
    assert.equal(html.includes('<a '), false, url);
    assert.equal(html.includes('href'), false, url);
    assert.match(html, /label/, url);
  }
});

test('http and https links become anchors with noopener, and resolved relative links use the resolver', () => {
  const html = r('[site](https://example.org/x) and [entry](../mare/)', {
    resolveLink: (url) => (url === '../mare/' ? '../mare/' : null),
  });
  assert.match(html, /<a href="https:\/\/example.org\/x" rel="noopener noreferrer">site<\/a>/);
  assert.match(html, /<a href="\.\.\/mare\/">entry<\/a>/);
  const unresolved = r('[entry](Unknown.md)', { resolveLink: () => null });
  assert.equal(unresolved, '<p>entry</p>');
});

test('href and src values with quotes are attribute-escaped', () => {
  const html = r('[x](https://example.org/a"b)', {});
  assert.equal(html.includes('"b'), false);
  assert.match(html, /href="https:\/\/example.org\/a&quot;b"/);
});

test('images resolve through the resolver, otherwise only their text remains', () => {
  const resolveImage = (url) => (url === 'img/a.png' ? '../../assets/img/abc.png' : null);
  assert.match(r('![A lamp](img/a.png)', { resolveImage }), /<img src="\.\.\/\.\.\/assets\/img\/abc\.png" alt="A lamp">/);
  assert.equal(r('![A lamp](img/b.png)', { resolveImage }), '<p>A lamp</p>');
});

test('headings are shown from level 2 down, and the heading level is clamped', () => {
  assert.equal(r('# One'), '<h2>One</h2>');
  assert.equal(r('### Three'), '<h3>Three</h3>');
  assert.equal(r('###### Six'), '<h6>Six</h6>');
});

test('lists, ordered lists with a start, nested items and tables', () => {
  assert.equal(r('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(r('3. c\n4. d'), '<ol start="3"><li>c</li><li>d</li></ol>');
  assert.match(r('- a\n  - b'), /<li>a\s*<ul><li>b<\/li><\/ul><\/li>/);
  const table = r('| a | b |\n|:-|-:|\n| 1 | 2 |');
  assert.match(table, /<th class="align-left">a<\/th><th class="align-right">b<\/th>/);
  assert.match(table, /<td class="align-left">1<\/td>/);
});

test('code spans, fenced code, emphasis and escapes', () => {
  assert.equal(r('`a <b>`'), '<p><code>a &lt;b&gt;</code></p>');
  assert.equal(r('```\n<b>x</b>\n```'), '<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>');
  assert.equal(r('*em* and **strong**'), '<p><em>em</em> and <strong>strong</strong></p>');
  assert.equal(r('\\*not em\\*'), '<p>*not em*</p>');
  assert.equal(r('a 2 * 3 * 4'), '<p>a 2 * 3 * 4</p>');
});

test('blockquotes and rules', () => {
  assert.equal(r('> quoted'), '<blockquote><p>quoted</p></blockquote>');
  assert.equal(r('---'), '<hr>');
});

test('plainText keeps labels and drops markup and reserved links', () => {
  assert.equal(plainText('# Title\n\nSee [the pier](pier.md) and **bold**.'), 'Title\n\nSee the pier and bold.');
});
