import { describe, expect, it } from 'vitest';
import { isThemePref, nextThemePref } from './theme.service';

describe('theme cycle', () => {
  it('cycles system -> light -> dark -> system', () => {
    expect(nextThemePref('system')).toBe('light');
    expect(nextThemePref('light')).toBe('dark');
    expect(nextThemePref('dark')).toBe('system');
  });

  it('accepts only known stored values', () => {
    expect(isThemePref('dark')).toBe(true);
    expect(isThemePref('blue')).toBe(false);
    expect(isThemePref(null)).toBe(false);
  });
});
