import { Injectable, inject } from '@angular/core';
import type {
  CombatOp,
  DocResponse,
  LiveSnapshot,
  LogEntry,
  LogKind,
  SearchResponse,
} from '@shared/types';
import { PanelHttp } from './panel-http';

export interface LogInput {
  kind: LogKind;
  text: string;
  scene?: string;
  subjects?: string[];
}

export interface LogPatch {
  text?: string;
  kind?: LogKind;
  scene?: string;
  subjects?: string[];
  resolved?: boolean;
}

/**
 * The HTTP calls the live panels make (log, combat, look-up). Each call resolves with the server's
 * answer or rejects with a PanelFailure. Callers never update their lists from the answer: the
 * list always comes from the `snapshot` input, which the table refetches on the live event.
 */
@Injectable({ providedIn: 'root' })
export class LiveActionsService {
  private readonly http = inject(PanelHttp);

  addLogEntry(input: LogInput): Promise<LiveSnapshot> {
    return this.http.request('POST', '/live/log', { body: input });
  }

  updateLogEntry(id: LogEntry['id'], patch: LogPatch): Promise<LiveSnapshot> {
    return this.http.request('PATCH', `/live/log/${encodeURIComponent(id)}`, { body: patch });
  }

  removeLogEntry(id: LogEntry['id']): Promise<LiveSnapshot> {
    return this.http.request('DELETE', `/live/log/${encodeURIComponent(id)}`);
  }

  combat(op: CombatOp): Promise<LiveSnapshot> {
    return this.http.request('POST', '/live/combat', { body: op });
  }

  searchDocs(query: string): Promise<SearchResponse> {
    return this.http.request('GET', '/search', { query: { q: query, view: 'master' } });
  }

  readDoc(path: string): Promise<DocResponse> {
    return this.http.request('GET', '/docs/read', { query: { path, view: 'master' } });
  }
}
