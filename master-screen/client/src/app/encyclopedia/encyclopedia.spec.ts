import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EncyclopediaReport, EncyclopediaSettings, EncyclopediaStatus } from '@shared/types';
import { CallFailure } from './call-json';
import { EncyclopediaApiService, reportFromBody } from './encyclopedia-api.service';
import { EncyclopediaPage, entryName, sameSettings } from './encyclopedia';

const ITEMS_ONLY: EncyclopediaSettings = { kinds: ['item'], flavourText: true, list: 'full' };

function report(overrides: Partial<EncyclopediaReport> = {}): EncyclopediaReport {
  return {
    ok: true,
    entries: 3,
    excluded: [],
    warnings: [],
    checks: [{ id: 'links', status: 'pass', message: 'All links lead somewhere.' }],
    baseUrl: 'http://localhost/',
    generatedAt: '2026-11-12T10:00:00Z',
    previewUrl: '/enc/',
    settings: ITEMS_ONLY,
    ...overrides,
  };
}

function built(overrides: Partial<EncyclopediaStatus> = {}): EncyclopediaStatus {
  return {
    enabled: true,
    built: true,
    report: report(),
    publishing: 'not-configured',
    settings: ITEMS_ONLY,
    changes: { added: [], changed: [], removed: [] },
    ...overrides,
  };
}

/** A fake of the API: `current` is what GET returns; `buildResult` is what POST does; `saveResult` what PUT does. */
class FakeEncyclopediaApi {
  current: EncyclopediaStatus = { enabled: true, built: false, report: null, publishing: 'not-configured', settings: ITEMS_ONLY, changes: null };
  buildResult: () => Promise<EncyclopediaReport> = async () => report();
  saveResult: (settings: EncyclopediaSettings) => Promise<EncyclopediaStatus> = async (settings) => ({ ...this.current, settings });
  buildCalls = 0;
  saveCalls: EncyclopediaSettings[] = [];

  status(): Promise<EncyclopediaStatus> {
    return Promise.resolve(this.current);
  }

  build(): Promise<EncyclopediaReport> {
    this.buildCalls++;
    return this.buildResult();
  }

  saveSettings(settings: EncyclopediaSettings): Promise<EncyclopediaStatus> {
    this.saveCalls.push(settings);
    return this.saveResult(settings);
  }
}

async function settle(fixture: ComponentFixture<EncyclopediaPage>): Promise<void> {
  for (let step = 0; step < 4; step++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  }
}

async function setup(fake: FakeEncyclopediaApi): Promise<ComponentFixture<EncyclopediaPage>> {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), { provide: EncyclopediaApiService, useValue: fake }],
  });
  const fixture = TestBed.createComponent(EncyclopediaPage);
  await settle(fixture);
  return fixture;
}

function root(fixture: ComponentFixture<EncyclopediaPage>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function text(fixture: ComponentFixture<EncyclopediaPage>): string {
  return root(fixture).textContent ?? '';
}

function buttonByText(fixture: ComponentFixture<EncyclopediaPage>, label: string): HTMLButtonElement | undefined {
  return [...root(fixture).querySelectorAll('button')].find((button) => button.textContent?.trim() === label);
}

function buttonContaining(fixture: ComponentFixture<EncyclopediaPage>, label: string): HTMLButtonElement | undefined {
  return [...root(fixture).querySelectorAll('button')].find((button) => button.textContent?.includes(label));
}

function badge(fixture: ComponentFixture<EncyclopediaPage>): string {
  return root(fixture).querySelector('.badge')?.textContent?.trim() ?? '';
}

function kpiValues(fixture: ComponentFixture<EncyclopediaPage>): string[] {
  return [...root(fixture).querySelectorAll('.kpi-value')].map((value) => value.textContent?.trim() ?? '');
}

function kindBox(fixture: ComponentFixture<EncyclopediaPage>, label: string): HTMLInputElement {
  const label_ = [...root(fixture).querySelectorAll('.check-row')].find((row) => row.textContent?.trim() === label);
  return label_?.querySelector('input') as HTMLInputElement;
}

function saveButton(fixture: ComponentFixture<EncyclopediaPage>): HTMLButtonElement {
  return root(fixture).querySelector('button.save') as HTMLButtonElement;
}

function previewTab(fixture: ComponentFixture<EncyclopediaPage>): HTMLButtonElement {
  return root(fixture).querySelector('#codex-tab-preview') as HTMLButtonElement;
}

function clearRemembered(): void {
  try {
    localStorage.removeItem('codex.tab');
  } catch {
    // Storage may be unavailable; nothing to clear.
  }
}

describe('EncyclopediaPage', () => {
  beforeEach(() => clearRemembered());

  afterEach(() => {
    clearRemembered();
    TestBed.resetTestingModule();
  });

  it('shows the module as off, with no dashboard, no tabs and no build button', async () => {
    const fake = new FakeEncyclopediaApi();
    fake.current = { enabled: false, built: false, report: null, publishing: 'not-configured', settings: null, changes: null };
    const fixture = await setup(fake);
    expect(text(fixture)).toContain('not turned on for this campaign');
    expect(buttonByText(fixture, 'Generate the Codex')).toBeUndefined();
    expect(root(fixture).querySelector('[role="tablist"]')).toBeNull();
    expect(root(fixture).querySelector('iframe')).toBeNull();
  });

  it('never built: says so, the KPIs show dashes, no changes block, preview disabled, only Items ticked', async () => {
    const fixture = await setup(new FakeEncyclopediaApi());
    expect(badge(fixture)).toBe('Not generated');
    expect(text(fixture)).toContain('has not been generated yet');
    expect(buttonByText(fixture, 'Generate the Codex')).toBeDefined();
    expect(kpiValues(fixture)).toEqual(['—', '—', '—', '—']);
    expect(root(fixture).querySelector('#codex-changes-title')).toBeNull();
    expect(previewTab(fixture).disabled).toBe(true);
    expect(root(fixture).querySelector('iframe')).toBeNull();
    expect(kindBox(fixture, 'Items').checked).toBe(true);
    expect(kindBox(fixture, 'Places').checked).toBe(false);
  });

  it('up to date: the badge, the sentence and the no-changes sentence', async () => {
    const fake = new FakeEncyclopediaApi();
    fake.current = built();
    const fixture = await setup(fake);
    expect(badge(fixture)).toBe('Up to date');
    expect(text(fixture)).toContain('matches the campaign and its settings');
    expect(text(fixture)).toContain('No changes since the last update.');
    expect(root(fixture).querySelector('[data-state="upToDate"]')).not.toBeNull();
  });

  it('out of date by changes: the badge, and the changed titles under their group', async () => {
    const fake = new FakeEncyclopediaApi();
    fake.current = built({ changes: { added: [{ id: 'places/tavern', title: 'The Tavern' }], changed: [], removed: [] } });
    const fixture = await setup(fake);
    expect(badge(fixture)).toBe('Out of date');
    expect(text(fixture)).toContain('The Tavern');
  });

  it('out of date by settings: the saved settings differ from the ones the last update used', async () => {
    const fake = new FakeEncyclopediaApi();
    fake.current = built({ settings: { kinds: ['item', 'place'], flavourText: true, list: 'full' } });
    const fixture = await setup(fake);
    expect(badge(fixture)).toBe('Out of date');
    expect(text(fixture)).toContain('the settings changed since the last update');
  });

  it('failed when the saved report says so', async () => {
    const fake = new FakeEncyclopediaApi();
    fake.current = built({ report: report({ ok: false }) });
    const fixture = await setup(fake);
    expect(badge(fixture)).toBe('Failed');
    expect(text(fixture)).toContain('The last update failed. Nothing was changed.');
  });

  it('failed when the last update in this session failed: the plain message, the nothing-changed line, the report kept', async () => {
    const fake = new FakeEncyclopediaApi();
    fake.buildResult = async () => {
      throw new CallFailure(409, 'A page has a broken link.', {
        error: 'A page has a broken link.',
        report: report({ ok: false, checks: [{ id: 'links', status: 'fail', message: 'One link leads nowhere.' }] }),
      });
    };
    const fixture = await setup(fake);
    buttonByText(fixture, 'Generate the Codex')?.click();
    await settle(fixture);

    expect(badge(fixture)).toBe('Failed');
    const alert = root(fixture).querySelector('.alert[role="alert"]');
    expect(alert?.textContent).toContain('A page has a broken link.');
    expect(alert?.textContent).toContain('Nothing was changed');
    expect(root(fixture).querySelector('iframe')).toBeNull();
    expect(kpiValues(fixture)[2]).toBe('1');
  });

  it('a failed update without a report still shows the plain message', async () => {
    const fake = new FakeEncyclopediaApi();
    fake.current = built();
    fake.buildResult = async () => {
      throw new CallFailure(409, 'A build is already running.', { error: 'A build is already running.' });
    };
    const fixture = await setup(fake);
    buttonByText(fixture, 'Update the Codex')?.click();
    await settle(fixture);
    expect(root(fixture).querySelector('.alert')?.textContent).toContain('A build is already running.');
  });

  it('KPI counts; each list opens on its own, and only one is open at a time', async () => {
    const fake = new FakeEncyclopediaApi();
    fake.current = built({
      report: report({
        entries: 7,
        excluded: [{ path: 'places/secret.md', reason: 'Fully master-only.' }, { path: 'items/key.md', reason: 'Not public.' }],
        warnings: [{ code: 'spacing', path: 'places/tavern.md', message: 'Two spaces in a row.' }],
        checks: [
          { id: 'links', status: 'pass', message: 'All links lead somewhere.' },
          { id: 'ids', status: 'fail', message: 'Two pages share an id.' },
          { id: 'images', status: 'skipped', message: 'No images to check.' },
        ],
      }),
    });
    const fixture = await setup(fake);
    expect(kpiValues(fixture)).toEqual(['7', '2', '1', '1']);

    buttonContaining(fixture, 'Left out')?.click();
    await settle(fixture);
    expect(root(fixture).querySelector('#codex-list')?.textContent).toContain('Left out and why');
    expect(text(fixture)).toContain('secret');
    expect(text(fixture)).toContain('Fully master-only.');
    expect(text(fixture)).not.toContain('places/secret.md');

    buttonContaining(fixture, 'Failing checks')?.click();
    await settle(fixture);
    const rows = [...root(fixture).querySelectorAll<HTMLElement>('#codex-list .row.check')];
    expect(rows.map((row) => row.dataset['status'])).toEqual(['fail', 'skipped']);
    expect(rows[0].textContent).toContain('Failed');
    expect(rows[0].textContent).toContain('Two pages share an id.');
    expect(rows[1].textContent).toContain('Skipped');
    expect(text(fixture)).not.toContain('Fully master-only.');
    expect(buttonContaining(fixture, 'Left out')?.getAttribute('aria-expanded')).toBe('false');
    expect(buttonContaining(fixture, 'Failing checks')?.getAttribute('aria-expanded')).toBe('true');

    buttonContaining(fixture, 'Warnings')?.click();
    await settle(fixture);
    expect(text(fixture)).toContain('tavern');
    expect(text(fixture)).toContain('Two spaces in a row.');
  });

  it('changes: three groups with their counts and titles', async () => {
    const fake = new FakeEncyclopediaApi();
    fake.current = built({
      changes: {
        added: [{ id: 'a', title: 'New Inn' }],
        changed: [
          { id: 'b', title: 'Old Keep' },
          { id: 'c', title: 'Duke Varn' },
        ],
        removed: [],
      },
    });
    const fixture = await setup(fake);
    const groups = [...root(fixture).querySelectorAll('.group-block')].map((block) => block.textContent ?? '');
    expect(groups).toHaveLength(3);
    expect(groups[0]).toContain('Added');
    expect(groups[0]).toContain('New Inn');
    expect(groups[1]).toContain('Changed');
    expect(groups[1]).toContain('2');
    expect(groups[1]).toContain('Duke Varn');
    expect(groups[2]).toContain('Removed');
    expect(groups[2]).toContain('0');
    expect(text(fixture)).not.toContain('No changes since the last update.');
  });

  it('changes that cannot be computed say so, and are not reported as no changes', async () => {
    const fake = new FakeEncyclopediaApi();
    fake.current = built({ changes: null });
    const fixture = await setup(fake);
    expect(text(fixture)).toContain('cannot be compared right now');
    expect(text(fixture)).not.toContain('No changes since the last update.');
  });

  it('settings: Save is disabled until a change, and disabled again with zero kinds', async () => {
    const fake = new FakeEncyclopediaApi();
    fake.current = built();
    const fixture = await setup(fake);
    expect(saveButton(fixture).disabled).toBe(true);

    kindBox(fixture, 'Items').click();
    await settle(fixture);
    expect(saveButton(fixture).disabled).toBe(true);
    expect(text(fixture)).toContain('Choose at least one kind of entry.');
  });

  it('settings: Save sends the edited object in the fixed order, then shows the answer and the out-of-date state', async () => {
    const fake = new FakeEncyclopediaApi();
    fake.current = built();
    fake.saveResult = async (settings) => built({ settings, report: report({ settings: ITEMS_ONLY }), changes: null });
    const fixture = await setup(fake);

    kindBox(fixture, 'Places').click();
    await settle(fixture);
    expect(saveButton(fixture).disabled).toBe(false);

    root(fixture).querySelector<HTMLButtonElement>('.switch')?.click();
    await settle(fixture);

    saveButton(fixture).click();
    await settle(fixture);

    expect(fake.saveCalls).toEqual([{ kinds: ['place', 'item'], flavourText: false, list: 'full' }]);
    expect(badge(fixture)).toBe('Out of date');
    expect(text(fixture)).toContain('Saved. Update the Codex to publish the changes.');
    expect(text(fixture)).toContain('Entry text is off: the Codex shows only titles and pictures.');
    expect(saveButton(fixture).disabled).toBe(true);
  });

  it('settings: a failed save shows the plain message and keeps the edits', async () => {
    const fake = new FakeEncyclopediaApi();
    fake.current = built();
    fake.saveResult = async () => {
      throw new CallFailure(409, 'The Codex is not turned on.', null);
    };
    const fixture = await setup(fake);
    kindBox(fixture, 'Places').click();
    await settle(fixture);
    saveButton(fixture).click();
    await settle(fixture);
    expect(root(fixture).querySelector('#codex-settings-title')?.parentElement?.textContent).toContain('The Codex is not turned on.');
    expect(kindBox(fixture, 'Places').checked).toBe(true);
  });

  it('flavour text off: the dashboard warns that the Codex shows only titles and pictures', async () => {
    const fake = new FakeEncyclopediaApi();
    fake.current = built({ settings: { kinds: ['item'], flavourText: false, list: 'full' } });
    const fixture = await setup(fake);
    expect(text(fixture)).toContain('only titles and pictures');
    expect(root(fixture).querySelector('.notice.warn')).not.toBeNull();
  });

  it('preview: disabled when never built; the frame of /enc/ when built and selected', async () => {
    const never = await setup(new FakeEncyclopediaApi());
    expect(previewTab(never).disabled).toBe(true);
    expect(root(never).querySelector('iframe')).toBeNull();
    TestBed.resetTestingModule();

    const fake = new FakeEncyclopediaApi();
    fake.current = built();
    const fixture = await setup(fake);
    expect(previewTab(fixture).disabled).toBe(false);
    previewTab(fixture).click();
    await settle(fixture);
    const iframe = root(fixture).querySelector('iframe');
    expect(iframe?.getAttribute('src')).toBe('/enc/');
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(iframe?.getAttribute('title')).toBeTruthy();
    expect(previewTab(fixture).getAttribute('aria-selected')).toBe('true');
  });

  it('a remembered Preview tab falls back to Status when the Codex was never built', async () => {
    localStorage.setItem('codex.tab', 'preview');
    const fixture = await setup(new FakeEncyclopediaApi());
    expect(root(fixture).querySelector('iframe')).toBeNull();
    expect(root(fixture).querySelector('#codex-tab-status')?.getAttribute('aria-selected')).toBe('true');
  });

  it('no element shows the public address or the publishing note', async () => {
    const fake = new FakeEncyclopediaApi();
    fake.current = built();
    const fixture = await setup(fake);
    expect(text(fixture)).not.toContain('localhost');
    expect(text(fixture)).not.toContain('Address of the Codex');
    expect(text(fixture)).not.toContain('Publishing is not set up');
    expect(root(fixture).querySelector('code')).toBeNull();
  });
});

describe('helpers', () => {
  it('entryName strips the folders and .md', () => {
    expect(entryName('places/taverns/the-tavern.md')).toBe('the-tavern');
    expect(entryName('loose.md')).toBe('loose');
  });

  it('sameSettings compares kinds as a set', () => {
    expect(sameSettings({ kinds: ['item', 'place'], flavourText: true, list: 'full' }, { kinds: ['place', 'item'], flavourText: true, list: 'full' })).toBe(true);
    expect(sameSettings(ITEMS_ONLY, { ...ITEMS_ONLY, list: 'discovered' })).toBe(false);
  });

  it('reportFromBody reads the report from a failed build body', () => {
    expect(reportFromBody({ error: 'x', report: report({ ok: false }) })?.ok).toBe(false);
  });

  it('reportFromBody accepts a bare report and rejects anything else', () => {
    expect(reportFromBody(report())?.entries).toBe(3);
    expect(reportFromBody({ error: 'x' })).toBeNull();
    expect(reportFromBody(null)).toBeNull();
  });
});
