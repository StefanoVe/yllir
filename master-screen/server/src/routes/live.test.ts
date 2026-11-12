import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Board, CombatState, LiveSnapshot } from '../../../shared/src/types.js';
import { emptyBoard } from '../live/board.js';
import { COMBAT_LIB, LOG_LIB } from '../live/framework.js';
import {
  get,
  makeCampaign,
  makeFramework,
  send,
  sendRaw,
  startApp,
  type Harness,
} from '../live/test-support.js';
import { domainMessage } from './live.js';
import { liveTexts } from '../live/text.js';

const REAL_FRAMEWORK = fileURLToPath(new URL('../../../../yllir', import.meta.url));
const REAL_LIBS = fs.existsSync(path.join(REAL_FRAMEWORK, LOG_LIB)) && fs.existsSync(path.join(REAL_FRAMEWORK, COMBAT_LIB));

const HEX40 = /^[0-9a-f]{40}$/;

const harnesses: Harness[] = [];
after(async () => {
  for (const h of harnesses) {
    await h.server.close();
    await h.ctx.closeAll();
  }
});

async function setup(opts: { libs?: boolean; lang?: 'en' | 'it'; files?: Record<string, string> } = {}): Promise<Harness> {
  const root = makeCampaign(opts.files ?? {}, opts.lang ?? 'en');
  const framework = makeFramework({ libs: opts.libs ?? true });
  const h = await startApp(root, framework);
  harnesses.push(h);
  return h;
}

async function openSession(h: Harness, body: unknown = {}): Promise<LiveSnapshot> {
  const res = await send(h, 'POST', '/live/open', body);
  assert.equal(res.status, 200, res.text);
  return res.json as LiveSnapshot;
}

function liveEvents(h: Harness): Array<{ revision: string }> {
  return h.events.filter((e) => e.event === 'live').map((e) => e.data as { revision: string });
}

describe('GET /api/live', () => {
  it('returns the empty snapshot when no session is open', async () => {
    const h = await setup();
    const res = await get(h, '/live');
    assert.equal(res.status, 200);
    const snap = res.json as LiveSnapshot;
    assert.equal(snap.session, null);
    assert.deepEqual(snap.log, []);
    assert.equal(snap.combat, null);
    assert.deepEqual(snap.board, emptyBoard());
    assert.match(snap.revision, HEX40);
  });

  it('answers 503 with the plain message when the framework has no live libraries (en and it)', async () => {
    const en = await setup({ libs: false });
    const resEn = await get(en, '/live');
    assert.equal(resEn.status, 503);
    assert.deepEqual(resEn.json, { error: 'This version of Yllir does not support live sessions yet.' });

    const italian = await setup({ libs: false, lang: 'it' });
    const resIt = await get(italian, '/live');
    assert.equal(resIt.status, 503);
    assert.deepEqual(resIt.json, { error: 'Questa versione di Yllir non supporta ancora le sessioni dal vivo.' });
  });

  it('reports a new revision after a session opens and after a log entry is added', async () => {
    const h = await setup();
    const before = ((await get(h, '/live')).json as LiveSnapshot).revision;
    await openSession(h);
    const afterOpen = ((await get(h, '/live')).json as LiveSnapshot).revision;
    assert.notEqual(afterOpen, before);
    await send(h, 'POST', '/live/log', { kind: 'fact', text: 'Il porto è chiuso.' });
    const afterLog = ((await get(h, '/live')).json as LiveSnapshot).revision;
    assert.notEqual(afterLog, afterOpen);
  });
});

describe('session routes', () => {
  it('opens a session, publishes live with the snapshot revision, and ends it', async () => {
    const h = await setup();
    const snap = await openSession(h, { title: 'Il faro' });
    assert.equal(snap.session?.title, 'Il faro');
    assert.match(snap.session?.id ?? '', /^\d{4}-\d{2}-\d{2}/);
    assert.deepEqual(liveEvents(h).at(-1), { revision: snap.revision });

    const ended = await send(h, 'POST', '/live/end');
    assert.equal(ended.status, 200);
    assert.equal((ended.json as LiveSnapshot).session, null);
  });

  it('answers 409 with the English sentence when a session is already open', async () => {
    const h = await setup();
    await openSession(h);
    const res = await send(h, 'POST', '/live/open', {});
    assert.equal(res.status, 409);
    assert.deepEqual(res.json, { error: 'A session is already open. End it before opening another one.' });
  });

  it('answers 409 with the Italian sentence when a session is already open', async () => {
    const h = await setup({ lang: 'it' });
    await openSession(h);
    const res = await send(h, 'POST', '/live/open', {});
    assert.equal(res.status, 409);
    assert.deepEqual(res.json, { error: 'C\'è già una sessione aperta. Chiudila prima di aprirne un\'altra.' });
  });

  it('answers 409 when ending with nothing open, in both languages', async () => {
    const en = await setup();
    assert.deepEqual((await send(en, 'POST', '/live/end')).json, {
      error: 'No session is open right now. Open one first.',
    });
    const italian = await setup({ lang: 'it' });
    const res = await send(italian, 'POST', '/live/end');
    assert.equal(res.status, 409);
    assert.deepEqual(res.json, { error: 'Nessuna sessione è aperta in questo momento. Aprine una prima.' });
  });

  it('rejects an unknown field and an unsafe sessionRef with 400', async () => {
    const h = await setup();
    assert.equal((await send(h, 'POST', '/live/open', { color: 'red' })).status, 400);
    assert.equal((await send(h, 'POST', '/live/open', { sessionRef: '../x.md' })).status, 400);
    assert.equal((await send(h, 'POST', '/live/open', { sessionRef: '/abs.md' })).status, 400);
  });

  it('rejects a body that is not JSON with 400', async () => {
    const h = await setup();
    const res = await sendRaw(h, 'POST', '/live/open', '{ nope');
    assert.equal(res.status, 400);
    assert.match((res.json as { error: string }).error, /could not be read|not valid/);
  });
});

describe('log routes', () => {
  it('refuses a log entry when no session is open', async () => {
    const h = await setup();
    const res = await send(h, 'POST', '/live/log', { kind: 'fact', text: 'x' });
    assert.equal(res.status, 409);
    assert.deepEqual(res.json, { error: 'No session is open right now. Open one first.' });
  });

  it('stores the text verbatim and returns it verbatim, marked as the master\'s', async () => {
    const h = await setup();
    await openSession(h);
    const text = '  «Sì», disse il capitano:\n\tla nave parte alle 9.  ';
    const res = await send(h, 'POST', '/live/log', { kind: 'decision', text, scene: 'Sessione 1/Eventi/Porto.md' });
    assert.equal(res.status, 200, res.text);
    const snap = res.json as LiveSnapshot;
    assert.equal(snap.log.length, 1);
    assert.equal(snap.log[0].text, text);
    assert.equal(snap.log[0].by, 'master');
    assert.equal(snap.log[0].scene, 'Sessione 1/Eventi/Porto.md');

    const stored = JSON.parse(
      fs.readFileSync(path.join(h.ctx.campaignRoot, '.campaign/state/live', snap.session!.id, 'log.json'), 'utf8'),
    ) as Array<{ text: string }>;
    assert.equal(stored[0].text, text);
  });

  it('rejects an unknown kind, a blank text, an unsafe scene and an unknown field with 400', async () => {
    const h = await setup();
    await openSession(h);
    assert.equal((await send(h, 'POST', '/live/log', { kind: 'rumour', text: 'x' })).status, 400);
    assert.equal((await send(h, 'POST', '/live/log', { kind: 'fact', text: '   ' })).status, 400);
    assert.equal((await send(h, 'POST', '/live/log', { kind: 'fact', text: 'x', scene: '../a.md' })).status, 400);
    assert.equal((await send(h, 'POST', '/live/log', { kind: 'fact', text: 'x', by: 'agent' })).status, 400);
  });

  it('patches an entry and deletes it', async () => {
    const h = await setup();
    await openSession(h);
    const added = (await send(h, 'POST', '/live/log', { kind: 'thread', text: 'Il sigillo' })).json as LiveSnapshot;
    const id = added.log[0].id;

    const patched = await send(h, 'PATCH', `/live/log/${id}`, { resolved: true, text: 'Il sigillo spezzato' });
    assert.equal(patched.status, 200);
    const entry = (patched.json as LiveSnapshot).log[0];
    assert.equal(entry.resolved, true);
    assert.equal(entry.text, 'Il sigillo spezzato');

    const removed = await send(h, 'DELETE', `/live/log/${id}`);
    assert.equal(removed.status, 200);
    assert.deepEqual((removed.json as LiveSnapshot).log, []);
  });

  it('answers 409 for an entry that does not exist, and 400 for a bad id or an empty patch', async () => {
    const h = await setup();
    await openSession(h);
    const missing = await send(h, 'PATCH', '/live/log/e-9999', { resolved: true });
    assert.equal(missing.status, 409);
    assert.deepEqual(missing.json, { error: 'That entry does not exist any more.' });
    assert.equal((await send(h, 'DELETE', '/live/log/e-9999')).status, 409);
    assert.equal((await send(h, 'PATCH', '/live/log/bad%20id!', { resolved: true })).status, 400);
    assert.equal((await send(h, 'PATCH', '/live/log/e-0001', {})).status, 400);
  });
});

describe('combat routes', () => {
  it('refuses a combat op when no session is open', async () => {
    const h = await setup();
    const res = await send(h, 'POST', '/live/combat', { op: 'start' });
    assert.equal(res.status, 409);
    assert.deepEqual(res.json, { error: 'No session is open right now. Open one first.' });
  });

  it('starts a combat (the in-app agent flow too), refuses a second start, and shows it in the snapshot', async () => {
    const h = await setup();
    await openSession(h);
    const started = await send(h, 'POST', '/live/combat', { op: 'start' });
    assert.equal(started.status, 200, started.text);
    const combat = (started.json as LiveSnapshot).combat as CombatState;
    assert.equal(combat.active, true);

    const again = await send(h, 'POST', '/live/combat', { op: 'start' });
    assert.equal(again.status, 409);
    assert.deepEqual(again.json, { error: 'A combat is already running.' });

    const snap = (await get(h, '/live')).json as LiveSnapshot;
    assert.equal(snap.combat?.active, true);
  });

  it('plain 409 sentences for an unknown condition and a bad sheet, in Italian', async () => {
    const h = await setup({ lang: 'it' });
    await openSession(h);
    await send(h, 'POST', '/live/combat', { op: 'start' });
    const bogus = await send(h, 'POST', '/live/combat', { op: 'condition-add', id: 'c-1', condition: 'volante' });
    assert.equal(bogus.status, 409);
    assert.deepEqual(bogus.json, { error: 'Questa condizione non esiste nel sistema di gioco.' });

    const sheet = await send(h, 'POST', '/live/combat', {
      op: 'add',
      name: 'Guardia',
      side: 'enemy',
      sheet: 'missing.md',
    });
    assert.equal(sheet.status, 409);
    assert.deepEqual(sheet.json, { error: 'Questa scheda non esiste o non si può usare qui.' });
  });

  it('answers 409 invalid-state after the combat has ended', async () => {
    const h = await setup();
    await openSession(h);
    await send(h, 'POST', '/live/combat', { op: 'start' });
    await send(h, 'POST', '/live/combat', { op: 'end' });
    const res = await send(h, 'POST', '/live/combat', { op: 'next' });
    assert.equal(res.status, 409);
    assert.deepEqual(res.json, { error: 'The combat is not in the right state for that.' });
  });

  it('validates the op as a discriminated union and bounds the text', async () => {
    const h = await setup();
    await openSession(h);
    assert.equal((await send(h, 'POST', '/live/combat', { op: 'explode' })).status, 400);
    assert.equal((await send(h, 'POST', '/live/combat', { op: 'add', name: 'X' })).status, 400);
    assert.equal(
      (await send(h, 'POST', '/live/combat', { op: 'add', name: 'x'.repeat(81), side: 'enemy' })).status,
      400,
    );
    assert.equal((await send(h, 'POST', '/live/combat', { op: 'start', extra: 1 })).status, 400);
  });
});

describe('board route', () => {
  const card = (id: string) => ({ id, kind: 'document', ref: 'Mondo/Porto.md', x: 10, y: 20, w: 200, h: 120, z: 1 });

  it('refuses a board save when no session is open', async () => {
    const h = await setup();
    const res = await send(h, 'PUT', '/live/board', emptyBoard());
    assert.equal(res.status, 409);
    assert.deepEqual(res.json, { error: 'No session is open right now. Open one first.' });
  });

  it('saves a board, bumps the revision, and returns it with the snapshot', async () => {
    const h = await setup();
    await openSession(h);
    const first = await send(h, 'PUT', '/live/board', { revision: 0, cards: [card('a')], frames: [], arrows: [] });
    assert.equal(first.status, 200, first.text);
    const saved = (first.json as { board: Board }).board;
    assert.equal(saved.revision, 1);
    assert.equal(saved.cards[0].id, 'a');

    const snap = (await get(h, '/live')).json as LiveSnapshot;
    assert.equal(snap.board.revision, 1);
    assert.equal(snap.board.cards.length, 1);
  });

  it('answers 409 with the current board on a stale revision (en and it)', async () => {
    const h = await setup({ lang: 'it' });
    await openSession(h);
    await send(h, 'PUT', '/live/board', { revision: 0, cards: [card('a')], frames: [], arrows: [] });
    const stale = await send(h, 'PUT', '/live/board', { revision: 0, cards: [card('b')], frames: [], arrows: [] });
    assert.equal(stale.status, 409);
    const body = stale.json as { error: string; board: Board };
    assert.equal(body.board.revision, 1);
    assert.equal(body.board.cards[0].id, 'a');
    assert.equal(
      body.error,
      'Il tabellone è stato modificato nel frattempo. Guardalo com\'è ora e riprova.',
    );

    const en = await setup();
    await openSession(en);
    await send(en, 'PUT', '/live/board', { revision: 0, cards: [], frames: [], arrows: [] });
    const enStale = await send(en, 'PUT', '/live/board', { revision: 0, cards: [], frames: [], arrows: [] });
    assert.equal(enStale.status, 409);
    assert.equal(
      (enStale.json as { error: string }).error,
      'The board was changed somewhere else in the meantime. Look at the board as it is now and try again.',
    );
  });

  it('rejects an invalid board with 400 and changes nothing', async () => {
    const h = await setup();
    await openSession(h);
    const res = await send(h, 'PUT', '/live/board', {
      revision: 0,
      cards: [card('a')],
      frames: [],
      arrows: [{ id: 'r', from: 'a', to: 'ghost' }],
    });
    assert.equal(res.status, 400);
    const snap = (await get(h, '/live')).json as LiveSnapshot;
    assert.equal(snap.board.revision, 0);
  });

  it('publishes live after a board save', async () => {
    const h = await setup();
    await openSession(h);
    const before = liveEvents(h).length;
    await send(h, 'PUT', '/live/board', { revision: 0, cards: [], frames: [], arrows: [] });
    assert.equal(liveEvents(h).length, before + 1);
  });
});

describe('plain-language refusals', () => {
  it('maps known codes to sentences and never shows a code, a path or an English leftover in Italian', () => {
    const italian = liveTexts('it');
    const message = domainMessage(italian, { code: 'already-open', message: 'A session is already open.' });
    assert.equal(message, italian.codes['already-open']);
    assert.doesNotMatch(message, /already-open|session\.json|\/|\\/);
    for (const code of Object.keys(italian.codes)) {
      assert.doesNotMatch(italian.codes[code], /[a-z]+-[a-z]+|\.json|\.mjs/, code);
    }
  });

  it('shows the English message for an unknown code when it is plain, and a fallback when it leaks a path', () => {
    const en = liveTexts('en');
    assert.equal(
      domainMessage(en, { code: 'something-new', message: 'Only one thing may be open at a time.' }),
      'Only one thing may be open at a time.',
    );
    assert.equal(
      domainMessage(en, { code: 'something-new', message: 'Could not write /home/x/.campaign/state/live/a.json' }),
      'The action could not be completed.',
    );
  });
});

describe('master-only material never reaches the live snapshot or the plot', () => {
  it('keeps a master-only secret of a canon document out of GET /api/live', async () => {
    const secret = 'SEGRETO-DEL-MASTER-7731';
    const h = await setup({
      files: {
        'Mondo/Porto.md': `---\nid: porto\n---\n\n# Porto\n\nIl porto è grigio.\n\n<!-- master-only -->\n${secret}\n<!-- /master-only -->\n`,
      },
    });
    await openSession(h);
    await send(h, 'POST', '/live/log', { kind: 'fact', text: 'Il gruppo arriva al porto.' });
    const text = (await get(h, '/live')).text;
    assert.doesNotMatch(text, new RegExp(secret));
  });

  it('live route sources do not import the document, history or engine modules', () => {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'live');
    const files = [
      ...fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => path.join(dir, f)),
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'live.ts'),
    ];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(source, /from ['"]\.\.\/(docs|history|engine)/, path.basename(file));
    }
  });
});

describe('real framework libraries', { skip: REAL_LIBS ? false : 'the real session-log and combat-tracker libraries are not in the framework yet' }, () => {
  it('opens a session, logs an entry and ends it through the real libraries', async () => {
    const root = makeCampaign();
    const h = await startApp(root, REAL_FRAMEWORK);
    harnesses.push(h);
    const opened = await openSession(h, { title: 'Integrazione' });
    assert.equal(opened.session?.title, 'Integrazione');
    const logged = await send(h, 'POST', '/live/log', { kind: 'fact', text: 'Test' });
    assert.equal(logged.status, 200, logged.text);
    assert.equal((logged.json as LiveSnapshot).log.length, 1);
    const ended = await send(h, 'POST', '/live/end');
    assert.equal(ended.status, 200);
    assert.equal((ended.json as LiveSnapshot).session, null);
  });

  it('answers a combat without a game system with the plain sentence, in English and Italian', async () => {
    const en = await startApp(makeCampaign(), REAL_FRAMEWORK);
    harnesses.push(en);
    await openSession(en);
    const refusedEn = await send(en, 'POST', '/live/combat', { op: 'start' });
    assert.equal(refusedEn.status, 409);
    assert.deepEqual(refusedEn.json, { error: 'The game rules are not set for this campaign yet.' });

    const it = await startApp(makeCampaign({}, 'it'), REAL_FRAMEWORK);
    harnesses.push(it);
    await openSession(it);
    const refusedIt = await send(it, 'POST', '/live/combat', { op: 'start' });
    assert.equal(refusedIt.status, 409);
    assert.deepEqual(refusedIt.json, { error: 'Le regole del gioco non sono ancora impostate per questa campagna.' });
  });
});

describe('every code of the framework libraries has a sentence', () => {
  const REAL_CODES = [
    'already-active', 'already-open', 'bad-op', 'bad-sheet', 'corrupt-state', 'encounter-unavailable',
    'entry-not-found', 'invalid-by', 'invalid-id', 'invalid-kind', 'invalid-patch', 'invalid-resolved',
    'invalid-scene', 'invalid-session-id', 'invalid-session-ref', 'invalid-state', 'invalid-subjects',
    'invalid-text', 'invalid-title', 'no-active-session', 'no-adapter', 'no-combat', 'no-live-session',
    'no-session', 'not-a-campaign', 'read-failed', 'resolved-not-thread', 'session-not-found', 'unreadable',
    'write-failed', 'unknown-condition', 'validation', 'not-found',
  ];

  for (const lang of ['en', 'it'] as const) {
    it(`maps every code in ${lang}`, () => {
      const texts = liveTexts(lang);
      for (const code of REAL_CODES) {
        assert.ok(Object.prototype.hasOwnProperty.call(texts.codes, code), `${lang}: ${code}`);
        assert.doesNotMatch(texts.codes[code], /[a-z]+-[a-z]+ |\.json|\.mjs/, `${lang}: ${code}`);
      }
    });
  }
});
