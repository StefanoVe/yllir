import type { I18n } from '../i18n';

/**
 * A call that did not succeed. `message` is plain language (the server's `error`, or the generic
 * text). `body` is what the server sent, when it sent JSON: some failures carry data as well
 * (a failed build carries its report).
 */
export class CallFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown = null,
  ) {
    super(message);
    this.name = 'CallFailure';
  }
}

/** JSON request to the master screen API. Rejects with a CallFailure, never with a raw fetch error. */
export async function callJson<T>(i18n: I18n, method: 'GET' | 'POST', url: string, body?: unknown): Promise<T> {
  const hasBody = body !== undefined;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: hasBody ? { 'content-type': 'application/json' } : undefined,
      body: hasBody ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new CallFailure(0, i18n.t('errors.network'));
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const record = (payload ?? {}) as { error?: unknown; message?: unknown };
    const text =
      typeof record.error === 'string'
        ? record.error
        : typeof record.message === 'string'
          ? record.message
          : i18n.t('errors.generic');
    throw new CallFailure(response.status, text, payload);
  }
  return payload as T;
}
