import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/** How a combatant is hurt, as a word for the table. Enemies only; PCs and allies show their hit points. */
export type ProjectedHealth = 'unhurt' | 'wounded' | 'bloodied' | 'down';

/** One line of the initiative order as the projector shows it. Mirrors the server contract. */
export interface ProjectedCombatant {
  id: string;
  name: string;
  side: 'pc' | 'ally' | 'enemy';
  initiative: number | null;
  current: boolean;
  health?: ProjectedHealth;
  hp?: number;
  hpMax?: number;
  tempHp?: number;
  defeated?: boolean;
}

/** The fight as the projector shows it: the order, the battle map and the tokens' cells (or fractions without a grid). */
export interface ProjectedCombat {
  round: number;
  order: ProjectedCombatant[];
  map: { src: string; cols?: number; rows?: number } | null;
  positions: Record<string, { x: number; y: number }>;
}

/** What the projector window shows. Mirrors the server contract; declared locally on purpose. */
export type Projection =
  | { kind: 'blank' }
  | { kind: 'image'; src: string }
  | { kind: 'combat'; combat: ProjectedCombat | null };

/** What the master sends: the server answers with the new current projection. */
type ProjectionRequest = { kind: 'blank' } | { kind: 'image'; src: string } | { kind: 'combat' };

/**
 * The server accepts only the relative form of a same-origin image URL (`/api/file?path=...`). An absolute URL
 * on this origin is reduced to that form; anything from another origin is returned unchanged.
 */
export function projectorSrc(src: string, origin: string = location.origin): string {
  // Already relative: keep it byte for byte (re-parsing would re-encode spaces and break existing callers).
  if (src.startsWith('/') && !src.startsWith('//')) return src;
  try {
    const url = new URL(src, origin);
    return url.origin === origin ? url.pathname + url.search : src;
  } catch {
    return src;
  }
}

export const PROJECTOR_WINDOW_NAME = 'yllir-projector';
const PROJECTOR_FEATURES = 'popup=yes,width=1280,height=720';
/** While the stream is down, the projector window polls the current projection this often... */
const POLL_MS = 3000;
/** ...once no frame has arrived for this long. */
const STALE_MS = 5000;

/**
 * Projector side: opens the native pop-up that the master drags to a second screen, sends it projections,
 * and keeps the current projection in a signal. The master window only fetches the current projection once;
 * the projector window calls listen() to stay in sync (SSE, with a polling fallback).
 */
@Injectable({ providedIn: 'root' })
export class ProjectorService {
  readonly current = signal<Projection>({ kind: 'blank' });
  private win: Window | null = null;
  private source: EventSource | null = null;
  private streamOpen = false;
  private lastFrame = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    void this.refresh();
    inject(DestroyRef).onDestroy(() => this.stopListening());
  }

  /**
   * Opens the event stream and keeps the projection current: fetches it now, again on every stream error,
   * and polls while no frame has arrived for 5 s and the stream is not open. Idempotent.
   */
  listen(): void {
    if (this.source || typeof EventSource === 'undefined') return;
    let source: EventSource | null = null;
    try {
      source = new EventSource('/api/projector/events');
    } catch {
      /* the stream is unavailable: the polling below still keeps the projection current */
    }
    if (source) {
      this.source = source;
      source.addEventListener('projection', (message) => {
        this.lastFrame = Date.now();
        try {
          this.current.set(JSON.parse(String((message as MessageEvent).data)) as Projection);
        } catch {
          /* malformed frame: keep the last known projection */
        }
      });
      source.onopen = () => {
        this.streamOpen = true;
      };
      source.onerror = () => {
        this.streamOpen = false;
        void this.refresh();
      };
    }
    void this.refresh();
    if (this.pollTimer === null) this.pollTimer = setInterval(() => this.poll(), POLL_MS);
  }

  private poll(): void {
    if (this.streamOpen || Date.now() - this.lastFrame < STALE_MS) return;
    void this.refresh();
  }

  /** Fetches the current projection. A frame that arrived meanwhile is newer, so the response is dropped. */
  private async refresh(): Promise<void> {
    const frameAt = this.lastFrame;
    try {
      const response = await fetch('/api/projector');
      if (!response.ok || frameAt !== this.lastFrame) return;
      this.current.set((await response.json()) as Projection);
    } catch {
      /* offline or the server is restarting: keep the last known projection */
    }
  }

  private stopListening(): void {
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.source?.close();
    this.source = null;
  }

  /** Opens (or focuses) the projector window. Must run from a click, because of pop-up blockers. */
  open(): Window | null {
    if (this.isOpen()) {
      this.win?.focus();
      return this.win;
    }
    const win = window.open('/projector', PROJECTOR_WINDOW_NAME, PROJECTOR_FEATURES);
    if (win) {
      this.win = win;
      win.focus();
    }
    return win;
  }

  isOpen(): boolean {
    return !!this.win && !this.win.closed;
  }

  /** Whether the server allows this image on the projector (false when the server refuses the source, and on any error). */
  async check(src: string): Promise<boolean> {
    try {
      const response = await fetch(`/api/projector/check?src=${encodeURIComponent(projectorSrc(src))}`);
      if (!response.ok) return false;
      const body = (await response.json()) as { projectable?: boolean };
      return body.projectable === true;
    } catch {
      return false;
    }
  }

  /** Projects an image. The window is opened first, synchronously, so the click still counts as a user gesture. */
  async project(src: string): Promise<boolean> {
    if (!this.isOpen()) this.open();
    return this.post({ kind: 'image', src: projectorSrc(src) });
  }

  /** Projects the live fight. Like project(), the window opens first; the server then pushes each new frame by itself. */
  async projectCombat(): Promise<boolean> {
    if (!this.isOpen()) this.open();
    return this.post({ kind: 'combat' });
  }

  async blank(): Promise<boolean> {
    return this.post({ kind: 'blank' });
  }

  private async post(body: ProjectionRequest): Promise<boolean> {
    try {
      const response = await fetch('/api/projector', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) return false;
      this.current.set((await response.json()) as Projection);
      return true;
    } catch {
      return false;
    }
  }

}
