import type { Signal, WritableSignal } from "@angular/core";
import type { ChatMessage, Turn } from "@shared/cockpit-types";

/** What the chat shows and does: the table session or a combat thread. */
export interface ChatThreadView {
  id: string;
  messages: ChatMessage[];
  turns: Turn[];
}

/** The thread a chat component talks to. The table provides CockpitService, the combat overlay its own thread. */
export abstract class ChatSource {
  abstract readonly session: Signal<ChatThreadView | null>;
  abstract readonly chatError: WritableSignal<string>;
  abstract send(text: string, clientId: string): Promise<unknown>;
  abstract cancel(): Promise<void>;
}
