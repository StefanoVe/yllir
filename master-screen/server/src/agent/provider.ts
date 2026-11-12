// Agent provider contract, exactly as in API.md. Owner: chat engineer.

export type AgentEvent =
  | { type: 'activity'; text: string }
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
  signal: AbortSignal;
}

export interface AgentProvider {
  run(input: AgentRunInput): AsyncIterable<AgentEvent>;
}
