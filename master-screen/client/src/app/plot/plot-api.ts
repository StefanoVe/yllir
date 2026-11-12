import { Injectable, inject } from '@angular/core';
import type { PlotResponse } from '@shared/types';
import { PlotHttp } from './plot-http';

/** GET /api/plot. A separate service so the map can be tested with a fake. */
@Injectable({ providedIn: 'root' })
export class PlotApi {
  private readonly http = inject(PlotHttp);

  load(): Promise<PlotResponse> {
    return this.http.request<PlotResponse>('GET', '/plot');
  }
}
