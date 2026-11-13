import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { LucideAngularModule, Send } from 'lucide-angular';
import type { ChatMessage, ChatResponse, Turn } from '@shared/types';
import type { AlignStatus } from '@shared/types';
import { ApiService, isApiFailure } from '../core/api.service';
import { I18n, type TranslationKey } from '../i18n';
import { HelpersIndicator } from '../chat/helpers-indicator';
import { ChatRich } from '../chat/chat-rich';
import { renderChatMarkdown } from '../chat/chat-markdown';
import { isActiveTurn } from '../chat/chat-state';
import { nestSteps, type StepRow } from '../chat/chat-steps';

/** How often the alignment and its conversation are read while it runs (ms). */
export const ALIGN_POLL_MS = 1500;

/** States in which the alignment is still going on: the page polls and the text box waits. */
export function isAlignLive(status: AlignStatus | null): boolean {
  const state = status?.state;
  return state === 'needed' || state === 'running' || state === 'waiting-answer';
}

/**
 * The modal that shows the assistant aligning the campaign after a framework update. It opens by itself
 * when the alignment is needed or still running (also after a reload), starts it once when it is needed,
 * and follows the conversation read-only. Only a reply to a question can be typed, and only Close ends it.
 */
@Component({
  selector: 'ms-update-align',
  imports: [LucideAngularModule, ChatRich, HelpersIndicator],
  templateUrl: './update-align.html',
  styleUrl: './update-align.css',
})
export class UpdateAlign implements OnInit {
  readonly i18n = inject(I18n);
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  readonly icons = { Send };
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  /** The last alignment state from the server. Null until the first read answers. */
  readonly status = signal<AlignStatus | null>(null);
  /** True while the modal is shown. Closed for this session by Close, never sent anywhere. */
  readonly visible = signal(false);
  /** The conversation that shows the alignment, as last read. */
  readonly chat = signal<ChatResponse | null>(null);
  readonly draft = signal('');
  readonly sending = signal(false);
  readonly sendError = signal<string | null>(null);

  readonly state = computed(() => this.status()?.state ?? 'none');
  readonly waiting = computed(() => this.state() === 'waiting-answer');
  readonly finished = computed(() => this.state() === 'done' || this.state() === 'failed');
  /** The text box takes a reply only while the assistant waits for an answer. */
  readonly canType = computed(() => this.waiting() && !this.sending());
  readonly canSend = computed(() => this.canType() && this.draft().trim().length > 0);
  /** The plain line under the text box. Empty once the alignment has finished. */
  readonly hint = computed(() => {
    if (this.waiting()) return this.i18n.t('update.align.answer');
    if (this.finished()) return '';
    return this.i18n.t('update.align.working');
  });
  readonly finalText = computed(() =>
    this.state() === 'done' ? this.i18n.t('update.align.done') : this.i18n.t('update.align.failed'),
  );
  /** Only the assistant's messages are shown: the written prompt is hidden. */
  readonly agentMessages = computed<ChatMessage[]>(() =>
    (this.chat()?.messages ?? []).filter((message) => message.role === 'agent'),
  );
  readonly activeTurn = computed<Turn | null>(() => {
    const turn = this.chat()?.turn ?? null;
    return isActiveTurn(turn) ? turn : null;
  });
  readonly stepRows = computed<StepRow[]>(() => nestSteps(this.activeTurn()?.steps ?? []));
  /** The line of the running work: the latest running step, else the turn's activity. */
  readonly activityLine = computed(() => {
    const turn = this.activeTurn();
    if (!turn) return '';
    const running = [...(turn.steps ?? [])].reverse().find((step) => step.state === 'running');
    return running?.text || turn.activity || this.i18n.t('chat.working');
  });

  private timer: ReturnType<typeof setTimeout> | null = null;
  private dismissed = false;
  /** The start is asked once per opening: a failed start is not asked again by the polling. */
  private startAsked = false;
  private returnFocus: HTMLElement | null = null;

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => {
      this.dismissed = true;
      this.clearTimer();
    });
    void this.refresh();
  }

  /**
   * Reads the alignment, starts it when it is needed (once), reads its conversation and polls on while it
   * is live. The modal opens for needed, running and waiting states; a finished state keeps it open.
   */
  async refresh(): Promise<void> {
    this.clearTimer();
    if (this.dismissed) return;

    const read = await this.readStatus();
    if (read) this.status.set(read);

    if (this.state() === 'needed' && !this.startAsked) {
      this.startAsked = true;
      await this.startAlignment();
    }

    // Opened for a needed alignment too, so a start that fails still shows its sentence.
    if (isAlignLive(this.status()) || this.startAsked) this.open();
    if (!this.visible()) return;

    const conversationId = this.status()?.conversationId ?? null;
    if (conversationId !== null) await this.loadChat(conversationId);
    if (!this.dismissed && isAlignLive(this.status())) this.schedule();
  }

  /** Sends a reply to the question of the assistant. No model, no effort, no topic: the server fixes them. */
  async send(): Promise<void> {
    const conversationId = this.status()?.conversationId ?? null;
    const text = this.draft().trim();
    if (!this.canSend() || conversationId === null) return;
    this.sending.set(true);
    this.sendError.set(null);
    try {
      await this.api.sendMessage(text, {}, conversationId);
      this.draft.set('');
      await this.refresh();
    } catch (failure) {
      this.sendError.set(isApiFailure(failure) ? failure.error : this.i18n.t('errors.generic'));
    } finally {
      this.sending.set(false);
    }
  }

  /** Close: only in the done and failed states. Hides the modal for this session and sends nothing. */
  close(): void {
    if (!this.visible() || !this.finished()) return;
    this.dismissed = true;
    this.clearTimer();
    this.visible.set(false);
    this.returnFocus?.focus();
  }

  /** Escape closes only when the alignment has finished; while it runs the modal stays. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  /** Keeps the Tab focus inside the modal while it is open. */
  @HostListener('document:keydown.tab', ['$event'])
  onTab(event: Event): void {
    if (!this.visible()) return;
    const panel = this.panel()?.nativeElement;
    if (!panel) return;
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>('textarea:not([disabled]), button:not([disabled]), [tabindex="0"]'),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const shift = (event as KeyboardEvent).shiftKey;
    if (!active || !panel.contains(active)) {
      event.preventDefault();
      (shift ? last : first).focus();
    } else if (shift && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!shift && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /** Enter sends, Shift+Enter writes a new line. */
  onComposerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void this.send();
    }
  }

  /** The Markdown of an assistant message as HTML (same rendering as the chat). */
  render(text: string): string {
    return renderChatMarkdown(text);
  }

  t(key: TranslationKey): string {
    return this.i18n.t(key);
  }

  /** Starts the alignment. A refusal (409) re-reads the state; any other failure ends it as failed. */
  private async startAlignment(): Promise<void> {
    try {
      this.status.set(await this.api.startAlign());
      return;
    } catch (failure) {
      if (isApiFailure(failure) && failure.status === 409) {
        const again = await this.readStatus();
        if (again && again.state !== 'needed') {
          this.status.set(again);
          return;
        }
      }
    }
    this.status.set({ state: 'failed', conversationId: null });
  }

  private async readStatus(): Promise<AlignStatus | null> {
    try {
      return await this.api.alignStatus();
    } catch {
      // A failed read keeps the last state: the polling tries again while the alignment is live.
      return null;
    }
  }

  private async loadChat(conversationId: string): Promise<void> {
    try {
      const response = await this.api.chat(conversationId);
      if (this.status()?.conversationId === conversationId) this.chat.set(response);
    } catch {
      // Keep the last messages shown; the next read tries again.
    }
  }

  private open(): void {
    if (this.visible()) return;
    this.returnFocus = document.activeElement as HTMLElement | null;
    this.visible.set(true);
    afterNextRender(() => this.panel()?.nativeElement.focus(), { injector: this.injector });
  }

  private schedule(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, ALIGN_POLL_MS);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
