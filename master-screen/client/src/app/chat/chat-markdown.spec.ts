import { describe, expect, it } from 'vitest';
import { renderChatMarkdown } from './chat-markdown';

describe('renderChatMarkdown', () => {
  it('renders a table inside a scrolling wrapper', () => {
    const html = renderChatMarkdown('| Name | HP |\n|---|---|\n| Alia | 12 |');
    expect(html).toContain('<div class="chat-table-wrap"><table>');
    expect(html).toContain('<th>Name</th>');
    expect(html).toContain('<td>12</td>');
    expect(html).toContain('</table>\n</div>');
  });

  it('renders task items as disabled checkboxes', () => {
    const html = renderChatMarkdown('- [x] done thing\n- [ ] open thing');
    expect(html).toContain('<li class="task-list-item">');
    expect(html).toContain('<input class="task-checkbox" type="checkbox" disabled checked>');
    expect(html).toContain('<input class="task-checkbox" type="checkbox" disabled>');
    expect(html).toContain('done thing');
    expect(html).not.toContain('[x]');
  });

  it('turns a relative document link into a reader link with its anchor', () => {
    const html = renderChatMarkdown('See [Alia](characters/alia.md#backstory).');
    expect(html).toContain('<a href="/doc/characters/alia.md#backstory" class="doc-link" data-doc="characters/alia.md">Alia</a>');
  });

  it('decodes the document path and encodes each segment of the reader URL', () => {
    const html = renderChatMarkdown('[Port](places/porto%20nuovo.md)');
    expect(html).toContain('href="/doc/places/porto%20nuovo.md"');
    expect(html).toContain('data-doc="places/porto nuovo.md"');
  });

  it('resolves document links against a base folder', () => {
    const html = renderChatMarkdown('[Notes](notes.md)', { baseDir: 'sessions/one' });
    expect(html).toContain('href="/doc/sessions/one/notes.md"');
  });

  it('opens external links in a new window without the opener', () => {
    const html = renderChatMarkdown('[Site](https://example.com/page)');
    expect(html).toContain('href="https://example.com/page"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('keeps the text of a javascript: link and drops the link', () => {
    const html = renderChatMarkdown('[click me](javascript:alert(1))');
    expect(html).toContain('click me');
    expect(html).not.toContain('<a');
    expect(html).not.toContain('javascript:');
  });

  it('keeps the text of data:, file: and parent-folder links without a link', () => {
    for (const source of ['[x](data:text/html,hi)', '[x](file:///etc/passwd)', '[x](../secret.md)', '[x](/doc/a.md)']) {
      const html = renderChatMarkdown(source);
      expect(html).not.toContain('<a');
      expect(html).toContain('x');
    }
  });

  it('rewrites a relative campaign image to the file API with a caption', () => {
    const html = renderChatMarkdown('![Old map](images/map%20one.png)');
    expect(html).toContain('<figure class="chat-image"><img src="/api/file?path=images%2Fmap%20one.png"');
    expect(html).toContain('alt="Old map"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('data-path="images/map one.png"');
    expect(html).toContain('<figcaption>Old map</figcaption></figure>');
  });

  it('leaves out the caption when the image has no alt text', () => {
    const html = renderChatMarkdown('![](images/x.png)');
    expect(html).toContain('<figure class="chat-image">');
    expect(html).not.toContain('<figcaption>');
  });

  it('does not load an absolute image URL and shows its alt text instead', () => {
    const html = renderChatMarkdown('![Tracker](https://tracker.example/pixel.png)');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('tracker.example');
    expect(html).toContain('Tracker');
  });

  it('renders a mermaid fence as a diagram source block', () => {
    const html = renderChatMarkdown('```mermaid\nflowchart TD\n  A --> B\n```');
    expect(html).toBe(
      '<div class="chat-diagram" data-diagram><pre class="mermaid-src">flowchart TD\n  A --&gt; B\n</pre></div>\n',
    );
  });

  it('marks other fenced code with its language class', () => {
    const html = renderChatMarkdown('```ts\nconst a = 1;\n```');
    expect(html).toContain('<code class="language-ts">');
    expect(html).toContain('const a = 1;');
  });

  it('demotes headings one level so a chat message never shows a page title', () => {
    const html = renderChatMarkdown('# Title\n\n## Part\n\n### Sub\n\n#### Detail\n\n##### Deep');
    expect(html).toContain('<h2>Title</h2>');
    expect(html).toContain('<h3>Part</h3>');
    expect(html).toContain('<h4>Sub</h4>');
    expect(html).toContain('<h5>Detail</h5>');
    expect(html).toContain('<h5>Deep</h5>');
    expect(html).not.toContain('<h1');
  });

  it('escapes raw HTML instead of rendering it', () => {
    const html = renderChatMarkdown('Hello <script>alert(1)</script> <img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders strikethrough, blockquotes and lists', () => {
    const html = renderChatMarkdown('~~old~~\n\n> note\n\n- one\n- two');
    expect(html).toContain('<s>old</s>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<ul>');
  });
});
