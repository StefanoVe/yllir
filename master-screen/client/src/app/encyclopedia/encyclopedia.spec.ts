import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import type { EncyclopediaReport, EncyclopediaStatus } from '@shared/types';
import { CallFailure } from './call-json';
import { EncyclopediaApiService, reportFromBody } from './encyclopedia-api.service';
import { EncyclopediaPage } from './encyclopedia';

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
    ...overrides,
  };
}

/** A fake of the API: `current` is what GET returns; `buildResult` is what POST does. */
class FakeEncyclopediaApi {
  current: EncyclopediaStatus = { enabled: true, built: false, report: null, publishing: 'not-configured' };
  buildResult: () => Promise<EncyclopediaReport> = async () => report();
  buildCalls = 0;

  status(): Promise<EncyclopediaStatus> {
    return Promise.resolve(this.current);
  }

  build(): Promise<EncyclopediaReport> {
    this.buildCalls++;
    return this.buildResult();
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

function buildButton(fixture: ComponentFixture<EncyclopediaPage>): HTMLButtonElement {
  return root(fixture).querySelector('button.primary') as HTMLButtonElement;
}

describe('EncyclopediaPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows the empty state and no preview when it was never built', async () => {
    const fixture = await setup(new FakeEncyclopediaApi());
    expect(root(fixture).textContent).toContain('has not been built yet');
    expect(root(fixture).querySelector('iframe')).toBeNull();
    expect(root(fixture).querySelector('a[href="/enc/"]')).toBeNull();
    expect(root(fixture).querySelectorAll('button')).toHaveLength(1);
    expect(root(fixture).textContent).toContain('only available on this computer');
  });

  it('shows the base address read-only with the hint about the assistant once a build exists', async () => {
    const fake = new FakeEncyclopediaApi();
    fake.current = { enabled: true, built: true, report: report(), publishing: 'not-configured' };
    const fixture = await setup(fake);
    expect(root(fixture).querySelector('code')?.textContent).toBe('http://localhost/');
    expect(root(fixture).textContent).toContain('ask the assistant in the chat');
    expect(root(fixture).querySelector('input')).toBeNull();
  });

  it('shows the module as off when it is not turned on', async () => {
    const fake = new FakeEncyclopediaApi();
    fake.current = { enabled: false, built: false, report: null, publishing: 'not-configured' };
    const fixture = await setup(fake);
    expect(root(fixture).textContent).toContain('not turned on for this campaign');
    expect(buildButton(fixture)).toBeNull();
  });

  it('while building, the button is busy and no result is shown before the server answers', async () => {
    const fake = new FakeEncyclopediaApi();
    fake.buildResult = () => new Promise<EncyclopediaReport>(() => undefined);
    const fixture = await setup(fake);
    buildButton(fixture).click();
    await settle(fixture);
    expect(buildButton(fixture).disabled).toBe(true);
    expect(buildButton(fixture).getAttribute('aria-busy')).toBe('true');
    expect(root(fixture).textContent).toContain('Building…');
    expect(root(fixture).querySelector('#enc-report-title')).toBeNull();
    expect(root(fixture).querySelector('[data-status]')).toBeNull();
  });

  it('after a successful build shows the entries, the checks with icon and text, the preview and the link', async () => {
    const fake = new FakeEncyclopediaApi();
    fake.buildResult = async () => {
      fake.current = { enabled: true, built: true, report: null, publishing: 'not-configured' };
      return report({
        entries: 3,
        checks: [
          { id: 'links', status: 'pass', message: 'All links lead somewhere.' },
          { id: 'ids', status: 'fail', message: 'Two pages share an id.' },
          { id: 'images', status: 'skipped', message: 'No images to check.' },
        ],
      });
    };
    const fixture = await setup(fake);
    buildButton(fixture).click();
    await settle(fixture);

    expect(fake.buildCalls).toBe(1);
    expect(root(fixture).textContent).toContain('The encyclopedia has 3 entries.');

    const rows = [...root(fixture).querySelectorAll<HTMLElement>('li.check')];
    expect(rows.map((row) => row.dataset['status'])).toEqual(['pass', 'fail', 'skipped']);
    for (const row of rows) {
      expect(row.querySelector('svg')).not.toBeNull();
      expect(row.querySelector('.check-status')?.textContent?.trim()).not.toBe('');
    }
    expect(rows[0].textContent).toContain('Passed');
    expect(rows[0].textContent).toContain('All links lead somewhere.');
    expect(rows[1].textContent).toContain('Failed');
    expect(rows[1].textContent).toContain('Two pages share an id.');
    expect(rows[2].textContent).toContain('Skipped');

    const iframe = root(fixture).querySelector('iframe');
    expect(iframe?.getAttribute('src')).toBe('/enc/');
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(iframe?.getAttribute('title')).toBeTruthy();
    expect(iframe?.getAttribute('loading')).toBe('lazy');

    const link = root(fixture).querySelector('a[href="/enc/"]');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener');
  });

  it('a failed build shows the server message, says nothing was changed and keeps the report rows', async () => {
    const fake = new FakeEncyclopediaApi();
    fake.buildResult = async () => {
      throw new CallFailure(409, 'A page has a broken link.', {
        error: 'A page has a broken link.',
        report: report({ ok: false, checks: [{ id: 'links', status: 'fail', message: 'One link leads nowhere.' }] }),
      });
    };
    const fixture = await setup(fake);
    buildButton(fixture).click();
    await settle(fixture);

    const alert = root(fixture).querySelector('.alert[role="alert"]');
    expect(alert?.textContent).toContain('A page has a broken link.');
    expect(alert?.textContent).toContain('Nothing was changed');

    const row = root(fixture).querySelector('li.check[data-status="fail"]');
    expect(row?.textContent).toContain('Failed');
    expect(row?.textContent).toContain('One link leads nowhere.');
    expect(root(fixture).querySelector('iframe')).toBeNull();
  });

  it('a failed build without a report still shows the plain message', async () => {
    const fake = new FakeEncyclopediaApi();
    fake.buildResult = async () => {
      throw new CallFailure(409, 'A build is already running.', { error: 'A build is already running.' });
    };
    const fixture = await setup(fake);
    buildButton(fixture).click();
    await settle(fixture);
    expect(root(fixture).querySelector('.alert')?.textContent).toContain('A build is already running.');
    expect(root(fixture).querySelector('li.check')).toBeNull();
  });

  it('lists what was left out, with the reasons, and the warnings', async () => {
    const fake = new FakeEncyclopediaApi();
    fake.current = {
      enabled: true,
      built: true,
      report: report({
        excluded: [{ path: 'places/secret.md', reason: 'Fully master-only.' }],
        warnings: [{ code: 'spacing', path: 'places/tavern.md', message: 'Two spaces in a row.' }],
      }),
      publishing: 'not-configured',
    };
    const fixture = await setup(fake);
    const text = root(fixture).textContent ?? '';
    expect(text).toContain('1 document was left out.');
    expect(text).toContain('places/secret.md: Fully master-only.');
    expect(root(fixture).querySelector('details')?.textContent).toContain('Left out and why');
    expect(text).toContain('places/tavern.md: Two spaces in a row.');
  });
});

describe('reportFromBody', () => {
  it('reads the report from a failed build body', () => {
    expect(reportFromBody({ error: 'x', report: report({ ok: false }) })?.ok).toBe(false);
  });

  it('accepts a bare report and rejects anything else', () => {
    expect(reportFromBody(report())?.entries).toBe(3);
    expect(reportFromBody({ error: 'x' })).toBeNull();
    expect(reportFromBody(null)).toBeNull();
  });
});
