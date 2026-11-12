import { Component, inject } from '@angular/core';
import { StatusService } from './core/status.service';
import { Shell } from './shell/shell';

@Component({
  selector: 'app-root',
  imports: [Shell],
  template: `<ms-shell />`,
})
export class App {
  // Created at start-up: loads /api/status and sets the campaign language and slug.
  private readonly status = inject(StatusService);
}
