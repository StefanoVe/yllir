import { Component, inject } from '@angular/core';
import { StatusService } from './core/status.service';
import { Shell } from './shell/shell';
import { ProjectorPage } from './projector/projector-page';

@Component({
  selector: 'app-root',
  imports: [Shell, ProjectorPage],
  template: `
    @if (isProjector) {
      <ms-projector-page />
    } @else {
      <ms-shell />
    }
  `,
})
export class App {
  // Created at start-up: loads /api/status and sets the campaign language and slug.
  private readonly status = inject(StatusService);
  // The projector window is a separate page without the shell; decided once at start-up.
  readonly isProjector = location.pathname === '/projector' || location.pathname.startsWith('/projector/');
}
