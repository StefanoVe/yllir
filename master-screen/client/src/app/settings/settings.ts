import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { LoaderCircle, LucideAngularModule, Monitor, Moon, RefreshCw, Sun } from 'lucide-angular';
import type { ChecksResponse, ModuleId } from '@shared/types';
import { ApiService, isApiFailure } from '../core/api.service';
import { PrefsService } from '../core/prefs.service';
import { BattleMapPrefs } from '../cockpit/combat/battle-maps-pref';
import { StatusService } from '../core/status.service';
import { ThemePref, ThemeService } from '../core/theme.service';
import { I18n, type TranslationKey } from '../i18n';
import {
  TEXT_SCALE_KEY,
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
  TEXT_SCALE_STEP,
  applyTextScale,
  clampTextScale,
  readTextScale,
} from '../shell/text-scale';

const MODULE_ORDER: ModuleId[] = ['music', 'print', 'encyclopedia'];
const THEME_OPTIONS: Array<{ pref: ThemePref; key: TranslationKey; icon: 'monitor' | 'sun' | 'moon' }> = [
  { pref: 'system', key: 'theme.system', icon: 'monitor' },
  { pref: 'light', key: 'theme.light', icon: 'sun' },
  { pref: 'dark', key: 'theme.dark', icon: 'moon' },
];

export interface CheckLine {
  text: string;
  broken: boolean;
}

/** Plain-language summary of a checks result, one sentence per check. */
export function checkSummary(
  result: ChecksResponse,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): CheckLine[] {
  const broken = result.brokenLinks.length;
  const sketches = result.sketches.length;
  const exclusions = result.exclusions.length;
  return [
    {
      text: broken === 0 ? t('settings.noBroken') : broken === 1 ? t('settings.brokenFound.one', { count: broken }) : t('settings.brokenFound.other', { count: broken }),
      broken: broken > 0,
    },
    {
      text: sketches === 0 ? t('settings.noSketches') : sketches === 1 ? t('settings.sketchesFound.one', { count: sketches }) : t('settings.sketchesFound.other', { count: sketches }),
      broken: false,
    },
    {
      text: exclusions === 0 ? t('settings.noExclusions') : exclusions === 1 ? t('settings.exclusionsFound.one', { count: exclusions }) : t('settings.exclusionsFound.other', { count: exclusions }),
      broken: false,
    },
  ];
}

@Component({
  selector: 'ms-settings',
  imports: [LucideAngularModule],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class Settings {
  private readonly api = inject(ApiService);
  private readonly prefs = inject(PrefsService);
  private readonly theme = inject(ThemeService);
  private readonly status = inject(StatusService);
  private readonly battleMaps = inject(BattleMapPrefs);
  readonly showBattleMaps = this.battleMaps.showMaps;
  readonly i18n = inject(I18n);

  readonly icons = { LoaderCircle, Monitor, Moon, RefreshCw, Sun };
  readonly themeOptions = THEME_OPTIONS;
  readonly scaleMin = TEXT_SCALE_MIN;
  readonly scaleMax = TEXT_SCALE_MAX;
  readonly scaleStep = TEXT_SCALE_STEP;

  readonly textScale = signal(100);
  readonly checks = signal<ChecksResponse | null>(null);
  readonly checkError = signal<string | null>(null);
  readonly checking = signal(false);
  readonly lines = computed<CheckLine[]>(() => {
    const result = this.checks();
    return result ? checkSummary(result, (key, params) => this.t(key, params)) : [];
  });
  readonly checkedTime = computed(() => {
    const iso = this.checks()?.checkedAt;
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString(this.i18n.language(), { hour: '2-digit', minute: '2-digit' });
  });

  readonly campaign = computed(() => this.status.campaign());
  readonly framework = computed(() => this.status.status()?.frameworkVersion ?? '');
  readonly agent = computed(() => this.status.status()?.agent ?? null);
  readonly moduleRows = computed(() => {
    const modules = this.status.modules();
    if (!modules) return [];
    return MODULE_ORDER.map((id) => ({ id, on: modules[id] === true }));
  });

  constructor() {
    effect(() => {
      this.prefs.slug();
      const saved = readTextScale(this.prefs);
      untracked(() => this.textScale.set(saved));
    });
    void this.loadChecks();
  }

  t(key: TranslationKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  themeLabel(option: ThemePref): string {
    return this.t(option === 'system' ? 'theme.system' : option === 'light' ? 'theme.light' : 'theme.dark');
  }

  isTheme(option: ThemePref): boolean {
    return this.theme.pref() === option;
  }

  /** ThemeService cycles system -> light -> dark; step until the chosen value is reached. */
  setTheme(option: ThemePref): void {
    for (let step = 0; step < 3 && this.theme.pref() !== option; step++) this.theme.cycle();
  }

  onScale(raw: string): void {
    const percent = clampTextScale(Number(raw));
    this.textScale.set(percent);
    this.prefs.set(TEXT_SCALE_KEY, String(percent));
    applyTextScale(percent);
  }

  async loadChecks(): Promise<void> {
    try {
      this.checks.set(await this.api.checks());
      this.checkError.set(null);
    } catch (failure) {
      this.checkError.set(isApiFailure(failure) ? failure.error : this.i18n.t('errors.generic'));
    }
  }

  async runChecks(): Promise<void> {
    if (this.checking()) return;
    this.checking.set(true);
    try {
      this.checks.set(await this.api.runChecks());
      this.checkError.set(null);
    } catch (failure) {
      this.checkError.set(isApiFailure(failure) ? failure.error : this.i18n.t('errors.generic'));
    } finally {
      this.checking.set(false);
    }
  }

  moduleLabel(id: ModuleId): string {
    return this.t(`settings.module.${id}` as TranslationKey);
  }

  /** Plain sentence for one broken link. */
  linkLine(from: string, to: string): string {
    return this.t('settings.linkLine', { from, to });
  }

  setShowBattleMaps(on: boolean): void {
    this.battleMaps.set(on);
  }

  readonly scaleLabel = computed(() => this.t('settings.textSizeValue', { percent: this.textScale() }));
}
