import { Injectable, inject } from '@angular/core';
import { DICTIONARIES, I18n, lookup, type Lang, type TranslationKey, type TranslationParams } from '../i18n';

/** Keys of the live panels and of the plot map (in the shared dictionaries). */
export type PanelKey = Extract<TranslationKey, `panels.${string}` | `plot.${string}`>;

/**
 * Text of a key in one language, with the usual fallbacks (English, then the key itself).
 * Pure, so it can be tested without Angular.
 */
export function panelText(lang: Lang, key: string, params?: TranslationParams): string {
  return lookup(DICTIONARIES, lang, key, params);
}

/** Copy for the live panels and the plot map: a thin wrapper over the shared I18n dictionary. */
@Injectable({ providedIn: 'root' })
export class PanelStrings {
  private readonly i18n = inject(I18n);

  text(key: PanelKey, params?: TranslationParams): string {
    return this.i18n.t(key, params);
  }
}
