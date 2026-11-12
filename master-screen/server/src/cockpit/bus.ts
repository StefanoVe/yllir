import type { CockpitEvent } from "../../../shared/src/cockpit-types.js";
type Item = { id: number; event: CockpitEvent };
type Subscriber = {
  controller: ReadableStreamDefaultController<Uint8Array>;
  syncing: boolean;
  lastSent: number;
  pending: Item[];
};
const EVENT_BUFFER_SIZE = 500;
export class CockpitBus {
  private seq = new Map<string, number>();
  private ring = new Map<string, Item[]>();
  private subscribers = new Map<string, Set<Subscriber>>();
  private timers = new Set<ReturnType<typeof setInterval>>();
  private timerByController = new Map<
    ReadableStreamDefaultController<Uint8Array>,
    ReturnType<typeof setInterval>
  >();
  private closed = false;
  constructor(private heartbeatMs = 15000) {}
  publish(sessionId: string, event: CockpitEvent) {
    if (this.closed) return;
    const id = (this.seq.get(sessionId) || 0) + 1;
    this.seq.set(sessionId, id);
    const list = this.ring.get(sessionId) || [];
    list.push({ id, event });
    if (list.length > EVENT_BUFFER_SIZE)
      list.splice(0, list.length - EVENT_BUFFER_SIZE);
    this.ring.set(sessionId, list);
    this.send(sessionId, { id, event });
  }
  private send(sessionId: string, item: Item) {
    const bytes = new TextEncoder().encode(
      `id: ${item.id}\ndata: ${JSON.stringify(item.event)}\n\n`,
    );
    for (const subscriber of [...(this.subscribers.get(sessionId) || [])]) {
      if (subscriber.syncing) subscriber.pending.push(item);
      else this.sendOne(sessionId, subscriber, item);
    }
  }
  private remove(sessionId: string, subscriber: Subscriber) {
    const timer = this.timerByController.get(subscriber.controller);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(timer);
      this.timerByController.delete(subscriber.controller);
    }
    this.subscribers.get(sessionId)?.delete(subscriber);
    if (!this.subscribers.get(sessionId)?.size)
      this.subscribers.delete(sessionId);
  }
  async subscribe(
    sessionId: string,
    lastEventId: string | null,
    snapshot: () => Promise<CockpitEvent>,
  ): Promise<Response> {
    let subscriber: Subscriber | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start: (c) => {
        subscriber = {
          controller: c,
          syncing: true,
          lastSent: -1,
          pending: [],
        };
        const set = this.subscribers.get(sessionId) || new Set();
        set.add(subscriber);
        this.subscribers.set(sessionId, set);
        const timer = setInterval(() => {
          if (subscriber?.syncing) return;
          try {
            c.enqueue(new TextEncoder().encode(": ping\n\n"));
          } catch {
            if (subscriber) this.remove(sessionId, subscriber);
            clearInterval(timer);
            this.timers.delete(timer);
          }
        }, this.heartbeatMs);
        this.timers.add(timer);
        this.timerByController.set(c, timer);
        void (async () => {
          const current = this.ring.get(sessionId) || [];
          const n =
            lastEventId && /^\d+$/.test(lastEventId)
              ? Number(lastEventId)
              : NaN;
          const first = current[0]?.id;
          const replay =
            Number.isSafeInteger(n) &&
            first !== undefined &&
            n >= first - 1 &&
            n <= (this.seq.get(sessionId) || 0);
          if (replay) {
            for (const item of current)
              if (item.id > n) this.sendOne(sessionId, subscriber!, item);
          } else {
            const snapshotId = this.seq.get(sessionId) || 0;
            const event = await snapshot();
            this.sendOne(sessionId, subscriber!, { id: snapshotId, event });
          }
          subscriber!.syncing = false;
          for (const item of subscriber!.pending)
            this.sendOne(sessionId, subscriber!, item);
          subscriber!.pending = [];
        })().catch(() => {
          if (subscriber) this.remove(sessionId, subscriber);
        });
      },
      cancel: () => {
        if (subscriber) this.remove(sessionId, subscriber);
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  }
  private sendOne(sessionId: string, subscriber: Subscriber, item: Item) {
    if (item.id <= subscriber.lastSent) return;
    try {
      subscriber.controller.enqueue(
        new TextEncoder().encode(
          `id: ${item.id}\ndata: ${JSON.stringify(item.event)}\n\n`,
        ),
      );
      subscriber.lastSent = item.id;
    } catch {
      this.remove(sessionId, subscriber);
    }
  }
  close() {
    this.closed = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers.clear();
    this.timerByController.clear();
    for (const set of this.subscribers.values())
      for (const subscriber of set)
        try {
          subscriber.controller.close();
        } catch {}
    this.subscribers.clear();
  }
}
