import { describe, expect, it } from 'vitest';
import { formatRelative } from './relative-time';

const NOW = Date.parse('2026-11-12T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('formatRelative', () => {
  it('reads recent times as now', () => {
    expect(formatRelative(ago(5_000), NOW, 'en')).toBe('now');
    expect(formatRelative(ago(5_000), NOW, 'it')).toBe('ora');
  });

  it('uses the largest whole unit, localized', () => {
    expect(formatRelative(ago(3 * 60_000), NOW, 'en')).toBe('3 minutes ago');
    expect(formatRelative(ago(3 * 60_000), NOW, 'it')).toBe('3 minuti fa');
    expect(formatRelative(ago(2 * 86_400_000), NOW, 'en')).toBe('2 days ago');
    expect(formatRelative(ago(3_600_000), NOW, 'en')).toBe('1 hour ago');
  });

  it('treats a future time (clock skew) as now', () => {
    expect(formatRelative(new Date(NOW + 60_000).toISOString(), NOW, 'en')).toBe('now');
  });

  it('gives an empty string for an unreadable time', () => {
    expect(formatRelative('not a date', NOW, 'en')).toBe('');
  });
});
