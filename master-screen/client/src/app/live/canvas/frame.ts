import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import type { BoardFrame } from '@shared/types';
import { LiveStrings } from '../strings';
import type { CardPress } from './card';

/** A scene frame: a resizable rectangle with an editable title. Cards dropped inside belong to it. */
@Component({
  selector: 'ms-live-frame',
  templateUrl: './frame.html',
  styleUrl: './frame.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'frame-host' },
})
export class LiveFrame {
  readonly frame = input.required<BoardFrame>();
  readonly x = input.required<number>();
  readonly y = input.required<number>();
  readonly w = input.required<number>();
  readonly h = input.required<number>();
  readonly selected = input(false);
  readonly linkMode = input(false);

  readonly press = output<CardPress>();
  readonly focused = output<void>();
  readonly titleChange = output<string>();

  readonly s = inject(LiveStrings);

  onHeader(event: PointerEvent): void {
    event.stopPropagation();
    const target = event.target as Element | null;
    if (target?.closest('input, button')) return;
    if (event.button !== 0) return;
    this.press.emit({ action: 'move', event });
  }

  onGrip(event: PointerEvent): void {
    event.stopPropagation();
    if (event.button !== 0) return;
    this.press.emit({ action: 'resize', event });
  }

  onTitle(event: Event): void {
    this.titleChange.emit((event.target as HTMLInputElement).value);
  }
}
