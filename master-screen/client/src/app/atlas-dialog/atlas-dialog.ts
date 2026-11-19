import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Injector,
  afterNextRender,
  computed,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { LucideAngularModule, Send } from 'lucide-angular';
import type { AtlasStatus, ChatMessage, ChatResponse, Turn } from '@shared/types';
import { AtlasApiService } from '../atlas/atlas-api.service';
import { ApiService, isApiFailure } from '../core/api.service';
import { I18n, type TranslationKey } from '../i18n';
import { HelpersIndicator } from '../chat/helpers-indicator';
import { ChatRich } from '../chat/chat-rich';
import { renderChatMarkdown } from '../chat/chat-markdown';
import { isActiveTurn } from '../chat/chat-state';
import { nestSteps, type StepRow } from '../chat/chat-steps';

/** How often the atlas status and its conversation are read while it runs (ms). */
export const ATLAS_DIALOG_POLL_MS = 1500;

/** States in which the atlas assistant is still working: the dialog polls and may wait for an answer. */
export function isAtlasGenerating(status: AtlasStatus | null): boolean {
  const state = status?.generation.state;
  return state === 'running' || state === 'waiting-answer';
}

/**
 * The popup that follows the assistant creating or updating the atlas. It opens when the page starts a
 * generation, follows the conversation read-only, and takes a reply only while the assistant asks a question.
 * Closing it does not stop the generation: the page shows the atlas later and can open the popup again.
 */
@Component({
  selector: 'ms-atlas-dialog',
  imports: [LucideAngularModule, ChatRich, HelpersIndicator],
  templateUrl: './atlas-dialog.html',
  styleUrl: './atlas-dialog.css',
})
export class AtlasDialog {
  readonly i18n = inject(I18n);
  private readonly api = inject(ApiService);
  private readonly atlasApi = inject(AtlasApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  readonly icons = { Send };
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  /** True while the popup is shown. Reported to the page so it can show the state behind it. */
  readonly visible = signal(false);
  readonly visibleChange = output<boolean>();

  /** The atlas state, as last read. Null until the first read answers. */
  readonly status = signal<AtlasStatus | null>(null);
  readonly conversationId = signal<string | null>(null);
  /** The conversation that shows the work, as last read. */
  readonly chat = signal<ChatResponse | null>(null);
  readonly draft = signal('');
  readonly sending = signal(false);
  readonly sendError = signal<string | null>(null);
  /** Counts the turns that ended; the preview image URL changes with it, so the browser fetches it again. */
  readonly previewVersion = signal(0);
  /** True while the preview image cannot be shown (no preview yet): the image is left out. */
  readonly previewMissing = signal(false);

  readonly state = computed(() => this.status()?.generation.state ?? 'idle');
  readonly waiting = computed(() => this.state() === 'waiting-answer');
  readonly finished = computed(() => this.state() === 'done' || this.state() === 'failed');
  readonly canSend = computed(() => this.waiting() && !this.sending() && this.draft().trim().length > 0);
  readonly hint = computed(() => {
    if (this.waiting()) return this.i18n.t('atlas.dialog.answer');
    if (this.finished()) return '';
    return this.i18n.t('atlas.dialog.working');
  });
  readonly finalText = computed(() =>
    this.state() === 'done' ? this.i18n.t('atlas.dialog.done') : this.i18n.t('atlas.dialog.failed'),
  );
  readonly previewSrc = computed(() => this.atlasApi.previewUrl(this.previewVersion()));
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
  private destroyed = false;
  private wasTurnActive = false;
  private lastState: string | null = null;
  private returnFocus: HTMLElement | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.clearTimer();
    });
  }

  /** Shows the popup and follows the atlas assistant from now on. */
  open(): void {
    if (this.destroyed || this.visible()) return;
    this.returnFocus = document.activeElement as HTMLElement | null;
    this.previewMissing.set(false);
    this.previewVersion.update((version) => version + 1);
    this.visible.set(true);
    this.visibleChange.emit(true);
    afterNextRender(() => this.panel()?.nativeElement.focus(), { injector: this.injector });
    void this.refresh();
  }

  /**
   * Reads the atlas state and its conversation, and polls on while the assistant works. A finished
   * turn or a finished generation refreshes the preview image.
   */
  async refresh(): Promise<void> {
    this.clearTimer();
    if (this.destroyed || !this.visible()) return;

    const read = await this.readStatus();
    if (read) this.status.set(read);
    if (!this.visible()) return;

    const state = this.state();
    if (this.lastState !== null && state !== this.lastState && this.finished()) this.bumpPreview();
    this.lastState = state;

    const conversationId = this.status()?.generation.conversationId ?? this.conversationId();
    if (conversationId !== null) {
      this.conversationId.set(conversationId);
      await this.loadChat(conversationId);
    }
    if (!this.visible() || this.destroyed) return;
    if (isAtlasGenerating(this.status())) this.schedule();
  }

  /** Sends a reply to the question of the assistant. No model, no effort: the server fixes them. */
  async send(): Promise<void> {
    const conversationId = this.conversationId();
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

  /** Closes the popup. The generation goes on on the server. */
  close(): void {
    if (!this.visible()) return;
    this.clearTimer();
    this.visible.set(false);
    this.visibleChange.emit(false);
    this.returnFocus?.focus();
  }

  /** Escape closes the popup at any time: closing never stops the generation. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  /** Keeps the Tab focus inside the popup while it is open. */
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

  private async readStatus(): Promise<AtlasStatus | null> {
    try {
      return await this.atlasApi.status();
    } catch {
      // A failed read keeps the last state: the polling tries again while the atlas is being made.
      return null;
    }
  }

  private async loadChat(conversationId: string): Promise<void> {
    try {
      const response = await this.api.chat(conversationId);
      if (this.conversationId() !== conversationId) return;
      this.chat.set(response);
      // A turn that was running and is not any more has ended: the map may have changed.
      const turnActive = isActiveTurn(response.turn ?? null);
      if (this.wasTurnActive && !turnActive) this.bumpPreview();
      this.wasTurnActive = turnActive;
    } catch {
      // Keep the last messages shown; the next read tries again.
    }
  }

  private bumpPreview(): void {
    this.previewMissing.set(false);
    this.previewVersion.update((version) => version + 1);
  }

  private schedule(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, ATLAS_DIALOG_POLL_MS);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
