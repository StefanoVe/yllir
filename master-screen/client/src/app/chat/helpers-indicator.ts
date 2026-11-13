import { Component, booleanAttribute, computed, inject, input } from '@angular/core';
import { LucideAngularModule, Users } from 'lucide-angular';
import type { Turn } from '@shared/types';
import { I18n } from '../i18n';
import { helpersCountKey, runningHelpers } from './helpers';

/**
 * Shows the helper assistants that work right now in a turn. Hidden when none runs.
 * Full: a line with the count and the one-line sentences of the helpers (chat page).
 * Compact: the icon with a count badge, the sentences in the tooltip and in visually hidden text (rail).
 */
@Component({
  selector: 'ms-helpers-indicator',
  imports: [LucideAngularModule],
  templateUrl: './helpers-indicator.html',
  styleUrl: './helpers-indicator.css',
  host: {
    '[class.compact]': 'compact()',
    '[class.is-empty]': 'count() === 0',
  },
})
export class HelpersIndicator {
  private readonly i18n = inject(I18n);

  readonly icons = { Users };
  readonly turn = input<Turn | null>(null);
  readonly compact = input(false, { transform: booleanAttribute });

  readonly running = computed(() => runningHelpers(this.turn()));
  readonly count = computed(() => this.running().length);
  readonly countLabel = computed(() => this.i18n.t(helpersCountKey(this.count()), { count: this.count() }));
  readonly listLabel = computed(() => this.i18n.t('helpers.list'));
  /** The sentences of the running helpers, one per line: the tooltip of the compact form. */
  readonly tooltip = computed(() => this.running().map((step) => step.text).join('\n'));
}
