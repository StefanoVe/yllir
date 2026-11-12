import { Injectable, inject, signal } from '@angular/core';
import type { DocResponse, DocSummary } from '@shared/types';
import { ApiService } from '../../core/api.service';

/** The URL of a campaign file: the one route that serves campaign files, with the path encoded. */
export function fileUrl(path: string): string {
  return '/api/file?path=' + encodeURIComponent(path);
}

/**
 * The campaign documents as the cockpit needs them: the index for "add a sheet",
 * one document in master view, and the file URLs the server gives for images.
 */
@Injectable({ providedIn: 'root' })
export class DocumentsService {
  private readonly api = inject(ApiService);
  /** Loaded on first use by the board's "add a sheet" search. */
  readonly docs = signal<DocSummary[]>([]);

  async loadIndex(): Promise<void> {
    this.docs.set((await this.api.docs()).docs);
  }

  detail(path: string): Promise<DocResponse> {
    return this.api.readDoc(path, 'master');
  }

  /** File URL of a campaign file, in the format the master screen serves them (`/api/file?path=…`). */
  asset(path: string): string {
    return fileUrl(path);
  }
}
