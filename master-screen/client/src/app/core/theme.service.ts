import { Injectable, effect, inject, signal } from '@angular/core';
import { PrefsService } from './prefs.service';

export type ThemePref = 'system' | 'light' | 'dark';

const THEME_KEY = 'theme';
const ORDER: ThemePref[] = ['system', 'light', 'dark'];

export function isThemePref(value: unknown): value is ThemePref {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** Next value in the cycle system -> light -> dark -> system. */
export function nextThemePref(current: ThemePref): ThemePref {
  return ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
}

/** Applies the theme as `data-theme` on <html>; "system" removes the override. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly prefs = inject(PrefsService);
  readonly pref = signal<ThemePref>('system');

  constructor() {
    // Restore the saved override once the campaign slug is known.
    effect(() => {
      const stored = this.prefs.get(THEME_KEY);
      this.pref.set(isThemePref(stored) ? stored : 'system');
    });
    effect(() => {
      const value = this.pref();
      const root = document.documentElement;
      if (value === 'system') root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', value);
    });
  }

  cycle(): void {
    const next = nextThemePref(this.pref());
    this.pref.set(next);
    this.prefs.set(THEME_KEY, next);
  }
}
