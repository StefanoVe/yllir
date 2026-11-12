import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked, type Signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, ExternalLink, FileText, Image, StickyNote } from 'lucide-angular';
import type { BoardCard } from '@shared/types';
import { docUrl } from '../../chat/doc-link';
import { LiveStrings } from '../strings';
import { DocPreview, DocPreviewCache } from './doc-preview';

export type CardPressAction = 'select' | 'move' | 'resize';
export interface CardPress {
  action: CardPressAction;
  event: PointerEvent;
}

const IDLE: Signal<DocPreview> = signal<DocPreview>({ state: 'loading', title: '', excerpt: '' }).asReadonly();

/** Campaign file URL for an image card. */
export function fileUrl(path: string): string {
  return `/api/file?path=${encodeURIComponent(path)}`;
}

/** A document, image or note card. Dragging and resizing report gestures; the canvas owns the board. */
@Component({
  selector: 'ms-live-card',
  imports: [LucideAngularModule, RouterLink],
  templateUrl: './card.html',
  styleUrl: './card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'card-host' },
})
export class LiveCard {
  readonly card = input.required<BoardCard>();
  readonly x = input.required<number>();
  readonly y = input.required<number>();
  readonly w = input.required<number>();
  readonly h = input.required<number>();
  readonly selected = input(false);
  /** Link mode is on: the card is a possible target. */
  readonly linkMode = input(false);

  readonly press = output<CardPress>();
  readonly focused = output<void>();
  readonly textChange = output<string>();

  readonly s = inject(LiveStrings);
  private readonly cache = inject(DocPreviewCache);
  readonly icons = { ExternalLink, FileText, Image, StickyNote };

  private readonly source = signal<Signal<DocPreview>>(IDLE);
  readonly preview = computed(() => this.source()());

  readonly transform = computed(() => `translate(${this.x()}px, ${this.y()}px)`);
  readonly title = computed(() => {
    const card = this.card();
    if (card.kind === 'document') return this.preview().title;
    if (card.kind === 'image') return fileName(card.ref ?? '');
    return this.s.copy('live.card.note');
  });
  readonly imageSrc = computed(() => fileUrl(this.card().ref ?? ''));
  readonly docLink = computed(() => docUrl(this.card().ref ?? ''));
  readonly label = computed(() => {
    const card = this.card();
    const kind = this.s.copy(card.kind === 'document' ? 'live.card.document' : card.kind === 'image' ? 'live.card.image' : 'live.card.note');
    return `${kind}: ${this.title()}`;
  });

  constructor() {
    effect(() => {
      const card = this.card();
      untracked(() => {
        if (card.kind === 'document' && card.ref) this.source.set(this.cache.get(card.ref));
      });
    });
  }

  onHeader(event: PointerEvent): void {
    event.stopPropagation();
    const target = event.target as Element | null;
    if (target?.closest('a, input, textarea, button')) return;
    if (event.button !== 0) return;
    this.press.emit({ action: 'move', event });
  }

  onGrip(event: PointerEvent): void {
    event.stopPropagation();
    if (event.button !== 0) return;
    this.press.emit({ action: 'resize', event });
  }

  onBody(event: PointerEvent): void {
    this.press.emit({ action: 'select', event });
  }

  onNoteInput(event: Event): void {
    this.textChange.emit((event.target as HTMLTextAreaElement).value);
  }
}

export function fileName(path: string): string {
  return path.split('/').filter((part) => part.length > 0).pop() ?? path;
}
