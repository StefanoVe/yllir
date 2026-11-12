// In-process event bus that feeds the SSE stream (GET /api/events).
// Owner: core engineer. Keeps a ring buffer of the last 500 events for replay after a
// reconnect (Last-Event-ID), writes SSE frames to every subscribed response, and sends a
// comment heartbeat every 15 s. Event names and payloads come from LiveEvent (shared types).
import type { ServerResponse } from 'node:http';
import type { LiveEvent } from '../../shared/src/types.js';

const RING_SIZE = 500;
const RETRY_MS = 3000;
const DEFAULT_HEARTBEAT_MS = 15_000;

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

export interface BusOptions {
  /** Heartbeat interval in milliseconds. Default 15000. Tests use a short one. */
  heartbeatMs?: number;
}

interface StoredEvent {
  id: number;
  frame: string;
}

export class Bus {
  private readonly ring: StoredEvent[] = [];
  private readonly clients = new Set<ServerResponse>();
  private readonly listeners: Array<(count: number) => void> = [];
  private readonly heartbeatMs: number;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastId = 0;

  constructor(opts: BusOptions = {}) {
    this.heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  }

  /** Stores the event in the replay ring buffer and sends it to every client. Returns its id. */
  publish<E extends LiveEvent['event']>(
    event: E,
    data: Extract<LiveEvent, { event: E }>['data'],
  ): number {
    this.lastId += 1;
    const id = this.lastId;
    const frame = `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    this.ring.push({ id, frame });
    if (this.ring.length > RING_SIZE) this.ring.splice(0, this.ring.length - RING_SIZE);
    for (const res of [...this.clients]) {
      this.send(res, frame);
    }
    return id;
  }

  /**
   * Adds an SSE client, replaying events after lastEventId. The caller sends its own
   * `hello` frame; this method sends only the headers, `retry` and the replay.
   */
  subscribe(res: ServerResponse, lastEventId?: string): void {
    res.writeHead(200, SSE_HEADERS);
    if (!this.send(res, `retry: ${RETRY_MS}\n\n`)) return;
    for (const stored of this.replayAfter(lastEventId)) {
      if (!this.send(res, stored.frame)) return;
    }
    this.clients.add(res);
    const drop = (): void => this.drop(res);
    res.on('close', drop);
    res.on('error', drop);
    this.ensureHeartbeat();
    this.notify();
  }

  clientCount(): number {
    return this.clients.size;
  }

  /** Calls cb with the new client count whenever a client connects or disconnects. */
  onClientsChange(cb: (count: number) => void): void {
    this.listeners.push(cb);
  }

  /** Ends every SSE stream and clears the heartbeat. */
  close(): void {
    this.stopHeartbeat();
    const open = [...this.clients];
    this.clients.clear();
    for (const res of open) {
      try {
        res.end();
      } catch {
        // already gone
      }
    }
  }

  /**
   * Events the client has not seen. Nothing is replayed when the id is missing, not a
   * number, ahead of the bus, or older than the ring buffer (events were lost).
   */
  private replayAfter(lastEventId: string | undefined): StoredEvent[] {
    if (lastEventId === undefined || !/^\d+$/.test(lastEventId.trim())) return [];
    const seen = Number(lastEventId.trim());
    if (this.ring.length === 0 || seen >= this.lastId) return [];
    const first = this.ring[0].id;
    if (seen < first - 1) return [];
    return this.ring.filter((stored) => stored.id > seen);
  }

  /** Writes text to one client. A failed write drops that client. */
  private send(res: ServerResponse, text: string): boolean {
    try {
      res.write(text);
      return true;
    } catch {
      this.drop(res);
      return false;
    }
  }

  private drop(res: ServerResponse): void {
    if (this.clients.delete(res)) {
      if (this.clients.size === 0) this.stopHeartbeat();
      this.notify();
    }
  }

  private notify(): void {
    const count = this.clients.size;
    for (const cb of this.listeners) cb(count);
  }

  private ensureHeartbeat(): void {
    if (this.heartbeatTimer !== null) return;
    this.heartbeatTimer = setInterval(() => {
      for (const res of [...this.clients]) {
        this.send(res, ': ping\n\n');
      }
    }, this.heartbeatMs);
    this.heartbeatTimer.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
