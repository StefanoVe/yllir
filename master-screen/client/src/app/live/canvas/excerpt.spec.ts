import { describe, expect, it } from 'vitest';
import { fallbackTitle, firstPublicExcerpt, plainText } from './excerpt';

describe('excerpt', () => {
  it('returns text only, from the first public block', () => {
    const text = firstPublicExcerpt([
      { kind: 'public', html: '<h2>Alia</h2><p>A  courier   of the  <b>harbour</b>.</p>' },
      { kind: 'master', html: '<p>Secret</p>' },
    ]);
    expect(text).toBe('A courier of the harbour.');
    expect(text).not.toContain('<');
  });

  it('keeps the body without the leading heading, one line per paragraph', () => {
    const text = firstPublicExcerpt([
      { kind: 'public', html: '<h1>Porto di Aldea</h1><p>Un porto di pescatori nella nebbia.</p><p>Le barche tornano  all&#39;alba.</p>' },
    ]);
    expect(text).toBe('Un porto di pescatori nella nebbia.\nLe barche tornano all\'alba.');
    expect(text).not.toContain('Porto di Aldea');
  });

  it('keeps a heading that is not the first thing in the block', () => {
    const text = firstPublicExcerpt([{ kind: 'public', html: '<p>Intro.</p><h2>Storia</h2><p>Antica.</p>' }]);
    expect(text).toBe('Intro.\nStoria\nAntica.');
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

  it('cuts after about 220 characters by default', () => {
    const cut = firstPublicExcerpt([{ kind: 'public', html: `<h1>T</h1><p>${'parola '.repeat(60)}</p>` }]);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(220);
    expect(cut.length).toBeGreaterThan(200);
  });

  it('does not run markup, and keeps text of scripts as inert text', () => {
    expect(plainText('<p>hi</p><script>alert(1)</script>')).toContain('hi');
  });

  it('derives a title from the file name', () => {
    expect(fallbackTitle('characters/alia-vance.md')).toBe('alia-vance');
  });
});
