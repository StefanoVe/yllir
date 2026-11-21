import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveService } from './live.service';

/** Records every EventSource the service opens. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(): void {}
  close(): void {}
}

describe('LiveService on the projector route', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('does not open the live stream on /projector, and still constructs', () => {
    window.history.replaceState({}, '', '/projector');
    expect(() => TestBed.inject(LiveService)).not.toThrow();
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('does not open the live stream on a sub-path of /projector', () => {
    window.history.replaceState({}, '', '/projector/');
    TestBed.inject(LiveService);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('opens the live stream on any other route', () => {
    window.history.replaceState({}, '', '/');
    TestBed.inject(LiveService);
    expect(FakeEventSource.instances.map((s) => s.url)).toEqual(['/api/events']);
  });
});
