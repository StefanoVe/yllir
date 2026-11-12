import { Component, DestroyRef, Input, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import type { ChangeGroup, ChangedFile, ChangesResponse, FileDiff, FileStatus } from '@shared/types';
import {
  LucideAngularModule,
  ExternalLink,
  FileMinus,
  FilePen,
  FilePlus,
  FileSymlink,
  MessageSquare,
  Undo2,
  X,
} from 'lucide-angular';
import { ApiService, isApiFailure } from '../core/api.service';
import { LiveService } from '../core/live.service';
import { I18n, type TranslationKey } from '../i18n';
import { FocusMessageService } from '../chat/focus-message.service';
import { docUrl } from '../chat/doc-link';
import { DiffRow, fileDiffRows } from './diff-view';
import { formatRelative } from './relative-time';

type DiffEntry =
  | { state: 'loading' }
  | { state: 'ready'; files: FileDiff[] }
  | { state: 'error'; message: string };

interface Notice {
  ok: boolean;
  text: string;
}

const CLOCK_MS = 60_000;

/** The "what changed" panel: newest first, plain summaries, file chips, inline diffs and undo. */
@Component({
  selector: 'ms-changes',
  imports: [LucideAngularModule, RouterLink],
  templateUrl: './changes.html',
  styleUrl: './changes.css',
})
export class Changes implements OnInit {
  /** Narrow screens: only the summary line of each change. */
  @Input() compact = false;

  readonly i18n = inject(I18n);
  private readonly api = inject(ApiService);
  private readonly live = inject(LiveService);
  private readonly focus = inject(FocusMessageService);
  private readonly destroyRef = inject(DestroyRef);

  readonly icons = { ExternalLink, MessageSquare, Undo2, X };

  readonly groups = signal<ChangeGroup[]>([]);
  readonly loaded = signal(false);
  readonly loadError = signal<string | null>(null);
  /** Clock for relative times, refreshed every minute. */
  readonly now = signal(Date.now());

  /** The only group that shows an undo button: the newest that is neither undone nor an undo. */
  readonly undoTarget = computed(() => this.groups().find((g) => !g.undone && !g.isUndo)?.id ?? null);
  readonly confirmingId = signal<string | null>(null);
  readonly undoBusy = signal<string | null>(null);
  readonly notice = signal<Notice | null>(null);

  /** Open file diffs, keyed by `<group id>|<path>`. */
  readonly openFiles = signal<ReadonlySet<string>>(new Set());
  /** Diffs per group id: loaded once and then reused. */
  readonly diffs = signal<ReadonlyMap<string, DiffEntry>>(new Map());

  ngOnInit(): void {
    this.live
      .on('changes')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.load());
    this.live.resync$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.load());

    const clock = setInterval(() => this.now.set(Date.now()), CLOCK_MS);
    this.destroyRef.onDestroy(() => clearInterval(clock));
    void this.load();
  }

  async load(): Promise<void> {
    try {
      const response: ChangesResponse = await this.api.changes();
      this.groups.set(response.groups);
      this.loadError.set(null);
      this.now.set(Date.now());
    } catch {
      this.loadError.set(this.t('changes.loadError'));
    } finally {
      this.loaded.set(true);
    }
  }

  t(key: TranslationKey): string {
    return this.i18n.t(key);
  }

  relative(at: string): string {
    return formatRelative(at, this.now(), this.i18n.language());
  }

  absolute(at: string): string {
    const date = new Date(at);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(this.i18n.language());
  }

  statusLabel(status: FileStatus): string {
    return this.t(`changes.status.${status}` as TranslationKey);
  }

  statusIcon(status: FileStatus) {
    switch (status) {
      case 'added':
        return FilePlus;
      case 'deleted':
        return FileMinus;
      case 'renamed':
        return FileSymlink;
      case 'modified':
        return FilePen;
    }
  }

  isDoc(path: string): boolean {
    return path.toLowerCase().endsWith('.md');
  }

  link(path: string): string {
    return docUrl(path);
  }

  kindLabel(kind: DiffRow['kind']): string {
    if (kind === 'add') return this.t('changes.addedLine');
    if (kind === 'del') return this.t('changes.removedLine');
    return this.t('changes.contextLine');
  }

  rows(files: FileDiff[], path: string): DiffRow[] {
    return fileDiffRows(files, path);
  }

  isOpen(groupId: string, path: string): boolean {
    return this.openFiles().has(fileKey(groupId, path));
  }

  /** Opens or closes the diff of one file; the group's diff is fetched on first need only. */
  toggleFile(groupId: string, file: ChangedFile): void {
    const key = fileKey(groupId, file.path);
    const open = new Set(this.openFiles());
    if (open.has(key)) {
      open.delete(key);
      this.openFiles.set(open);
      return;
    }
    open.add(key);
    this.openFiles.set(open);
    void this.ensureDiff(groupId);
  }

  showInChat(messageId: string): void {
    this.focus.focus(messageId);
  }

  askUndo(id: string): void {
    this.notice.set(null);
    this.confirmingId.set(id);
  }

  cancelUndo(): void {
    this.confirmingId.set(null);
  }

  /** Undo is never optimistic: the list changes when the `changes` event arrives. */
  async confirmUndo(id: string): Promise<void> {
    this.undoBusy.set(id);
    this.confirmingId.set(null);
    try {
      const response = await this.api.undo(id);
      this.notice.set({ ok: response.ok, text: response.message });
    } catch (failure) {
      this.notice.set({ ok: false, text: (isApiFailure(failure) ? failure.error : this.i18n.t('errors.generic')) });
    } finally {
      this.undoBusy.set(null);
    }
  }

  private async ensureDiff(groupId: string): Promise<void> {
    const current = this.diffs().get(groupId);
    if (current?.state === 'loading' || current?.state === 'ready') return;
    this.setDiff(groupId, { state: 'loading' });
    try {
      const response = await this.api.changeDiff(groupId);
      this.setDiff(groupId, { state: 'ready', files: response.files });
    } catch {
      this.setDiff(groupId, { state: 'error', message: this.t('changes.diffError') });
    }
  }

  private setDiff(groupId: string, entry: DiffEntry): void {
    const next = new Map(this.diffs());
    next.set(groupId, entry);
    this.diffs.set(next);
  }
}

function fileKey(groupId: string, path: string): string {
  return `${groupId}|${path}`;
}
