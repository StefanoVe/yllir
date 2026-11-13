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
import type { ChatMessage, Conversation, ConversationsResponse, StepKind, Turn, TurnStep } from '@shared/types';
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
  Plus,
  Save,
  Search,
  Send,
  Sparkles,
  Square,
  Trash2,
  Users,
} from 'lucide-angular';
import { ApiService, isApiFailure } from '../core/api.service';
import { LiveService } from '../core/live.service';
import { ChatLiveSession } from './chat-live-session';
import { StatusService } from '../core/status.service';
import { PrefsService } from '../core/prefs.service';
import { CampaignTurnService } from '../core/campaign-turn.service';
import { I18n, type TranslationKey } from '../i18n';
import { formatRelative } from '../changes/relative-time';
import {
  ChatState,
  EMPTY_CHAT_STATE,
  addMessage,
  applyDelta,
  emptyStateFor,
  isActiveTurn,
  isFailedTurn,
  mergeFetched,
  setTurn,
} from './chat-state';
import { CONVERSATION_PREF_KEY, displayTitle, pickSelectedId } from './conversations';
import { HelpersIndicator } from './helpers-indicator';
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
  imports: [LucideAngularModule, NgTemplateOutlet, RouterLink, ChatRich, HelpersIndicator],
  templateUrl: './chat.html',
  styleUrl: './chat.css',
})
export class Chat implements OnInit {
  readonly i18n = inject(I18n);
  private readonly api = inject(ApiService);
  private readonly live = inject(LiveService);
  private readonly liveSession = inject(ChatLiveSession);
  private readonly statusService = inject(StatusService);
  private readonly prefs = inject(PrefsService);
  private readonly campaignTurns = inject(CampaignTurnService);
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
    Plus,
    Save,
    Trash2,
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
  /** All conversations of the campaign, newest first. */
  readonly conversations = signal<Conversation[]>([]);
  /** The queued or running turn of the whole campaign, whatever its conversation (kept by CampaignTurnService). */
  readonly campaignTurn = this.campaignTurns.turn;
  /** True from the moment another conversation is picked until its history has loaded. */
  readonly switching = signal(false);
  /** Whether the conversation list popover is open. */
  readonly listOpen = signal(false);
  /** The row whose delete confirmation is shown, if any. */
  readonly pendingDelete = signal<string | null>(null);
  /** The conversation whose deletion is in progress, if any. */
  readonly deleting = signal<string | null>(null);
  readonly listError = signal<string | null>(null);
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
  /** True once the master picked a conversation: a saved choice that arrives late no longer overrides it. */
  private userChose = false;

  readonly agent = computed(() => this.statusService.status()?.agent ?? null);
  readonly agentAvailable = computed(() => this.agent()?.available === true);
  /** The conversation shown, or null before the first load has picked one. */
  readonly shownId = computed(() => this.state().conversationId);
  readonly shownTitle = computed(() => {
    const id = this.shownId();
    const found = this.conversations().find((conversation) => conversation.id === id);
    return displayTitle(found?.title, this.t('chat.conversations.untitled'));
  });
  readonly canSend = computed(
    () =>
      this.agentAvailable() &&
      this.shownId() !== null &&
      !this.switching() &&
      this.draft().trim().length > 0 &&
      !this.sending(),
  );
  /**
   * The shown conversation waits for a turn of another conversation. The shown one is queued and
   * the campaign's running turn belongs to a different conversation.
   */
  readonly queuedElsewhere = computed(() => {
    const shown = this.activeTurn();
    const busy = this.campaignTurn();
    if (shown?.state !== 'queued' || !isActiveTurn(busy) || busy.id === shown.id) return false;
    return busy.conversationId !== undefined && busy.conversationId !== this.shownId();
  });
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
    // The saved conversation needs the campaign slug, which arrives with the status: restore it then,
    // unless the master has already picked another conversation.
    effect(() => {
      const slug = this.prefs.slug();
      untracked(() => this.restoreSavedAfterSlug(slug));
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
      .subscribe((message) => this.update((s) => addMessage(s, message)));
    this.live
      .on('delta')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((delta) => this.update((s) => applyDelta(s, delta, new Date().toISOString())));
    this.live
      .on('turn')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((turn) => this.update((s) => setTurn(s, turn)));
    this.live
      .on('conversations')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.refresh());
    this.live
      .on('open')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ path }) => void this.router.navigateByUrl(docUrl(path)));
    this.live.resync$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.refresh());
    void this.refresh();
  }

  /**
   * Reloads the conversation list and the campaign's turn, then makes sure the shown conversation
   * is still there (else it picks one) and loads its history.
   */
  async refresh(): Promise<void> {
    let list: ConversationsResponse;
    try {
      list = await this.api.conversations();
    } catch {
      this.listError.set(this.i18n.t('chat.conversations.loadError'));
      this.loaded.set(true);
      this.switching.set(false);
      return;
    }
    this.conversations.set(list.conversations);
    this.listError.set(null);

    const shown = this.shownId();
    const stillThere = shown !== null && list.conversations.some((conversation) => conversation.id === shown);
    if (!stillThere) this.enter(pickSelectedId(list.conversations, this.savedConversationId(), list.currentId));
    await this.load();
  }

  /**
   * Loads the history of the shown conversation. Shown messages that the server does not list yet are
   * kept. A response that arrives after the master picked another conversation is dropped.
   */
  async load(): Promise<void> {
    const id = this.shownId();
    if (id === null) return;
    try {
      const response = await this.api.chat(id);
      if (this.shownId() !== id) return;
      this.update((s) => mergeFetched(s, response));
      this.loadError.set(null);
    } catch {
      if (this.shownId() !== id) return;
      this.loadError.set(this.i18n.t('chat.loadError'));
    } finally {
      if (this.shownId() === id) {
        this.loaded.set(true);
        this.switching.set(false);
        this.scheduleScroll();
      }
    }
  }

  /** Sends the draft to the shown conversation. The composer is cleared and the bubble shown only once the server accepted it. */
  async send(): Promise<void> {
    const conversationId = this.shownId();
    if (!this.canSend() || conversationId === null) return;
    const sent = this.draft();
    const text = sent.trim();
    this.sending.set(true);
    this.sendError.set(null);
    try {
      await this.api.sendMessage(text, this.choice(), conversationId);
      if (this.draft() === sent) this.draft.set('');
      this.resizeLater();
      void this.refresh();
    } catch (failure) {
      this.sendError.set((isApiFailure(failure) ? failure.error : this.i18n.t('errors.generic')));
    } finally {
      this.sending.set(false);
    }
  }

  /** Makes `id` the shown conversation: the shown state is reset, the history is loaded by the caller. */
  private enter(id: string): void {
    if (id === this.shownId()) return;
    this.state.set(emptyStateFor(id));
    this.loaded.set(false);
    this.switching.set(true);
    this.pinned = true;
    this.jumpVisible.set(false);
    this.prefs.set(CONVERSATION_PREF_KEY, id);
  }

  private savedConversationId(): string | null {
    return this.prefs.get(CONVERSATION_PREF_KEY);
  }

  /**
   * Called when the campaign slug becomes known. The first load may have run before it, so the saved
   * conversation was not read: it is shown now, when it is still listed and the master has not picked one.
   */
  private restoreSavedAfterSlug(slug: string | null): void {
    if (slug === null || this.userChose) return;
    const saved = this.savedConversationId();
    if (saved === null || saved === this.shownId()) return;
    if (!this.conversations().some((conversation) => conversation.id === saved)) return;
    this.enter(saved);
    void this.load();
  }

  /** Shows another conversation picked from the list. */
  select(id: string): void {
    this.userChose = true;
    this.closeList(true);
    if (id === this.shownId()) return;
    this.enter(id);
    void this.load();
  }

  /** Creates a conversation and shows it. */
  async createConversation(): Promise<void> {
    this.userChose = true;
    this.listError.set(null);
    try {
      const created = await this.api.createConversation();
      this.conversations.update((list) => [created, ...list.filter((conversation) => conversation.id !== created.id)]);
      this.closeList(true);
      this.enter(created.id);
      await this.load();
    } catch (failure) {
      this.listError.set(isApiFailure(failure) ? failure.error : this.i18n.t('errors.generic'));
    }
  }

  /** Deletes a conversation after the inline confirmation. The server cancels its turns; the shown one is replaced by the server's current one. */
  async deleteConversation(id: string): Promise<void> {
    this.deleting.set(id);
    this.listError.set(null);
    try {
      await this.api.deleteConversation(id);
      const wasShown = id === this.shownId();
      const list = await this.api.conversations();
      this.conversations.set(list.conversations);
      this.pendingDelete.set(null);
      if (wasShown) {
        this.enter(list.currentId);
        await this.load();
      }
    } catch (failure) {
      this.listError.set(isApiFailure(failure) ? failure.error : this.i18n.t('errors.generic'));
    } finally {
      this.deleting.set(null);
    }
  }

  /** The title shown on a row of the list. */
  titleOf(conversation: Conversation): string {
    return displayTitle(conversation.title, this.t('chat.conversations.untitled'));
  }

  relativeOf(conversation: Conversation): string {
    return formatRelative(conversation.updatedAt, Date.now(), this.i18n.language());
  }

  toggleList(): void {
    if (this.listOpen()) {
      this.closeList(true);
      return;
    }
    this.listError.set(null);
    this.pendingDelete.set(null);
    this.listOpen.set(true);
    afterNextRender(() => this.focusCurrentItem(), { injector: this.injector });
  }

  /** Closes the list. Focus goes back to its button when `restoreFocus` is set. */
  closeList(restoreFocus: boolean): void {
    if (!this.listOpen()) return;
    this.listOpen.set(false);
    this.pendingDelete.set(null);
    if (restoreFocus) this.host.nativeElement.querySelector<HTMLElement>('[data-conv-trigger]')?.focus();
  }

  askDelete(id: string): void {
    this.pendingDelete.set(id);
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>('[data-conv-cancel]')?.focus(),
      { injector: this.injector },
    );
  }

  cancelDelete(): void {
    const id = this.pendingDelete();
    this.pendingDelete.set(null);
    if (id === null) return;
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>(`[data-conv-del="${id}"]`)?.focus(),
      { injector: this.injector },
    );
  }

  /** Escape cancels a pending delete first, then closes the list. Arrow keys, Home and End move between its buttons. */
  onConversationKeydown(event: KeyboardEvent): void {
    if (!this.listOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.pendingDelete() !== null) this.cancelDelete();
      else this.closeList(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = this.conversationItems();
    const at = items.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case 'ArrowDown':
        items[at < 0 ? 0 : Math.min(at + 1, items.length - 1)]?.focus();
        break;
      case 'ArrowUp':
        items[at <= 0 ? 0 : at - 1]?.focus();
        break;
      case 'Home':
        items[0]?.focus();
        break;
      case 'End':
        items[items.length - 1]?.focus();
        break;
    }
    event.preventDefault();
  }

  /** A click or tap outside the conversation bar closes the list. */
  @HostListener('document:pointerdown', ['$event'])
  onConversationPointerDown(event: Event): void {
    if (!this.listOpen()) return;
    const target = event.target;
    if (target instanceof Element && target.closest('.conv')) return;
    this.closeList(false);
  }

  private conversationItems(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('.conv-pop button:not([disabled])'));
  }

  /** Focus goes to the shown conversation's row when the list opens, else to its first button. */
  private focusCurrentItem(): void {
    const current = this.host.nativeElement.querySelector<HTMLElement>(`.conv-pop [aria-current="true"]`);
    (current ?? this.conversationItems()[0])?.focus();
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
