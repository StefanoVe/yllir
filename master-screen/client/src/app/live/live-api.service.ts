import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Board, DocResponse, LiveSnapshot, SearchResponse } from '@shared/types';
import { isApiFailure } from '../core/api.service';
import { LiveService } from '../core/live.service';
import { I18n, type TranslationKey } from '../i18n';
import { isLiveFailure, type LiveFailure } from './live-types';

type Method = 'GET' | 'POST' | 'PUT';

/** Typed calls for the live endpoints (master-screen/API.md, "Live session"). Errors reject with a LiveFailure. */
@Injectable({ providedIn: 'root' })
export class LiveApi {
  private readonly i18n = inject(I18n);

  snapshot(): Promise<LiveSnapshot> {
    return this.request('GET', '/live');
  }

  open(input: { title?: string; sessionRef?: string } = {}): Promise<LiveSnapshot> {
    return this.request('POST', '/live/open', { body: input });
  }

  end(): Promise<LiveSnapshot> {
    return this.request('POST', '/live/end');
  }

  /** Full replacement. The server answers 409 with the current board when the revision is stale. */
  saveBoard(board: Board): Promise<{ board: Board }> {
    return this.request('PUT', '/live/board', { body: board });
  }

  readDoc(path: string): Promise<DocResponse> {
    return this.request('GET', '/docs/read', { query: { path, view: 'master' } });
  }

  search(query: string): Promise<SearchResponse> {
    return this.request('GET', '/search', { query: { q: query, view: 'master' } });
  }

  private async request<T>(
    method: Method,
    path: string,
    options: { query?: Record<string, string>; body?: unknown } = {},
  ): Promise<T> {
    const search = new URLSearchParams(options.query ?? {});
    const qs = search.toString();
    const url = `/api${path}${qs ? `?${qs}` : ''}`;
    const hasBody = options.body !== undefined;

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: hasBody ? { 'content-type': 'application/json' } : undefined,
        body: hasBody ? JSON.stringify(options.body) : undefined,
        cache: 'no-store',
      });
    } catch {
      throw this.failure(this.i18n.t('errors.network' as TranslationKey), 0);
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const body = (typeof payload === 'object' && payload !== null ? payload : {}) as {
        error?: unknown;
        message?: unknown;
        board?: unknown;
      };
      const message =
        typeof body.error === 'string'
          ? body.error
          : typeof body.message === 'string'
            ? body.message
            : (this.i18n.t('errors.generic' as TranslationKey));
      const board = typeof body.board === 'object' && body.board !== null ? (body.board as Board) : undefined;
      throw this.failure(message, response.status, board);
    }
    return payload as T;
  }

  private failure(error: string, status: number, board?: Board): LiveFailure {
    return board === undefined ? { error, status } : { error, status, board };
  }
}

/** Message to show for any rejected call. */
export function failureText(value: unknown, fallback: string): string {
  if (isLiveFailure(value) || isApiFailure(value)) return value.error;
  return fallback;
}

/**
 * The live session state: snapshot, board (server-confirmed) and busy flag.
 * Refetches on the `live` event and after every reconnect. No optimistic updates.
 */
@Injectable({ providedIn: 'root' })
export class LiveStateService {
  private readonly api = inject(LiveApi);
  private readonly live = inject(LiveService);
  private readonly i18n = inject(I18n);

  readonly snapshot = signal<LiveSnapshot | null>(null);
  /** Board as the server last confirmed it (after a load, a save or a conflict). */
  readonly board = signal<Board | null>(null);
  readonly session = computed(() => this.snapshot()?.session ?? null);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.live.on('live').pipe(takeUntilDestroyed(destroyRef)).subscribe(() => void this.load());
    this.live.resync$.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => void this.load());
    void this.load();
  }

  async load(): Promise<void> {
    try {
      this.apply(await this.api.snapshot());
      this.error.set(null);
    } catch (failure) {
      this.error.set(failureText(failure, this.i18n.t('errors.network' as TranslationKey)));
    }
  }

  async open(title?: string): Promise<void> {
    await this.run(() => this.api.open(title ? { title } : {}));
  }

  async end(): Promise<void> {
    await this.run(() => this.api.end());
  }

  /** Saves the whole board. Resolves with the server's board; rejects with a LiveFailure. */
  async saveBoard(board: Board): Promise<Board> {
    try {
      const { board: saved } = await this.api.saveBoard(board);
      this.board.set(saved);
      return saved;
    } catch (failure) {
      if (isLiveFailure(failure) && failure.board) this.board.set(failure.board);
      throw failure;
    }
  }

  private async run(call: () => Promise<LiveSnapshot>): Promise<void> {
    this.busy.set(true);
    try {
      this.apply(await call());
      this.error.set(null);
    } catch (failure) {
      this.error.set(failureText(failure, this.i18n.t('errors.generic' as TranslationKey)));
    } finally {
      this.busy.set(false);
    }
  }

  private apply(next: LiveSnapshot): void {
    this.snapshot.set(next);
    this.board.set(next.board);
  }
}
