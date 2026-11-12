import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { BookOpen, Check, Gavel, Link as LinkIcon, LucideAngularModule, Map as MapIcon, RotateCcw, Target, Trash2, X } from 'lucide-angular';
import type { LogEntry, LogKind, LiveSnapshot } from '@shared/types';
import { LiveActionsService } from './live-actions.service';
import { PendingControls } from './pending';
import { LOG_KINDS, groupByKind, openThreads, sceneLabel, timelineEntries } from './log-model';
import { PanelStrings, type PanelKey } from './strings';
import { DocSearch } from './doc-search';
import { isPanelFailure } from './panel-http';

const KIND_KEYS: Record<LogKind, PanelKey> = {
  fact: 'panels.log.kind.fact',
  decision: 'panels.log.kind.decision',
  intention: 'panels.log.kind.intention',
  thread: 'panels.log.kind.thread',
};

const KIND_ICONS = { fact: BookOpen, decision: Gavel, intention: Target, thread: LinkIcon } as const;

/**
 * Dock panel: the session's notes. Open threads are pinned at the top; the rest is a timeline, newest
 * at the bottom. Nothing changes on screen before the server confirms it: the list is the `snapshot`.
 */
@Component({
  selector: 'ms-live-log',
  imports: [LucideAngularModule, NgTemplateOutlet],
  templateUrl: './live-log.html',
  styleUrl: './live-log.css',
})
export class LiveLogComponent {
  private readonly actions = inject(LiveActionsService);
  private readonly injector = inject(Injector);
  readonly s = inject(PanelStrings);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly snapshot = input<LiveSnapshot | null>(null);

  readonly icons = { Check, RotateCcw, Trash2, MapIcon, X };
  readonly kinds = LOG_KINDS;
  readonly pending = new PendingControls();
  readonly sceneSearch = new DocSearch((text) => this.actions.searchDocs(text).then((response) => response.hits));

  readonly kind = signal<LogKind>('fact');
  readonly draft = signal('');
  readonly sceneRef = signal<string | null>(null);
  readonly scenePicking = signal(false);
  readonly editing = signal<{ id: string; text: string } | null>(null);
  readonly confirmDelete = signal<string | null>(null);

  readonly session = computed(() => this.snapshot()?.session ?? null);
  readonly threads = computed(() => openThreads(this.snapshot()?.log ?? []));
  readonly runs = computed(() => groupByKind(timelineEntries(this.snapshot()?.log ?? [])));
  readonly hasEntries = computed(() => (this.snapshot()?.log.length ?? 0) > 0);
  readonly canSubmit = computed(
    () => this.session() !== null && this.draft().trim() !== '' && !this.pending.isBusy('add'),
  );

  private readonly composer = viewChild<ElementRef<HTMLTextAreaElement>>('composer');

  constructor() {
    // A new snapshot is the server's confirmation: every busy control is free again.
    effect(() => {
      this.snapshot();
      untracked(() => this.pending.settle());
    });
    inject(DestroyRef).onDestroy(() => {
      this.pending.dispose();
      this.sceneSearch.dispose();
    });
  }

  kindText(kind: LogKind): string {
    return this.s.text(KIND_KEYS[kind]);
  }

  kindIcon(kind: LogKind) {
    return KIND_ICONS[kind];
  }

  sceneName(path: string): string {
    return sceneLabel(path);
  }

  time(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  entryBusy(id: string): boolean {
    return ['edit', 'resolve', 'delete'].some((prefix) => this.pending.isBusy(`${prefix}:${id}`));
  }

  entryError(id: string): string | null {
    return ['edit', 'resolve', 'delete'].map((prefix) => this.pending.errorFor(`${prefix}:${id}`)).find((m) => m !== null) ?? null;
  }

  isEditing(id: string): boolean {
    return this.editing()?.id === id;
  }

  // ---- composer ---------------------------------------------------------------

  pickKind(kind: LogKind): void {
    this.kind.set(kind);
  }

  onDraftInput(event: Event): void {
    const area = event.target as HTMLTextAreaElement;
    this.draft.set(area.value);
    this.grow(area);
  }

  onDraftKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.submit();
    }
  }

  submit(): void {
    const text = this.draft().trim();
    const session = this.session();
    if (!session || text === '' || !this.pending.start('add')) return;
    const scene = this.sceneRef() ?? undefined;
    this.actions
      .addLogEntry({ kind: this.kind(), text, ...(scene ? { scene } : {}) })
      .then(() => {
        this.draft.set('');
        const area = this.composer()?.nativeElement;
        if (area) {
          area.value = '';
          this.grow(area);
        }
      })
      .catch((failure: unknown) => this.pending.fail('add', this.messageOf(failure)));
  }

  toggleScenePicker(): void {
    const open = !this.scenePicking();
    this.scenePicking.set(open);
    if (!open) this.sceneSearch.type('');
  }

  onSceneInput(event: Event): void {
    this.sceneSearch.type((event.target as HTMLInputElement).value);
  }

  pickScene(path: string): void {
    this.sceneRef.set(path);
    this.scenePicking.set(false);
    this.sceneSearch.type('');
  }

  clearScene(): void {
    this.sceneRef.set(null);
  }

  // ---- entries ------------------------------------------------------------------

  startEdit(entry: LogEntry): void {
    this.confirmDelete.set(null);
    this.editing.set({ id: entry.id, text: entry.text });
    afterNextRender(
      () => {
        const area = this.editorFor(entry.id);
        area?.focus();
        if (area) this.grow(area);
      },
      { injector: this.injector },
    );
  }

  onEditInput(event: Event): void {
    const area = event.target as HTMLTextAreaElement;
    this.editing.update((current) => (current ? { ...current, text: area.value } : current));
    this.grow(area);
  }

  onEditKeydown(event: KeyboardEvent, id: string): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelEdit();
    } else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.saveEdit(id);
    }
  }

  cancelEdit(): void {
    this.editing.set(null);
  }

  saveEdit(id: string): void {
    const current = this.editing();
    if (!current || current.id !== id) return;
    const text = current.text.trim();
    if (text === '') {
      this.cancelEdit();
      return;
    }
    const key = `edit:${id}`;
    if (!this.pending.start(key)) return;
    this.actions
      .updateLogEntry(id, { text })
      .then(() => this.editing.set(null))
      .catch((failure: unknown) => this.pending.fail(key, this.messageOf(failure)));
  }

  setResolved(entry: LogEntry, resolved: boolean): void {
    const key = `resolve:${entry.id}`;
    if (!this.pending.start(key)) return;
    this.actions
      .updateLogEntry(entry.id, { resolved })
      .catch((failure: unknown) => this.pending.fail(key, this.messageOf(failure)));
  }

  askDelete(id: string): void {
    this.editing.set(null);
    this.confirmDelete.set(id);
  }

  cancelDelete(): void {
    this.confirmDelete.set(null);
  }

  remove(id: string): void {
    const key = `delete:${id}`;
    if (!this.pending.start(key)) return;
    this.actions
      .removeLogEntry(id)
      .then(() => this.confirmDelete.set(null))
      .catch((failure: unknown) => this.pending.fail(key, this.messageOf(failure)));
  }

  private editorFor(id: string): HTMLTextAreaElement | null {
    const areas = Array.from(this.host.nativeElement.querySelectorAll<HTMLTextAreaElement>('textarea[data-edit-id]'));
    return areas.find((area) => area.getAttribute('data-edit-id') === id) ?? null;
  }

  private grow(area: HTMLTextAreaElement): void {
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight}px`;
  }

  private messageOf(failure: unknown): string {
    return isPanelFailure(failure) ? failure.error : this.s.text('panels.errors.generic');
  }
}
