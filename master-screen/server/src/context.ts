// Shared context of the server: campaign and framework folders, port, event bus and
// shutdown hooks. Created once per process by index.ts. Owner: server skeleton.
import path from 'node:path';
import { Bus } from './bus.js';

export interface AgentStatus {
  available: boolean;
  reason?: string;
}

export interface Ctx {
  campaignRoot: string;
  frameworkRoot: string;
  port: number;
  bus: Bus;
  log(msg: string): void;
  state: { dir: string };
  /** Whether the agent can run; the reason is plain language in the campaign language. */
  agentStatus(): AgentStatus;
  /** Asks the process to shut down gracefully (used by POST /api/shutdown). */
  requestShutdown(): void;
  /** Registers a cleanup that runs once at shutdown, last registered first. */
  onClose(fn: () => void | Promise<void>): void;
  /** Runs the registered cleanups. Errors are logged, never thrown. */
  closeAll(): Promise<void>;
}

export interface CreateCtxOptions {
  campaignRoot: string;
  frameworkRoot: string;
  port: number;
  log?: (msg: string) => void;
  agentStatus?: () => AgentStatus;
  requestShutdown?: () => void;
}

export function createCtx(opts: CreateCtxOptions): Ctx {
  const log = opts.log ?? ((msg: string) => process.stderr.write(`${msg}\n`));
  const closers: Array<() => void | Promise<void>> = [];
  return {
    campaignRoot: opts.campaignRoot,
    frameworkRoot: opts.frameworkRoot,
    port: opts.port,
    bus: new Bus(),
    log,
    state: { dir: path.join(opts.campaignRoot, '.campaign', 'state', 'master-screen') },
    agentStatus: opts.agentStatus ?? (() => ({ available: false, reason: 'Not configured' })),
    requestShutdown: opts.requestShutdown ?? (() => {}),
    onClose(fn) {
      closers.push(fn);
    },
    async closeAll() {
      while (closers.length > 0) {
        const fn = closers.pop();
        try {
          await fn?.();
        } catch (err) {
          log(`cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    },
  };
}
