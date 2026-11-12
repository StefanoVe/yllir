import { Injectable, inject } from '@angular/core';
import type {
  ChangesResponse,
  ChatResponse,
  ChecksResponse,
  DiffResponse,
  DocResponse,
  DocsResponse,
  SearchResponse,
  StatusResponse,
  UndoResponse,
} from '@shared/types';
import { I18n } from '../i18n';
import type { ViewMode } from './view-mode.service';

/** A failed call. `error` is plain language: the server's `error` (or its `message` when that is what it sent). */
export interface ApiFailure {
  error: string;
  status: number;
  message?: string;
}

export function isApiFailure(value: unknown): value is ApiFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ApiFailure).error === 'string' &&
    typeof (value as ApiFailure).status === 'number'
  );
}

type Query = Record<string, string | number | undefined>;

/** Typed client for every endpoint of the master screen API (see master-screen/API.md). */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly i18n = inject(I18n);

  status(): Promise<StatusResponse> {
    return this.request('GET', '/status');
  }

  docs(): Promise<DocsResponse> {
    return this.request('GET', '/docs');
  }

  readDoc(path: string, view: ViewMode = 'master'): Promise<DocResponse> {
    return this.request('GET', '/docs/read', { query: { path, view } });
  }

  search(q: string, view: ViewMode = 'master'): Promise<SearchResponse> {
    return this.request('GET', '/search', { query: { q, view } });
  }

  changes(limit = 30): Promise<ChangesResponse> {
    return this.request('GET', '/changes', { query: { limit } });
  }

  changeDiff(id: string): Promise<DiffResponse> {
    return this.request('GET', `/changes/${encodeURIComponent(id)}/diff`);
  }

  undo(id?: string): Promise<UndoResponse> {
    return this.request('POST', '/changes/undo', { body: id ? { id } : {} });
  }

  chat(): Promise<ChatResponse> {
    return this.request('GET', '/chat');
  }

  sendMessage(text: string): Promise<{ messageId: string; turnId: string }> {
    return this.request('POST', '/chat/messages', { body: { text } });
  }

  cancelTurn(turnId: string): Promise<{ ok: true }> {
    return this.request('POST', `/chat/turns/${encodeURIComponent(turnId)}/cancel`);
  }

  checks(): Promise<ChecksResponse> {
    return this.request('GET', '/checks');
  }

  runChecks(): Promise<ChecksResponse> {
    return this.request('POST', '/checks/run');
  }

  shutdown(): Promise<{ ok: true }> {
    return this.request('POST', '/shutdown');
  }

  /** Rejects with an ApiFailure (`{ error, status, message? }`) that keeps the server's error text; never with a raw Error. */
  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    options: { query?: Query; body?: unknown } = {},
  ): Promise<T> {
    const search = new URLSearchParams();
    for (const [name, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) search.set(name, String(value));
    }
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
      throw this.failure(this.i18n.t('errors.network'), 0);
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const body = (payload ?? {}) as { error?: unknown; message?: unknown };
      const serverMessage = typeof body.message === 'string' ? body.message : undefined;
      const serverError = typeof body.error === 'string' ? body.error : serverMessage;
      throw this.failure(serverError ?? this.i18n.t('errors.generic'), response.status, serverMessage);
    }
    return payload as T;
  }

  private failure(error: string, status: number, message?: string): ApiFailure {
    return message === undefined ? { error, status } : { error, status, message };
  }
}
