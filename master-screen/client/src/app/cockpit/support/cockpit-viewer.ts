import { Component, HostListener, effect, inject, signal, untracked } from '@angular/core';
import { I18n } from '../../i18n';
import { ProjectorService } from '../../projector/projector.service';
import { Icon } from './icon';
import { TooltipDirective } from '../../core/tooltip.directive';
import { OverlayService } from './overlay.service';
import { ViewerService } from './viewer.service';

/** The lightbox for images and the PDF hand-off, drawn above the cockpit. */
@Component({
  selector: 'cockpit-viewer',
  imports: [Icon, TooltipDirective],
  templateUrl: './cockpit-viewer.html',
  styleUrl: './cockpit-viewer.css',
})
export class CockpitViewer {
  readonly viewer = inject(ViewerService);
  readonly i18n = inject(I18n);
  readonly Math = Math;
  private readonly overlay = inject(OverlayService);
  private readonly projector = inject(ProjectorService);
  /** Whether the server lets the current image go to the projector. */
  readonly projectable = signal(false);

  constructor() {
    // Ask once per image; an answer for an image that is no longer open is ignored.
    effect(() => {
      const src = this.viewer.image();
      this.projectable.set(false);
      if (!src) return;
      void this.projector.check(src).then((ok) => {
        if (untracked(() => this.viewer.image()) === src) this.projectable.set(ok);
      });
    });
  }

  /** Called from the click, so the projector window can open. */
  projectImage() {
    const src = this.viewer.image();
    if (src) void this.projector.project(src);
  }

  /** Escape closes the topmost viewer only. */
  @HostListener('document:keydown.escape') escape() {
    if (this.overlay.isTop('image') && this.viewer.image()) this.viewer.closeImage();
    else if (this.overlay.isTop('pdf') && this.viewer.pdfLink()) this.viewer.closePdf();
  }
}
