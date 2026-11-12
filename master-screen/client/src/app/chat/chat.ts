import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import type { ChatMessage, ChatResponse, StepKind, Turn, TurnStep } from '@shared/types';
import {
  LucideAngularModule,
  ArrowDown,
  Check,
  ChevronDown,
  CircleAlert,
  Circle,
  Dices,
  ExternalLink,
  FileText,
  Image,
  ListChecks,
  LoaderCircle,
  Music,
  PencilLine,
  Save,
  Search,
  Send,
  Sparkles,
  Square,
  Users,
} from 'lucide-angular';
import { ApiService, isApiFailure } from '../core/api.service';
import { LiveService } from '../core/live.service';
import { ChatLiveSession } from './chat-live-session';
import { StatusService } from '../core/status.service';
import { I18n, type TranslationKey } from '../i18n';
import {
  ChatState,
  EMPTY_CHAT_STATE,
  addMessage,
  applyDelta,
  isActiveTurn,
  isFailedTurn,
  mergeFetched,
  setTurn,
} from './chat-state';
import { FocusMessageService } from './focus-message.service';
import { docUrl } from './doc-link';
import { renderChatMarkdown } from './chat-markdown';
import { ChatRich } from './chat-rich';
import {
  formatDuration,
  isSlowImage,
  loadStepsExpanded,
  nestSteps,
  saveStepsExpanded,
  stepElapsedMs,
  stepIcon,
  type StepRow,
} from './chat-steps';
import {
  CHAT_EFFORTS,
  CHAT_MODELS,
  EFFORT_TEXT,
  MODEL_TEXT,
  loadChatChoice,
  saveChatChoice,
  type ChatChoice,
  type ChatEffort,
  type ChatModel,
} from './chat-choice';

/** Distance from the bottom (px) under which the list still follows new messages. */
const NEAR_BOTTOM_PX = 48;
const EXAMPLE_KEYS: readonly TranslationKey[] = ['chat.example.1', 'chat.example.2', 'chat.example.3'];
/** Messages of the same speaker closer than this share one header. */
const GROUP_GAP_MS = 5 * 60 * 1000;

/** The two selector menus in the composer. */
type MenuName = 'model' | 'effort';
/** Where the focus goes when a menu opens: on the current choice, or on its last item. */
type MenuFocus = 'checked' | 'last';

/** Layout tick of the running steps' elapsed time. */
const STEP_TICK_MS = 1000;

/** Marks the first message of each group (same speaker, close in time) so only it shows a header. */
function groupRows<T extends ChatMessage>(messages: readonly T[]): { message: T; head: boolean }[] {
  return messages.map((message, index) => {
    const previous = messages[index - 1];
    const gap = previous ? Date.parse(message.at) - Date.parse(previous.at) : Number.NaN;
    return { message, head: !previous || previous.role !== message.role || !(gap < GROUP_GAP_MS) };
  });
}

/** The conversation with the assistant: messages, composer and the status line of the current turn. */
@Component({
  selector: 'ms-chat',
  imports: [LucideAngularModule, NgTemplateOutlet, RouterLink, ChatRich],
  templateUrl: './chat.html',
  styleUrl: './chat.css',
})
export class Chat implements OnInit {
  readonly i18n = inject(I18n);
  private readonly api = inject(ApiService);
  private readonly live = inject(LiveService);
  private readonly liveSession = inject(ChatLiveSession);
  private readonly statusService = inject(StatusService);
  private readonly router = inject(Router);
  private readonly focus = inject(FocusMessageService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly icons = {
    ArrowDown,
    Check,
    ChevronDown,
    Dices,
    Send,
    Square,
    CircleAlert,
    LoaderCircle,
    FileText,
    Search,
    PencilLine,
    Sparkles,
    Image,
    ListChecks,
    Save,
    Users,
    Music,
    ExternalLink,
    Circle,
  };
  readonly models = CHAT_MODELS;
  readonly efforts = CHAT_EFFORTS;
  readonly modelText = MODEL_TEXT;
  readonly effortText = EFFORT_TEXT;
  /** True while a live session is open: the header then links to the live table. */
  readonly liveOpen = computed(() => this.liveSession.open());
  readonly examples = EXAMPLE_KEYS;

  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  private readonly composer = viewChild<ElementRef<HTMLTextAreaElement>>('composer');
  private readonly stepsBox = viewChild<ElementRef<HTMLElement>>('steps');

  readonly state = signal<ChatState>(EMPTY_CHAT_STATE);
  readonly loaded = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly draft = signal('');
  readonly sending = signal(false);
  readonly sendError = signal<string | null>(null);
  readonly stopError = signal<string | null>(null);
  readonly jumpVisible = signal(false);
  /** The model and thinking choice for the next message. Saved in localStorage. */
  readonly choice = signal<ChatChoice>(loadChatChoice());
  /** The open selector menu, if any. Only one is open at a time. */
  readonly menu = signal<MenuName | null>(null);
  /** Whether the live list of the running turn's steps is expanded. Remembered in localStorage. */
  readonly stepsOpen = signal(loadStepsExpanded());
  /** Clock for the elapsed time of running steps. */
  private readonly now = signal(Date.now());
  private ticker: ReturnType<typeof setInterval> | null = null;
  /** False while the reader has scrolled up in the step list: new steps do not move it. */
  private stepsPinned = true;

  readonly agent = computed(() => this.statusService.status()?.agent ?? null);
  readonly agentAvailable = computed(() => this.agent()?.available === true);
  readonly canSend = computed(
    () => this.agentAvailable() && this.draft().trim().length > 0 && !this.sending(),
  );
  readonly messages = computed(() => this.state().messages);
  readonly rows = computed(() =>
    groupRows(this.messages()).map((row) => ({
      ...row,
      steps: row.message.steps?.length ? nestSteps(row.message.steps) : null,
    })),
  );
  readonly activeTurn = computed<Turn | null>(() => {
    const turn = this.state().turn;
    return isActiveTurn(turn) ? turn : null;
  });
  readonly failedTurn = computed<Turn | null>(() => {
    const turn = this.state().turn;
    return isFailedTurn(turn) ? turn : null;
  });
  readonly stepRows = computed<StepRow[]>(() => nestSteps(this.activeTurn()?.steps ?? []));
  readonly hasRunningStep = computed(() => (this.activeTurn()?.steps ?? []).some((s) => s.state === 'running'));
  /** The line under the chat: the latest running step, else the turn's activity. */
  readonly activeLine = computed(() => {
    const turn = this.activeTurn();
    if (!turn) return '';
    const running = [...(turn.steps ?? [])].reverse().find((s) => s.state === 'running');
    return running?.text || turn.activity || this.t('chat.working');
  });

  /** False while the reader has scrolled up: new messages do not move the view. */
  private pinned = true;

  constructor() {
    // A click on a change in the changes panel scrolls to its message and highlights it.
    effect(() => {
      const request = this.focus.request();
      if (request) untracked(() => this.highlight(request.id));
    });
    // One clock runs only while a step is running, and stops with the turn or the view.
    effect(() => {
      const running = this.hasRunningStep();
      untracked(() => (running ? this.startTicker() : this.stopTicker()));
    });
    this.destroyRef.onDestroy(() => this.stopTicker());
  }

  ngOnInit(): void {
    this.live
      .on('message')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((message: ChatMessage) => this.update((s) => addMessage(s, message)));
    this.live
      .on('delta')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((delta) => this.update((s) => applyDelta(s, delta, new Date().toISOString())));
    this.live
      .on('turn')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((turn: Turn) => this.update((s) => setTurn(s, turn)));
    this.live
      .on('open')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ path }) => void this.router.navigateByUrl(docUrl(path)));
    this.live.resync$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.load());
    void this.load();
  }

  /** Loads the stored conversation. Shown messages that the server does not list yet are kept. */
  async load(): Promise<void> {
    try {
      const response: ChatResponse = await this.api.chat();
      this.update((s) => mergeFetched(s, response));
      this.loadError.set(null);
    } catch {
      this.loadError.set(this.i18n.t('chat.loadError'));
    } finally {
      this.loaded.set(true);
      this.scheduleScroll();
    }
  }

  /** Sends the draft. The composer is cleared and the bubble shown only once the server accepted it. */
  async send(): Promise<void> {
    if (!this.canSend()) return;
    const sent = this.draft();
    const text = sent.trim();
    this.sending.set(true);
    this.sendError.set(null);
    try {
      await this.api.sendMessage(text, this.choice());
      if (this.draft() === sent) this.draft.set('');
      this.resizeLater();
      void this.load();
    } catch (failure) {
      this.sendError.set((isApiFailure(failure) ? failure.error : this.i18n.t('errors.generic')));
    } finally {
      this.sending.set(false);
    }
  }

  async stop(): Promise<void> {
    const turn = this.activeTurn();
    if (!turn) return;
    this.stopError.set(null);
    try {
      await this.api.cancelTurn(turn.id);
    } catch (failure) {
      this.stopError.set((isApiFailure(failure) ? failure.error : this.i18n.t('errors.generic')));
    }
  }

  onInput(element: HTMLTextAreaElement): void {
    this.draft.set(element.value);
    this.resize(element);
  }

  onComposerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void this.send();
    }
  }

  /** An example chip fills the composer; the master still sends it. */
  useExample(key: TranslationKey): void {
    this.draft.set(this.i18n.t(key));
    this.resizeLater();
    this.composer()?.nativeElement.focus();
  }

  onScroll(): void {
    const element = this.list()?.nativeElement;
    if (!element) return;
    this.pinned = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
    this.jumpVisible.set(!this.pinned);
  }

  modelLabel(model: ChatModel): string {
    return this.t(MODEL_TEXT[model].label);
  }

  effortLabel(effort: ChatEffort): string {
    return this.t(EFFORT_TEXT[effort].label);
  }

  selectModel(model: ChatModel): void {
    this.setChoice({ ...this.choice(), model });
    this.closeMenu(true);
  }

  selectEffort(effort: ChatEffort): void {
    this.setChoice({ ...this.choice(), effort });
    this.closeMenu(true);
  }

  toggleMenu(name: MenuName): void {
    if (this.menu() === name) this.closeMenu(true);
    else this.openMenu(name, 'checked');
  }

  /** Arrow keys open the menu from its button; Escape closes it. */
  onTriggerKeydown(name: MenuName, event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.openMenu(name, event.key === 'ArrowDown' ? 'checked' : 'last');
    } else if (event.key === 'Escape' && this.menu() === name) {
      event.preventDefault();
      this.closeMenu(true);
    }
  }

  /** Arrow keys, Home and End move between the choices; Escape closes; Tab leaves the menu. */
  onMenuKeydown(name: MenuName, event: KeyboardEvent): void {
    const items = this.menuItems(name);
    const at = items.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case 'ArrowDown':
        items[at < 0 ? 0 : (at + 1) % items.length]?.focus();
        break;
      case 'ArrowUp':
        items[at <= 0 ? items.length - 1 : at - 1]?.focus();
        break;
      case 'Home':
        items[0]?.focus();
        break;
      case 'End':
        items[items.length - 1]?.focus();
        break;
      case 'Escape':
        event.preventDefault();
        this.closeMenu(true);
        return;
      case 'Tab':
        // Focus goes back to the button first, so Tab continues from there.
        this.closeMenu(true);
        return;
      default:
        return;
    }
    event.preventDefault();
  }

  /** A click or tap anywhere outside the selectors closes an open menu. */
  @HostListener('document:pointerdown', ['$event'])
  onPointerDown(event: Event): void {
    if (!this.menu()) return;
    const target = event.target;
    if (target instanceof Element && target.closest('.choice')) return;
    this.closeMenu(false);
  }

  toggleSteps(): void {
    const open = !this.stepsOpen();
    this.stepsOpen.set(open);
    saveStepsExpanded(open);
    if (open) {
      this.stepsPinned = true;
      this.followSteps();
    }
  }

  onStepsScroll(): void {
    const element = this.stepsBox()?.nativeElement;
    if (!element) return;
    this.stepsPinned = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
  }

  iconFor(kind: StepKind) {
    return this.icons[stepIcon(kind)];
  }

  durationOf(step: TurnStep): string {
    return formatDuration(stepElapsedMs(step, this.now()));
  }

  isSlowStep(step: TurnStep): boolean {
    return isSlowImage(step, this.now());
  }

  doneLabel(count: number): string {
    return this.i18n.t(count === 1 ? 'chat.steps.doneSummary.one' : 'chat.steps.doneSummary.other', { count });
  }

  jumpToLatest(): void {
    this.pinned = true;
    this.jumpVisible.set(false);
    this.scrollToBottom();
  }

  t(key: TranslationKey): string {
    return this.i18n.t(key);
  }

  roleLabel(role: ChatMessage['role']): string {
    return this.t(role === 'master' ? 'chat.you' : 'chat.assistant');
  }

  renderMarkdown(text: string): string {
    return renderChatMarkdown(text);
  }

  timeLabel(at: string): string {
    const date = new Date(at);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date);
  }

  private setChoice(choice: ChatChoice): void {
    this.choice.set(choice);
    saveChatChoice(choice);
  }

  private openMenu(name: MenuName, focus: MenuFocus): void {
    if (this.menu() === name) {
      this.focusMenuItem(name, focus);
      return;
    }
    this.menu.set(name);
    afterNextRender(() => this.focusMenuItem(name, focus), { injector: this.injector });
  }

  /** Closes the open menu. Focus goes back to its button when `restoreFocus` is set. */
  private closeMenu(restoreFocus: boolean): void {
    const name = this.menu();
    if (!name) return;
    if (restoreFocus) this.host.nativeElement.querySelector<HTMLElement>(`[data-menu-trigger="${name}"]`)?.focus();
    this.menu.set(null);
  }

  private menuItems(name: MenuName): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>(`[data-menu="${name}"] [role="menuitemradio"]`));
  }

  private focusMenuItem(name: MenuName, focus: MenuFocus): void {
    const items = this.menuItems(name);
    if (items.length === 0) return;
    const checked = Math.max(items.findIndex((item) => item.getAttribute('aria-checked') === 'true'), 0);
    items[focus === 'last' ? items.length - 1 : checked]?.focus();
  }

  private update(change: (state: ChatState) => ChatState): void {
    this.state.update(change);
    this.scheduleScroll();
    this.followSteps();
  }

  private startTicker(): void {
    if (this.ticker !== null) return;
    this.now.set(Date.now());
    this.ticker = setInterval(() => this.now.set(Date.now()), STEP_TICK_MS);
  }

  private stopTicker(): void {
    if (this.ticker === null) return;
    clearInterval(this.ticker);
    this.ticker = null;
  }

  /** Keeps the live step list on its newest step, unless the reader scrolled up in it. */
  private followSteps(): void {
    afterNextRender(
      () => {
        const element = this.stepsBox()?.nativeElement;
        if (element && this.stepsPinned) element.scrollTop = element.scrollHeight;
      },
      { injector: this.injector },
    );
  }

  private scheduleScroll(): void {
    afterNextRender(
      () => {
        if (this.pinned) this.scrollToBottom();
      },
      { injector: this.injector },
    );
  }

  private scrollToBottom(): void {
    const element = this.list()?.nativeElement;
    if (!element) return;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (typeof element.scrollTo === 'function') {
      element.scrollTo({ top: element.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
    } else {
      element.scrollTop = element.scrollHeight;
    }
  }

  private highlight(id: string): void {
    afterNextRender(
      () => {
        const target = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('[data-message-id]')).find(
          (element) => element.dataset['messageId'] === id,
        );
        if (!target) return;
        target.scrollIntoView?.({ block: 'center' });
        this.onScroll();
        target.classList.add('flash');
        setTimeout(() => target.classList.remove('flash'), 1600);
      },
      { injector: this.injector },
    );
  }

  private resizeLater(): void {
    afterNextRender(() => this.resize(this.composer()?.nativeElement), { injector: this.injector });
  }

  private resize(element: HTMLTextAreaElement | undefined = this.composer()?.nativeElement): void {
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }
}
