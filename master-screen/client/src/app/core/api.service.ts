import { Injectable, inject } from '@angular/core';
import type {
  ChangesResponse,
  ChatResponse,
  ChecksResponse,
  DiffResponse,
  DocResponse,
  DocsResponse,
  ScreenSettingsPatch,
  SearchResponse,
  SettingsResponse,
  StatusResponse,
  UndoResponse,
} from '@shared/types';
import { I18n } from '../i18n';
import type { ChatChoice, ChatEffort, ChatModel } from '../chat/chat-choice';
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

  /** Sends a message. The model and thinking effort go along only when they are set. */
  sendMessage(text: string, choice: Partial<ChatChoice> = {}): Promise<{ messageId: string; turnId: string }> {
    const body: { text: string; model?: ChatModel; effort?: ChatEffort } = { text };
    if (choice.model !== undefined) body.model = choice.model;
    if (choice.effort !== undefined) body.effort = choice.effort;
    return this.request('POST', '/chat/messages', { body });
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

  settings(): Promise<SettingsResponse> {
    return this.request('GET', '/settings');
  }

  /** Saves a partial patch of the master screen settings. Rejects with 409 when the campaign is not a git repository. */
  saveSettings(patch: ScreenSettingsPatch): Promise<SettingsResponse> {
    return this.request('PUT', '/settings', { body: patch });
  }

  shutdown(): Promise<{ ok: true }> {
    return this.request('POST', '/shutdown');
  }

  /** Rejects with an ApiFailure (`{ error, status, message? }`) that keeps the server's error text; never with a raw Error. */
  private async request<T>(
    method: 'GET' | 'POST' | 'PUT',
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
