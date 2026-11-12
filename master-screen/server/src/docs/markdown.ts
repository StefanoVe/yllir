// Markdown of campaign documents: splitting at the master marker, rendering with
// markdown-it (HTML off), sanitizing, stable heading ids, link rewriting, plain text
// for search and titles. Owner: docs engineer.
import MarkdownIt from 'markdown-it';
import path from 'node:path';
import sanitizeHtml from 'sanitize-html';

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });

type Token = ReturnType<typeof md.parse>[number];

export type View = 'master' | 'public';

export interface Heading {
  level: number;
  text: string;
  id: string;
}

export interface Part {
  kind: 'public' | 'master';
  source: string;
}

export interface RenderedBlock {
  kind: 'public' | 'master';
  html: string;
}

export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);

/**
 * Splits a document body (metadata already removed) into its parts. The public part
 * is everything before the first marker, the master part everything after it. A
 * master-only document is one master part. Markers never reach the output.
 */
export function splitDocument(body: string, masterOnly: boolean, marker: string): Part[] {
  if (masterOnly) {
    const source = body.split(marker).join('');
    return source.trim() === '' ? [] : [{ kind: 'master', source }];
  }
  const at = body.indexOf(marker);
  if (at < 0) return [{ kind: 'public', source: body }];
  return [
    { kind: 'public', source: body.slice(0, at) },
    { kind: 'master', source: body.slice(at + marker.length).split(marker).join('') },
  ];
}

/** The parts a view may show: the public view keeps only public parts, none for master-only. */
export function partsForView(body: string, masterOnly: boolean, view: View, marker: string): Part[] {
  if (view === 'public' && masterOnly) return [];
  const parts = splitDocument(body, masterOnly, marker);
  return view === 'public' ? parts.filter((part) => part.kind === 'public') : parts;
}

export function slugify(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'section' : slug;
}

function uniqueSlug(base: string, used: Set<string>): string {
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${n}`;
    n++;
  }
  used.add(candidate);
  return candidate;
}

/** Text of an inline token: plain text and code, line breaks as spaces. */
function inlineText(token: Token | undefined): string {
  if (!token || !token.children) return '';
  let out = '';
  for (const child of token.children) {
    if (child.type === 'text' || child.type === 'code_inline') out += child.content;
    else if (child.type === 'softbreak' || child.type === 'hardbreak') out += ' ';
  }
  return out.trim();
}

/** Text of the first level-1 heading of a source, or null. */
export function headingTitle(source: string): string | null {
  const tokens = md.parse(source, {});
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === 'heading_open' && tokens[i].tag === 'h1') {
      const text = inlineText(tokens[i + 1]);
      return text === '' ? null : text;
    }
  }
  return null;
}

/** Plain text of a source: paragraphs and headings as text, code included. */
export function plainTextOf(source: string): string {
  const pieces: string[] = [];
  for (const token of md.parse(source, {})) {
    if (token.type === 'inline') pieces.push(inlineText(token));
    else if (token.type === 'fence' || token.type === 'code_block') pieces.push(token.content);
  }
  return pieces.filter((piece) => piece !== '').join('\n');
}

export type Ref =
  | { kind: 'doc'; rel: string; fragment: string }
  | { kind: 'file'; rel: string }
  | { kind: 'external'; href: string }
  | { kind: 'anchor'; href: string };

/**
 * Classifies a link or image target written in a document at docRel. Returns null for
 * anything that must not be followed: other schemes, protocol-relative, escaping the
 * campaign, inside `.campaign/` or `.git`, or a file kind the screen does not show.
 */
export function resolveRef(raw: string, docRel: string): Ref | null {
  const value = raw.trim();
  if (value === '' || value.includes('\0')) return null;
  if (value.startsWith('#')) return { kind: 'anchor', href: value };
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return /^(https?:|mailto:)/i.test(value) ? { kind: 'external', href: value } : null;
  }
  if (value.startsWith('//') || value.startsWith('\\')) return null;

  const hash = value.indexOf('#');
  const fragment = hash >= 0 ? value.slice(hash) : '';
  let pathPart = hash >= 0 ? value.slice(0, hash) : value;
  const query = pathPart.indexOf('?');
  if (query >= 0) pathPart = pathPart.slice(0, query);

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    return null;
  }
  const combined = decoded.startsWith('/')
    ? decoded.slice(1)
    : path.posix.join(path.posix.dirname(docRel), decoded);
  const rel = path.posix.normalize(combined.replace(/\\/g, '/'));
  if (rel === '' || rel === '.' || rel === '..' || rel.startsWith('../') || path.posix.isAbsolute(rel)) return null;
  const segments = rel.split('/');
  if (segments[0] === '.campaign' || segments.includes('.git')) return null;

  const ext = path.posix.extname(rel).toLowerCase();
  if (ext === '.md') return { kind: 'doc', rel, fragment };
  if (IMAGE_EXTENSIONS.has(ext)) return { kind: 'file', rel };
  return null;
}

function encodePath(rel: string): string {
  return rel.split('/').map(encodeURIComponent).join('/');
}

/** Campaign documents a Markdown source links to, resolved from docRel. */
export function linkTargets(source: string, docRel: string): Set<string> {
  const targets = new Set<string>();
  for (const token of md.parse(source, {})) {
    for (const child of token.children ?? []) {
      if (child.type !== 'link_open') continue;
      const href = child.attrGet('href');
      const ref = href === null ? null : resolveRef(String(href), docRel);
      if (ref?.kind === 'doc') targets.add(ref.rel);
    }
  }
  return targets;
}

export interface RenderOptions {
  docRel: string;
  /** Whether a link to another campaign document may be followed in this view. */
  canLink(rel: string): boolean;
}

const SANITIZED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'img', 'ul', 'ol', 'li', 'blockquote',
  'pre', 'code', 'em', 'strong', 'del', 'hr', 'br', 'table', 'thead', 'tbody', 'tr',
  'th', 'td', 'sup', 'sub',
];

const SANITIZED_ATTRIBUTES: Record<string, string[]> = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'title'],
  h1: ['id'],
  h2: ['id'],
  h3: ['id'],
  h4: ['id'],
  h5: ['id'],
  h6: ['id'],
  ol: ['start'],
  th: ['align'],
  td: ['align'],
  code: ['class'],
};

function rewriteAttribute(
  attribs: Record<string, string>,
  name: 'href' | 'src',
  tag: 'a' | 'img',
  opts: RenderOptions,
): Record<string, string> {
  const raw = attribs[name];
  if (raw === undefined) return attribs;
  const { [name]: _dropped, ...rest } = attribs;
  const ref = resolveRef(raw, opts.docRel);
  if (ref === null) return rest;
  if (ref.kind === 'file') return { ...rest, [name]: `/api/file?path=${encodeURIComponent(ref.rel)}` };
  if (tag === 'img') return rest;
  if (ref.kind === 'anchor' || ref.kind === 'external') return { ...rest, [name]: ref.href };
  if (!opts.canLink(ref.rel)) return rest;
  return { ...rest, [name]: `/doc/${encodePath(ref.rel)}${ref.fragment}` };
}

/**
 * Sanitizes an HTML fragment produced by the renderer. Scripts, event handlers, styles
 * and unknown tags are removed. Links and images are rewritten through opts.
 */
export function sanitizeFragment(html: string, opts: RenderOptions): string {
  return sanitizeHtml(html, {
    allowedTags: SANITIZED_TAGS,
    allowedAttributes: SANITIZED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: [] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed', 'template', 'svg', 'math'],
    transformTags: {
      a: (tagName, attribs) => ({ tagName, attribs: rewriteAttribute(attribs, 'href', 'a', opts) }),
      img: (tagName, attribs) => ({ tagName, attribs: rewriteAttribute(attribs, 'src', 'img', opts) }),
    },
  });
}

export interface RenderResult {
  blocks: RenderedBlock[];
  headings: Heading[];
  title: string | null;
}

/**
 * Renders the parts of one document. Heading ids are unique across all parts, so the
 * ids in `headings` match the ids in `blocks`.
 */
export function renderParts(parts: Part[], opts: RenderOptions): RenderResult {
  const used = new Set<string>();
  const headings: Heading[] = [];
  const blocks: RenderedBlock[] = [];
  for (const part of parts) {
    if (part.source.trim() === '') continue;
    const tokens = md.parse(part.source, {});
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type !== 'heading_open') continue;
      const text = inlineText(tokens[i + 1]);
      const id = uniqueSlug(slugify(text), used);
      token.attrSet('id', id);
      headings.push({ level: Number(token.tag.slice(1)), text, id });
    }
    const html = md.renderer.render(tokens, md.options, {});
    blocks.push({ kind: part.kind, html: sanitizeFragment(html, opts) });
  }
  const first = headings.find((heading) => heading.level === 1);
  return { blocks, headings, title: first ? first.text : null };
}
