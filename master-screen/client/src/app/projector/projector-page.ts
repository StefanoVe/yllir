import { Component, DOCUMENT, computed, effect, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { I18n } from '../i18n';
import { StatusService } from '../core/status.service';
import { ProjectorService } from './projector.service';

/** The projector window: no controls, black, shows the current projection or a neutral rest screen. */
@Component({
  selector: 'ms-projector-page',
  templateUrl: './projector-page.html',
  styleUrl: './projector-page.css',
  host: { '(dblclick)': 'toggleFullscreen()' },
})
export class ProjectorPage {
  private readonly projector = inject(ProjectorService);
  private readonly status = inject(StatusService);
  private readonly i18n = inject(I18n);
  private readonly title = inject(Title);
  private readonly document = inject(DOCUMENT);

  readonly campaignName = computed(() => this.status.campaign()?.name ?? '');
  readonly imageSrc = computed(() => {
    const projection = this.projector.current();
    return projection.kind === 'image' ? projection.src : null;
  });

  constructor() {
    effect(() => {
      const name = this.campaignName();
      const label = this.i18n.t('projector.title');
      this.i18n.language();
      this.title.setTitle(name ? `${name} · ${label}` : label);
    });
  }

  /** Double-click toggles fullscreen. There is deliberately no visible button. */
  toggleFullscreen(): void {
    const doc = this.document;
    if (doc.fullscreenElement) {
      void doc.exitFullscreen().catch(() => {});
    } else {
      void doc.documentElement.requestFullscreen().catch(() => {});
    }
  }
}
