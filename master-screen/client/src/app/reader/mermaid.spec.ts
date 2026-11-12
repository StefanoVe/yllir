import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DiagramTheme, currentTheme, drawDiagrams } from './mermaid';

const FLOW = '<pre><code class="language-mermaid">flowchart TD\n  A --&gt; B\n</code></pre>';
const CODE = '<pre><code class="language-ts">const x = 1;\n</code></pre>';
const NOTE = 'This diagram could not be drawn.';

function root(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

function fakeEngine(render: (id: string, source: string) => Promise<string>) {
  return {
    initialize: vi.fn<(theme: DiagramTheme) => void>(),
    render: vi.fn<(id: string, source: string) => Promise<string>>(render),
  };
}


const OK_SVG = '<svg viewBox="0 0 200 100" style="max-width: 200px;" width="100%"><text>A</text></svg>';

describe('drawDiagrams', () => {
  let el: HTMLElement;

  beforeEach(() => {
    el = root('');
  });

  afterEach(() => {
    el.remove();
  });

  it('does not load the engine when the document has no diagram', async () => {
    el.innerHTML = CODE + '<p>text</p>';
    const engine = vi.fn();
    await drawDiagrams(el, { engine: engine as never, theme: () => 'default', errorText: NOTE });
    expect(engine).not.toHaveBeenCalled();
    expect(el.querySelector('pre code.language-ts')).not.toBeNull();
  });

  it('replaces a mermaid block with the SVG and passes the decoded source', async () => {
    el.innerHTML = FLOW + CODE;
    const engine = fakeEngine(async () => OK_SVG);
    await drawDiagrams(el, { engine: async () => engine, theme: () => 'dark', errorText: NOTE });

    expect(engine.initialize).toHaveBeenCalledWith('dark');
    expect(engine.render).toHaveBeenCalledTimes(1);
    expect(engine.render.mock.calls[0][1]).toBe('flowchart TD\n  A --> B\n');
    const box = el.querySelector('.ms-diagram');
    expect(box?.querySelector('svg')).not.toBeNull();
    expect(box?.querySelector('svg')?.getAttribute('width')).toBe('200');
    expect(el.querySelector('code.language-mermaid')).toBeNull();
    expect(el.querySelector('pre code.language-ts')).not.toBeNull();
    expect(el.querySelector('.ms-diagram-error')).toBeNull();
  });

  it('keeps the source and adds a note when the diagram cannot be drawn', async () => {
    el.innerHTML = FLOW;
    const engine = fakeEngine(async () => {
      throw new Error('Parse error');
    });
    await drawDiagrams(el, { engine: async () => engine, theme: () => 'default', errorText: NOTE });

    expect(el.querySelector('.ms-diagram')).toBeNull();
    expect(el.querySelector('pre code.language-mermaid')).not.toBeNull();
    const note = el.querySelector('.ms-diagram-error');
    expect(note?.textContent).toBe(NOTE);
    expect(note?.getAttribute('role')).toBe('note');
  });

  it('keeps the source and adds a note when the engine cannot be loaded', async () => {
    el.innerHTML = FLOW;
    await drawDiagrams(el, {
      engine: async () => {
        throw new Error('chunk failed');
      },
      theme: () => 'default',
      errorText: NOTE,
    });
    expect(el.querySelector('pre code.language-mermaid')).not.toBeNull();
    expect(el.querySelector('.ms-diagram-error')?.textContent).toBe(NOTE);
  });

  it('redraws from the source when called again (theme change), without duplicates', async () => {
    el.innerHTML = FLOW;
    const engine = fakeEngine(async () => OK_SVG);
    const opts = { engine: async () => engine, errorText: NOTE };

    let theme: DiagramTheme = 'default';
    await drawDiagrams(el, { ...opts, theme: () => theme });
    theme = 'dark';
    await drawDiagrams(el, { ...opts, theme: () => theme });

    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(engine.initialize).toHaveBeenLastCalledWith('dark');
    expect(el.querySelectorAll('.ms-diagram')).toHaveLength(1);
    expect(el.querySelectorAll('svg')).toHaveLength(1);
  });

  it('stops a draw that was overtaken by a newer one', async () => {
    el.innerHTML = FLOW;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = fakeEngine(async () => {
      await gate;
      return OK_SVG;
    });
    const fast = fakeEngine(async () => OK_SVG.replace('>A<', '>B<'));

    const first = drawDiagrams(el, { engine: async () => slow, theme: () => 'default', errorText: NOTE });
    await drawDiagrams(el, { engine: async () => fast, theme: () => 'dark', errorText: NOTE });
    release();
    await first;

    expect(el.querySelectorAll('.ms-diagram')).toHaveLength(1);
    expect(el.querySelector('.ms-diagram text')?.textContent).toBe('B');
  });
});

describe('currentTheme', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    vi.unstubAllGlobals();
  });

  it('follows the data-theme override first', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(currentTheme()).toBe('dark');
    document.documentElement.setAttribute('data-theme', 'light');
    expect(currentTheme()).toBe('default');
  });

  it('follows the system preference when there is no override', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('dark') }));
    expect(currentTheme()).toBe('dark');
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(currentTheme()).toBe('default');
  });
});
