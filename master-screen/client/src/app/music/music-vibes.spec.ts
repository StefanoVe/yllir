import { describe, expect, it } from 'vitest';
import { VIBES, hasTerm, queryWords, toggleTerm } from './music-vibes';

describe('vibe chips', () => {
  it('adds a term to the query and removes it on the second toggle', () => {
    const once = toggleTerm('', 'Tensione');
    expect(once).toBe('Tensione');
    expect(toggleTerm(once, 'Tensione')).toBe('');
  });

  it('keeps several chips on at once, joined with spaces', () => {
    let query = toggleTerm('inseguimento', 'Tensione');
    query = toggleTerm(query, 'Bosco');
    expect(query).toBe('inseguimento Tensione Bosco');
    expect(queryWords(query)).toHaveLength(3);
  });

  it('matches a term in any case and accent, and only as a whole word', () => {
    expect(hasTerm('TENSIONE notturna', 'tensione')).toBe(true);
    expect(hasTerm('pioggia', 'pio')).toBe(false);
    expect(toggleTerm('Città', 'citta')).toBe('');
  });

  it('keeps the other words of the query when a chip is removed', () => {
    expect(toggleTerm('scena tesa Bosco', 'bosco')).toBe('scena tesa');
  });

  it('offers twelve chips', () => {
    expect(VIBES).toHaveLength(12);
  });
});
