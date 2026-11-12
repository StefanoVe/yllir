import { describe, expect, it } from 'vitest';
import { docUrl } from './doc-link';

describe('docUrl', () => {
  it('builds the reader URL with each segment encoded', () => {
    expect(docUrl('characters/alia.md')).toBe('/doc/characters/alia.md');
    expect(docUrl('places/porto nuovo.md')).toBe('/doc/places/porto%20nuovo.md');
    expect(docUrl('/a//b.md')).toBe('/doc/a/b.md');
  });
});
