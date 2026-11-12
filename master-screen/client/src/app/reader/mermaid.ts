// Mermaid diagrams in the reader. The server keeps a ```mermaid fence as
// `<pre><code class="language-mermaid">`; this file draws those blocks as SVG and keeps
// the source visible with a short note when a diagram cannot be drawn. The mermaid
// package is loaded only when a document has a diagram, so the main bundle stays small.

export type DiagramTheme = 'dark' | 'default';

/** The part of mermaid this file uses. The real one is loaded by `loadMermaidEngine`. */
export interface DiagramEngine {
  initialize(theme: DiagramTheme): void;
  /** Resolves to the SVG markup of the diagram; rejects when the source cannot be drawn. */
  render(id: string, source: string): Promise<string>;
}

export interface DrawOptions {
  engine: () => Promise<DiagramEngine>;
  theme: () => DiagramTheme;
  /** Plain-language note shown under a diagram that could not be drawn. */
  errorText: string;
}

const CODE_SELECTOR = 'pre > code.language-mermaid';
const DIAGRAM_CLASS = 'ms-diagram';
const ERROR_CLASS = 'ms-diagram-error';

/** Original code block of each drawn diagram, so a redraw (theme change) can start over. */
const originals = new WeakMap<HTMLElement, HTMLPreElement>();
/** Latest draw per root: a draw that is no longer the latest stops before touching the DOM. */
const generations = new WeakMap<HTMLElement, number>();
let counter = 0;

/**
 * Draws every mermaid code block under root as SVG. Diagrams already drawn under root are
 * restored to their source first, so calling this again redraws them (for example after a
 * theme change). Nothing is loaded when root holds no diagram.
 */
export async function drawDiagrams(root: HTMLElement, opts: DrawOptions): Promise<void> {
  const generation = (generations.get(root) ?? 0) + 1;
  generations.set(root, generation);
  restoreSources(root);
  const codes = Array.from(root.querySelectorAll<HTMLElement>(CODE_SELECTOR));
  if (codes.length === 0) return;

  let engine: DiagramEngine | null = null;
  try {
    engine = await opts.engine();
    engine.initialize(opts.theme());
  } catch {
    engine = null;
  }

  for (const code of codes) {
    if (generations.get(root) !== generation) return;
    const pre = code.parentElement;
    if (!(pre instanceof HTMLPreElement)) continue;
    if (engine === null) {
      addNote(pre, opts.errorText);
      continue;
    }
    try {
      const svg = await engine.render(nextId(), code.textContent ?? '');
      if (generations.get(root) !== generation) return;
      replaceWithDiagram(pre, svg);
    } catch {
      if (generations.get(root) !== generation) return;
      addNote(pre, opts.errorText);
    }
  }
}

/** Theme the diagrams are drawn in: data-theme on <html> when set, else the system preference. */
export function currentTheme(): DiagramTheme {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark') return 'dark';
  if (attr === 'light') return 'default';
  return systemPrefersDark() ? 'dark' : 'default';
}

/**
 * Calls onChange when the effective theme changes (manual override or system preference).
 * Returns a function that stops watching.
 */
export function watchTheme(onChange: (theme: DiagramTheme) => void): () => void {
  let last = currentTheme();
  const check = () => {
    const next = currentTheme();
    if (next === last) return;
    last = next;
    onChange(next);
  };
  const observer = new MutationObserver(check);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  media?.addEventListener('change', check);
  return () => {
    observer.disconnect();
    media?.removeEventListener('change', check);
  };
}

/** The real engine: the mermaid package, imported on first use. Strict security, no auto start. */
export async function loadMermaidEngine(): Promise<DiagramEngine> {
  const { default: mermaid } = await import('mermaid');
  return {
    initialize: (theme) => mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme }),
    render: async (id, source) => (await mermaid.render(id, source)).svg,
  };
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

function nextId(): string {
  counter += 1;
  return `ms-diagram-${counter}`;
}

/** Puts every drawn diagram back to its source block and removes the notes. */
function restoreSources(root: HTMLElement): void {
  for (const note of Array.from(root.querySelectorAll(`.${ERROR_CLASS}`))) note.remove();
  for (const box of Array.from(root.querySelectorAll<HTMLElement>(`.${DIAGRAM_CLASS}`))) {
    const original = originals.get(box);
    if (original) box.replaceWith(original.cloneNode(true));
    else box.remove();
  }
}

function replaceWithDiagram(pre: HTMLPreElement, svgMarkup: string): void {
  const box = document.createElement('div');
  box.className = DIAGRAM_CLASS;
  box.innerHTML = svgMarkup;
  const svg = box.querySelector('svg');
  if (svg) fitNaturalWidth(svg);
  originals.set(box, pre.cloneNode(true) as HTMLPreElement);
  pre.replaceWith(box);
}

/**
 * Mermaid caps the SVG at the column width. Here the SVG gets its natural width (from the
 * viewBox) so a wide diagram scrolls inside its box instead of shrinking into unreadable text.
 */
function fitNaturalWidth(svg: SVGElement): void {
  const parts = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  if (parts.length === 4 && parts[2] > 0) svg.setAttribute('width', String(parts[2]));
  svg.style.maxWidth = 'none';
}

function addNote(pre: HTMLPreElement, text: string): void {
  const note = document.createElement('p');
  note.className = ERROR_CLASS;
  note.setAttribute('role', 'note');
  note.textContent = text;
  pre.after(note);
}
