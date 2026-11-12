import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { LucideAngularModule, PanelRightClose, PanelRightOpen, ScrollText, Search, Swords } from 'lucide-angular';
import type { LiveSnapshot } from '@shared/types';
import { LiveCombatComponent, LiveLogComponent, LiveLookupComponent } from '../dock-panels';
import { LiveStrings } from '../strings';

export type DockTab = 'log' | 'combat' | 'lookup';

interface TabDef {
  id: DockTab;
  label: string;
  icon: typeof ScrollText;
}

/**
 * The right-hand dock of the table. A vertical icon bar (a bottom sheet on narrow screens) and the
 * content of the selected panel. The parent owns the state: `open` and `tab` are inputs, and
 * clicks come back as `tabSelect` and `toggle`.
 */
@Component({
  selector: 'ms-live-dock',
  imports: [LucideAngularModule, LiveLogComponent, LiveCombatComponent, LiveLookupComponent],
  templateUrl: './dock.html',
  styleUrl: './dock.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveDock {
  readonly open = input(true);
  /** The live snapshot, passed to the log and combat panels. */
  readonly snapshot = input<LiveSnapshot | null>(null);
  readonly tab = input<DockTab>('log');
  readonly tabSelect = output<DockTab>();
  readonly toggle = output<void>();

  readonly s = inject(LiveStrings);
  readonly icons = { PanelRightClose, PanelRightOpen };
  readonly tabs: readonly TabDef[] = [
    { id: 'log', label: 'live.dock.log', icon: ScrollText },
    { id: 'combat', label: 'live.dock.combat', icon: Swords },
    { id: 'lookup', label: 'live.dock.lookup', icon: Search },
  ];

  labelOf(tab: DockTab): string {
    return this.s.copy(this.tabs.find((t) => t.id === tab)?.label ?? 'live.dock.log');
  }
}
