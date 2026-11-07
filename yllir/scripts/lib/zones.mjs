// Classifies the lines of a Markdown body into zones: block kinds (fences,
// comments, master block, headings, tables, ...) and inline spans (code,
// comments, images, links). It does not search names.

const FENCE = '```';
const MASTER_OPEN = '<!-- master -->';
const MASTER_CLOSE = '<!-- /master -->';
const MASTER_HEADING = '## Master';
const HEADING = /^(#{1,6})\s/;
const LIST = /^([-*+]|\d+[.)])\s/;
const SPAN_BLOCKS = new Set(['heading', 'table', 'quote', 'list', 'paragraph']);

/**
 * @param {string} body Markdown text without frontmatter.
 * @param {number} firstLine Line number of the first line of `body` in the original file.
 * @returns {{ lines: object[], errors: { line: number, message: string }[] }}
 */
export function analyzeMarkdown(body, firstLine = 1) {
  const texts = splitLines(String(body));
  const lines = [];
  const errors = [];
  const reportError = (line, message) => errors.push({ line, message });

  let fence = null; // { line, mermaid } while inside a fenced block
  let comment = null; // { line } while inside an HTML comment
  let masterOpen = null; // line of the open master marker, or null
  let masterSeen = false; // a master block was opened at some point
  let masterDone = false; // a master block was opened and properly closed
  let masterFirstPending = false; // waiting for the first non-blank line after the open marker
  let masterHeadingLine = null; // line of the accepted "## Master" heading

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    const trimmed = text.trim();
    const line = firstLine + i;

    if (masterDone && trimmed !== '') {
      reportError(line, 'content after master block');
    }

    let block;
    let level;
    let headingText;

    // Rules are applied in priority order (fences, comments, master markers, then the rest).
    if (fence) {
      if (trimmed.startsWith(FENCE)) {
        block = 'fence-close';
        fence = null;
      } else {
        block = fence.mermaid ? 'mermaid' : 'code';
      }
    } else if (trimmed.startsWith(FENCE)) {
      block = 'fence-open';
      fence = { line, mermaid: trimmed.slice(FENCE.length).trim() === 'mermaid' };
    } else if (comment) {
      block = 'comment';
      if (text.includes('-->')) comment = null;
    } else if (text.trimEnd() === MASTER_OPEN) {
      block = 'master-open';
      if (masterOpen !== null || masterSeen) {
        reportError(line, 'more than one master block');
      } else {
        masterOpen = line;
        masterSeen = true;
        masterFirstPending = true;
      }
    } else if (text.trimEnd() === MASTER_CLOSE) {
      block = 'master-close';
      if (masterOpen === null) {
        reportError(line, 'master block closed but never opened');
      } else {
        masterOpen = null;
        masterDone = true;
      }
    } else if (trimmed.startsWith('<!--')) {
      block = 'comment';
      if (text.indexOf('-->', text.indexOf('<!--') + 4) < 0) comment = { line };
    } else if (trimmed === '') {
      block = 'blank';
    } else if (HEADING.test(trimmed)) {
      block = 'heading';
      level = HEADING.exec(trimmed)[1].length;
      headingText = trimmed
        .slice(level)
        .trim()
        .replace(/(^|\s)#+$/, '')
        .trim();
    } else if (trimmed.startsWith('|')) {
      block = 'table';
    } else if (trimmed.startsWith('>')) {
      block = 'quote';
    } else if (LIST.test(trimmed)) {
      block = 'list';
    } else {
      block = 'paragraph';
    }

    if (masterFirstPending && trimmed !== '' && block !== 'master-open') {
      masterFirstPending = false;
      if (block === 'heading' && trimmed === MASTER_HEADING) {
        masterHeadingLine = line;
      } else {
        reportError(line, 'master block must start with ## Master');
      }
    }

    if (block === 'heading' && masterOpen !== null && level <= 2 && line !== masterHeadingLine) {
      reportError(line, 'only ### or lower headings allowed in master block');
    }

    const entry = {
      line,
      text,
      block,
      inMaster: masterOpen !== null && !block.startsWith('master-'),
      spans: SPAN_BLOCKS.has(block) ? scanSpans(text) : [],
    };
    if (block === 'heading') {
      entry.level = level;
      entry.headingText = headingText;
    }
    lines.push(entry);
  }

  if (fence) reportError(fence.line, 'code fence is not closed');
  if (comment) reportError(comment.line, 'HTML comment is not closed');
  if (masterOpen !== null) reportError(masterOpen, 'master block is not closed');

  markItalicParagraphs(lines);

  return { lines, errors };
}

function splitLines(body) {
  if (body === '') return [];
  const parts = body.split(/\r?\n/);
  if (parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/** Marks runs of consecutive paragraph lines that form a narrative italic paragraph. */
function markItalicParagraphs(lines) {
  let i = 0;
  while (i < lines.length) {
    if (lines[i].block !== 'paragraph') {
      i++;
      continue;
    }
    let end = i;
    while (end < lines.length && lines[end].block === 'paragraph') end++;
    const first = lines[i].text.trim();
    const last = lines[end - 1].text.trim();
    const italic =
      first.startsWith('_') && !first.startsWith('__') &&
      last.endsWith('_') && !last.endsWith('__');
    for (let k = i; k < end; k++) lines[k].italic = italic;
    i = end;
  }
}

/** Scans one line left to right and returns its inline spans. */
function scanSpans(text) {
  const spans = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (ch === '`') {
      const n = backtickRunLength(text, i);
      const end = findBacktickRun(text, i + n, n);
      if (end < 0) {
        i += n; // unmatched backticks are ordinary text
        continue;
      }
      spans.push({ kind: 'code', start: i, end });
      i = end;
      continue;
    }

    if (text.startsWith('<!--', i)) {
      const close = text.indexOf('-->', i + 4);
      if (close < 0) {
        i += 4;
        continue;
      }
      spans.push({ kind: 'comment', start: i, end: close + 3 });
      i = close + 3;
      continue;
    }

    if (ch === '!' && text[i + 1] === '[') {
      const link = parseLink(text, i + 1);
      if (link) {
        spans.push({ kind: 'image', start: i, end: link.end, target: link.target });
        i = link.end;
      } else {
        i += 1;
      }
      continue;
    }

    if (ch === '[') {
      const link = parseLink(text, i);
      if (link) {
        spans.push({
          kind: 'link',
          start: i,
          end: link.end,
          target: link.target,
          labelStart: i + 1,
          labelEnd: link.labelEnd,
        });
        i = link.end;
        continue;
      }
    }

    i += 1;
  }
  return spans;
}

function backtickRunLength(text, from) {
  let n = 0;
  while (text[from + n] === '`') n++;
  return n;
}

/** Returns the index just after the next run of exactly `n` backticks, or -1. */
function findBacktickRun(text, from, n) {
  let j = text.indexOf('`', from);
  while (j >= 0) {
    const m = backtickRunLength(text, j);
    if (m === n) return j + m;
    j = text.indexOf('`', j + m);
  }
  return -1;
}

/** Parses `[label](target)` starting at the `[` at index `open`. Returns null if invalid. */
function parseLink(text, open) {
  const close = text.indexOf(']', open + 1);
  if (close < 0 || text[close + 1] !== '(') return null;
  const paren = text.indexOf(')', close + 2);
  if (paren < 0) return null;
  return {
    labelEnd: close,
    target: text.slice(close + 2, paren).trim(),
    end: paren + 1,
  };
}
