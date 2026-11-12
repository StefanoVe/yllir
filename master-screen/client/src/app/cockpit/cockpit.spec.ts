import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CockpitSessionSummary, CockpitSessionView } from '@shared/cockpit-types';
import { StatusService } from '../core/status.service';
import { MusicApiService } from '../music/music-api.service';
import { MusicPlayerService } from '../music/music-player.service';
import { Cockpit } from './cockpit';

const SESSION: CockpitSessionView = {
  id: 's1',
  title: 'Session one',
  createdAt: '2026-11-10T10:00:00Z',
  updatedAt: '2026-11-10T10:00:00Z',
  revision: 1,
  provider: 'claude',
  model: 'claude-sonnet-5-5',
  state: {
    position: { location: '', moment: '', summary: '' },
    party: [],
    board: { modules: [], frames: [], links: [], highlightId: null },
    ledger: [],
    combat: null,
  },
  messages: [
    { id: 'm1', role: 'dm', text: 'Hello from the DM', at: '2026-11-10T10:00:00Z', turnId: 't1', status: 'complete' },
    { id: 'm2', role: 'agent', text: 'The board is ready', at: '2026-11-10T10:00:05Z', turnId: 't1', status: 'complete' },
  ],
  turns: [],
  history: [],
};

const SUMMARY: CockpitSessionSummary = {
  id: 's1',
  title: 'Session one',
  createdAt: SESSION.createdAt,
  updatedAt: SESSION.updatedAt,
  location: '',
};

/** Only what the cockpit reads from an event stream: no events are sent in this smoke test. */
class FakeEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(readonly url: string) {}
  close() {}
}

function json(value: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }));
}

describe('Cockpit (live table)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/cockpit/sessions') return json([SUMMARY]);
        if (url === '/api/cockpit/sessions/s1') return json(SESSION);
        return json({ error: 'not found' }, 404);
      }),
    );
    TestBed.configureTestingModule({
      imports: [Cockpit],
      providers: [
        provideRouter([]),
        { provide: StatusService, useValue: { modules: () => ({ music: false, print: false, encyclopedia: false }) } },
        { provide: MusicPlayerService, useValue: { current: () => null, toggle() {}, playTrack() {} } },
        { provide: MusicApiService, useValue: { tracks: async () => ({ enabled: false, tracks: [] }) } },
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function settle(fixture: { detectChanges: () => void; whenStable: () => Promise<boolean> }) {
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();
      await fixture.whenStable();
    }
  }

  it('opens the last session on the board and shows its chat', async () => {
    const fixture = TestBed.createComponent(Cockpit);
    fixture.detectChanges();
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.board-head h1')?.textContent).toContain('Session one');
    expect(root.querySelector('cockpit-board')).not.toBeNull();
    const messages = [...root.querySelectorAll('.message-body')].map((el) => el.textContent);
    expect(messages.some((text) => text?.includes('Hello from the DM'))).toBe(true);
    expect(messages.some((text) => text?.includes('The board is ready'))).toBe(true);
    expect(root.querySelector('cockpit-composer textarea')).not.toBeNull();
    expect(root.querySelector('.provider-control, .provider-menu')).toBeNull();
  });

  it('remembers the session it opened', async () => {
    const fixture = TestBed.createComponent(Cockpit);
    fixture.detectChanges();
    await settle(fixture);
    expect(localStorage.getItem('yllir.cockpit.last-session')).toBe('s1');
  });
});
