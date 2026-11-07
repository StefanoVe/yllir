// Case, accent, apostrophe, dash and whitespace folding for name matching.
// `folded[i]` always comes from the original character at `map[i]`, so match
// positions in the folded text can be turned back into columns of the source.

const QUOTE_VARIANTS = /[’‘ʼ´`]/g;
const DASH_VARIANTS = /[‐-―]/g;
const MARKS = /\p{M}/gu;

/**
 * @param {string} s
 * @returns {{ folded: string, map: number[] }}
 */
export function foldText(s) {
  const out = [];
  const map = [];
  let index = 0;

  for (const ch of s) {
    const origin = index;
    index += ch.length;

    if (/\s/.test(ch)) {
      if (out.length === 0 || out[out.length - 1] === ' ') continue;
      out.push(' ');
      map.push(origin);
      continue;
    }

    const x = ch
      .normalize('NFD')
      .replace(MARKS, '')
      .toLowerCase()
      .replace(QUOTE_VARIANTS, "'")
      .replace(DASH_VARIANTS, '-');

    // Code units, not code points, so that the map lines up with string indexes.
    for (let k = 0; k < x.length; k++) {
      out.push(x[k]);
      map.push(origin);
    }
  }

  if (out.length > 0 && out[out.length - 1] === ' ') {
    out.pop();
    map.pop();
  }

  return { folded: out.join(''), map };
}

/**
 * Folds a name used as a form (title or alias).
 * @param {string} s
 * @returns {string}
 */
export function foldForm(s) {
  return foldText(s.trim()).folded;
}
