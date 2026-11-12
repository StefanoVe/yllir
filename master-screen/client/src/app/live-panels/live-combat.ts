import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { KeyValuePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  ArrowRight,
  EllipsisVertical,
  Eye,
  EyeOff,
  LucideAngularModule,
  Minus,
  Play,
  Plus,
  Shield,
  SkipForward,
  Skull,
  Square,
  UserRound,
  X,
} from 'lucide-angular';
import type { CombatOp, CombatState, Combatant, ConditionState, LiveSnapshot, Side } from '@shared/types';
import { docUrl } from '../core/doc-nav.service';
import { LiveActionsService } from './live-actions.service';
import { PendingControls } from './pending';
import { isPanelFailure } from './panel-http';
import {
  DURATION_IDS,
  SIDE_IDS,
  combatRows,
  conditionKey,
  conditionOptions,
  conditionRounds as roundsOf,
  durationKey,
  hpView,
  parseAmount,
  parseOptionalInt,
  sideIconName,
  sideKey,
  type DurationId,
} from './combat-model';
import { PanelStrings } from './strings';

/** Draft of the add-combatant form. Numbers stay text until they are parsed. */
interface AddDraft {
  name: string;
  side: Side;
  initiative: string;
  hp: string;
  ac: string;
  sheet: string;
  hidden: boolean;
}

/** Draft of the inline add-condition form on one row. */
interface ConditionDraft {
  id: string | null;
  condition: string;
  duration: DurationId;
  rounds: string;
}

/**
 * Dock panel: the combat tracker. Everything comes from `snapshot.combat`; the rules belong to the
 * server (a refusal arrives as a plain message and is shown next to the control, never as a modal).
 * Keyboard: N moves to the next turn while the panel has focus.
 */
@Component({
  selector: 'ms-live-combat',
  imports: [FormsModule, KeyValuePipe, LucideAngularModule, RouterLink],
  templateUrl: './live-combat.html',
  styleUrl: './live-combat.css',
  host: { '(keydown)': 'onPanelKey($event)' },
})
export class LiveCombatComponent {
  private readonly actions = inject(LiveActionsService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly s = inject(PanelStrings);

  readonly snapshot = input<LiveSnapshot | null>(null);

  readonly pending = new PendingControls();
  readonly icons = { ArrowRight, EllipsisVertical, Eye, EyeOff, Minus, Play, Plus, Shield, SkipForward, Skull, Square, UserRound, X };
  readonly durations = DURATION_IDS;
  readonly sides = SIDE_IDS;

  readonly menuFor = signal<string | null>(null);
  readonly removeFor = signal<string | null>(null);
  readonly endConfirm = signal(false);
  readonly addDraft: AddDraft = { name: '', side: 'enemy', initiative: '', hp: '', ac: '', sheet: '', hidden: false };
  readonly conditionDraft: ConditionDraft = { id: null, condition: 'blinded', duration: 'until_removed', rounds: '1' };

  readonly combat = computed<CombatState | null>(() => this.snapshot()?.combat ?? null);
  readonly active = computed(() => this.combat()?.active === true);
  readonly rows = computed(() => {
    const combat = this.combat();
    return combat ? combatRows(combat) : [];
  });
  readonly conditionChoices = computed(() => conditionOptions(this.combat()));
  readonly hasSession = computed(() => this.snapshot()?.session != null);

  constructor() {
    // A new snapshot is the server's confirmation: every busy control is free again.
    effect(() => {
      this.snapshot();
      untracked(() => this.pending.settle());
    });
    inject(DestroyRef).onDestroy(() => this.pending.dispose());
  }

  // ---- labels and icons ------------------------------------------------------------

  conditionName(id: string): string {
    const key = conditionKey(id);
    return key ? this.s.text(key) : id;
  }

  durationName(id: DurationId): string {
    return this.s.text(durationKey(id) ?? 'panels.combat.duration.rounds');
  }

  sideText(side: Side): string {
    return this.s.text(sideKey(side));
  }

  sideIcon(side: Side) {
    return this.icons[sideIconName(side)];
  }

  conditionRounds(condition: ConditionState): number | null {
    return roundsOf(condition);
  }

  hpOf(combatant: Combatant) {
    return hpView(combatant);
  }

  docLink(path: string): string {
    return docUrl(path);
  }

  time(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  rowError(id: string): string | null {
    return this.pending.errorWithPrefix(`row:${id}:`);
  }

  rowBusy(id: string): boolean {
    return this.pending.busyWithPrefix(`row:${id}:`);
  }

  panelError(): string | null {
    return this.pending.errorFor('start') ?? this.pending.errorFor('next') ?? this.pending.errorFor('end');
  }

  // ---- combat as a whole ---------------------------------------------------------------

  start(): void {
    this.send('start', { op: 'start' });
  }

  next(): void {
    if (!this.active()) return;
    this.send('next', { op: 'next' });
  }

  end(): void {
    this.send('end', { op: 'end' }, () => this.endConfirm.set(false));
  }

  onPanelKey(event: KeyboardEvent): void {
    if (event.key !== 'n' && event.key !== 'N') return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    event.preventDefault();
    this.next();
  }

  // ---- rows ------------------------------------------------------------------------------

  setInitiative(combatant: Combatant, raw: string): void {
    const key = `row:${combatant.id}:init`;
    const parsed = parseOptionalInt(raw);
    if (!parsed.ok) {
      this.pending.fail(key, this.s.text('panels.combat.wholeNumber'));
      return;
    }
    if (parsed.value === undefined || parsed.value === combatant.initiative) return;
    this.send(key, { op: 'initiative', id: combatant.id, value: parsed.value });
  }

  setNote(combatant: Combatant, text: string): void {
    if (text === (combatant.notes ?? '')) return;
    this.send(`row:${combatant.id}:note`, { op: 'note', id: combatant.id, text });
  }

  resource(combatant: Combatant, name: string, delta: number): void {
    this.send(`row:${combatant.id}:res:${name}`, { op: 'resource', id: combatant.id, resource: name, delta });
  }

  /** Damage (minus) or heal (plus) from the amount box. Enter applies damage. */
  applyAmount(combatant: Combatant, kind: 'damage' | 'heal', box: HTMLInputElement): void {
    const key = `row:${combatant.id}:${kind}`;
    const amount = parseAmount(box.value);
    if (amount === null) {
      this.pending.fail(key, this.s.text('panels.combat.amountInvalid'));
      return;
    }
    this.send(key, { op: kind, id: combatant.id, amount }, () => {
      box.value = '';
    });
  }

  reveal(combatant: Combatant): void {
    this.send(`row:${combatant.id}:reveal`, { op: 'reveal', id: combatant.id });
  }

  removeCondition(combatant: Combatant, condition: string): void {
    this.send(`row:${combatant.id}:condx:${condition}`, { op: 'condition-remove', id: combatant.id, condition });
  }

  // ---- menu and inline forms ------------------------------------------------------------

  toggleMenu(id: string): void {
    if (this.menuFor() === id) {
      this.closeMenu(false);
      return;
    }
    this.menuFor.set(id);
    this.removeFor.set(null);
    afterNextRender(() => this.menuItems(id)[0]?.focus(), { injector: this.injector });
  }

  closeMenu(returnFocus: boolean): void {
    const id = this.menuFor();
    this.menuFor.set(null);
    if (returnFocus && id !== null) {
      afterNextRender(() => this.triggerFor(id)?.focus(), { injector: this.injector });
    }
  }

  onMenuKeydown(event: KeyboardEvent, id: string): void {
    const items = this.menuItems(id);
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeMenu(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (items.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
    }
  }

  openConditionForm(combatant: Combatant): void {
    this.menuFor.set(null);
    this.conditionDraft.id = combatant.id;
    this.conditionDraft.condition = this.conditionChoices()[0] ?? 'blinded';
    this.conditionDraft.duration = 'until_removed';
    this.conditionDraft.rounds = '1';
  }

  cancelConditionForm(): void {
    this.conditionDraft.id = null;
  }

  addCondition(combatant: Combatant): void {
    const draft = this.conditionDraft;
    const key = `row:${combatant.id}:cond`;
    let rounds: number | undefined;
    if (draft.duration === 'rounds') {
      const parsed = parseAmount(draft.rounds);
      if (parsed === null) {
        this.pending.fail(key, this.s.text('panels.combat.amountInvalid'));
        return;
      }
      rounds = parsed;
    }
    const op: CombatOp = {
      op: 'condition-add',
      id: combatant.id,
      condition: draft.condition,
      duration: draft.duration,
      ...(rounds !== undefined ? { rounds } : {}),
    };
    this.send(key, op, () => this.cancelConditionForm());
  }

  askRemove(id: string): void {
    this.menuFor.set(null);
    this.removeFor.set(id);
  }

  cancelRemove(): void {
    this.removeFor.set(null);
  }

  remove(combatant: Combatant): void {
    this.send(`row:${combatant.id}:remove`, { op: 'remove', id: combatant.id }, () => this.removeFor.set(null));
  }

  // ---- add combatant -----------------------------------------------------------------

  addCombatant(): void {
    const draft = this.addDraft;
    const key = 'add';
    const name = draft.name.trim();
    if (name === '') {
      this.pending.fail(key, this.s.text('panels.combat.nameRequired'));
      return;
    }
    const initiative = parseOptionalInt(draft.initiative);
    const hp = parseOptionalInt(draft.hp);
    const ac = parseOptionalInt(draft.ac);
    if (!initiative.ok || !hp.ok || !ac.ok) {
      this.pending.fail(key, this.s.text('panels.combat.wholeNumber'));
      return;
    }
    const sheet = draft.sheet.trim();
    const op: CombatOp = {
      op: 'add',
      name,
      side: draft.side,
      ...(initiative.value !== undefined ? { initiative: initiative.value } : {}),
      ...(hp.value !== undefined ? { hp: hp.value, hpMax: hp.value } : {}),
      ...(ac.value !== undefined ? { ac: ac.value } : {}),
      ...(sheet !== '' ? { sheet } : {}),
      ...(draft.hidden ? { hidden: true } : {}),
    };
    this.send(key, op, () => {
      draft.name = '';
      draft.initiative = '';
      draft.hp = '';
      draft.ac = '';
      draft.sheet = '';
      draft.hidden = false;
    });
  }

  // ---- internals ---------------------------------------------------------------------------

  /** Sends one operation. The control is busy until the next snapshot; a refusal is shown next to it. */
  private send(key: string, op: CombatOp, done?: () => void): void {
    if (!this.pending.start(key)) return;
    this.actions
      .combat(op)
      .then(() => done?.())
      .catch((failure: unknown) => this.pending.fail(key, this.messageOf(failure)));
  }

  private messageOf(failure: unknown): string {
    return isPanelFailure(failure) ? failure.error : this.s.text('panels.errors.generic');
  }

  private menuItems(id: string): HTMLElement[] {
    const menu = this.host.nativeElement.querySelector<HTMLElement>(`[data-menu-for="${id}"]`);
    return menu ? Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')) : [];
  }

  private triggerFor(id: string): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>(`[data-trigger-for="${id}"]`);
  }
}
