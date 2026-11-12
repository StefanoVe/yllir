import { Injectable, inject } from '@angular/core';
import { I18n, type TranslationKey } from '../i18n';

/** A failed call. `error` is plain language: the server's own `error` text, or a fallback when there is none. */
export interface PlotFailure {
  error: string;
  status: number;
}

export function isPlotFailure(value: unknown): value is PlotFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PlotFailure).error === 'string' &&
    typeof (value as PlotFailure).status === 'number'
  );
}

export type PlotMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** Fetch-based JSON calls under /api for the plot map. Every rejection is a PlotFailure. */
@Injectable({ providedIn: 'root' })
export class PlotHttp {
  private readonly i18n = inject(I18n);

  async request<T>(
    method: PlotMethod,
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
      throw this.failure(this.i18n.t('panels.errors.network' as TranslationKey), 0);
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
        typeof message === 'string' && message !== '' ? message : this.i18n.t('panels.errors.generic' as TranslationKey),
        response.status,
      );
    }
    return payload as T;
  }

  private failure(error: string, status: number): PlotFailure {
    return { error, status };
  }
}
