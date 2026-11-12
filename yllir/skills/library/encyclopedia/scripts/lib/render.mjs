// Markdown to HTML for the public encyclopedia. A CommonMark subset: headings,
// paragraphs, lists, tables, emphasis, code, links, images, blockquotes, rules.
// Safety by construction: every piece of text is escaped, raw HTML is never
// passed through (HTML comments are removed), and a link or image is emitted
// only when its target is http(s) (links) or one the caller resolves. Anything
// else (javascript:, data:, mailto:, protocol-relative, #master) becomes plain text.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes text for HTML text and attribute values. */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

const EXTERNAL = /^https?:\/\//i;
const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
const CONTROL_OR_SPACE = /[\u0000- \u007f]/g;
const ASCII_PUNCT = /[!-/:-@[-`{-~]/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>/;
const BULLET = /^( {0,3})([-*+])[ \t]+(.*)$/;
const ORDERED = /^( {0,3})(\d{1,9})[.)][ \t]+(.*)$/;
const TABLE_DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/**
 * Renders Markdown to HTML.
 * @param {string} markdown text without metadata
 * @param {{ resolveLink?: (url: string) => string|null, resolveImage?: (url: string) => string|null, minHeading?: number }} [options]
 *   resolveLink returns the href of a relative link, or null to keep it as plain text;
 *   resolveImage returns the src of a relative image, or null to keep only its text;
 *   minHeading is the smallest heading level written (default 2: the page has one h1).
 * @returns {string} HTML fragment
 */
export function renderMarkdown(markdown, options = {}) {
  const ctx = {
    resolveLink: options.resolveLink ?? (() => null),
    resolveImage: options.resolveImage ?? (() => null),
    minHeading: options.minHeading ?? 2,
    tight: false,
  };
  const clean = stripComments(String(markdown ?? ''));
  return renderBlocks(clean.replace(/\r\n?/g, '\n').split('\n'), ctx);
}

/** Removes HTML comments, including one that is never closed. */
export function stripComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '').replace(/<!--[\s\S]*$/, '');
}

/** Plain text of a Markdown fragment: markup removed, labels kept. */
export function plainText(markdown) {
  return stripComments(String(markdown ?? ''))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^ {0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^ {0,3}>[ \t]?/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const blank = (line) => line.trim() === '';

function indentOf(line) {
  let n = 0;
  for (const ch of line) {
    if (ch === ' ') n++;
    else if (ch === '\t') n += 4 - (n % 4);
    else break;
  }
  return n;
}

function isBlockStart(line) {
  return FENCE_OPEN.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || BULLET.test(line) || ORDERED.test(line);
}

function renderBlocks(lines, ctx) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) {
      i++;
      continue;
    }

    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      const marker = fence[1];
      const body = [];
      i++;
      while (i < lines.length && !closesFence(lines[i], marker)) {
        body.push(lines[i]);
        i++;
      }
      i++; // the closing fence (or the end of the text)
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = Math.min(6, Math.max(ctx.minHeading, heading[1].length));
      const text = (heading[2] ?? '').replace(/[ \t]+#+$/, '').replace(/^#+$/, '');
      out.push(`<h${level}>${inline(text, ctx)}</h${level}>`);
      i++;
      continue;
    }

    if (RULE.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner = [];
      while (i < lines.length && !blank(lines[i]) && (QUOTE.test(lines[i]) || !isBlockStart(lines[i]))) {
        inner.push(lines[i].replace(QUOTE, '').replace(/^ /, ''));
        i++;
      }
      out.push(`<blockquote>${renderBlocks(inner, ctx)}</blockquote>`);
      continue;
    }

    if (isTableStart(lines, i)) {
      const table = readTable(lines, i);
      out.push(renderTable(table, ctx));
      i = table.next;
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      const list = readList(lines, i, ctx);
      out.push(list.html);
      i = list.next;
      continue;
    }

    const para = [];
    while (i < lines.length && !blank(lines[i]) && (para.length === 0 || (!isBlockStart(lines[i]) && !isTableStart(lines, i)))) {
      para.push(lines[i].replace(/^[ \t]+/, ''));
      i++;
    }
    const text = para.join('\n').replace(/\s+$/, '');
    out.push(ctx.tight ? inline(text, ctx) : `<p>${inline(text, ctx)}</p>`);
  }
  return out.join('\n');
}

function closesFence(line, marker) {
  const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  return close !== null && close[1][0] === marker[0] && close[1].length >= marker.length;
}

function splitRow(line) {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  const cells = [];
  let cell = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && text[i + 1] === '|') {
      cell += '|';
      i++;
    } else if (text[i] === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += text[i];
    }
  }
  cells.push(cell.trim());
  return cells;
}

function isTableStart(lines, i) {
  if (i + 1 >= lines.length || !lines[i].includes('|')) return false;
  if (!TABLE_DELIM.test(lines[i + 1]) || !lines[i + 1].includes('-')) return false;
  return splitRow(lines[i]).length === splitRow(lines[i + 1]).length;
}

function readTable(lines, start) {
  const align = splitRow(lines[start + 1]).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return '';
  });
  const rows = [];
  let i = start + 2;
  while (i < lines.length && !blank(lines[i]) && lines[i].includes('|')) {
    rows.push(splitRow(lines[i]));
    i++;
  }
  return { head: splitRow(lines[start]), align, rows, next: i };
}

function renderTable(table, ctx) {
  const cell = (tag, text, col) => {
    const cls = table.align[col] ? ` class="align-${table.align[col]}"` : '';
    return `<${tag}${cls}>${inline(text ?? '', ctx)}</${tag}>`;
  };
  const head = `<thead><tr>${table.head.map((text, col) => cell('th', text, col)).join('')}</tr></thead>`;
  const body = table.rows
    .map((row) => `<tr>${table.head.map((_, col) => cell('td', row[col], col)).join('')}</tr>`)
    .join('');
  return `<table>${head}<tbody>${body}</tbody></table>`;
}

function readList(lines, start, ctx) {
  const ordered = ORDERED.test(lines[start]);
  const markerRe = ordered ? ORDERED : BULLET;
  const first = markerRe.exec(lines[start]);
  const startNumber = ordered ? Number(first[2]) : 1;
  const items = [];
  let i = start;
  let loose = false;

  while (i < lines.length) {
    const match = markerRe.exec(lines[i]);
    if (!match) break;
    const contentIndent = match[0].length - match[3].length;
    const content = [match[ordered ? 3 : 3]];
    i++;
    let sawBlank = false;
    while (i < lines.length) {
      const next = lines[i];
      if (blank(next)) {
        sawBlank = true;
        i++;
        continue;
      }
      if (indentOf(next) >= 2) {
        if (sawBlank) {
          loose = true;
          content.push('');
          sawBlank = false;
        }
        content.push(removeIndent(next, Math.min(indentOf(next), contentIndent)));
        i++;
        continue;
      }
      if (sawBlank || markerRe.test(next) || isBlockStart(next)) break;
      content.push(next.trimStart()); // lazy continuation of the paragraph
      i++;
    }
    while (content.length > 0 && content[content.length - 1] === '') content.pop();
    items.push(content);
    // A blank line followed by another item keeps the list going.
    let j = i;
    while (j < lines.length && blank(lines[j])) j++;
    if (j < lines.length && markerRe.test(lines[j]) && (j === i || blank(lines[i - 1] ?? ''))) {
      if (j > i) loose = true;
      i = j;
    }
  }

  const tag = ordered ? 'ol' : 'ul';
  const startAttr = ordered && startNumber !== 1 ? ` start="${startNumber}"` : '';
  const body = items
    .map((content) => {
      const nested = { ...ctx, tight: !loose };
      return `<li>${renderBlocks(content, nested)}</li>`;
    })
    .join('');
  return { html: `<${tag}${startAttr}>${body}</${tag}>`, next: i };
}

function removeIndent(line, width) {
  let remaining = width;
  let idx = 0;
  while (idx < line.length && remaining > 0 && (line[idx] === ' ' || line[idx] === '\t')) {
    remaining -= line[idx] === '\t' ? 4 : 1;
    idx++;
  }
  return line.slice(idx);
}

/**
 * Turns the text of an inline run into HTML. Brackets and emphasis are matched
 * by simple scanning; anything unmatched is text.
 */
function inline(text, ctx, depth = 0) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (ch === '\\' && i + 1 < text.length && ASCII_PUNCT.test(text[i + 1])) {
      out += escapeHtml(text[i + 1]);
      i += 2;
      continue;
    }

    if (ch === '`') {
      let run = 0;
      while (text[i + run] === '`') run++;
      const closer = '`'.repeat(run);
      let end = text.indexOf(closer, i + run);
      while (end >= 0 && text[end + run] === '`') end = text.indexOf(closer, end + run + 1);
      if (end >= 0) {
        out += `<code>${escapeHtml(text.slice(i + run, end).trim())}</code>`;
        i = end + run;
      } else {
        out += escapeHtml(closer);
        i += run;
      }
      continue;
    }

    if (ch === '!' && text[i + 1] === '[') {
      const link = readLink(text, i + 1);
      if (link) {
        const alt = plainText(link.label);
        const src = isExternal(link.url) ? null : ctx.resolveImage(cleanUrl(link.url));
        out += src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">` : escapeHtml(alt);
        i = link.end;
        continue;
      }
    }

    if (ch === '[') {
      const link = readLink(text, i);
      if (link) {
        const label = depth < 4 ? inline(link.label, ctx, depth + 1) : escapeHtml(plainText(link.label));
        const href = linkHref(link.url, ctx);
        out += href ? `<a href="${escapeHtml(href)}"${EXTERNAL.test(href) ? ' rel="noopener noreferrer"' : ''}>${label}</a>` : label;
        i = link.end;
        continue;
      }
    }

    if (ch === '<') {
      const auto = /^<(https?:\/\/[^\s<>]+)>/i.exec(text.slice(i));
      if (auto) {
        out += `<a href="${escapeHtml(auto[1])}" rel="noopener noreferrer">${escapeHtml(auto[1])}</a>`;
        i += auto[0].length;
        continue;
      }
    }

    if ((ch === '*' || ch === '_') && depth < 4) {
      let run = 1;
      while (text[i + run] === ch) run++;
      const size = run >= 2 ? 2 : 1;
      const delim = ch.repeat(size);
      const before = i === 0 ? ' ' : text[i - 1];
      const opensWord = ch === '_' && /[\p{L}\p{N}]/u.test(before);
      const after = text[i + size] ?? ' ';
      if (!opensWord && !/\s/.test(after)) {
        const end = findCloser(text, i + size, delim);
        if (end > i + size) {
          const content = text.slice(i + size, end);
          const tag = size === 2 ? 'strong' : 'em';
          out += `<${tag}>${inline(content, ctx, depth + 1)}</${tag}>`;
          i = end + size;
          continue;
        }
      }
      out += escapeHtml(delim);
      i += size;
      continue;
    }

    if (ch === ' ' && /^ {2,}\n/.test(text.slice(i))) {
      out += '<br>\n';
      i = text.indexOf('\n', i) + 1;
      continue;
    }
    if (ch === '\n') {
      out += '\n';
      i++;
      continue;
    }

    out += escapeHtml(ch);
    i++;
  }
  return out;
}

/** Index of a closing delimiter that is not preceded by a space, or -1. */
function findCloser(text, from, delim) {
  let idx = text.indexOf(delim, from);
  while (idx >= 0) {
    const prev = text[idx - 1];
    const next = text[idx + delim.length] ?? ' ';
    if (prev !== undefined && !/\s/.test(prev) && next !== delim[0]) return idx;
    idx = text.indexOf(delim, idx + 1);
  }
  return -1;
}

/**
 * Reads `[label](url)` starting at the `[` at `start`. Returns the label, the
 * url and the index after the closing parenthesis, or null when there is none.
 */
function readLink(text, start) {
  if (text[start] !== '[') return null;
  let depth = 0;
  let close = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
    } else if (text[i] === '[') {
      depth++;
    } else if (text[i] === ']') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0 || text[close + 1] !== '(') return null;
  let i = close + 2;
  while (text[i] === ' ' || text[i] === '\t') i++;
  let url = '';
  if (text[i] === '<') {
    const end = text.indexOf('>', i);
    if (end < 0) return null;
    url = text.slice(i + 1, end);
    i = end + 1;
  } else {
    let parens = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '(') parens++;
      else if (ch === ')') {
        if (parens === 0) break;
        parens--;
      } else if (/\s/.test(ch)) break;
      url += ch;
      i++;
    }
  }
  while (text[i] === ' ' || text[i] === '\t') i++;
  if (text[i] === '"' || text[i] === "'") {
    const quote = text[i];
    const end = text.indexOf(quote, i + 1);
    if (end < 0) return null;
    i = end + 1;
    while (text[i] === ' ' || text[i] === '\t') i++;
  }
  if (text[i] !== ')') return null;
  return { label: text.slice(start + 1, close), url, end: i + 1 };
}

function cleanUrl(url) {
  return url.trim();
}

function isExternal(url) {
  return EXTERNAL.test(cleanUrl(url));
}

/**
 * The href of a link target, or null when the link must be plain text.
 * http(s) links pass; any other scheme, protocol-relative links and anything
 * pointing at a `#master` anchor are refused; relative links go to resolveLink.
 */
function linkHref(rawUrl, ctx) {
  const url = cleanUrl(rawUrl);
  if (/#master\b/i.test(url)) return null;
  const compact = url.replace(CONTROL_OR_SPACE, '');
  const scheme = SCHEME.exec(compact);
  if (scheme) return EXTERNAL.test(url) ? url : null;
  if (compact.startsWith('//')) return null;
  if (compact.startsWith('#')) return url;
  return ctx.resolveLink(url);
}
