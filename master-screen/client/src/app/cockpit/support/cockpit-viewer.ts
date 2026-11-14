import { Component, HostListener, inject } from '@angular/core';
import { I18n } from '../../i18n';
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

  /** Escape closes the topmost viewer only. */
  @HostListener('document:keydown.escape') escape() {
    if (this.overlay.isTop('image') && this.viewer.image()) this.viewer.closeImage();
    else if (this.overlay.isTop('pdf') && this.viewer.pdfLink()) this.viewer.closePdf();
  }
}
