import type { ProviderId, ProviderStatus } from "../../../../shared/src/cockpit-types.js";

export interface TurnInput {
  sessionId: string;
  turnId: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  mcp: { url: string; token: string };
  resume?: string;
}

export type ProviderEvent =
  | { type: "thinking" }
  | { type: "text"; text: string }
  | { type: "tool"; name: string }
  | { type: "session"; id: string };

export interface Provider {
  id: ProviderId;
  defaultModel: string;
  status(): Promise<ProviderStatus>;
  run(input: TurnInput, signal: AbortSignal): AsyncIterable<ProviderEvent>;
  close(): Promise<void>;
}
