import { Injectable, inject } from '@angular/core';
import type { PrintSheetResult, PrintState, PrintStatus } from '@shared/types';
import { callJson } from '../encyclopedia/call-json';
import { I18n } from '../i18n';

export type PrintFormat = PrintStatus['format'];

/** Body of POST /api/print/sheets. */
export interface PrintSheetsRequest {
  ids: string[];
  format: PrintFormat;
  cmyk: boolean;
  copies: Record<string, number>;
}

/** Typed calls to the print endpoints. Failures reject with a CallFailure (plain message). */
@Injectable({ providedIn: 'root' })
export class PrintApiService {
  private readonly i18n = inject(I18n);

  /** GET /api/print */
  status(): Promise<PrintStatus> {
    return callJson<PrintStatus>(this.i18n, 'GET', '/api/print');
  }

  /** POST /api/print/state: only the master can say a card is printed. */
  setState(id: string, state: PrintState): Promise<PrintStatus> {
    return callJson<PrintStatus>(this.i18n, 'POST', '/api/print/state', { id, state });
  }

  /** POST /api/print/render: makes the card image. */
  render(id: string, renderer: 'node' = 'node'): Promise<PrintStatus> {
    return callJson<PrintStatus>(this.i18n, 'POST', '/api/print/render', { id, renderer });
  }

  /** POST /api/print/sheets */
  sheets(body: PrintSheetsRequest): Promise<PrintSheetResult> {
    return callJson<PrintSheetResult>(this.i18n, 'POST', '/api/print/sheets', body);
  }
}
