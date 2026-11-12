const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/**
 * Relative time of `at` (ISO string) seen from `now` (epoch ms), localized with Intl.
 * Under 45 seconds reads as "now". A future time (clock skew) also reads as "now".
 * An unreadable time gives an empty string.
 */
export function formatRelative(at: string, now: number, lang: string): string {
  const then = Date.parse(at);
  if (Number.isNaN(then)) return '';
  const format = new Intl.RelativeTimeFormat(lang === 'it' ? 'it' : 'en', { numeric: 'auto' });
  const elapsed = Math.max(0, Math.floor((now - then) / 1000));
  if (elapsed < 45) return format.format(0, 'second');
  for (const [unit, seconds] of UNITS) {
    if (elapsed >= seconds) {
      return format.format(-Math.floor(elapsed / seconds), unit);
    }
  }
  return format.format(-elapsed, 'second');
}
