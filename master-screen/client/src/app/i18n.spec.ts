import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DICTIONARIES, interpolate, lookup, normalizeLanguage } from './i18n';
import { en } from './i18n/en';
import { it as itDict } from './i18n/it';

const APP_DIR = dirname(fileURLToPath(import.meta.url));

/** Every source file under src/app, except the dictionaries and spec files. */
function sourceFiles(dir: string = APP_DIR): string[] {
  return readdirSync(dir).flatMap((name: string) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'i18n' ? [] : sourceFiles(path);
    if (name.endsWith('.spec.ts')) return [];
    return /\.(ts|html)$/.test(name) ? [path] : [];
  });
}

describe('i18n', () => {
  it('falls back to English, then to the key, when a translation is missing', () => {
    const dictionaries = { it: {}, en: { 'nav.home': 'Home' } };
    expect(lookup(dictionaries, 'it', 'nav.home')).toBe('Home');
    expect(lookup(dictionaries, 'it', 'nav.unknown')).toBe('nav.unknown');
  });

  it('uses the Italian string when it exists', () => {
    expect(lookup(DICTIONARIES, 'it', 'nav.search')).toBe('Cerca');
    expect(lookup(DICTIONARIES, 'en', 'nav.search')).toBe('Search');
  });

  it('fills {name} placeholders and leaves unknown ones as they are', () => {
    expect(interpolate('{count} links, {missing}', { count: 3 })).toBe('3 links, {missing}');
    expect(lookup(DICTIONARIES, 'en', 'settings.checkedAt', { time: '10:00' })).toBe('Last checked at 10:00.');
  });

  it('keeps every Italian key in step with English', () => {
    expect(Object.keys(itDict).sort()).toEqual(Object.keys(en).sort());
  });

  it('keeps the English keys in step with the Italian keys in both directions', () => {
    const english = new Set(Object.keys(en));
    const italian = new Set(Object.keys(itDict));
    expect(Object.keys(en).filter((key) => !italian.has(key))).toEqual([]);
    expect(Object.keys(itDict).filter((key) => !english.has(key))).toEqual([]);
  });

  it('has every key that the code uses through t(), label(), i18n.t(), copy() or text()', () => {
    const known = new Set<string>(Object.keys(en));
    const pattern = /(?:\bt|\blabel|i18n\.t|\.copy|\.text)\(\s*'([^']+)'/g;
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(20);
    const missing = new Set<string>();
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(pattern)) {
        if (!known.has(match[1])) missing.add(`${file}: ${match[1]}`);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('has every live, panel and plot key that appears as a quoted string anywhere in the code', () => {
    // Keys chosen through a ternary or a map (for example a dock tab label) are not caught by the call
    // patterns above, so every quoted live.*, panels.* or plot.* string is checked as well.
    const known = new Set<string>(Object.keys(en));
    const pattern = /'((?:live|panels|plot)\.[A-Za-z0-9.]+)'/g;
    const missing = new Set<string>();
    for (const file of sourceFiles()) {
      for (const match of readFileSync(file, 'utf8').matchAll(pattern)) {
        if (!known.has(match[1])) missing.add(`${file}: ${match[1]}`);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('declares each key once in the source of each dictionary', () => {
    for (const lang of ['en', 'it']) {
      const text = readFileSync(join(APP_DIR, 'i18n', `${lang}.ts`), 'utf8');
      const keys = [...text.matchAll(/^\s*'([^']+)':/gm)].map((match) => match[1]);
      const seen = new Set<string>();
      const duplicates = keys.filter((key) => (seen.has(key) ? true : (seen.add(key), false)));
      expect(duplicates).toEqual([]);
    }
  });

  it('maps campaign languages to it or en, defaulting to en', () => {
    expect(normalizeLanguage('it')).toBe('it');
    expect(normalizeLanguage(' IT-it ')).toBe('it');
    expect(normalizeLanguage('fr')).toBe('en');
    expect(normalizeLanguage('')).toBe('en');
    expect(normalizeLanguage(undefined)).toBe('en');
    expect(normalizeLanguage(null)).toBe('en');
  });
});
