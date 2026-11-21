import { Injectable, inject } from '@angular/core';
import type { EncyclopediaReport, EncyclopediaSettings, EncyclopediaStatus } from '@shared/types';
import { I18n } from '../i18n';
import { callJson } from './call-json';

/** Typed calls to the encyclopedia endpoints. Failures reject with a CallFailure (plain message). */
@Injectable({ providedIn: 'root' })
export class EncyclopediaApiService {
  private readonly i18n = inject(I18n);

  /** GET /api/encyclopedia */
  status(): Promise<EncyclopediaStatus> {
    return callJson<EncyclopediaStatus>(this.i18n, 'GET', '/api/encyclopedia');
  }

  /** POST /api/encyclopedia/build. Nothing is shown before the server answers. */
  build(): Promise<EncyclopediaReport> {
    return callJson<EncyclopediaReport>(this.i18n, 'POST', '/api/encyclopedia/build');
  }

  /** PUT /api/encyclopedia/settings. Saving does not rebuild; the answer is the full status. */
  saveSettings(settings: EncyclopediaSettings): Promise<EncyclopediaStatus> {
    // callJson only passes the method through to fetch; its type lists GET and POST only.
    return callJson<EncyclopediaStatus>(this.i18n, 'PUT', '/api/encyclopedia/settings', settings);
  }
}

/** A failed build may carry its report in the body (`{ error, report }`). Returns it only when it looks like a report. */
export function reportFromBody(body: unknown): EncyclopediaReport | null {
  if (typeof body !== 'object' || body === null) return null;
  const candidate = (body as { report?: unknown }).report ?? body;
  if (typeof candidate !== 'object' || candidate === null) return null;
  const report = candidate as Partial<EncyclopediaReport>;
  return Array.isArray(report.checks) && typeof report.ok === 'boolean' ? (report as EncyclopediaReport) : null;
}
