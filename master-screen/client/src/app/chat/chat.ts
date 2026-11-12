import {
  Component,
  DestroyRef,
  ElementRef,
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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import type { ChatMessage, ChatResponse, Turn } from '@shared/types';
import { LucideAngularModule, ArrowDown, Dices, Send, Square } from 'lucide-angular';
import { ApiService, isApiFailure } from '../core/api.service';
import { LiveService } from '../core/live.service';
import { LiveStateService } from '../live/live-api.service';
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

/** Distance from the bottom (px) under which the list still follows new messages. */
const NEAR_BOTTOM_PX = 48;
const EXAMPLE_KEYS: readonly TranslationKey[] = ['chat.example.1', 'chat.example.2', 'chat.example.3'];

/** The conversation with the assistant: messages, composer and the status line of the current turn. */
@Component({
  selector: 'ms-chat',
  imports: [LucideAngularModule, RouterLink],
  templateUrl: './chat.html',
  styleUrl: './chat.css',
})
export class Chat implements OnInit {
  readonly i18n = inject(I18n);
  private readonly api = inject(ApiService);
  private readonly live = inject(LiveService);
  private readonly liveState = inject(LiveStateService);
  private readonly statusService = inject(StatusService);
  private readonly router = inject(Router);
  private readonly focus = inject(FocusMessageService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly icons = { ArrowDown, Dices, Send, Square };
  /** True while a live session is open: the header then links to the live table. */
  readonly liveOpen = computed(() => this.liveState.session() !== null);
  readonly examples = EXAMPLE_KEYS;

  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  private readonly composer = viewChild<ElementRef<HTMLTextAreaElement>>('composer');

  readonly state = signal<ChatState>(EMPTY_CHAT_STATE);
  readonly loaded = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly draft = signal('');
  readonly sending = signal(false);
  readonly sendError = signal<string | null>(null);
  readonly stopError = signal<string | null>(null);
  readonly jumpVisible = signal(false);

  readonly agent = computed(() => this.statusService.status()?.agent ?? null);
  readonly agentAvailable = computed(() => this.agent()?.available === true);
  readonly canSend = computed(
    () => this.agentAvailable() && this.draft().trim().length > 0 && !this.sending(),
  );
  readonly messages = computed(() => this.state().messages);
  readonly activeTurn = computed<Turn | null>(() => {
    const turn = this.state().turn;
    return isActiveTurn(turn) ? turn : null;
  });
  readonly failedTurn = computed<Turn | null>(() => {
    const turn = this.state().turn;
    return isFailedTurn(turn) ? turn : null;
  });

  /** False while the reader has scrolled up: new messages do not move the view. */
  private pinned = true;

  constructor() {
    // A click on a change in the changes panel scrolls to its message and highlights it.
    effect(() => {
      const request = this.focus.request();
      if (request) untracked(() => this.highlight(request.id));
    });
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
      await this.api.sendMessage(text);
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

  private update(change: (state: ChatState) => ChatState): void {
    this.state.update(change);
    this.scheduleScroll();
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
