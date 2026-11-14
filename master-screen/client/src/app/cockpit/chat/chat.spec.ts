import { describe, expect, it } from 'vitest';
import { renderMessageMarkdown } from './chat';

describe('renderMessageMarkdown', () => {
  it('turns a blank line into a new paragraph and a single break into a line break', () => {
    const html = renderMessageMarkdown('First line\nsecond line\n\nNext paragraph');
    expect(html).toBe('<p>First line<br>second line</p><p>Next paragraph</p>');
  });

  it('keeps a list as its own block between paragraphs', () => {
    const html = renderMessageMarkdown('Before\n- one\n- two\nAfter');
    expect(html).toContain('<p>Before</p>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<p>After</p>');
    expect(html).not.toContain('<p><ul>');
  });

  it('escapes the text before rendering', () => {
    expect(renderMessageMarkdown('<b>x</b>')).toBe('<p>&lt;b&gt;x&lt;/b&gt;</p>');
  });
});
