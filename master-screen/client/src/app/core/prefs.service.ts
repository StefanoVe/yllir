import { Injectable, signal } from '@angular/core';

/** Builds the localStorage key for a campaign preference: `yllir:<slug>:<key>`. */
export function prefKey(slug: string, key: string): string {
  return `yllir:${slug}:${key}`;
}

/**
 * Wraps every storage access in try/catch. Storage can be blocked, full, or throw
 * on access (private windows, disabled site data); the app must keep working without it.
 */
export class KeyValueStore {
  constructor(private readonly source: () => Storage | null) {}

  get(key: string): string | null {
    try {
      return this.source()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  set(key: string, value: string): boolean {
    try {
      this.source()?.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  remove(key: string): boolean {
    try {
      this.source()?.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }
}

@Injectable({ providedIn: 'root' })
export class PrefsService {
  private readonly store = new KeyValueStore(() => globalThis.localStorage ?? null);

  /** Campaign slug, set once `/api/status` has loaded. Preferences are unavailable before that. */
  readonly slug = signal<string | null>(null);

  setCampaign(slug: string): void {
    this.slug.set(slug);
  }

  get(key: string): string | null {
    const slug = this.slug();
    return slug ? this.store.get(prefKey(slug, key)) : null;
  }

  set(key: string, value: string): void {
    const slug = this.slug();
    if (slug) this.store.set(prefKey(slug, key), value);
  }

  remove(key: string): void {
    const slug = this.slug();
    if (slug) this.store.remove(prefKey(slug, key));
  }
}
