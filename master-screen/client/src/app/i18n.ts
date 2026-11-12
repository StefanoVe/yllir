import { Injectable, signal } from '@angular/core';
import { en } from './i18n/en';
import { it } from './i18n/it';

export type Lang = 'it' | 'en';
export type TranslationKey = keyof typeof en;
type Dictionary = Partial<Record<TranslationKey, string>>;
export type TranslationParams = Record<string, string | number>;

export const DICTIONARIES: Record<Lang, Dictionary> = { it, en };

/** Maps any campaign language value to a supported language; anything else is English. */
export function normalizeLanguage(raw: string | null | undefined): Lang {
  return typeof raw === 'string' && raw.trim().toLowerCase().startsWith('it') ? 'it' : 'en';
}

/** Replaces `{name}` placeholders. Unknown placeholders stay as they are. */
export function interpolate(template: string, params: TranslationParams = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}

/**
 * Looks a key up in the language, falls back to English, then to the key itself,
 * so a missing translation never shows an empty label.
 */
export function lookup(
  dictionaries: Record<Lang, Dictionary>,
  lang: Lang,
  key: string,
  params?: TranslationParams,
): string {
  const text =
    dictionaries[lang][key as TranslationKey] ?? dictionaries.en[key as TranslationKey] ?? key;
  return params ? interpolate(text, params) : text;
}

@Injectable({ providedIn: 'root' })
export class I18n {
  /** Campaign language. Templates that call `t()` re-render when it changes. */
  readonly language = signal<Lang>('en');

  /** Translated text for a key. Plural keys: call `<base>.one` or `<base>.other` explicitly. */
  t(key: TranslationKey, params?: TranslationParams): string {
    return lookup(DICTIONARIES, this.language(), key, params);
  }

  setLanguage(raw: string | null | undefined): void {
    const lang = normalizeLanguage(raw);
    this.language.set(lang);
    document.documentElement.lang = lang;
  }
}
