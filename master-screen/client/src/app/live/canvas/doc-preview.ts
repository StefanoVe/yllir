import { Injectable, inject, signal, type Signal, type WritableSignal } from '@angular/core';
import { LiveApi } from '../live-api.service';
import { fallbackTitle, firstPublicExcerpt } from './excerpt';

export interface DocPreview {
  state: 'loading' | 'ready' | 'missing';
  title: string;
  excerpt: string;
}

/**
 * Titles and excerpts of document cards. One request per path, shared by every card
 * that shows it. Text only: the excerpt comes from textContent, never from innerHTML.
 */
@Injectable({ providedIn: 'root' })
export class DocPreviewCache {
  private readonly api = inject(LiveApi);
  private readonly cache = new Map<string, WritableSignal<DocPreview>>();

  get(path: string): Signal<DocPreview> {
    let entry = this.cache.get(path);
    if (!entry) {
      entry = signal<DocPreview>({ state: 'loading', title: fallbackTitle(path), excerpt: '' });
      this.cache.set(path, entry);
      void this.load(path, entry);
    }
    return entry.asReadonly();
  }

  private async load(path: string, target: WritableSignal<DocPreview>): Promise<void> {
    try {
      const doc = await this.api.readDoc(path);
      target.set({ state: 'ready', title: doc.title || fallbackTitle(path), excerpt: firstPublicExcerpt(doc.blocks) });
    } catch {
      target.set({ state: 'missing', title: fallbackTitle(path), excerpt: '' });
    }
  }
}
