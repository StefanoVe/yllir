import { Injectable, signal } from '@angular/core';

/** What the projector window shows. Mirrors the server contract; declared locally on purpose. */
export type Projection = { kind: 'blank' } | { kind: 'image'; src: string };

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

  /** Whether the server allows this image on the projector (false for master-only images, and on any error). */
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

  async blank(): Promise<boolean> {
    return this.post({ kind: 'blank' });
  }

  private async post(body: Projection): Promise<boolean> {
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
