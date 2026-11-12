import type { ChatEffort, ChatModel, StepKind } from '../../../shared/src/types.js';

// Agent provider contract, exactly as in API.md. Owner: chat engineer.

export type AgentEvent =
  | { type: 'activity'; text: string }
  | { type: 'step'; id: string; kind: StepKind; text: string; parentId?: string }
  | { type: 'step-end'; id: string; ok: boolean }
  | { type: 'delta'; text: string }
  | { type: 'open'; path: string }
  | { type: 'resume'; id: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface AgentRunInput {
  prompt: string;
  cwd: string;
  frameworkRoot: string;
  resumeId?: string;
  /** Model and thinking effort the master chose for this message; absent = SDK default. */
  model?: ChatModel;
  effort?: ChatEffort;
  signal: AbortSignal;
}

export interface AgentProvider {
  run(input: AgentRunInput): AsyncIterable<AgentEvent>;
}
