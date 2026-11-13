import { Injectable, inject, signal } from "@angular/core";
import { I18n } from "../i18n";
import { ChatSource } from "./chat/chat-source";
import type {
  CockpitEvent,
  CockpitSessionSummary,
  CockpitSessionView,
  CockpitAction,
  ActionGroup,
  LayoutItem,
  SourceRef,
} from "@shared/cockpit-types";

/** The cockpit never navigates away: everything it opens is a modal on top of it. */
export type CockpitModal =
  { kind: "document"; source: SourceRef } | { kind: "sessions" } | null;

function latestActiveGroup(history: ActionGroup[]) {
  return history.filter((group) => !group.undone).at(-1) || null;
}

const STORAGE_KEY = "yllir.cockpit.last-session";

/** The short model choices of a live session; the server maps each one to a model id. */
export type LiveModelChoice = "haiku" | "sonnet" | "opus";

/** The short choice of a model id (matched by name); an unknown id counts as Haiku, the default. */
export function modelChoiceOf(modelId: string): LiveModelChoice {
  if (modelId.includes("opus")) return "opus";
  if (modelId.includes("sonnet")) return "sonnet";
  return "haiku";
}

/**
 * Talks to the cockpit API and keeps the open session. The open session has its own
 * event stream (`/api/cockpit/sessions/:id/events`); the browser reconnects it by itself
 * and sends Last-Event-ID, so missed events are replayed.
 */
@Injectable({ providedIn: "root" })
export class CockpitService implements ChatSource {
  session = signal<CockpitSessionView | null>(null);
  sessions = signal<CockpitSessionSummary[]>([]);
  /** False while the browser is reconnecting the session stream. */
  connected = signal(true);
  lastGroup = signal<ActionGroup | null>(null);
  chatError = signal("");
  modal = signal<CockpitModal>(null);
  /** Bumped on every snapshot and state event: views that read other endpoints (the battle screen) refetch on it. */
  readonly stateTick = signal(0);
  private generation = 0;
  private source: EventSource | null = null;
  private readonly i18n = inject(I18n);

  /** The session `/live` should open: the last one used, else the most recent. */
  async defaultSessionId() {
    await this.listSessions();
    let id = "";
    try {
      id = localStorage.getItem(STORAGE_KEY) || "";
    } catch {
      /* storage unavailable */
    }
    if (!this.sessions().some((s) => s.id === id))
      id = this.sessions()[0]?.id || "";
    return id;
  }
  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const r = await fetch(path, init);
    const v = await r.json();
    if (!r.ok) throw new Error(v.error || this.i18n.t("liveAgent.requestFailed", { status: r.status }));
    return v as T;
  }
  async listSessions() {
    this.sessions.set(
      await this.request<CockpitSessionSummary[]>("/api/cockpit/sessions"),
    );
  }
  async create(title: string) {
    const value = await this.request<CockpitSessionView>(
      "/api/cockpit/sessions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      },
    );
    // Only list it: opening a session is a separate step.
    await this.listSessions();
    return value;
  }
  /** Changes the model of the open session; the next turn uses it. */
  async setModel(choice: LiveModelChoice) {
    const s = this.session();
    if (!s) return;
    const value = await this.request<CockpitSessionView>(
      `/api/cockpit/sessions/${encodeURIComponent(s.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: choice }),
      },
    );
    if (this.session()?.id === value.id) this.session.set(value);
  }
  /** Opens a session: loads it, follows its events and remembers it. */
  async select(id: string) {
    if (this.session()?.id === id) return;
    const value = await this.request<CockpitSessionView>(
      `/api/cockpit/sessions/${encodeURIComponent(id)}`,
    );
    this.attach(id, value);
  }
  async delete(id: string) {
    await this.request(`/api/cockpit/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    await this.listSessions();
    if (this.session()?.id === id) this.detach();
  }
  private attach(id: string, initial: CockpitSessionView) {
    const generation = ++this.generation;
    this.session.set(initial);
    this.lastGroup.set(latestActiveGroup(initial.history));
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* storage unavailable */
    }
    this.closeStream();
    if (generation !== this.generation) return;
    const source = new EventSource(
      `/api/cockpit/sessions/${encodeURIComponent(id)}/events`,
    );
    this.source = source;
    source.onopen = () => this.connected.set(true);
    source.onerror = () => this.connected.set(false);
    source.onmessage = (message: MessageEvent) => {
      let event: CockpitEvent;
      try {
        event = JSON.parse(String(message.data)) as CockpitEvent;
      } catch {
        return; // malformed frame
      }
      this.apply(event);
    };
  }
  private closeStream() {
    this.source?.close();
    this.source = null;
  }
  private detach() {
    this.session.set(null);
    this.closeStream();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
  }
  private apply(event: CockpitEvent) {
    if (event.type === "snapshot") {
      this.session.set(event.session);
      this.stateTick.update((n) => n + 1);
      return;
    }
    const current = this.session();
    if (!current) return;
    if (event.type === "state") {
      this.stateTick.update((n) => n + 1);
      this.session.set({
        ...current,
        revision: event.revision,
        state: event.state,
        history: event.history,
      });
      // The undo target is always the latest group still applied, never one just undone.
      // Keep the same object when the group did not change (e.g. a layout-only
      // update): the canvas follows the latest group's cards on identity change.
      const group = latestActiveGroup(event.history);
      const previous = this.lastGroup();
      if (
        group?.id !== previous?.id ||
        group?.actions.length !== previous?.actions.length
      )
        this.lastGroup.set(group);
    } else if (event.type === "message")
      this.session.update((s) =>
        s
          ? {
              ...s,
              messages: [
                ...s.messages.filter((m) => m.id !== event.message.id),
                event.message,
              ],
            }
          : s,
      );
    else if (event.type === "delta")
      this.session.update((s) =>
        s
          ? {
              ...s,
              messages: s.messages.map((m) =>
                m.id === event.messageId
                  ? { ...m, text: m.text + event.text, status: "streaming" }
                  : m,
              ),
            }
          : s,
      );
    else if (event.type === "turn")
      this.session.update((s) =>
        s
          ? {
              ...s,
              turns: [
                ...s.turns.filter((t) => t.id !== event.turn.id),
                event.turn,
              ],
            }
          : s,
      );
    else if (event.type === "open")
      window.dispatchEvent(
        new CustomEvent("cockpit-open", { detail: event.source }),
      );
    else if (event.type === "deleted") {
      this.detach();
      void this.listSessions();
    }
  }
  async send(text: string, clientId: string) {
    const s = this.session();
    if (!s) return;
    return this.request(`/api/cockpit/sessions/${s.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, clientId }),
    });
  }
  async action(...actions: CockpitAction[]) {
    const s = this.session();
    if (!s) return;
    return this.request(`/api/cockpit/sessions/${s.id}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actions }),
    });
  }
  /** Geometry only: persisted without an undo group. */
  async layout(items: LayoutItem[]) {
    const s = this.session();
    if (!s) return;
    return this.request(`/api/cockpit/sessions/${s.id}/layout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
  }
  /** Stores an image in the session folder and returns its file name. */
  async upload(file: File): Promise<string> {
    const s = this.session();
    if (!s) throw new Error(this.i18n.t("liveAgent.noSessionOpen"));
    const value = await this.request<{ name: string }>(
      `/api/cockpit/sessions/${s.id}/files`,
      {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      },
    );
    return value.name;
  }
  async undo(group: ActionGroup) {
    const s = this.session();
    if (!s) return;
    await this.request(`/api/cockpit/sessions/${s.id}/undo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId: group.id }),
    });
  }
  async cancel() {
    const s = this.session();
    const turn =
      s?.turns.find((t) => t.status === "running") ||
      s?.turns.find((t) => t.status === "queued");
    if (s && turn)
      await this.request(
        `/api/cockpit/sessions/${s.id}/turns/${turn.id}/cancel`,
        { method: "POST" },
      );
  }
  destroy() {
    this.generation++;
    this.session.set(null);
    this.closeStream();
  }
}
