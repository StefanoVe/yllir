import { Injectable, inject } from '@angular/core';
import type { AtlasRenderResult, AtlasStartRequest, AtlasStatus } from '@shared/types';
import { I18n } from '../i18n';
import { callJson } from '../encyclopedia/call-json';

/** Typed calls to the atlas endpoints. Failures reject with a CallFailure (plain message). */
@Injectable({ providedIn: 'root' })
export class AtlasApiService {
  private readonly i18n = inject(I18n);

  /** GET /api/atlas */
  status(): Promise<AtlasStatus> {
    return callJson<AtlasStatus>(this.i18n, 'GET', '/api/atlas');
  }

  /** POST /api/atlas/generate. Rejects with 409 or 503 and the server's plain message. */
  generate(mode: AtlasStartRequest['mode']): Promise<{ ok: true; status: AtlasStatus }> {
    const body: AtlasStartRequest = { mode };
    return callJson<{ ok: true; status: AtlasStatus }>(this.i18n, 'POST', '/api/atlas/generate', body);
  }

  /** POST /api/atlas/render: redraws the master site from the existing data. No assistant involved. */
  async render(): Promise<AtlasRenderResult> {
    const result = await callJson<AtlasRenderResult>(this.i18n, 'POST', '/api/atlas/render');
    if (!result.ok) throw new Error(result.error ?? this.i18n.t('atlas.renderFailed'));
    return result;
  }

  /** The latest preview image; the version only changes the URL so the browser fetches it again. */
  previewUrl(version: number): string {
    return `/api/atlas/preview.png?v=${version}`;
  }
}
