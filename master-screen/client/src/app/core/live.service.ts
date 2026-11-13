import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Observable, Subject, filter, map } from 'rxjs';
import type { LiveEvent } from '@shared/types';

const EVENT_NAMES = [
  'hello', 'files', 'changes', 'message', 'delta', 'turn', 'open', 'status', 'live', 'music', 'musicstate',
] as const satisfies readonly LiveEvent['event'][];

export type LiveData<K extends LiveEvent['event']> = Extract<LiveEvent, { event: K }>['data'];

/** Delay before reconnect attempt `attempt` (0-based): 500 ms, doubling, capped at 15 s. */
export function reconnectDelay(attempt: number, baseMs = 500, maxMs = 15_000): number {
  const n = Math.min(Math.max(0, Math.floor(attempt)), 30);
  return Math.min(maxMs, baseMs * 2 ** n);
}

/**
 * The single EventSource on /api/events. It stays open while the tab is hidden.
 * Any drop closes the stream and reconnects with backoff. Because an EventSource
 * cannot send Last-Event-ID after a manual reconnect, `resync$` fires on every
 * reconnect so listeners refetch what they show.
 */
@Injectable({ providedIn: 'root' })
export class LiveService {
  readonly connected = signal(false);

  private readonly events = new Subject<LiveEvent>();
  private readonly resyncs = new Subject<void>();
  /** Emits after every reconnect (not on the first connect): refetch the visible state. */
  readonly resync$: Observable<void> = this.resyncs.asObservable();

  private source: EventSource | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private everConnected = false;

  constructor() {
    this.connect();
    inject(DestroyRef).onDestroy(() => this.close());
  }

  on<K extends LiveEvent['event']>(name: K): Observable<LiveData<K>> {
    return this.events.pipe(
      filter((event): event is Extract<LiveEvent, { event: K }> => event.event === name),
      map((event) => event.data as LiveData<K>),
    );
  }

  private connect(): void {
    if (typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/events');
    this.source = source;
    source.onopen = () => {
      this.attempt = 0;
      this.connected.set(true);
      if (this.everConnected) this.resyncs.next();
      this.everConnected = true;
    };
    source.onerror = () => this.lose();
    for (const name of EVENT_NAMES) {
      source.addEventListener(name, (message) => this.dispatch(name, message as MessageEvent));
    }
  }

  private dispatch(name: (typeof EVENT_NAMES)[number], message: MessageEvent): void {
    let data: unknown;
    try {
      data = JSON.parse(String(message.data));
    } catch {
      return;
    }
    this.events.next({ event: name, data } as LiveEvent);
  }

  private lose(): void {
    this.connected.set(false);
    this.close();
    const delay = reconnectDelay(this.attempt);
    this.attempt += 1;
    this.timer = setTimeout(() => this.connect(), delay);
  }

  private close(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.source?.close();
    this.source = null;
  }
}
