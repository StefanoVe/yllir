import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import type { UpdateStatus } from '@shared/types';
import { ApiService, isApiFailure } from './api.service';
import { I18n, type TranslationKey } from '../i18n';

/** How often the status is read while an update runs (ms). */
export const UPDATE_POLL_MS = 2000;
/** While the server restarts, failed reads are expected; after this long without an answer, the page says it reopens by itself (ms). */
export const RESTART_GIVE_UP_MS = 60_000;

/** Keys of the reason sentences shown next to a disabled "Update now" button. */
export const BLOCKED_REASON_KEYS: Record<NonNullable<UpdateStatus['blockedReason']>, TranslationKey> = {
  'turn-running': 'update.blocked.turnRunning',
  'live-open': 'update.blocked.liveOpen',
  offline: 'update.blocked.offline',
};

/**
 * Framework update: loads the status, checks again, snoozes the notice, starts the update and follows it
 * until the page can be used again. Reads the status at startup and when the window regains focus;
 * while the update runs (updating or restarting) it polls every 2 s.
 */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  private readonly api = inject(ApiService);
  private readonly i18n = inject(I18n);

  /** Last status from the server. Null until the first read answers. */
  readonly status = signal<UpdateStatus | null>(null);
  /** True while a fresh check is running. */
  readonly checking = signal(false);
  /** Plain sentence from the last refused or failed action (for example the 409 of "Update now"). */
  readonly actionError = signal<string | null>(null);
  /** True once a restart has gone on for a while, or the connection came back after it: the page will reopen by itself. */
  readonly reopenNotice = signal(false);

  /** The notice in the rail: an update is ready and the master has not said "later". */
  readonly showNotice = computed(() => {
    const status = this.status();
    return status?.state === 'available' && !status.snoozed;
  });

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  /** When the failed reads of a restart began (null when the server answers). */
  private restartSince: number | null = null;
  private readonly onFocus = () => void this.load();

  constructor() {
    if (typeof window !== 'undefined') window.addEventListener('focus', this.onFocus);
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      if (typeof window !== 'undefined') window.removeEventListener('focus', this.onFocus);
      this.stopPolling();
    });
    void this.load();
  }

  /** Reads the status. A failed read keeps the last status; during a restart it is counted quietly. */
  async load(): Promise<void> {
    try {
      const next = await this.api.updateStatus();
      // The connection is back after failed reads during a restart: say the page reopens by itself.
      if (this.restartSince !== null) this.reopenNotice.set(true);
      this.restartSince = null;
      this.applyStatus(next);
    } catch {
      this.onReadFailed();
    }
  }

  /** Asks the server for a fresh check of the framework's update. */
  async check(): Promise<void> {
    if (this.checking()) return;
    this.checking.set(true);
    this.actionError.set(null);
    try {
      await this.api.checkUpdate();
      await this.load();
    } catch (failure) {
      this.actionError.set(this.messageOf(failure));
    } finally {
      this.checking.set(false);
    }
  }

  /** "Later": hides the notice until the next update is found. The server answers with the new status. */
  async snooze(): Promise<void> {
    try {
      this.applyStatus(await this.api.snoozeUpdate());
      this.actionError.set(null);
    } catch (failure) {
      this.actionError.set(this.messageOf(failure));
    }
  }

  /**
   * "Update now" from the available state. A 409 keeps the state and shows the server's sentence
   * as the reason. On 202 the update is shown as running at once and followed by polling.
   */
  async apply(): Promise<void> {
    try {
      await this.api.applyUpdate();
      this.actionError.set(null);
      this.restartSince = null;
      this.reopenNotice.set(false);
      const current = this.status();
      this.applyStatus({
        state: 'updating',
        news: current?.news ?? null,
        snoozed: false,
        canApply: false,
        blockedReason: null,
      });
    } catch (failure) {
      this.actionError.set(this.messageOf(failure));
      await this.load();
    }
  }

  /**
   * Retry after a failed update. The server clears a failed update only on a check, and it accepts
   * an apply only from the available state, so the retry checks first and then applies.
   */
  async retry(): Promise<void> {
    await this.check();
    await this.apply();
  }

  private applyStatus(next: UpdateStatus): void {
    this.status.set(next);
    if (this.isUpdateRunning()) {
      this.startPolling();
    } else {
      this.stopPolling();
    }
  }

  private isUpdateRunning(): boolean {
    const state = this.status()?.state;
    return state === 'updating' || state === 'restarting';
  }

  private startPolling(): void {
    if (this.destroyed || this.pollTimer !== null) return;
    this.schedulePoll();
  }

  private schedulePoll(): void {
    this.pollTimer = setTimeout(async () => {
      this.pollTimer = null;
      await this.load();
      // load() may already have restarted the chain through applyStatus: only one chain runs.
      if (this.pollTimer === null && this.isUpdateRunning()) this.schedulePoll();
    }, UPDATE_POLL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  /** A read failed. While restarting this is expected: keep polling quietly, and show the reopen notice after a while. */
  private onReadFailed(): void {
    if (this.status()?.state !== 'restarting') return;
    this.restartSince ??= Date.now();
    if (Date.now() - this.restartSince >= RESTART_GIVE_UP_MS) this.reopenNotice.set(true);
  }

  private messageOf(failure: unknown): string {
    return isApiFailure(failure) ? failure.error : this.i18n.t('errors.generic');
  }
}
