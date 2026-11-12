import { Injectable, inject, signal } from "@angular/core";
import { I18n } from "../../i18n";
import { ChatSource, type ChatThreadView } from "../chat/chat-source";
import type { CockpitEvent, CockpitSessionView } from "@shared/cockpit-types";

/**
 * The agent chat of the combat: a separate server session, the thread of the active
 * combat. It follows the thread's own event stream and shows only what the server sent.
 */
@Injectable()
export class CombatChatService extends ChatSource {
  override readonly session = signal<ChatThreadView | null>(null);
  override readonly chatError = signal("");
  private tableId: string | null = null;
  private source: EventSource | null = null;
  private generation = 0;
  /** The thread being loaded, so repeated binds to it do not start another load. */
  private pending: string | null = null;
  private readonly i18n = inject(I18n);

  /** Follows the given combat thread of the table; a null thread clears the chat. */
  async bind(tableId: string | null, threadId: string | null): Promise<void> {
    this.tableId = tableId;
    if (threadId && (threadId === this.session()?.id || threadId === this.pending)) return;
    const generation = ++this.generation;
    this.closeStream();
    this.pending = threadId;
    this.session.set(null);
    if (!threadId) return;
    const view = await this.request<CockpitSessionView>(
      `/api/cockpit/sessions/${encodeURIComponent(threadId)}`,
    );
    if (generation !== this.generation) return;
    this.pending = null;
    this.session.set({ id: threadId, messages: view.messages, turns: view.turns });
    const source = new EventSource(
      `/api/cockpit/sessions/${encodeURIComponent(threadId)}/events`,
    );
    this.source = source;
    source.onmessage = (message: MessageEvent) => {
      let event: CockpitEvent;
      try {
        event = JSON.parse(String(message.data)) as CockpitEvent;
      } catch {
        return; // malformed frame
      }
      if (source === this.source) this.apply(event);
    };
  }

  /** The id of the combat thread, created by the server when the combat has none yet. */
  async ensureThread(): Promise<string | null> {
    const current = this.session();
    if (current) return current.id;
    if (!this.tableId) return null;
    const { threadId } = await this.request<{ threadId: string }>(
      `/api/cockpit/sessions/${encodeURIComponent(this.tableId)}/combat/thread`,
      { method: "POST" },
    );
    await this.bind(this.tableId, threadId);
    return threadId;
  }

  override async send(text: string, clientId: string): Promise<unknown> {
    const id = await this.ensureThread();
    if (!id) return;
    return this.request<unknown>(
      `/api/cockpit/sessions/${encodeURIComponent(id)}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, clientId }),
      },
    );
  }

  override async cancel(): Promise<void> {
    const s = this.session();
    const turn =
      s?.turns.find((t) => t.status === "running") ||
      s?.turns.find((t) => t.status === "queued");
    if (s && turn)
      await this.request(
        `/api/cockpit/sessions/${encodeURIComponent(s.id)}/turns/${encodeURIComponent(turn.id)}/cancel`,
        { method: "POST" },
      );
  }

  destroy(): void {
    this.generation++;
    this.pending = null;
    this.session.set(null);
    this.closeStream();
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const r = await fetch(path, init);
    const v = (await r.json()) as { error?: string };
    if (!r.ok)
      throw new Error(v.error || this.i18n.t("liveAgent.requestFailed", { status: r.status }));
    return v as T;
  }

  private closeStream() {
    this.source?.close();
    this.source = null;
  }

  private update(change: (s: ChatThreadView) => ChatThreadView) {
    this.session.update((s) => (s ? change(s) : s));
  }

  private apply(event: CockpitEvent) {
    if (event.type === "snapshot") {
      const current = this.session();
      if (current)
        this.session.set({
          id: current.id,
          messages: event.session.messages,
          turns: event.session.turns,
        });
    } else if (event.type === "message")
      this.update((s) => ({
        ...s,
        messages: [...s.messages.filter((m) => m.id !== event.message.id), event.message],
      }));
    else if (event.type === "delta")
      this.update((s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id === event.messageId
            ? { ...m, text: m.text + event.text, status: "streaming" }
            : m,
        ),
      }));
    else if (event.type === "turn")
      this.update((s) => ({
        ...s,
        turns: [...s.turns.filter((t) => t.id !== event.turn.id), event.turn],
      }));
    else if (event.type === "deleted") {
      this.session.set(null);
      this.closeStream();
    }
  }
}
