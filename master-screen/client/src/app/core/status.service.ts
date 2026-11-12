import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { StatusResponse } from '@shared/types';
import { ApiService, isApiFailure } from './api.service';
import { LiveService } from './live.service';
import { PrefsService } from './prefs.service';
import { I18n, normalizeLanguage } from '../i18n';

/** Campaign status, loaded from /api/status and refreshed on every `status` event. */
@Injectable({ providedIn: 'root' })
export class StatusService {
  private readonly api = inject(ApiService);
  private readonly live = inject(LiveService);
  private readonly prefs = inject(PrefsService);
  private readonly i18n = inject(I18n);

  readonly status = signal<StatusResponse | null>(null);
  readonly error = signal<string | null>(null);
  readonly campaign = computed(() => this.status()?.campaign ?? null);
  readonly modules = computed(() => this.status()?.modules ?? null);
  readonly language = computed(() => normalizeLanguage(this.status()?.campaign.language));

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.live.on('status').pipe(takeUntilDestroyed(destroyRef)).subscribe((next) => this.apply(next));
    this.live.resync$.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => void this.refresh());
    void this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      this.apply(await this.api.status());
    } catch (failure) {
      this.error.set(isApiFailure(failure) ? failure.error : this.i18n.t('errors.network'));
    }
  }

  private apply(next: StatusResponse): void {
    this.status.set(next);
    this.error.set(null);
    this.prefs.setCampaign(next.campaign.slug);
    this.i18n.setLanguage(next.campaign.language);
  }
}
