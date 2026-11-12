import { Component, effect, inject, signal } from '@angular/core';
import { History, LucideAngularModule } from 'lucide-angular';
import { Changes } from '../changes/changes';
import { Chat } from '../chat/chat';
import { PrefsService } from '../core/prefs.service';
import { I18n } from '../i18n';

const CHANGES_COLLAPSED_KEY = 'changes-collapsed';
const NARROW_QUERY = '(max-width: 719px)';

@Component({
  selector: 'ms-home',
  imports: [Chat, Changes, LucideAngularModule],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {
  readonly i18n = inject(I18n);
  private readonly prefs = inject(PrefsService);

  readonly icons = { History };

  /** Collapsed state of the changes panel, remembered per campaign. */
  readonly changesCollapsed = signal(false);
  /** Number of change groups, shown as a badge when the panel is collapsed. */
  readonly changeCount = signal(0);
  /** Narrow screens: the panel stacks below the chat and shows the compact list. */
  readonly narrow = signal(false);

  constructor() {
    // The campaign slug may arrive after this page is created, so read the saved value reactively.
    effect(() => {
      this.changesCollapsed.set(this.prefs.get(CHANGES_COLLAPSED_KEY) === '1');
    });

    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const query = window.matchMedia(NARROW_QUERY);
      this.narrow.set(query.matches);
      query.addEventListener('change', (event) => this.narrow.set(event.matches));
    }
  }

  toggleChanges(): void {
    const next = !this.changesCollapsed();
    this.changesCollapsed.set(next);
    this.prefs.set(CHANGES_COLLAPSED_KEY, next ? '1' : '0');
  }
}
