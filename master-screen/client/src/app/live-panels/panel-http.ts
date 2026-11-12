import { Injectable, inject } from '@angular/core';
import { PanelStrings } from './strings';

/** A failed call. `error` is plain language: the server's own `error` text, or a fallback when there is none. */
export interface PanelFailure {
  error: string;
  status: number;
}

export function isPanelFailure(value: unknown): value is PanelFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PanelFailure).error === 'string' &&
    typeof (value as PanelFailure).status === 'number'
  );
}

export type PanelMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/**
 * Fetch-based JSON calls under /api for the live panels and the plot map.
 * Every rejection is a PanelFailure, so callers never see a raw Error or a stack trace.
 */
@Injectable({ providedIn: 'root' })
export class PanelHttp {
  private readonly strings = inject(PanelStrings);

  async request<T>(
    method: PanelMethod,
    path: string,
    options: { query?: Record<string, string>; body?: unknown } = {},
  ): Promise<T> {
    const search = new URLSearchParams(options.query ?? {}).toString();
    const url = `/api${path}${search ? `?${search}` : ''}`;
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
      throw this.failure(this.strings.text('panels.errors.network'), 0);
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const message = (payload as { error?: unknown } | null)?.error;
      throw this.failure(
        typeof message === 'string' && message !== '' ? message : this.strings.text('panels.errors.generic'),
        response.status,
      );
    }
    return payload as T;
  }

  private failure(error: string, status: number): PanelFailure {
    return { error, status };
  }
}
