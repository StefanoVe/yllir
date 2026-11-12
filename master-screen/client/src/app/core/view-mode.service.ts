import { Injectable, signal } from '@angular/core';

export type ViewMode = 'master' | 'public';

/** Global "players preview" switch. Session only: it is not persisted. */
@Injectable({ providedIn: 'root' })
export class ViewModeService {
  readonly viewMode = signal<ViewMode>('master');

  toggle(): void {
    this.viewMode.update((mode) => (mode === 'master' ? 'public' : 'master'));
  }
}
