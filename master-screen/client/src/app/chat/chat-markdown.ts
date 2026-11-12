// Renders the assistant's Markdown for the chat. Raw HTML is escaped (html is off). Links to
// campaign documents and images from the campaign are rewritten to the reader and the file API;
// anything else that is not a relative campaign path becomes plain text, and no external image
// is loaded. Angular still sanitizes the result when it is bound with [innerHTML].

import MarkdownIt, { type StateCore, type Token } from 'markdown-it';
import { docUrl } from './doc-link';

export interface ChatMarkdownOptions {
  /** Campaign folder that relative links and images are resolved against. Empty for the campaign root. */
  baseDir?: string;
}

/** Any URL scheme at the start, such as `https:`, `javascript:` or `data:`. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const EXTERNAL = /^https?:\/\//i;
const FILE_API = '/api/file?path=';

const md = createMarkdown();

/** Chat Markdown to HTML. Pass the result to [innerHTML]. */
export function renderChatMarkdown(text: string, opts: ChatMarkdownOptions = {}): string {
  return md.render(text, { baseDir: opts.baseDir ?? '' });
}

function createMarkdown() {
  const instance = new MarkdownIt({ html: false, linkify: false, typographer: false });
  // Links and images are judged below, not by markdown-it, so an unsafe link keeps its text.
  instance.validateLink = () => true;

  instance.core.ruler.after('inline', 'chat_rich', richInline);

  instance.renderer.rules['chat_checkbox'] = (tokens, index) =>
    `<input class="task-checkbox" type="checkbox" disabled${tokens[index].meta?.['checked'] ? ' checked' : ''}>`;

  const defaultFence = instance.renderer.rules['fence'];
  instance.renderer.rules['fence'] = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const language = token.info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    if (language === 'mermaid') {
      return `<div class="chat-diagram" data-diagram><pre class="mermaid-src">${instance.utils.escapeHtml(token.content)}</pre></div>\n`;
    }
    return defaultFence ? defaultFence(tokens, index, options, env, self) : self.renderToken(tokens, index, options);
  };

  // Tables scroll inside their own wrapper, so a wide table never breaks the page.
  instance.renderer.rules['table_open'] = (tokens, index, options, _env, self) =>
    '<div class="chat-table-wrap">' + self.renderToken(tokens, index, options);
  instance.renderer.rules['table_close'] = (tokens, index, options, _env, self) =>
    self.renderToken(tokens, index, options) + '</div>\n';

  instance.renderer.rules['image'] = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const alt = self.renderInlineAsText(token.children ?? [], options, env);
    const path = campaignPath(String(token.attrGet('src') ?? ''), baseOf(env));
    // Absolute URLs (and any other scheme) are not loaded: the alt text stands in for them.
    if (path === null) return instance.utils.escapeHtml(alt);
    const src = FILE_API + encodeURIComponent(path);
    const figure =
      `<figure class="chat-image"><img src="${instance.utils.escapeHtml(src)}" alt="${instance.utils.escapeHtml(alt)}"` +
      ` loading="lazy" data-path="${instance.utils.escapeHtml(path)}">`;
    const caption = alt ? `<figcaption>${instance.utils.escapeHtml(alt)}</figcaption>` : '';
    return `${figure}${caption}</figure>`;
  };

  return instance;
}

/** Heading levels move down one step (h1 becomes h2 and so on); h5 and h6 stay. */
function demotedTag(tag: string): string {
  const match = /^h([1-6])$/.exec(tag);
  if (!match) return tag;
  const level = Number(match[1]);
  return level <= 4 ? `h${level + 1}` : tag;
}

function richInline(state: StateCore): void {
  const tokens = state.tokens;
  const baseDir = baseOf(state.env);
  tokens.forEach((token, index) => {
    if (token.type === 'heading_open' || token.type === 'heading_close') {
      token.tag = demotedTag(token.tag);
      return;
    }
    if (token.type !== 'inline' || !token.children) return;
    const paragraph = tokens[index - 1];
    const item = tokens[index - 2];
    if (paragraph?.type === 'paragraph_open' && item?.type === 'list_item_open') markTask(state, token, item);
    token.children = rewriteLinks(token.children, baseDir);
  });
}

/** A list item that starts with `[ ]` or `[x]` becomes a disabled checkbox. */
function markTask(state: StateCore, inline: Token, item: Token): void {
  const first = inline.children?.[0];
  if (!first || first.type !== 'text') return;
  const match = /^\[([ xX])\][ \t]+/.exec(first.content);
  if (!match) return;
  first.content = first.content.slice(match[0].length);
  const box = new state.Token('chat_checkbox', 'input', 0);
  box.meta = { checked: match[1] !== ' ' };
  inline.children?.unshift(box);
  item.attrJoin('class', 'task-list-item');
}

/** Keeps the safe links (marked up in place) and drops the unsafe ones, leaving their text. */
function rewriteLinks(children: Token[], baseDir: string): Token[] {
  const out: Token[] = [];
  let dropping = false;
  for (const token of children) {
    if (token.type === 'link_open') {
      dropping = !prepareLink(token, baseDir);
      if (!dropping) out.push(token);
    } else if (token.type === 'link_close') {
      if (!dropping) out.push(token);
      dropping = false;
    } else {
      out.push(token);
    }
  }
  return out;
}

/** Sets the attributes of a safe link. Returns false when the link must become plain text. */
function prepareLink(token: Token, baseDir: string): boolean {
  const href = String(token.attrGet('href') ?? '').trim();
  if (EXTERNAL.test(href)) {
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener noreferrer');
    return true;
  }
  const hash = href.indexOf('#');
  const anchor = hash >= 0 ? href.slice(hash + 1) : '';
  const path = campaignPath(hash >= 0 ? href.slice(0, hash) : href, baseDir);
  if (path === null || !/\.md$/i.test(path)) return false;
  token.attrs = [
    ['href', docUrl(path) + (anchor ? `#${anchor}` : '')],
    ['class', 'doc-link'],
    ['data-doc', path],
  ];
  return true;
}

/**
 * A relative path inside the campaign, decoded, or null. Null for any scheme, a leading slash,
 * a backslash, or a `..` segment. The base folder is put in front when there is one.
 */
function campaignPath(raw: string, baseDir: string): string | null {
  const decoded = safeDecode(raw.trim());
  if (decoded === null) return null;
  const compact = decoded.replace(/[\s\u0000-\u001f\u007f]/g, '');
  if (SCHEME.test(compact) || compact.startsWith('/') || decoded.includes('\\')) return null;
  const segments = decoded.split('/');
  if (segments.includes('..')) return null;
  const own = segments.filter((segment) => segment !== '' && segment !== '.').join('/');
  if (own === '') return null;
  return baseDir ? `${baseDir}/${own}` : own;
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function baseOf(env: unknown): string {
  const dir = (env as { baseDir?: unknown } | null | undefined)?.baseDir;
  return typeof dir === 'string' ? dir.replace(/^\/+|\/+$/g, '') : '';
}
