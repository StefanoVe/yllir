import { describe, expect, it } from 'vitest';
import { highlightSegments, queryTerms } from './highlight';

const joined = (segments: { text: string }[]) => segments.map((segment) => segment.text).join('');

describe('highlightSegments', () => {
  it('marks the query words and keeps the text intact', () => {
    const segments = highlightSegments('The Duke of Vell lives in the old keep.', 'vell keep');
    expect(joined(segments)).toBe('The Duke of Vell lives in the old keep.');
    expect(segments.filter((s) => s.match).map((s) => s.text)).toEqual(['Vell', 'keep']);
  });

  it('is case and accent insensitive and maps back to the original characters', () => {
    const segments = highlightSegments('La Città di Été', 'citta ete');
    expect(joined(segments)).toBe('La Città di Été');
    expect(segments.filter((s) => s.match).map((s) => s.text)).toEqual(['Città', 'Été']);
  });

  it('keeps a snippet that looks like HTML as plain text', () => {
    const snippet = '<img src=x onerror="alert(1)"> and <script>evil()</script>';
    const segments = highlightSegments(snippet, 'img script');
    expect(joined(segments)).toBe(snippet);
    expect(segments.some((s) => s.match && s.text === 'img')).toBe(true);
    expect(segments.every((s) => typeof s.text === 'string')).toBe(true);
  });

  it('returns the text unmarked for an empty query or no match', () => {
    expect(highlightSegments('plain text', '')).toEqual([{ text: 'plain text', match: false }]);
    expect(highlightSegments('plain text', 'zzz')).toEqual([{ text: 'plain text', match: false }]);
    expect(highlightSegments('', 'word')).toEqual([]);
  });

  it('merges overlapping matches of different words', () => {
    const segments = highlightSegments('abcdef', 'abc cde');
    expect(segments).toEqual([{ text: 'abcde', match: true }, { text: 'f', match: false }]);
  });
});

describe('queryTerms', () => {
  it('folds and splits the query into words', () => {
    expect(queryTerms('  Città, "Vell"  ')).toEqual(['citta', 'vell']);
    expect(queryTerms('   ')).toEqual([]);
  });
});
