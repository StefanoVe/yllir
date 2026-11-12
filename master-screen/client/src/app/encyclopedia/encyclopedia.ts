import { Component, computed, inject, signal } from '@angular/core';
import {
  CircleCheck,
  CircleMinus,
  CircleX,
  ExternalLink,
  Hammer,
  Info,
  LoaderCircle,
  LucideAngularModule,
  TriangleAlert,
} from 'lucide-angular';
import type { EncyclopediaCheck, EncyclopediaReport, EncyclopediaStatus } from '@shared/types';
import { I18n, type TranslationKey } from '../i18n';
import { CallFailure } from './call-json';
import { EncyclopediaApiService, reportFromBody } from './encyclopedia-api.service';

/** The encyclopedia page (`/encyclopedia`): build it, read the checks, open the preview. */
@Component({
  selector: 'ms-encyclopedia',
  imports: [LucideAngularModule],
  templateUrl: './encyclopedia.html',
  styleUrl: './encyclopedia.css',
})
export class EncyclopediaPage {
  private readonly api = inject(EncyclopediaApiService);
  private readonly i18n = inject(I18n);

  readonly icons = { CircleCheck, CircleMinus, CircleX, ExternalLink, Hammer, Info, LoaderCircle, TriangleAlert };

  /** What the server said about the module and the last build. */
  readonly status = signal<EncyclopediaStatus | null>(null);
  readonly loadError = signal<string | null>(null);
  /** The report the server returned for the last build (or the saved one). Never set before the server answers. */
  readonly report = signal<EncyclopediaReport | null>(null);
  readonly building = signal(false);
  /** Plain message of a failed build, shown prominently. */
  readonly buildError = signal<string | null>(null);

  readonly enabled = computed(() => this.status()?.enabled === true);
  readonly built = computed(() => this.status()?.built === true);
  readonly baseUrl = computed(() => this.report()?.baseUrl ?? '');

  constructor() {
    void this.load();
  }

  t(key: TranslationKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  /** GET /api/encyclopedia */
  async load(): Promise<void> {
    try {
      const next = await this.api.status();
      this.status.set(next);
      // Keep the report the server just returned for a build when the saved status has none.
      this.report.set(next.report ?? this.report());
      this.loadError.set(null);
    } catch (failure) {
      this.loadError.set(this.messageOf(failure));
    }
  }

  /** POST /api/encyclopedia/build. The screen shows only what the server returned. */
  async build(): Promise<void> {
    if (this.building()) return;
    this.building.set(true);
    this.buildError.set(null);
    try {
      const next = await this.api.build();
      this.report.set(next);
      if (next.ok) {
        await this.load();
      } else {
        this.buildError.set(this.t('enc.failed'));
      }
    } catch (failure) {
      // A failed build carries its report in the body, next to the plain message.
      const report = failure instanceof CallFailure ? reportFromBody(failure.body) : null;
      if (report) this.report.set(report);
      this.buildError.set(this.messageOf(failure));
    } finally {
      this.building.set(false);
    }
  }

  checkIcon(status: EncyclopediaCheck['status']) {
    return status === 'pass' ? this.icons.CircleCheck : status === 'fail' ? this.icons.CircleX : this.icons.CircleMinus;
  }

  /** The plain word shown next to the icon, so the status never relies on colour. */
  checkText(status: EncyclopediaCheck['status']): string {
    return status === 'pass' ? this.t('enc.check.pass') : status === 'fail' ? this.t('enc.check.fail') : this.t('enc.check.skipped');
  }

  entriesText(count: number): string {
    return this.t(count === 1 ? 'enc.entriesCount.one' : 'enc.entriesCount.other', { count });
  }

  excludedText(count: number): string {
    return this.t(count === 1 ? 'enc.excludedCount.one' : 'enc.excludedCount.other', { count });
  }

  /** `path: message` when the item has a path, the message alone otherwise. */
  lineText(path: string | undefined, message: string): string {
    return path ? this.t('enc.pathLine', { path, message }) : message;
  }

  private messageOf(failure: unknown): string {
    return failure instanceof Error && failure.message !== '' ? failure.message : this.t('errors.generic');
  }
}
