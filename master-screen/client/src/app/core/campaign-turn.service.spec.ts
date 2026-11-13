import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationsResponse, Turn } from '@shared/types';
import { ApiService } from './api.service';
import { CampaignTurnService } from './campaign-turn.service';
import { LiveService } from './live.service';

const AT = '2026-11-13T10:00:00.000Z';

function turn(id: string, state: Turn['state']): Turn {
  return { id, messageId: `m-${id}`, state, activity: '', startedAt: AT, conversationId: 'c1' };
}

function list(current: Turn | null): ConversationsResponse {
  return { conversations: [], currentId: 'c1', turn: current };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('CampaignTurnService', () => {
  let turnEvents: Subject<Turn>;
  let conversationEvents: Subject<void>;
  let resyncs: Subject<void>;
  let api: { conversations: ReturnType<typeof vi.fn> };

  function create(): CampaignTurnService {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ApiService, useValue: api },
        {
          provide: LiveService,
          useValue: {
            on: (name: string) => (name === 'turn' ? turnEvents : conversationEvents),
            resync$: resyncs.asObservable(),
            connected: signal(true).asReadonly(),
          },
        },
      ],
    });
    return TestBed.inject(CampaignTurnService);
  }

  beforeEach(() => {
    turnEvents = new Subject<Turn>();
    conversationEvents = new Subject<void>();
    resyncs = new Subject<void>();
    api = { conversations: vi.fn(async () => list(turn('t1', 'running'))) };
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('loads the campaign turn once at start', async () => {
    const service = create();
    await flush();
    expect(api.conversations).toHaveBeenCalledTimes(1);
    expect(service.turn()?.id).toBe('t1');
  });

  it('stays empty and quiet when the first load fails', async () => {
    api.conversations.mockRejectedValueOnce({ error: 'down', status: 0 });
    const service = create();
    await flush();
    expect(service.turn()).toBeNull();
  });

  it('takes the turn of a turn event', async () => {
    api.conversations.mockResolvedValueOnce(list(null));
    const service = create();
    await flush();
    turnEvents.next(turn('t2', 'running'));
    expect(service.turn()?.id).toBe('t2');
  });

  it('keeps a running turn when a queued one arrives', async () => {
    api.conversations.mockResolvedValueOnce(list(null));
    const service = create();
    await flush();
    turnEvents.next(turn('t2', 'running'));
    turnEvents.next(turn('t3', 'queued'));
    expect(service.turn()?.id).toBe('t2');
  });

  it('reloads on a conversations event and on resync', async () => {
    const service = create();
    await flush();
    api.conversations.mockResolvedValueOnce(list(null));
    conversationEvents.next();
    await flush();
    expect(service.turn()).toBeNull();
    api.conversations.mockResolvedValueOnce(list(turn('t4', 'running')));
    resyncs.next();
    await flush();
    expect(service.turn()?.id).toBe('t4');
  });

  it('does not let a list fetched before a turn event overwrite that event', async () => {
    let answer!: (value: ConversationsResponse) => void;
    api.conversations.mockReturnValueOnce(new Promise<ConversationsResponse>((resolve) => (answer = resolve)));
    const service = create();
    turnEvents.next(turn('t5', 'running'));
    answer(list(null));
    await flush();
    expect(service.turn()?.id).toBe('t5');
  });
});
