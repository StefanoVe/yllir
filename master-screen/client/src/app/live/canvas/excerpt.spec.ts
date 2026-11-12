import { describe, expect, it } from 'vitest';
import { fallbackTitle, firstPublicExcerpt, plainText } from './excerpt';

describe('excerpt', () => {
  it('returns text only, from the first public block', () => {
    const text = firstPublicExcerpt([
      { kind: 'public', html: '<h2>Alia</h2><p>A  courier   of the  <b>harbour</b>.</p>' },
      { kind: 'master', html: '<p>Secret</p>' },
    ]);
    expect(text).toBe('Alia A courier of the harbour.');
    expect(text).not.toContain('<');
  });

  it('gives nothing for a master-only document', () => {
    expect(firstPublicExcerpt([{ kind: 'master', html: '<p>only for me</p>' }])).toBe('');
    expect(firstPublicExcerpt([])).toBe('');
  });

  it('cuts long text with an ellipsis', () => {
    const long = 'word '.repeat(100);
    const cut = firstPublicExcerpt([{ kind: 'public', html: `<p>${long}</p>` }], 40);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(40);
  });

  it('does not run markup, and keeps text of scripts as inert text', () => {
    expect(plainText('<p>hi</p><script>alert(1)</script>')).toContain('hi');
  });

  it('derives a title from the file name', () => {
    expect(fallbackTitle('characters/alia-vance.md')).toBe('alia-vance');
  });
});
