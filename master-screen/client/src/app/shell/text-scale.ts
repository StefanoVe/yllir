import type { PrefsService } from '../core/prefs.service';

export const TEXT_SCALE_KEY = 'text-size';
export const TEXT_SCALE_MIN = 90;
export const TEXT_SCALE_MAX = 130;
export const TEXT_SCALE_STEP = 5;
export const TEXT_SCALE_DEFAULT = 100;

/** Rounds to the nearest step and keeps the value inside the range. Anything not a number is the default. */
export function clampTextScale(value: number): number {
  if (!Number.isFinite(value)) return TEXT_SCALE_DEFAULT;
  const stepped = Math.round(value / TEXT_SCALE_STEP) * TEXT_SCALE_STEP;
  return Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, stepped));
}

/** Saved text size of the campaign, as a percentage. */
export function readTextScale(prefs: PrefsService): number {
  const raw = prefs.get(TEXT_SCALE_KEY);
  return raw === null ? TEXT_SCALE_DEFAULT : clampTextScale(Number(raw));
}

/** Applies the text size to the whole app: the root font size scales every rem-based measure. */
export function applyTextScale(percent: number): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.fontSize = `${clampTextScale(percent)}%`;
}
