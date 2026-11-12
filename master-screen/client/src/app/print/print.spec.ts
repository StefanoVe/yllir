import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import type { PrintCard, PrintSheetResult, PrintState, PrintStatus } from '@shared/types';
import { CallFailure } from '../encyclopedia/call-json';
import { PrintApiService, type PrintSheetsRequest } from './print-api.service';
import { PrintPage, buildSheetsRequest, clampCopies, matchesFilter } from './print';

const CARDS: PrintCard[] = [
  { id: 'c1', title: 'Tavern', path: 'places/tavern.md', category: 'Places', print: 'to-print', hasImage: true, personal: false },
  { id: 'c2', title: 'Alia', path: 'characters/alia.md', category: 'Characters', print: 'printed', hasImage: true, personal: false },
  { id: 'c3', title: 'Bran', path: 'characters/bran.md', category: 'Characters', print: null, hasImage: false, personal: true },
  { id: 'c4', title: 'Port', path: 'places/port.md', category: 'Places', print: 'reprint', hasImage: true, personal: false },
];

function status(cards: PrintCard[] = CARDS): PrintStatus {
  return {
    enabled: true,
    cards,
    renderer: 'node',
    format: '5x7',
    cmyk: false,
    baseUrl: 'http://localhost/',
    encyclopediaEnabled: true,
  };
}

function sheetResult(overrides: Partial<PrintSheetResult> = {}): PrintSheetResult {
  return {
    ok: true,
    file: '.campaign/cache/print/sheets-20261112-1.pdf',
    fileUrl: '/api/print/files/sheets-20261112-1.pdf',
    pages: 2,
    excluded: [],
    warnings: [],
    ...overrides,
  };
}

/** Fake of the print API. Every call is recorded; each answer can be replaced by a test. */
class FakePrintApi {
  current: PrintStatus = status();
  calls: unknown[][] = [];
  setStateImpl: (id: string, state: PrintState) => Promise<PrintStatus> = async (id, state) => this.withState(id, state);
  renderImpl: (id: string) => Promise<PrintStatus> = async () => this.current;
  sheetsImpl: (body: PrintSheetsRequest) => Promise<PrintSheetResult> = async () => sheetResult();

  status(): Promise<PrintStatus> {
    return Promise.resolve(this.current);
  }

  setState(id: string, state: PrintState): Promise<PrintStatus> {
    this.calls.push(['setState', id, state]);
    return this.setStateImpl(id, state);
  }

  render(id: string): Promise<PrintStatus> {
    this.calls.push(['render', id]);
    return this.renderImpl(id);
  }

  sheets(body: PrintSheetsRequest): Promise<PrintSheetResult> {
    this.calls.push(['sheets', body]);
    return this.sheetsImpl(body);
  }

  withState(id: string, state: PrintState): PrintStatus {
    const cards = this.current.cards.map((card) => (card.id === id ? { ...card, print: state } : card));
    this.current = { ...this.current, cards };
    return this.current;
  }
}

async function settle(fixture: ComponentFixture<PrintPage>): Promise<void> {
  for (let step = 0; step < 4; step++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  }
}

async function setup(fake: FakePrintApi): Promise<ComponentFixture<PrintPage>> {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), { provide: PrintApiService, useValue: fake }],
  });
  const fixture = TestBed.createComponent(PrintPage);
  await settle(fixture);
  return fixture;
}

function root(fixture: ComponentFixture<PrintPage>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function titles(fixture: ComponentFixture<PrintPage>): string[] {
  return [...root(fixture).querySelectorAll('li.row .row-title')].map((node) => node.textContent?.trim() ?? '');
}

function row(fixture: ComponentFixture<PrintPage>, title: string): HTMLElement {
  const found = [...root(fixture).querySelectorAll<HTMLElement>('li.row')].find(
    (item) => item.querySelector('.row-title')?.textContent?.trim() === title,
  );
  if (!found) throw new Error(`no row for ${title}`);
  return found;
}

function selectIn(scope: ParentNode, selector: string): HTMLSelectElement {
  return scope.querySelector(selector) as HTMLSelectElement;
}

function choose(element: HTMLSelectElement | HTMLInputElement, value: string): void {
  element.value = value;
  element.dispatchEvent(new Event('change'));
}

function openMenu(fixture: ComponentFixture<PrintPage>, title: string): void {
  const button = root(fixture).querySelector(`button[aria-label="Actions for ${title}"]`) as HTMLButtonElement;
  button.click();
}

function buttonWithText(scope: ParentNode, text: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll('button')].find((button) => button.textContent?.trim() === text);
  if (!found) throw new Error(`no button "${text}"`);
  return found as HTMLButtonElement;
}

describe('clampCopies', () => {
  it('keeps copies between 1 and 20 and rounds them', () => {
    expect(clampCopies(0)).toBe(1);
    expect(clampCopies(-4)).toBe(1);
    expect(clampCopies(21)).toBe(20);
    expect(clampCopies(2.6)).toBe(3);
    expect(clampCopies('7')).toBe(7);
  });

  it('returns null for text that is not a number', () => {
    expect(clampCopies('')).toBeNull();
    expect(clampCopies('abc')).toBeNull();
    expect(clampCopies(Number.NaN)).toBeNull();
  });
});

describe('matchesFilter and buildSheetsRequest', () => {
  it('filters by state, with "none" for cards without a state', () => {
    expect(CARDS.filter((card) => matchesFilter(card, 'printed')).map((card) => card.id)).toEqual(['c2']);
    expect(CARDS.filter((card) => matchesFilter(card, 'none')).map((card) => card.id)).toEqual(['c3']);
    expect(CARDS.filter((card) => matchesFilter(card, 'all'))).toHaveLength(4);
  });

  it('builds the request from the selection, in list order, with copies only for personal cards', () => {
    const body = buildSheetsRequest(CARDS, new Set(['c3', 'c1', 'c2']), { c3: 4, c1: 9 }, 'a4', true);
    expect(body).toEqual({ ids: ['c1', 'c2', 'c3'], format: 'a4', cmyk: true, copies: { c3: 4 } });
  });

  it('gives a personal card one copy when no copies were chosen', () => {
    expect(buildSheetsRequest(CARDS, new Set(['c3']), {}, '5x7', false).copies).toEqual({ c3: 1 });
  });
});

describe('PrintPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('filters the list by state', async () => {
    const fixture = await setup(new FakePrintApi());
    expect(titles(fixture)).toEqual(['Tavern', 'Alia', 'Bran', 'Port']);

    choose(selectIn(root(fixture), '.list-tools select'), 'printed');
    await settle(fixture);
    expect(titles(fixture)).toEqual(['Alia']);

    choose(selectIn(root(fixture), '.list-tools select'), 'none');
    await settle(fixture);
    expect(titles(fixture)).toEqual(['Bran']);
  });

  it('shows each state with an icon and words', async () => {
    const fixture = await setup(new FakePrintApi());
    expect(row(fixture, 'Tavern').querySelector('.chip')?.textContent).toContain('To print');
    expect(row(fixture, 'Alia').querySelector('.chip')?.textContent).toContain('Printed');
    expect(row(fixture, 'Port').querySelector('.chip')?.textContent).toContain('Reprint');
    expect(row(fixture, 'Bran').querySelector('.chip')?.textContent).toContain('No state yet');
    expect(row(fixture, 'Bran').querySelector('.chip svg')).not.toBeNull();
  });

  it('select all selects the cards on screen only, and clear empties the selection', async () => {
    const fixture = await setup(new FakePrintApi());
    choose(selectIn(root(fixture), '.list-tools select'), 'to-print');
    await settle(fixture);
    buttonWithText(root(fixture), 'Select all shown').click();
    await settle(fixture);
    expect(root(fixture).textContent).toContain('Selected: 1');

    choose(selectIn(root(fixture), '.list-tools select'), 'all');
    await settle(fixture);
    buttonWithText(root(fixture), 'Clear selection').click();
    await settle(fixture);
    expect(root(fixture).textContent).toContain('Selected: 0');
  });

  it('keeps the copies of a personal card between 1 and 20', async () => {
    const fixture = await setup(new FakePrintApi());
    const input = row(fixture, 'Bran').querySelector('input[type="number"]') as HTMLInputElement;
    expect(input.value).toBe('1');

    choose(input, '25');
    await settle(fixture);
    expect(input.value).toBe('20');

    choose(input, '0');
    await settle(fixture);
    expect(input.value).toBe('1');

    choose(input, '');
    await settle(fixture);
    expect(input.value).toBe('1');
  });

  it('asks for confirmation before a card is set to printed, and sends it only after the confirmation', async () => {
    const fake = new FakePrintApi();
    const fixture = await setup(fake);
    openMenu(fixture, 'Tavern');
    await settle(fixture);

    const menuSelect = selectIn(row(fixture, 'Tavern'), 'select');
    choose(menuSelect, 'printed');
    await settle(fixture);
    expect(fake.calls).toEqual([]);
    expect(row(fixture, 'Tavern').textContent).toContain('Mark Tavern as printed?');
    expect(menuSelect.value).toBe('to-print');

    buttonWithText(row(fixture, 'Tavern'), 'Yes, mark as printed').click();
    await settle(fixture);
    expect(fake.calls).toEqual([['setState', 'c1', 'printed']]);
    expect(row(fixture, 'Tavern').querySelector('.chip')?.textContent).toContain('Printed');
  });

  it('cancelling the confirmation sends nothing', async () => {
    const fake = new FakePrintApi();
    const fixture = await setup(fake);
    openMenu(fixture, 'Tavern');
    await settle(fixture);
    choose(selectIn(row(fixture, 'Tavern'), 'select'), 'printed');
    await settle(fixture);
    buttonWithText(row(fixture, 'Tavern'), 'Cancel').click();
    await settle(fixture);
    expect(fake.calls).toEqual([]);
    expect(row(fixture, 'Tavern').textContent).not.toContain('Mark Tavern as printed?');
  });

  it('no optimistic state: the chip changes only after the server answers', async () => {
    const fake = new FakePrintApi();
    let answer: (value: PrintStatus) => void = () => undefined;
    fake.setStateImpl = () => new Promise<PrintStatus>((resolve) => (answer = resolve));
    const fixture = await setup(fake);
    openMenu(fixture, 'Tavern');
    await settle(fixture);

    choose(selectIn(row(fixture, 'Tavern'), 'select'), 'reprint');
    await settle(fixture);
    expect(fake.calls).toEqual([['setState', 'c1', 'reprint']]);
    expect(row(fixture, 'Tavern').querySelector('.chip')?.textContent).toContain('To print');
    expect(selectIn(row(fixture, 'Tavern'), 'select').disabled).toBe(true);

    answer(fake.withState('c1', 'reprint'));
    await settle(fixture);
    expect(row(fixture, 'Tavern').querySelector('.chip')?.textContent).toContain('Reprint');
  });

  it('a refused state change keeps the old state and shows the message on the card', async () => {
    const fake = new FakePrintApi();
    fake.setStateImpl = async () => {
      throw new CallFailure(409, 'The card is being rebuilt.');
    };
    const fixture = await setup(fake);
    openMenu(fixture, 'Tavern');
    await settle(fixture);
    choose(selectIn(row(fixture, 'Tavern'), 'select'), 'reprint');
    await settle(fixture);
    expect(row(fixture, 'Tavern').querySelector('.chip')?.textContent).toContain('To print');
    expect(row(fixture, 'Tavern').querySelector('[role="alert"]')?.textContent).toContain('The card is being rebuilt.');
    expect(selectIn(row(fixture, 'Tavern'), 'select').value).toBe('to-print');
  });

  it('shows the Photoshop refusal of a card image inline on that card', async () => {
    const fake = new FakePrintApi();
    fake.renderImpl = async () => {
      throw new CallFailure(409, 'Photoshop is needed for this image. Open Photoshop and try again.');
    };
    const fixture = await setup(fake);
    openMenu(fixture, 'Bran');
    await settle(fixture);
    buttonWithText(row(fixture, 'Bran'), 'Make card image').click();
    await settle(fixture);
    expect(fake.calls).toEqual([['render', 'c3']]);
    expect(row(fixture, 'Bran').querySelector('[role="alert"]')?.textContent).toContain('Photoshop is needed');
    expect(row(fixture, 'Tavern').querySelector('[role="alert"]')).toBeNull();
  });

  it('sends the selection as the sheets request and shows the result with a PDF link', async () => {
    const fake = new FakePrintApi();
    fake.sheetsImpl = async () =>
      sheetResult({ pages: 1, excluded: [{ id: 'c4', reason: 'No image yet.' }], warnings: [{ code: 'x', message: 'Small text.' }] });
    const fixture = await setup(fake);

    const checkboxes = [...root(fixture).querySelectorAll<HTMLInputElement>('input.pick')];
    checkboxes[0].click(); // Tavern
    checkboxes[2].click(); // Bran
    await settle(fixture);
    choose(row(fixture, 'Bran').querySelector('input[type="number"]') as HTMLInputElement, '3');
    await settle(fixture);
    choose(selectIn(root(fixture), '.toolbar select'), 'a4');
    (root(fixture).querySelector('.toolbar input[type="checkbox"]') as HTMLInputElement).click();
    await settle(fixture);

    buttonWithText(root(fixture), 'Make sheets').click();
    await settle(fixture);

    expect(fake.calls).toEqual([
      ['sheets', { ids: ['c1', 'c3'], format: 'a4', cmyk: true, copies: { c3: 3 } }],
    ]);
    const text = root(fixture).textContent ?? '';
    expect(text).toContain('1 page was made.');
    expect(text).toContain('Port: No image yet.');
    expect(text).toContain('Small text.');
    const link = root(fixture).querySelector('a[href="/api/print/files/sheets-20261112-1.pdf"]');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener');
    expect(root(fixture).querySelector('object[type="application/pdf"]')).not.toBeNull();
  });

  it('the sheets button is disabled while nothing is selected', async () => {
    const fixture = await setup(new FakePrintApi());
    expect(buttonWithText(root(fixture), 'Make sheets').disabled).toBe(true);
    expect(root(fixture).textContent).toContain('Select at least one card');
  });

  it('shows a failed sheets request as plain text', async () => {
    const fake = new FakePrintApi();
    fake.sheetsImpl = async () => {
      throw new CallFailure(409, 'Another sheet job is running. Wait and try again.');
    };
    const fixture = await setup(fake);
    (root(fixture).querySelector('input.pick') as HTMLInputElement).click();
    await settle(fixture);
    buttonWithText(root(fixture), 'Make sheets').click();
    await settle(fixture);
    expect(root(fixture).querySelector('.sheets [role="alert"]')?.textContent).toContain('Another sheet job is running.');
  });

  it('warns when the encyclopedia is off', async () => {
    const fake = new FakePrintApi();
    fake.current = { ...status(), encyclopediaEnabled: false };
    const fixture = await setup(fake);
    expect(root(fixture).textContent).toContain('the QR codes will not open a page yet');
    expect(root(fixture).textContent).toContain('http://localhost/');
  });

  it('uses the format and CMYK defaults from the status', async () => {
    const fake = new FakePrintApi();
    fake.current = { ...status(), format: 'a4', cmyk: true };
    const fixture = await setup(fake);
    expect(selectIn(root(fixture), '.toolbar select').value).toBe('a4');
    expect((root(fixture).querySelector('.toolbar input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
  });
});
