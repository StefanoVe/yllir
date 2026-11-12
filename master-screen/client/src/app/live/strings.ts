import { Injectable, inject } from '@angular/core';
import { I18n, type TranslationKey, type TranslationParams } from '../i18n';

/**
 * Copy for the live table. A thin wrapper over the shared I18n dictionary, so every live key lives
 * in i18n/en.ts and i18n/it.ts and is checked by i18n.spec.ts.
 */
@Injectable({ providedIn: 'root' })
export class LiveStrings {
  private readonly i18n = inject(I18n);

  copy(key: string, params?: TranslationParams): string {
    return this.i18n.t(key as TranslationKey, params);
  }
}
