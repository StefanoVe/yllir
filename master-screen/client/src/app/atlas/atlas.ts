import { Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { LucideAngularModule, RefreshCw } from 'lucide-angular';
import { merge } from 'rxjs';
import type { AtlasStatus } from '@shared/types';
import { AtlasDialog, isAtlasGenerating } from '../atlas-dialog/atlas-dialog';
import { docUrl } from '../core/doc-nav.service';
import { LiveService } from '../core/live.service';
import { I18n, type TranslationKey } from '../i18n';
import { CallFailure } from '../encyclopedia/call-json';
import { AtlasApiService } from './atlas-api.service';

/** How often the page reads the atlas while a generation runs (ms). */
export const ATLAS_PAGE_POLL_MS = 2000;

/** What the page shows: nothing while the first read is out, then one of these. */
export type AtlasView = 'loading' | 'preparing' | 'empty' | 'unbuilt' | 'viewer';

/** True for a path the viewer may open: a campaign-relative Markdown file, no way up, no leading slash. */
export function isAtlasDocPath(path: unknown): path is string {
  return typeof path === 'string' && path.endsWith('.md') && !path.includes('..') && !path.startsWith('/');
}

/** The atlas section (`/atlas`): one button before the atlas exists, the atlas viewer after it. */
@Component({
  selector: 'ms-atlas',
  imports: [LucideAngularModule, AtlasDialog],
  templateUrl: './atlas.html',
  styleUrl: './atlas.css',
})
export class AtlasPage {
  readonly i18n = inject(I18n);
  private readonly api = inject(AtlasApiService);
  private readonly live = inject(LiveService);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);

  readonly icons = { RefreshCw };
  private readonly frame = viewChild<ElementRef<HTMLIFrameElement>>('frame');
  private readonly dialog = viewChild.required<AtlasDialog>('dialog');

  /** The last atlas state from the server. Null until the first read answers. */
  readonly status = signal<AtlasStatus | null>(null);
  readonly loadError = signal<string | null>(null);
  /** A failed action (start, redraw), shown as a plain sentence. */
  readonly actionError = signal<string | null>(null);
  readonly busy = signal(false);
  /** Changes when the viewer must load the site again (after a generation or a redraw). */
  readonly frameVersion = signal(0);

  readonly exists = computed(() => this.status()?.exists === true);
  readonly built = computed(() => this.status()?.built === true);
  readonly generating = computed(() => isAtlasGenerating(this.status()));
  /** An update over an atlas that is already built: the viewer stays up while the assistant places the places. */
  readonly updatingOverViewer = computed(() => {
    const current = this.status();
    return current !== null && this.generating() && current.generation.mode === 'update' && current.built;
  });
  readonly pending = computed(() => this.status()?.pending ?? 0);
  readonly failed = computed(() => this.status()?.generation.state === 'failed');
  readonly agentAvailable = computed(() => this.status()?.agent.available !== false);
  readonly unavailableReason = computed(() => this.status()?.agent.reason || this.i18n.t('atlas.unavailable'));
  readonly view = computed<AtlasView>(() => {
    const current = this.status();
    if (current === null) return 'loading';
    if (this.generating() && !this.updatingOverViewer()) return 'preparing';
    if (!current.exists) return 'empty';
    if (!current.built) return 'unbuilt';
    return 'viewer';
  });
  readonly frameSrc = computed<SafeResourceUrl>(() =>
    this.sanitizer.bypassSecurityTrustResourceUrl(`/atlas/index.html?v=${this.frameVersion()}`),
  );
  readonly pendingText = computed(() => {
    const count = this.pending();
    return this.i18n.t(count === 1 ? 'atlas.pending.one' : 'atlas.pending.other', { count });
  });

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.live.resync$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.load());
    merge(this.live.on('conversations'), this.live.on('files'))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.load());

    const onMessage = (event: MessageEvent) => this.onViewerMessage(event);
    window.addEventListener('message', onMessage);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('message', onMessage);
      this.clearTimer();
    });

    void this.load();
  }

  t(key: TranslationKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  /** GET /api/atlas. A generation that just ended reloads the viewer. */
  async load(): Promise<void> {
    this.clearTimer();
    try {
      const next = await this.api.status();
      const previous = this.status();
      this.status.set(next);
      this.loadError.set(null);
      if (isAtlasGenerating(previous) && !isAtlasGenerating(next)) this.reloadViewer();
    } catch (failure) {
      this.loadError.set(this.messageOf(failure));
    }
    if (this.generating()) this.schedule();
  }

  /** Starts the create generation, then opens the popup on its conversation. */
  async startCreate(): Promise<void> {
    await this.startGeneration('create');
  }

  /** Starts the update generation for the places that are not on the atlas yet. */
  async startUpdate(): Promise<void> {
    await this.startGeneration('update');
  }

  /** Reopens the popup of a generation that is still running. */
  reopen(): void {
    this.dialog().open();
  }

  /** Redraws the master site from the existing data (no assistant). Also used for a first draw. */
  async redraw(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.actionError.set(null);
    try {
      await this.api.render();
      this.reloadViewer();
      await this.load();
    } catch (failure) {
      this.actionError.set(this.messageOf(failure, 'atlas.renderFailed'));
    } finally {
      this.busy.set(false);
    }
  }

  /** The viewer posts the path of a document when a place is clicked: the document opens in the screen. */
  onViewerMessage(event: MessageEvent): void {
    const win = this.frame()?.nativeElement.contentWindow;
    if (!win || event.source !== win) return;
    const data = event.data as { type?: unknown; path?: unknown } | null;
    if (!data || data.type !== 'yllir-atlas-open' || !isAtlasDocPath(data.path)) return;
    void this.router.navigateByUrl(docUrl(data.path));
  }

  private async startGeneration(mode: 'create' | 'update'): Promise<void> {
    if (this.busy() || this.generating()) return;
    this.busy.set(true);
    this.actionError.set(null);
    try {
      const started = await this.api.generate(mode);
      this.status.set(started.status);
      this.schedule();
      this.dialog().open();
    } catch (failure) {
      this.actionError.set(this.messageOf(failure));
    } finally {
      this.busy.set(false);
    }
  }

  private reloadViewer(): void {
    this.frameVersion.update((version) => version + 1);
  }

  private schedule(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.load();
    }, ATLAS_PAGE_POLL_MS);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private messageOf(failure: unknown, fallback: TranslationKey = 'errors.generic'): string {
    if (failure instanceof CallFailure && failure.message !== '') return failure.message;
    if (failure instanceof Error && failure.message !== '') return failure.message;
    return this.i18n.t(fallback);
  }
}
