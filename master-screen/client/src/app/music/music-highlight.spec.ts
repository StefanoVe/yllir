import { describe, expect, it } from 'vitest';
import { foldWord, formatClock, snippetParts } from './music-highlight';

describe('snippetParts', () => {
  it('marks the matched words, accent and case insensitively, and keeps the text exact', () => {
    const parts = snippetParts('Pioggía sottile sul porto.', ['pioggia', 'porto']);
    expect(parts.filter((part) => part.hit).map((part) => part.text)).toEqual(['Pioggía', 'porto']);
    expect(parts.map((part) => part.text).join('')).toBe('Pioggía sottile sul porto.');
  });

  it('returns the whole snippet as plain text when nothing matches', () => {
    expect(snippetParts('Solo testo.', [])).toEqual([{ text: 'Solo testo.', hit: false }]);
  });

  it('folds words the same way on both sides', () => {
    expect(foldWord('Città')).toBe('citta');
  });
});

describe('formatClock', () => {
  it('reads mm:ss under an hour and h:mm:ss from one hour on', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(75.9)).toBe('01:15');
    expect(formatClock(3599)).toBe('59:59');
    expect(formatClock(3600)).toBe('1:00:00');
    expect(formatClock(3725)).toBe('1:02:05');
  });

  it('reads unknown or negative values as zero', () => {
    expect(formatClock(Number.NaN)).toBe('00:00');
    expect(formatClock(-4)).toBe('00:00');
  });
});
