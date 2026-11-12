import { Component, effect, inject, signal } from '@angular/core';
import { Changes } from '../changes/changes';
import { Chat } from '../chat/chat';
import { PrefsService } from '../core/prefs.service';
import { I18n } from '../i18n';

const CHANGES_COLLAPSED_KEY = 'changes-collapsed';

@Component({
  selector: 'ms-home',
  imports: [Chat, Changes],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {
  readonly i18n = inject(I18n);
  private readonly prefs = inject(PrefsService);

  /** Collapsed state of the changes panel, remembered per campaign. */
  readonly changesCollapsed = signal(false);

  constructor() {
    // The campaign slug may arrive after this page is created, so read the saved value reactively.
    effect(() => {
      this.changesCollapsed.set(this.prefs.get(CHANGES_COLLAPSED_KEY) === '1');
    });
  }

  toggleChanges(): void {
    const next = !this.changesCollapsed();
    this.changesCollapsed.set(next);
    this.prefs.set(CHANGES_COLLAPSED_KEY, next ? '1' : '0');
  }
}
