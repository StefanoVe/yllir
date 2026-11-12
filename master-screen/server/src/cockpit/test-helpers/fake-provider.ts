import type { ProviderId } from "../../../../shared/src/cockpit-types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  Provider,
  ProviderEvent,
  TurnInput,
} from "../providers/provider.js";

export type FakeStep =
  | { type: "event"; event: ProviderEvent }
  | { type: "delay"; ms: number }
  | { type: "callTool"; name: string; arguments: Record<string, unknown> }
  | { type: "error"; message: string }
  | { type: "block" };
export class FakeProvider implements Provider {
  id: ProviderId = "claude";
  defaultModel = "fake-model";
  parallelRuns = 0;
  maxParallelRuns = 0;
  received: TurnInput[] = [];
  runs = 0;
  constructor(
    public steps: FakeStep[] = [],
    public retrySteps?: FakeStep[],
  ) {}
  async status() {
    return { id: this.id, available: true, model: this.defaultModel };
  }
  async *run(
    input: TurnInput,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    this.received.push(input);
    this.runs++;
    const steps =
      this.runs > 1 && this.retrySteps ? this.retrySteps : this.steps;
    this.parallelRuns++;
    this.maxParallelRuns = Math.max(this.maxParallelRuns, this.parallelRuns);
    try {
      for (const step of steps) {
        if (signal.aborted) throw new Error("Annullato");
        if (step.type === "delay") {
          await this.delay(step.ms, signal);
          continue;
        }
        if (step.type === "event") {
          yield step.event;
          continue;
        }
        if (step.type === "error") throw new Error(step.message);
        if (step.type === "block") {
          await new Promise<void>((_resolve, reject) =>
            signal.addEventListener(
              "abort",
              () => reject(new Error("Annullato")),
              { once: true },
            ),
          );
          continue;
        }
        const transport = new StreamableHTTPClientTransport(
          new URL(input.mcp.url),
          {
            requestInit: {
              headers: { Authorization: `Bearer ${input.mcp.token}` },
            },
          },
        );
        const client = new Client({ name: "fake-provider", version: "1.0.0" });
        try {
          await client.connect(transport);
          await client.callTool({ name: step.name, arguments: step.arguments });
        } finally {
          await client.close();
        }
      }
    } finally {
      this.parallelRuns--;
    }
  }
  async close() {}
  private delay(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const finish = () => {
        signal.removeEventListener("abort", abort);
        resolve();
      };
      const timer = setTimeout(finish, ms);
      const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        reject(new Error("Annullato"));
      };
      signal.addEventListener("abort", abort, { once: true });
    });
  }
}
