import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { LucideAngularModule, CircleAlert, Cloud, CloudOff, FileText, Frame, Image, LoaderCircle, Link, Maximize, StickyNote, Unlink, ZoomIn, ZoomOut } from 'lucide-angular';
import { LiveStrings } from '../strings';
import type { SaveStatus } from './board-sync';

export type ToolbarCommand = 'note' | 'document' | 'image' | 'frame' | 'link' | 'zoom-in' | 'zoom-out' | 'fit';

/** Icons only, each with a tooltip and an aria-label. Also shows whether the table is saved. */
@Component({
  selector: 'ms-live-canvas-toolbar',
  imports: [LucideAngularModule],
  templateUrl: './canvas-toolbar.html',
  styleUrl: './canvas-toolbar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveCanvasToolbar {
  readonly linkActive = input(false);
  readonly imageActive = input(false);
  readonly documentActive = input(false);
  readonly status = input<SaveStatus>('saved');
  readonly percent = input(100);

  readonly command = output<ToolbarCommand>();
  readonly s = inject(LiveStrings);
  readonly icons = { StickyNote, FileText, Image, Frame, Link, Unlink, ZoomIn, ZoomOut, Maximize, Cloud, CloudOff, LoaderCircle, CircleAlert };

  saveLabel(): string {
    const status = this.status();
    const key = status === 'saved' ? 'live.save.saved' : status === 'pending' ? 'live.save.pending' : status === 'saving' ? 'live.save.saving' : status === 'conflict' ? 'live.save.conflict' : 'live.save.error';
    return this.s.copy(key);
  }
}
