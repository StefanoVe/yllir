// Minimal parser for the YAML-like frontmatter used in Yllir Markdown files.
// Supports only `key: value` scalars and flow lists `[a, b]`; everything else
// is reported as an error. Values are always strings.

const KEY_LINE = /^([a-z][a-z0-9_]*):(?: (.*)|)$/;

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
 * Parses the frontmatter of a Markdown text.
 * @param {string} text full file content
 * @returns {{ data: object|null, body: string, bodyStartLine: number, errors: Array<{line: number, message: string}> }}
 */
export function parseFrontmatter(text) {
  const rawLines = text.split('\n');
  // Content of each line without its trailing \r (for \r\n input).
  const lines = rawLines.map((raw) => (raw.endsWith('\r') ? raw.slice(0, -1) : raw));

  if (lines[0] !== '---') {
    return { data: null, body: text, bodyStartLine: 1, errors: [] };
  }

  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      close = i;
      break;
    }
  }
  if (close === -1) {
    return {
      data: null,
      body: text,
      bodyStartLine: 1,
      errors: [{ line: 1, message: 'frontmatter is not closed' }],
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

  for (let i = 1; i < close; i++) {
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

  return { data, body, bodyStartLine: close + 2, errors };
}
