// Parser for the restricted YAML subset used in configuration files such as
// campaign.yaml. Anything outside the subset is an error at its line; nothing
// is guessed.
//
// Supported:
//   - blank lines and comment lines; trailing ` # ...` comments on values
//   - block mappings (`key: value`, `key:` followed by a nested block)
//   - block lists (`- scalar`, `- key: value` mapping items)
//   - flow lists `[a, "b, c"]` and the empty flow mapping `{}`
//   - block scalars `|` (line breaks kept) and `>` (lines joined by a space)
//   - scalars: quoted strings (no escapes), integers, booleans, null, `~`,
//     and any other text as a trimmed plain string (dates stay strings)
//
// The parser stops at the first error it meets and reports only that one.

const KEY_RE = /^[a-z][a-z0-9_]*$/;
const UNSUPPORTED = 'unsupported YAML syntax';

class YamlLiteError extends Error {
  constructor(line, message) {
    super(message);
    this.name = 'YamlLiteError';
    this.line = line;
  }
}

/**
 * Parses a restricted-subset YAML document.
 * @param {string} text full document; `\r\n` and `\n` are both line breaks
 * @returns {{ data: object|null, errors: Array<{line: number, message: string}> }}
 */
export function parseYamlLite(text) {
  if (typeof text !== 'string') {
    throw new TypeError('parseYamlLite expects a string');
  }
  try {
    const tokens = tokenize(text);
    const data = new Parser(tokens).parseDocument();
    return { data, errors: [] };
  } catch (err) {
    if (err instanceof YamlLiteError) {
      return { data: null, errors: [{ line: err.line, message: err.message }] };
    }
    throw err;
  }
}

/**
 * Splits the text into lines. Each token has `no` (1-based line number),
 * `indent` (count of leading spaces), `text` (content without the leading
 * indentation, trailing whitespace removed; '' for blank lines) and, when the
 * line is invalid, `error` (a YamlLiteError thrown by the parser when it
 * reaches the line). Comment lines with odd indentation are not errors.
 */
function tokenize(text) {
  return text.split(/\r?\n/).map((raw, index) => {
    const no = index + 1;
    const leading = /^[ \t]*/.exec(raw)[0];
    const body = raw.slice(leading.length).trimEnd();
    if (body === '') {
      return { no, indent: 0, text: '' };
    }
    if (leading.includes('\t')) {
      return { no, indent: 0, text: body, error: new YamlLiteError(no, 'tabs are not allowed') };
    }
    const indent = leading.length;
    if (body.startsWith('#')) {
      return { no, indent, text: body };
    }
    if (indent % 2 !== 0) {
      return {
        no,
        indent,
        text: body,
        error: new YamlLiteError(no, 'indentation must be a multiple of 2 spaces'),
      };
    }
    if (indent === 0 && (body === '---' || body.startsWith('--- '))) {
      return { no, indent, text: body, error: new YamlLiteError(no, UNSUPPORTED) };
    }
    return { no, indent, text: body };
  });
}

function isListText(text) {
  return text === '-' || text.startsWith('- ');
}

/**
 * Parses `key: rest` from a line of text.
 * Returns null when the text is not a mapping entry (no `: ` separator, or a
 * quoted or flow form). Throws when the text looks like a key but the key is
 * not in the supported form.
 */
function parseKeyLine(text, no) {
  const first = text[0];
  if (first === '"' || first === "'" || first === '[' || first === '{') {
    return null;
  }
  const match = /:(?=\s|$)/.exec(text);
  if (match === null) {
    return null;
  }
  const key = text.slice(0, match.index);
  if (!KEY_RE.test(key)) {
    throw new YamlLiteError(no, UNSUPPORTED);
  }
  return { key, rest: text.slice(match.index + 1).trimStart() };
}

/**
 * Removes a trailing comment. A `#` starts a comment when it is outside
 * quotes and at the start of the value or preceded by a space or tab.
 * A quote opens a quoted string only at the start of a value or right after
 * `[` or `,`. Returns the value with trailing whitespace removed.
 */
function stripComment(value) {
  let quote = null;
  let prev = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quote !== null) {
      if (ch === quote) {
        if (quote === "'" && value[i + 1] === "'") {
          i++;
          continue;
        }
        quote = null;
        prev = ch;
      }
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      continue;
    }
    if (ch === '#' && (i === 0 || value[i - 1] === ' ' || value[i - 1] === '\t')) {
      return value.slice(0, i).trimEnd();
    }
    if ((ch === '"' || ch === "'") && (prev === '' || prev === '[' || prev === ',')) {
      quote = ch;
    }
    prev = ch;
  }
  return value.trimEnd();
}

function scalar(text) {
  if (/^-?\d+$/.test(text)) {
    return Number(text);
  }
  if (text === 'true') {
    return true;
  }
  if (text === 'false') {
    return false;
  }
  if (text === 'null' || text === '~') {
    return null;
  }
  return text;
}

/**
 * Index of the quote that closes the quoted string starting at index 0, or -1.
 * In single quotes, `''` is an escaped quote and does not close the string.
 * Double quotes have no escapes.
 */
function findClosingQuote(value) {
  const quote = value[0];
  let i = 1;
  while (i < value.length) {
    if (value[i] === quote) {
      if (quote === "'" && value[i + 1] === "'") {
        i += 2;
        continue;
      }
      return i;
    }
    i++;
  }
  return -1;
}

/**
 * Parses a whole quoted scalar. The value must be exactly one quoted string.
 * Leading and trailing spaces inside the quotes are kept. In single quotes,
 * `''` becomes `'`; double quotes have no escape processing.
 */
function parseQuoted(value, no) {
  const quote = value[0];
  if (value.length < 2 || findClosingQuote(value) !== value.length - 1) {
    throw new YamlLiteError(no, UNSUPPORTED);
  }
  const inner = value.slice(1, -1);
  return quote === "'" ? inner.replaceAll("''", "'") : inner;
}

/** Parses a flow list body (the text between `[` and `]`). */
function parseFlowList(inner, no) {
  if (inner.trim() === '') {
    return [];
  }
  const parts = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote !== null) {
      if (ch === quote && quote === "'" && inner[i + 1] === "'") {
        current += "''";
        i++;
        continue;
      }
      current += ch;
      if (ch === quote) {
        quote = null;
      }
    } else if ((ch === '"' || ch === "'") && current.trim() === '') {
      quote = ch;
      current += ch;
    } else if (ch === ',') {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (quote !== null) {
    throw new YamlLiteError(no, UNSUPPORTED);
  }
  parts.push(current);

  return parts.map((part) => {
    const item = part.trim();
    if (item === '') {
      throw new YamlLiteError(no, 'empty list item');
    }
    if (item[0] === '"' || item[0] === "'") {
      return parseQuoted(item, no);
    }
    if (/[[\]{}]/.test(item) || /:(?=\s|$)/.test(item)) {
      throw new YamlLiteError(no, UNSUPPORTED);
    }
    return scalar(item);
  });
}

/** Parses an inline (single-line) value that is not a block scalar. */
function parseInline(value, no) {
  const first = value[0];
  if (first === '&' || first === '*' || first === '!') {
    throw new YamlLiteError(no, UNSUPPORTED);
  }
  if (first === '[') {
    if (value[value.length - 1] !== ']') {
      throw new YamlLiteError(no, UNSUPPORTED);
    }
    return parseFlowList(value.slice(1, -1), no);
  }
  if (first === '{') {
    if (value === '{}') {
      return {};
    }
    throw new YamlLiteError(no, UNSUPPORTED);
  }
  if (first === '>' || first === '|') {
    throw new YamlLiteError(no, UNSUPPORTED);
  }
  if (first === '"' || first === "'") {
    return parseQuoted(value, no);
  }
  return scalar(value);
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  /**
   * Returns the next significant token without consuming it, or null at the
   * end. Blank and comment lines are skipped. Invalid lines throw when reached.
   */
  peek() {
    const { tokens } = this;
    while (this.pos < tokens.length) {
      const token = tokens[this.pos];
      if (token.error) {
        throw token.error;
      }
      if (token.text !== '' && !token.text.startsWith('#')) {
        return token;
      }
      this.pos++;
    }
    return null;
  }

  parseDocument() {
    const first = this.peek();
    if (first === null) {
      return {};
    }
    if (first.indent !== 0) {
      throw new YamlLiteError(first.no, 'unexpected indentation');
    }
    if (isListText(first.text)) {
      throw new YamlLiteError(first.no, 'top-level value must be a mapping');
    }
    const data = this.parseMapping(0);
    const rest = this.peek();
    if (rest !== null) {
      throw new YamlLiteError(rest.no, 'unexpected indentation');
    }
    return data;
  }

  parseMapping(indent) {
    const result = {};
    const seen = new Set();
    for (;;) {
      const token = this.peek();
      if (token === null || token.indent < indent) {
        break;
      }
      if (token.indent > indent) {
        throw new YamlLiteError(token.no, 'unexpected indentation');
      }
      const entry = parseKeyLine(token.text, token.no);
      if (entry === null) {
        throw new YamlLiteError(token.no, UNSUPPORTED);
      }
      const { key, rest } = entry;
      if (seen.has(key)) {
        throw new YamlLiteError(token.no, `duplicate key ${key}`);
      }
      seen.add(key);
      this.pos++;

      const value = stripComment(rest);
      if (value === '>' || value === '|') {
        result[key] = this.parseBlockScalar(indent, value, key, token.no);
      } else if (value === '') {
        result[key] = this.parseNested(indent, key, token.no);
      } else {
        result[key] = parseInline(value, token.no);
      }
    }
    return result;
  }

  /** Parses the block that follows a `key:` line with no inline value. */
  parseNested(indent, key, no) {
    const next = this.peek();
    if (next === null || next.indent <= indent) {
      throw new YamlLiteError(no, `missing value for key ${key}`);
    }
    if (isListText(next.text)) {
      if (next.indent !== indent + 2) {
        throw new YamlLiteError(next.no, 'unexpected indentation');
      }
      return this.parseList(indent + 2);
    }
    return this.parseMapping(next.indent);
  }

  parseList(indent) {
    const items = [];
    for (;;) {
      const token = this.peek();
      if (token === null || token.indent < indent) {
        break;
      }
      if (token.indent > indent) {
        throw new YamlLiteError(token.no, 'unexpected indentation');
      }
      if (!isListText(token.text)) {
        throw new YamlLiteError(token.no, UNSUPPORTED);
      }
      const rest = token.text === '-' ? '' : token.text.slice(2).trimStart();
      if (rest === '') {
        throw new YamlLiteError(token.no, 'empty list item');
      }
      if (isListText(rest)) {
        throw new YamlLiteError(token.no, UNSUPPORTED);
      }
      if (parseKeyLine(rest, token.no) !== null) {
        // `- key: value`: the mapping starts on the dash line, at column indent + 2.
        this.tokens[this.pos] = { no: token.no, indent: indent + 2, text: rest };
        items.push(this.parseMapping(indent + 2));
      } else {
        const value = stripComment(rest);
        if (value === '') {
          throw new YamlLiteError(token.no, 'empty list item');
        }
        if (value === '>' || value === '|') {
          throw new YamlLiteError(token.no, UNSUPPORTED);
        }
        items.push(parseInline(value, token.no));
        this.pos++;
      }
    }
    return items;
  }

  /**
   * Reads the more-indented lines after a `key: |` or `key: >` line.
   * `|` keeps line breaks; `>` joins the non-blank lines with a single space.
   * Both end with a newline. Trailing blank lines are dropped.
   */
  parseBlockScalar(indent, style, key, no) {
    const { tokens } = this;
    const lines = [];
    let blockIndent = -1;
    while (this.pos < tokens.length) {
      const token = tokens[this.pos];
      if (token.error) {
        throw token.error;
      }
      if (token.text === '') {
        lines.push('');
        this.pos++;
        continue;
      }
      if (token.indent <= indent) {
        break;
      }
      if (blockIndent === -1) {
        blockIndent = token.indent;
      } else if (token.indent < blockIndent) {
        throw new YamlLiteError(token.no, 'unexpected indentation');
      }
      lines.push(' '.repeat(token.indent - blockIndent) + token.text);
      this.pos++;
    }
    while (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }
    if (lines.length === 0) {
      throw new YamlLiteError(no, `missing value for key ${key}`);
    }
    if (style === '|') {
      return lines.join('\n') + '\n';
    }
    return lines.filter((line) => line !== '').join(' ') + '\n';
  }
}
