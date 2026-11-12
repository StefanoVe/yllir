import { Injectable, inject } from '@angular/core';
import type { PlotResponse } from '@shared/types';
import { PanelHttp } from '../live-panels/panel-http';

/** GET /api/plot. A separate service so the map can be tested with a fake. */
@Injectable({ providedIn: 'root' })
export class PlotApi {
  private readonly http = inject(PanelHttp);

  load(): Promise<PlotResponse> {
    return this.http.request<PlotResponse>('GET', '/plot');
  }
}
