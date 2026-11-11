// Minimal parser for the YAML-like metadata block of Yllir Markdown files.
// The block is read in two forms:
//   - comment form (the form the framework writes): an HTML comment that every
//     Markdown preview hides. Line 1 is exactly `<!-- yllir`, the block closes
//     at the first later line that is exactly `-->`.
//   - dashes form (read only, for older campaigns): YAML frontmatter between
//     two `---` lines.
// The lines in between are the same YAML-like content in both forms: `key: value`
// scalars, flow lists `[a, b]`, plus block YAML for the structured `appearances`
// and `relations` fields. Other keys retain string semantics.

import { parseYamlLite } from './yaml-lite.mjs';

export const METADATA_OPEN = '<!-- yllir';
export const METADATA_CLOSE = '-->';

const DASHES = '---';
const KEY_LINE = /^([a-z][a-z0-9_]*):(?: (.*)|)$/;
const BLOCK_KEYS = ['appearances', 'relations'];

function stripCr(raw) {
  return raw.endsWith('\r') ? raw.slice(0, -1) : raw;
}

// Double-quoted: outer quotes removed, no escape processing.
// Single-quoted: outer quotes removed, `''` means one literal `'` (YAML style).
function unquote(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if (first === '"' && last === '"') {
      return value.slice(1, -1);
    }
    if (first === "'" && last === "'") {
      return value.slice(1, -1).replace(/''/g, "'");
    }
  }
  return value;
}

// Splits the content of a flow list on commas that are outside quoted items.
// A quote only opens when it is the first non-space character of an item.
function splitFlowItems(inner) {
  const items = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      current += ch;
      if (ch === quote) {
        if (quote === "'" && inner[i + 1] === "'") {
          current += "'";
          i++;
        } else {
          quote = null;
        }
      }
    } else if (ch === ',') {
      items.push(current);
      current = '';
    } else {
      if ((ch === '"' || ch === "'") && current.trim() === '') {
        quote = ch;
      }
      current += ch;
    }
  }
  items.push(current);
  return items;
}

/**
 * Finds the metadata block at the top of a file, in either form.
 * @param {string[]} lines lines of the file, with any trailing \r already removed
 * @returns {{ format: 'comment'|'dashes', close: number }|null}
 *   close is the index of the closing line, or -1 when the block is not closed.
 *   null when line 0 opens no block.
 */
export function findMetadataBlock(lines) {
  let format;
  let closeLine;
  if (lines[0] === METADATA_OPEN) {
    format = 'comment';
    closeLine = METADATA_CLOSE;
  } else if (lines[0] === DASHES) {
    format = 'dashes';
    closeLine = DASHES;
  } else {
    return null;
  }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === closeLine) {
      return { format, close: i };
    }
  }
  return { format, close: -1 };
}

/**
 * Renders a metadata block in the comment form (the form the framework writes).
 * @param {string[]} contentLines content lines, without delimiters
 * @returns {string} the block, without a trailing newline
 */
export function renderMetadata(contentLines) {
  if (contentLines.length === 0) {
    return `${METADATA_OPEN}\n${METADATA_CLOSE}`;
  }
  return `${METADATA_OPEN}\n${contentLines.join('\n')}\n${METADATA_CLOSE}`;
}

/**
 * Converts a closed dashes block to the comment form, changing only the two
 * delimiter lines. Every other byte, including the body and \r\n endings, is kept.
 * @param {string} text full file content
 * @returns {string|null} the converted text, or null when there is no closed dashes block
 */
export function toCommentMetadata(text) {
  const rawLines = text.split('\n');
  const block = findMetadataBlock(rawLines.map(stripCr));
  if (!block || block.format !== 'dashes' || block.close === -1) {
    return null;
  }
  const cr = (raw) => (raw.endsWith('\r') ? '\r' : '');
  const out = rawLines.slice();
  out[0] = METADATA_OPEN + cr(rawLines[0]);
  out[block.close] = METADATA_CLOSE + cr(rawLines[block.close]);
  return out.join('\n');
}

/**
 * Parses the metadata block of a Markdown text, in either form.
 * @param {string} text full file content
 * @returns {{ data: object|null, body: string, bodyStartLine: number, errors: Array<{line: number, message: string}>, format?: 'comment'|'dashes' }}
 *   format is set when a block is found; it is absent when there is no block.
 */
export function parseFrontmatter(text) {
  const rawLines = text.split('\n');
  // Content of each line without its trailing \r (for \r\n input).
  const lines = rawLines.map(stripCr);

  const block = findMetadataBlock(lines);
  if (!block) {
    return { data: null, body: text, bodyStartLine: 1, errors: [] };
  }
  const { format, close } = block;

  if (close === -1) {
    return {
      data: null,
      body: text,
      bodyStartLine: 1,
      errors: [{ line: 1, message: 'frontmatter is not closed' }],
      format,
    };
  }

  // Body starts right after the closing line and its line terminator.
  let offset = 0;
  for (let i = 0; i <= close; i++) {
    offset += rawLines[i].length + 1;
  }
  const body = offset >= text.length ? '' : text.slice(offset);

  const data = {};
  const errors = [];

  // A comment-form block ends at the first `-->`, so no content line may contain it.
  if (format === 'comment') {
    for (let i = 1; i < close; i++) {
      if (lines[i].includes(METADATA_CLOSE)) {
        errors.push({ line: i + 1, message: 'metadata line contains -->' });
      }
    }
  }

  // Keys whose value is a block list of mappings, parsed with parseYamlLite.
  // Only the first occurrence of each key is a block; a repeated key goes
  // through the ordinary path and is reported as a duplicate.
  const blocks = [];
  for (const key of BLOCK_KEYS) {
    const keyLine = new RegExp(`^${key}:\\s*$`);
    const start = lines.findIndex((line, i) => i > 0 && i < close && keyLine.test(line));
    if (start < 0) continue;
    let end = start + 1;
    while (end < close && (/^\s/.test(lines[end]) || /^ *$/.test(lines[end]) || /^ *#/.test(lines[end]))) end++;
    blocks.push({ key, start, end });
  }
  for (const { key, start, end } of blocks) {
    const blockText = [`${key}:`, ...lines.slice(start + 1, end)].join('\n');
    const parsed = parseYamlLite(blockText);
    if (parsed.errors.length) {
      errors.push({ line: start + parsed.errors[0].line, message: parsed.errors[0].message });
    } else {
      data[key] = parsed.data[key];
    }
  }

  for (let i = 1; i < close; i++) {
    if (blocks.some((block) => i >= block.start && i < block.end)) continue;
    const line = lines[i];
    const lineNo = i + 1;

    if (/^ *$/.test(line)) continue;
    if (/^ *#/.test(line)) continue;

    const match = KEY_LINE.exec(line);
    if (!match) {
      errors.push({ line: lineNo, message: 'unsupported YAML syntax' });
      continue;
    }

    const key = match[1];
    const value = (match[2] ?? '').trim();

    if (value === '') {
      errors.push({ line: lineNo, message: `missing value for key ${key}` });
      continue;
    }

    let parsed;
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1);
      if (inner.trim() === '') {
        parsed = [];
      } else {
        const items = splitFlowItems(inner).map((item) => item.trim());
        if (items.some((item) => item === '')) {
          errors.push({ line: lineNo, message: 'empty list item' });
          continue;
        }
        parsed = items.map(unquote);
      }
    } else {
      parsed = unquote(value);
    }

    if (Object.hasOwn(data, key)) {
      errors.push({ line: lineNo, message: `duplicate key ${key}` });
      continue;
    }
    data[key] = parsed;
  }

  return { data, body, bodyStartLine: close + 2, errors, format };
}
