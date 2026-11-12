import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocResponse } from '@shared/types';
import { ApiService } from '../core/api.service';
import { LiveService } from '../core/live.service';
import { StatusService } from '../core/status.service';
import { ViewModeService } from '../core/view-mode.service';
import { Reader } from './reader';

function docWith(partial: Partial<DocResponse>): DocResponse {
  return {
    path: 'characters/alia.md',
    title: 'Alia',
    masterOnly: false,
    headings: [],
    blocks: [],
    backlinks: [],
    ...partial,
  };
}

describe('Reader', () => {
  let api: { readDoc: ReturnType<typeof vi.fn> };
  let live: { on: () => Subject<unknown>; resync$: Subject<void> };
  let router: Router;

  function setup(doc: DocResponse, view: 'master' | 'public' = 'master') {
    api.readDoc.mockResolvedValue(doc);
    TestBed.inject(ViewModeService).viewMode.set(view);
    const fixture = TestBed.createComponent(Reader);
    fixture.componentRef.setInput('compact', true);
    fixture.componentRef.setInput('docPath', doc.path);
    return fixture;
  }

  async function settle(fixture: { detectChanges: () => void; whenStable: () => Promise<boolean> }) {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
  }

  beforeEach(() => {
    api = { readDoc: vi.fn() };
    live = { on: () => new Subject<unknown>(), resync$: new Subject<void>() };
    TestBed.configureTestingModule({
      imports: [Reader],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: LiveService, useValue: live },
        { provide: StatusService, useValue: { campaign: () => ({ name: 'Test campaign' }) } },
      ],
    });
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('marks a master block with an icon, a label and visually hidden text in the master view', async () => {
    const fixture = setup(
      docWith({
        blocks: [
          { kind: 'public', html: '<p>Open text</p>' },
          { kind: 'master', html: '<p>The secret</p>' },
        ],
      }),
      'master',
    );
    await settle(fixture);
    const element: HTMLElement = fixture.nativeElement;
    const master = element.querySelector('.block-master');
    expect(master).not.toBeNull();
    expect(master?.textContent).toContain('The secret');
    expect(master?.querySelector('[aria-label="Master only"]')).not.toBeNull();
    expect(master?.querySelector('.sr-only')?.textContent).toBe('Master only');
    expect(element.querySelectorAll('.block-master')).toHaveLength(1);
  });

  it('never shows master blocks in the public view, and shows a notice for a master-only document', async () => {
    const fixture = setup(docWith({ masterOnly: true, blocks: [] }), 'public');
    await settle(fixture);
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('.block-master')).toBeNull();
    const notice = element.querySelector('[role="note"]');
    expect(notice?.textContent).toContain('master only');
    expect(element.querySelector('.block')).toBeNull();
  });

  it('shows only public text in the public view', async () => {
    const fixture = setup(docWith({ blocks: [{ kind: 'public', html: '<p>Players read this</p>' }] }), 'public');
    await settle(fixture);
    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).toContain('Players read this');
    expect(element.querySelector('.block-master')).toBeNull();
    expect(element.querySelector('[role="note"]')).toBeNull();
  });

  it('navigates inside the app for /doc/ links and opens external links in a new tab', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const fixture = setup(
      docWith({
        blocks: [
          {
            kind: 'public',
            html: '<p><a id="inner" href="/doc/places/keep.md#gate">Keep</a> <a id="outer" href="https://example.org/page">Site</a></p>',
          },
        ],
      }),
    );
    await settle(fixture);
    const element: HTMLElement = fixture.nativeElement;

    const inner = element.querySelector<HTMLAnchorElement>('a[href="/doc/places/keep.md#gate"]');
    inner?.click();
    expect(router.navigate).toHaveBeenCalledWith([], { queryParams: { with: 'places/keep.md' }, queryParamsHandling: 'merge' });

    const outer = element.querySelector<HTMLAnchorElement>('a[href^="https://"]');
    expect(outer?.target).toBe('_blank');
    expect(outer?.rel).toBe('noopener noreferrer');
    outer?.click();
    expect(open).toHaveBeenCalledWith('https://example.org/page', '_blank', 'noopener,noreferrer');
    expect(router.navigate).toHaveBeenCalledTimes(1);
  });

  it('restores heading ids that the HTML sanitizer removes, so the outline can jump to them', async () => {
    const fixture = setup(
      docWith({
        headings: [
          { level: 2, text: 'History', id: 'history' },
          { level: 2, text: 'Family', id: 'family' },
        ],
        blocks: [{ kind: 'public', html: '<h2>History</h2><p>Old.</p><h2>Family</h2>' }],
      }),
    );
    await settle(fixture);
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('h2#history')?.textContent).toBe('History');
    expect(element.querySelector('h2#family')?.textContent).toBe('Family');
  });

  it('shows the plain-language error from the server when the document cannot be read', async () => {
    api.readDoc.mockRejectedValue({ error: 'There is no such document.', status: 404 });
    const fixture = TestBed.createComponent(Reader);
    fixture.componentRef.setInput('compact', true);
    fixture.componentRef.setInput('docPath', 'missing.md');
    await settle(fixture);
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent).toContain(
      'There is no such document.',
    );
  });
});
