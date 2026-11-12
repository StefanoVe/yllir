import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { openFixture, yamlWithModules, type Fixture } from './fixture.js';

const CARD = {
  id: 'mappa',
  title: 'Mappa',
  path: 'places/mappa.md',
  category: 'places',
  print: 'to-print',
  hasImage: false,
  personal: false,
};

const LIST = { cards: [CARD], renderer: 'node', format: '5x7', cmyk: false, baseUrl: 'http://localhost/' };
const FILE = 'sheets-20261112T100000Z.pdf';
const PHOTOSHOP = 'Cards with Photoshop are made by the assistant; ask it in the chat.';

describe('print routes with the module off', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await openFixture(yamlWithModules({ encyclopedia: true, print: false }));
  });
  afterEach(async () => {
    await f.close();
  });

  it('answers the disabled status without running anything', async () => {
    const res = await f.call('GET', '/api/print');
    assert.equal(res.status, 200);
    const body = res.json as { enabled: boolean; cards: unknown[]; encyclopediaEnabled: boolean };
    assert.equal(body.enabled, false);
    assert.deepEqual(body.cards, []);
    assert.equal(body.encyclopediaEnabled, true);
    assert.deepEqual(await f.fake.calls(), []);
  });

  it('refuses state, render and sheets without running anything', async () => {
    const state = await f.call('POST', '/api/print/state', { id: 'mappa', state: 'printed' });
    const render = await f.call('POST', '/api/print/render', { id: 'mappa' });
    const sheets = await f.call('POST', '/api/print/sheets', {});
    assert.equal(state.status, 409);
    assert.equal(render.status, 409);
    assert.equal(sheets.status, 409);
    assert.deepEqual(await f.fake.calls(), []);
  });

  it('does not serve a sheets file', async () => {
    const res = await f.call('GET', `/api/print/files/${FILE}`);
    assert.equal(res.status, 404);
  });
});

describe('print status and state', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await openFixture(yamlWithModules({ encyclopedia: false, print: true }));
    await f.fake.respond('list', { code: 0, json: LIST });
  });
  afterEach(async () => {
    await f.close();
  });

  it('merges the CLI list with the encyclopedia flag', async () => {
    const res = await f.call('GET', '/api/print');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, {
      enabled: true,
      cards: [CARD],
      renderer: 'node',
      format: '5x7',
      cmyk: false,
      baseUrl: 'http://localhost/',
      encyclopediaEnabled: false,
    });
    assert.deepEqual((await f.fake.calls()).map((c) => c.args), [['list', f.root]]);
  });

  it('changes the state through the CLI, refreshes the list and publishes changes', async () => {
    const res = await f.call('POST', '/api/print/state', { id: 'mappa', state: 'printed' });
    assert.equal(res.status, 200);
    assert.equal((res.json as { cards: unknown[] }).cards.length, 1);
    const calls = (await f.fake.calls()).map((c) => c.args);
    assert.deepEqual(calls, [
      ['state', f.root, '--id', 'mappa', '--state', 'printed'],
      ['list', f.root],
    ]);
    assert.deepEqual(f.events, ['changes']);
  });

  it('rejects bad ids and states before any run', async () => {
    for (const body of [
      { id: '../etc', state: 'printed' },
      { id: 'Mappa Grande', state: 'printed' },
      { id: 'mappa', state: 'done' },
      { id: 'mappa' },
      { id: 'x'.repeat(121), state: 'printed' },
    ]) {
      const res = await f.call('POST', '/api/print/state', body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    assert.deepEqual(await f.fake.calls(), []);
  });

  it('answers 409 with the safe framework sentence, or a generic one, and publishes nothing', async () => {
    await f.fake.respond('state', { code: 1, json: { ok: false, error: 'not-found', message: 'no card with id mappa' } });
    const safe = await f.call('POST', '/api/print/state', { id: 'mappa', state: 'printed' });
    assert.equal(safe.status, 409);
    assert.equal((safe.json as { error: string }).error, 'That card does not exist.');

    await f.fake.respond('state', { code: 1, json: { ok: false, error: 'odd', message: 'ENOENT: /Users/x/places/mappa.md' } });
    const unsafe = await f.call('POST', '/api/print/state', { id: 'mappa', state: 'printed' });
    assert.equal(unsafe.status, 409);
    assert.equal((unsafe.json as { error: string }).error, 'The card could not be updated. Try again.');
    assert.doesNotMatch(unsafe.text, /Users|ENOENT/);
    assert.deepEqual(f.events, []);
  });

  it('answers in Italian for an Italian campaign', async () => {
    const it = await openFixture(yamlWithModules({ encyclopedia: false, print: true }, 'it'));
    try {
      await it.fake.respond('state', { code: 1, json: {} });
      const res = await it.call('POST', '/api/print/state', { id: 'mappa', state: 'printed' });
      assert.equal((res.json as { error: string }).error, 'La scheda non è stata aggiornata. Riprova.');
    } finally {
      await it.close();
    }
  });
});

describe('print render', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await openFixture(yamlWithModules({ encyclopedia: false, print: true }));
    await f.fake.respond('list', { code: 0, json: LIST });
  });
  afterEach(async () => {
    await f.close();
  });

  it('refuses the Photoshop renderer without running anything', async () => {
    const res = await f.call('POST', '/api/print/render', { id: 'mappa', renderer: 'photoshop' });
    assert.equal(res.status, 409);
    assert.equal((res.json as { error: string }).error, PHOTOSHOP);
    assert.deepEqual(await f.fake.calls(), []);
  });

  it('runs only the Node renderer for auto and node', async () => {
    const auto = await f.call('POST', '/api/print/render', { id: 'mappa', renderer: 'auto' });
    const bare = await f.call('POST', '/api/print/render', { id: 'mappa' });
    assert.equal(auto.status, 200);
    assert.equal(bare.status, 200);
    const renders = (await f.fake.calls()).map((c) => c.args).filter((args) => args[0] === 'render-card');
    assert.deepEqual(renders, [
      ['render-card', f.root, '--id', 'mappa', '--renderer', 'node'],
      ['render-card', f.root, '--id', 'mappa', '--renderer', 'node'],
    ]);
  });

  it('answers 409 plainly when the render fails, with a bad id refused first', async () => {
    const bad = await f.call('POST', '/api/print/render', { id: '../x' });
    assert.equal(bad.status, 400);
    await f.fake.respond('render-card', { code: 1, raw: '' });
    const res = await f.call('POST', '/api/print/render', { id: 'mappa' });
    assert.equal(res.status, 409);
    assert.equal((res.json as { error: string }).error, 'The card image could not be made. Try again.');
  });
});

describe('print sheets', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await openFixture(yamlWithModules({ encyclopedia: false, print: true }));
  });
  afterEach(async () => {
    await f.close();
  });

  it('rejects out-of-bound bodies before any run', async () => {
    const many = Array.from({ length: 201 }, (_, i) => `card-${i}`);
    const bodies: unknown[] = [
      { ids: many },
      { ids: [] },
      { ids: ['Bad Id'] },
      { copies: { mappa: 21 } },
      { copies: { mappa: 0 } },
      { copies: { mappa: 1.5 } },
      { format: 'letter' },
      { cmyk: 'yes' },
    ];
    for (const body of bodies) {
      const res = await f.call('POST', '/api/print/sheets', body);
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
    }
    assert.deepEqual(await f.fake.calls(), []);
  });

  it('makes the sheets with the flags and answers the file URL', async () => {
    await f.fake.respond('sheets', {
      code: 0,
      json: {
        ok: true,
        file: `.campaign/cache/print/${FILE}`,
        pages: 2,
        excluded: [{ id: 'bozza', reason: 'The card has no image yet.' }],
        warnings: [],
      },
    });
    const res = await f.call('POST', '/api/print/sheets', {
      ids: ['mappa'],
      copies: { mappa: 2 },
      format: 'a4',
      cmyk: true,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, {
      ok: true,
      file: `.campaign/cache/print/${FILE}`,
      fileUrl: `/api/print/files/${FILE}`,
      pages: 2,
      excluded: [{ id: 'bozza', reason: 'The card has no image yet.' }],
      warnings: [],
    });
    assert.deepEqual((await f.fake.calls()).map((c) => c.args), [
      ['sheets', f.root, '--ids', 'mappa', '--format', 'a4', '--copies', 'mappa=2', '--cmyk', 'true'],
    ]);
  });

  it('answers 409 when the CLI fails or the file name is wrong', async () => {
    await f.fake.respond('sheets', { code: 1, json: { ok: false, error: 'usage', message: 'the campaign folder is required' } });
    const failed = await f.call('POST', '/api/print/sheets', {});
    assert.equal(failed.status, 409);
    assert.equal((failed.json as { error: string }).error, 'the campaign folder is required');

    await f.fake.respond('sheets', { code: 0, json: { ok: true, file: '../../etc/passwd.pdf', pages: 1 } });
    const odd = await f.call('POST', '/api/print/sheets', {});
    assert.equal(odd.status, 409);
    assert.equal((odd.json as { error: string }).error, 'The sheets could not be made. Try again.');
  });

  it('refuses a second sheet job while one runs', async () => {
    await f.fake.respond('sheets', { code: 0, json: { ok: true, file: `.campaign/cache/print/${FILE}`, pages: 1 }, sleepMs: 900 });
    const first = f.call('POST', '/api/print/sheets', {});
    await new Promise((resolve) => setTimeout(resolve, 250));
    const second = await f.call('POST', '/api/print/sheets', {});
    assert.equal(second.status, 409);
    assert.match((second.json as { error: string }).error, /Another build or sheet job is running/);
    assert.equal((await first).status, 200);
  });
});

describe('print files', () => {
  let f: Fixture;
  let dir: string;
  beforeEach(async () => {
    f = await openFixture(yamlWithModules({ encyclopedia: false, print: true }));
    dir = path.join(f.root, '.campaign', 'cache', 'print');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, FILE), '%PDF-1.4 test');
    await fs.writeFile(path.join(f.root, 'secret.pdf'), '%PDF secret');
    await fs.symlink(path.join(f.root, 'secret.pdf'), path.join(dir, 'sheets-20261112T100001Z.pdf'));
  });
  afterEach(async () => {
    await f.close();
  });

  it('serves a generated PDF inline with the PDF type and nosniff', async () => {
    const res = await f.call('GET', `/api/print/files/${FILE}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/pdf');
    assert.equal(res.headers['content-disposition'], `inline; filename="${FILE}"`);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.text, '%PDF-1.4 test');
  });

  it('refuses names that do not match the pattern, traversal, symlinks out and missing files', async () => {
    for (const name of [
      'sheets-x.pdf',
      'other.pdf',
      `${FILE}.exe`,
      '..%2Fsecret.pdf',
      '%2e%2e%2Fsecret.pdf',
      'sheets-20261112T100001Z.pdf',
      'sheets-20261112T100009Z.pdf',
    ]) {
      const res = await f.call('GET', `/api/print/files/${name}`);
      assert.equal(res.status, 404, name);
      assert.doesNotMatch(res.text, /secret/, name);
    }
  });
});
