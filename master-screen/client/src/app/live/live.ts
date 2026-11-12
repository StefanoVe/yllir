import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { LucideAngularModule, Square } from 'lucide-angular';
import { LiveStateService } from './live-api.service';
import { LiveCanvas } from './canvas/canvas';
import { LiveDock, type DockTab } from './dock/dock';
import { LiveStrings } from './strings';

/** The combat panel opens when a combat turns active (false to true), once per start. */
export function shouldOpenCombat(wasActive: boolean, isActive: boolean): boolean {
  return !wasActive && isActive;
}

/** The dock panel named in `?dock=log|combat|lookup`, or null. Used to open a panel directly (for example from a link). */
export function parseDockParam(value: string | null): DockTab | null {
  return value === 'log' || value === 'combat' || value === 'lookup' ? value : null;
}

/**
 * The live table (route `/live`): an empty state with the start button, or the session bar,
 * the canvas and the dock.
 */
@Component({
  selector: 'ms-live',
  imports: [LucideAngularModule, LiveCanvas, LiveDock],
  templateUrl: './live.html',
  styleUrl: './live.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveComponent {
  readonly state = inject(LiveStateService);
  readonly s = inject(LiveStrings);
  readonly icons = { Square };

  readonly title = signal('');
  readonly confirmingEnd = signal(false);
  readonly dockOpen = signal(true);
  readonly dockTab = signal<DockTab>('log');

  private readonly route = inject(ActivatedRoute);
  /** Panel chosen by the URL; while it is set, the combat panel does not open on the first load by itself. */
  private readonly requestedTab = parseDockParam(this.route.snapshot.queryParamMap.get('dock'));
  /** null until the first snapshot arrives. */
  private combatWasActive: boolean | null = null;

  constructor() {
    if (this.requestedTab !== null) {
      this.dockTab.set(this.requestedTab);
    }
    effect(() => {
      const snapshot = this.state.snapshot();
      if (snapshot === null) return;
      const active = snapshot.combat?.active === true;
      untracked(() => {
        // First snapshot with a requested panel: treat the combat as already seen, so the requested panel stays.
        const was = this.combatWasActive ?? this.requestedTab !== null;
        if (shouldOpenCombat(was, active)) {
          this.dockTab.set('combat');
          this.dockOpen.set(true);
        }
        this.combatWasActive = active;
      });
    });
    effect(() => {
      if (this.state.session() === null) {
        untracked(() => this.confirmingEnd.set(false));
      }
    });
  }

  onTitle(event: Event): void {
    this.title.set((event.target as HTMLInputElement).value);
  }

  async start(): Promise<void> {
    const title = this.title().trim();
    await this.state.open(title === '' ? undefined : title);
    if (this.state.error() === null) this.title.set('');
  }

  async endNow(): Promise<void> {
    await this.state.end();
    this.confirmingEnd.set(false);
  }

  onTab(tab: DockTab): void {
    if (this.dockOpen() && this.dockTab() === tab) {
      this.dockOpen.set(false);
      return;
    }
    this.dockTab.set(tab);
    this.dockOpen.set(true);
  }
}
