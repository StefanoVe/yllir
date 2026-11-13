import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { ScreenSettings, ScreenSettingsPatch, SettingsResponse } from '@shared/types';
import { ApiService, isApiFailure } from './api.service';
import { LiveService } from './live.service';
import { PrefsService } from './prefs.service';
import { I18n } from '../i18n';

/** Server defaults of the master screen settings (see master-screen/server/src/settings). */
export const DEFAULT_SCREEN_SETTINGS: ScreenSettings = {
  live: { model: 'haiku' },
  combat: {
    model: 'haiku',
    showMaps: true,
    panels: { initiative: true, turn: true, chat: false, music: true },
    autoHide: true,
    autoHideSeconds: 4,
  },
  music: { volume: 80, fadeSeconds: 3, loop: true, dock: 'always' },
  ui: {
    density: 'comfortable',
    motion: 'system',
    startPage: 'plot',
    rail: { plot: true, docs: true, music: true, encyclopedia: true, print: true },
  },
};

/** Changes are saved this long after the last one (ms). */
const SAVE_DELAY_MS = 600;

/** The old local preference that held "show battle maps" before the settings file existed. */
const OLD_SHOW_MAPS_PREF = 'showBattleMaps';

type Plain = Record<string, unknown>;

function isPlain(value: unknown): value is Plain {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep merge of two patches (never mutates either one). `b` wins. */
function mergePatch(a: Plain, b: Plain): Plain {
  const result: Plain = { ...a };
  for (const [key, value] of Object.entries(b)) {
    if (isPlain(value)) {
      result[key] = mergePatch(isPlain(result[key]) ? (result[key] as Plain) : {}, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** Master screen settings: loaded from /api/settings, saved debounced through PUT /api/settings. */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly api = inject(ApiService);
  private readonly live = inject(LiveService);
  private readonly prefs = inject(PrefsService);
  private readonly i18n = inject(I18n);

  /** Effective settings. Changed by a load, a `settings` live event, or a successful save (never optimistically). */
  readonly settings = signal<ScreenSettings>(DEFAULT_SCREEN_SETTINGS);
  readonly defaults = signal<ScreenSettings>(DEFAULT_SCREEN_SETTINGS);
  /** Keys the settings file sets explicitly, as dotted camelCase paths. */
  readonly explicit = signal<string[]>([]);
  /** False when the campaign is not a git repository: nothing can be saved. */
  readonly canSave = signal(true);
  readonly loaded = signal(false);
  readonly saveState = signal<'idle' | 'saving' | 'saved' | 'error'>('idle');
  readonly saveError = signal<string | null>(null);
  /** Changes not sent yet. */
  readonly pending = signal<ScreenSettingsPatch>({});
  /** Changes sent and not answered yet; kept on the page until the response arrives. */
  readonly inFlight = signal<ScreenSettingsPatch>({});
  /** What the page shows: saved settings, then the changes in flight, then the pending ones. Other code keeps using `settings`. */
  readonly shown = computed<ScreenSettings>(() =>
    mergePatch(
      mergePatch(this.settings() as unknown as Plain, this.inFlight() as unknown as Plain),
      this.pending() as unknown as Plain,
    ) as unknown as ScreenSettings,
  );
  /** Set when the settings could not be loaded; cleared on the next successful load. */
  readonly loadError = signal<string | null>(null);

  /** Changes waiting to be sent (the signal `pending` mirrors them for the page). */
  private waiting: Plain | null = null;
  /** Patches whose request has not finished yet, in send order. */
  private sending: Plain[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private migrated = false;

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.live.on('settings').pipe(takeUntilDestroyed(destroyRef)).subscribe((next) => this.settings.set(next));
    this.live.resync$.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => void this.load());

    effect(() => {
      if (this.migrated) return;
      const slug = this.prefs.slug();
      if (slug === null || !this.loaded()) return;
      this.migrated = true;
      untracked(() => this.migrateShowMaps());
    });

    void this.load();
  }

  /** Loads the settings. On failure the defaults stay; never throws. */
  async load(): Promise<void> {
    try {
      this.apply(await this.api.settings());
      this.loadError.set(null);
    } catch (failure) {
      // keep the current values (defaults on the first load)
      this.loadError.set(isApiFailure(failure) ? failure.error : this.i18n.t('errors.generic'));
    }
    this.loaded.set(true);
  }

  /** Queues a partial change; it is saved 600 ms after the last change. `settings` is not changed until the save succeeds. */
  update(patch: ScreenSettingsPatch): void {
    this.waiting = mergePatch(this.waiting ?? {}, patch as Plain);
    this.pending.set(this.waiting as ScreenSettingsPatch);
    this.saveState.set('saving');
    this.saveError.set(null);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, SAVE_DELAY_MS);
  }

  /** Sends the pending change now. Resolves when the save (and any save before it) has finished. */
  flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const patch = this.waiting;
    if (patch !== null) {
      this.waiting = null;
      this.pending.set({});
      this.sending.push(patch);
      this.inFlight.set(this.mergeSending());
      this.queue = this.queue.then(() => this.send(patch as ScreenSettingsPatch));
    }
    return this.queue;
  }

  /** Restores one section to its default values. */
  reset(section: keyof ScreenSettings): void {
    this.update({ [section]: this.defaults()[section] } as ScreenSettingsPatch);
  }

  /** True when the file does not set this dotted camelCase path (e.g. "combat.showMaps"). */
  isDefault(path: string): boolean {
    return !this.explicit().includes(path);
  }

  private async send(patch: ScreenSettingsPatch): Promise<void> {
    this.saveState.set('saving');
    try {
      this.apply(await this.api.saveSettings(patch));
      this.saveError.set(null);
      this.saveState.set('saved');
    } catch (failure) {
      if (isApiFailure(failure) && failure.status === 409) this.canSave.set(false);
      this.saveError.set(isApiFailure(failure) ? failure.error : this.i18n.t('errors.generic'));
      this.saveState.set('error');
    } finally {
      this.sending = this.sending.filter((item) => item !== (patch as Plain));
      this.inFlight.set(this.mergeSending());
    }
  }

  /** All patches still waiting for their response, merged. */
  private mergeSending(): ScreenSettingsPatch {
    return this.sending.reduce<Plain>((acc, item) => mergePatch(acc, item), {}) as ScreenSettingsPatch;
  }

  private apply(response: SettingsResponse): void {
    this.settings.set(response.settings);
    this.defaults.set(response.defaults);
    this.explicit.set(response.explicit);
    this.canSave.set(response.canSave);
  }

  /** Moves the old local "show battle maps" preference into the settings file, once. */
  private migrateShowMaps(): void {
    const old = this.prefs.get(OLD_SHOW_MAPS_PREF);
    if (old === 'false' && !this.explicit().includes('combat.showMaps')) {
      this.update({ combat: { showMaps: false } });
    }
    this.prefs.remove(OLD_SHOW_MAPS_PREF);
  }
}
