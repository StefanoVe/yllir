import { Injectable, signal } from '@angular/core';

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

export const PROJECTOR_WINDOW_NAME = 'yllir-projector';
const PROJECTOR_FEATURES = 'popup=yes,width=1280,height=720';

/**
 * Master side of the projector: opens the native pop-up that the master drags to a second screen,
 * sends it projections, and keeps the current projection in a signal for the rail.
 */
@Injectable({ providedIn: 'root' })
export class ProjectorService {
  readonly current = signal<Projection>({ kind: 'blank' });
  private win: Window | null = null;

  constructor() {
    this.connect();
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
      const response = await fetch(`/api/projector/check?src=${encodeURIComponent(src)}`);
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
    return this.post({ kind: 'image', src });
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

  /** The server sends the current projection as the first frame, then each change. EventSource reconnects by itself. */
  private connect(): void {
    if (typeof EventSource === 'undefined') return;
    try {
      const source = new EventSource('/api/projector/events');
      source.addEventListener('projection', (message) => {
        try {
          this.current.set(JSON.parse(String((message as MessageEvent).data)) as Projection);
        } catch {
          /* malformed frame: keep the last known projection */
        }
      });
    } catch {
      /* the stream is unavailable: the rail simply shows no projection state */
    }
  }
}
