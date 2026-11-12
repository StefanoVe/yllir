import { describe, expect, it } from 'vitest';
import { capitalizeParts } from './labels';

describe('capitalizeParts', () => {
  it('capitalises a single part', () => {
    expect(capitalizeParts('personaggi')).toBe('Personaggi');
    expect(capitalizeParts('creature')).toBe('Creature');
  });

  it('capitalises each part separated by " · "', () => {
    expect(capitalizeParts('Morvalle · luoghi')).toBe('Morvalle · Luoghi');
    expect(capitalizeParts('morvalle · luoghi · nord')).toBe('Morvalle · Luoghi · Nord');
  });

  it('leaves the rest of each part unchanged', () => {
    expect(capitalizeParts('nomi propri · NPC')).toBe('Nomi propri · NPC');
  });

  it('handles empty text and empty parts', () => {
    expect(capitalizeParts('')).toBe('');
    expect(capitalizeParts('a ·  · b')).toBe('A ·  · B');
  });
});
