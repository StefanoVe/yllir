import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FRICTIONS,
  MAX_DETAIL,
  OUTCOMES,
  feedbackFile,
  latestSession,
  latestTurn,
  readEvents,
  recordEnd,
  recordEvent,
  summarize,
} from './feedback.mjs';

/** Runs `body` with a fresh temp folder as the campaign root, then removes it. */
function withRoot(body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-feedback-'));
  try {
    return body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Writes the runner result file and sets its modification time. */
function writeResult(root, text, mtime) {
  const dir = path.join(root, '.campaign', 'state', 'runner');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'result.txt');
  fs.writeFileSync(file, text);
  fs.utimesSync(file, mtime, mtime);
}

describe('feedback', () => {
  test('feedbackFile is an absolute path inside the campaign state folder', () => {
    withRoot((root) => {
      const file = feedbackFile(root);
      assert.ok(path.isAbsolute(file));
      assert.equal(file, path.join(path.resolve(root), '.campaign', 'state', 'feedback', 'events.jsonl'));
    });
  });

  test('recordEvent writes a valid turn and creates the folder', () => {
    withRoot((root) => {
      const result = recordEvent(root, { type: 'turn', session: 's1', agent: 'a', version: '0.14.0', topic: 'session 3' });
      assert.deepEqual(result, { ok: true });
      assert.ok(fs.existsSync(feedbackFile(root)));
      assert.ok(fs.existsSync(path.dirname(feedbackFile(root))));
    });
  });

  test('readEvents returns the recorded turn with a ts', () => {
    withRoot((root) => {
      recordEvent(root, { type: 'turn', session: 's1', topic: 'session 3' });
      const events = readEvents(root);
      assert.equal(events.length, 1);
      assert.equal(events[0].type, 'turn');
      assert.equal(events[0].session, 's1');
      assert.equal(events[0].topic, 'session 3');
      assert.equal(typeof events[0].ts, 'string');
      assert.ok(!Number.isNaN(Date.parse(events[0].ts)));
    });
  });

  test('an invalid type is rejected and no file is created', () => {
    withRoot((root) => {
      const result = recordEvent(root, { type: 'bogus' });
      assert.equal(result.ok, false);
      assert.equal(typeof result.error, 'string');
      assert.equal(fs.existsSync(feedbackFile(root)), false);
    });
  });

  test('a note with an unknown friction is rejected and no file is created', () => {
    withRoot((root) => {
      const result = recordEvent(root, { type: 'note', outcome: 'ok', friction: 'bored' });
      assert.equal(result.ok, false);
      assert.equal(fs.existsSync(feedbackFile(root)), false);
    });
  });

  test('every listed outcome and friction is accepted', () => {
    withRoot((root) => {
      for (const outcome of OUTCOMES) {
        for (const friction of FRICTIONS) {
          assert.deepEqual(recordEvent(root, { type: 'note', outcome, friction }), { ok: true });
        }
      }
      assert.equal(readEvents(root).length, OUTCOMES.length * FRICTIONS.length);
    });
  });

  test('a note detail with newlines and tabs is flattened', () => {
    withRoot((root) => {
      recordEvent(root, { type: 'note', outcome: 'partial', friction: 'slow', detail: 'line one\nline two\tend\r\nthree' });
      assert.equal(readEvents(root)[0].detail, 'line one line two end three');
    });
  });

  test('a note detail of 500 characters is cut to MAX_DETAIL', () => {
    withRoot((root) => {
      assert.equal(MAX_DETAIL, 200);
      recordEvent(root, { type: 'note', outcome: 'ok', friction: 'none', detail: 'a'.repeat(500) });
      assert.equal(readEvents(root)[0].detail, 'a'.repeat(200));
    });
  });

  test('an end with a string duration_s is rejected', () => {
    withRoot((root) => {
      const result = recordEvent(root, { type: 'end', duration_s: '5' });
      assert.equal(result.ok, false);
      assert.equal(fs.existsSync(feedbackFile(root)), false);
    });
  });

  test('unknown fields are dropped and the ts is set by the code', () => {
    withRoot((root) => {
      recordEvent(root, { type: 'turn', session: 's', ts: '2000-01-01T00:00:00.000Z', secret: 'campaign text', extra: 1 });
      const [event] = readEvents(root);
      assert.deepEqual(Object.keys(event).sort(), ['session', 'ts', 'type']);
      assert.notEqual(event.ts, '2000-01-01T00:00:00.000Z');
    });
  });

  test('readEvents skips a corrupt line', () => {
    withRoot((root) => {
      const file = feedbackFile(root);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const first = JSON.stringify({ type: 'turn', ts: '2026-01-01T00:00:00.000Z', session: 'a' });
      const second = JSON.stringify({ type: 'turn', ts: '2026-01-01T00:00:01.000Z', session: 'b' });
      fs.writeFileSync(file, `${first}\nnot json{\n${second}\n`);
      const events = readEvents(root);
      assert.deepEqual(events.map((event) => event.session), ['a', 'b']);
    });
  });

  test('recordEvent on an unwritable root returns ok false and does not throw', () => {
    withRoot((root) => {
      const blocker = path.join(root, 'regular-file.txt');
      fs.writeFileSync(blocker, 'not a folder');
      const result = recordEvent(path.join(blocker, 'campaign'), { type: 'turn' });
      assert.equal(result.ok, false);
      assert.equal(typeof result.error, 'string');
    });
  });

  test('latestSession is none when empty and the last session after two turns', () => {
    withRoot((root) => {
      assert.equal(latestSession(root), 'none');
      recordEvent(root, { type: 'turn', session: 's1' });
      recordEvent(root, { type: 'turn', session: 's2' });
      assert.equal(latestSession(root), 's2');
      assert.equal(latestTurn(root, 's1').session, 's1');
      assert.equal(latestTurn(root, 'missing'), null);
    });
  });

  test('recordEnd skips when there is no turn', () => {
    withRoot((root) => {
      assert.deepEqual(recordEnd(root, { session: 's1' }), { ok: true, skipped: true });
      assert.equal(readEvents(root).length, 0);
    });
  });

  test('recordEnd writes one end with a duration, and a second call is skipped', () => {
    withRoot((root) => {
      recordEvent(root, { type: 'turn', session: 's1' });
      const options = { session: 's1', agent: 'a', version: '0.14.0', process: 'after-session' };
      assert.deepEqual(recordEnd(root, options), { ok: true });

      const ends = readEvents(root).filter((event) => event.type === 'end');
      assert.equal(ends.length, 1);
      assert.equal(typeof ends[0].duration_s, 'number');
      assert.ok(ends[0].duration_s >= 0);
      assert.equal(ends[0].process, 'after-session');

      assert.deepEqual(recordEnd(root, options), { ok: true, skipped: true });
      assert.equal(readEvents(root).filter((event) => event.type === 'end').length, 1);
    });
  });

  test('recordEnd reads status, model and files from a result.txt written after the turn', () => {
    withRoot((root) => {
      recordEvent(root, { type: 'turn', session: 's1' });
      writeResult(root, 'status: ok\nmodel: haiku-test\nfiles written: a.md, b.md, c.md\n', new Date(Date.now() + 60_000));
      recordEnd(root, { session: 's1' });
      const [end] = readEvents(root).filter((event) => event.type === 'end');
      assert.equal(end.status, 'ok');
      assert.equal(end.model, 'haiku-test');
      assert.equal(end.files, 3);
    });
  });

  test('recordEnd ignores a result.txt older than the turn', () => {
    withRoot((root) => {
      recordEvent(root, { type: 'turn', session: 's1' });
      writeResult(root, 'status: blocked\nmodel: old\nfiles written: x.md\n', new Date('2001-01-01T00:00:00Z'));
      recordEnd(root, { session: 's1' });
      const [end] = readEvents(root).filter((event) => event.type === 'end');
      assert.equal(end.status, undefined);
      assert.equal(end.model, undefined);
      assert.equal(end.files, undefined);
    });
  });

  test('summarize on an empty list shows zero requests and n/a', () => {
    const text = summarize([]);
    assert.equal(text.split('\n')[0], 'requests: 0');
    assert.match(text, /n\/a/);
    assert.match(text, /by status:\n {2}none/);
    assert.equal(text.endsWith('\n'), false);
  });

  test('summarize counts statuses, frictions and outcomes', () => {
    const events = [
      { type: 'turn', ts: '2026-01-01T00:00:00.000Z' },
      { type: 'turn', ts: '2026-01-01T00:00:10.000Z' },
      { type: 'end', status: 'ok', duration_s: 10 },
      { type: 'end', status: 'ok', duration_s: 20 },
      { type: 'end', status: 'blocked', duration_s: 5 },
      { type: 'note', ts: '2026-01-01T00:00:01.000Z', outcome: 'ok', friction: 'slow', detail: 'first' },
      { type: 'note', ts: '2026-01-01T00:00:02.000Z', outcome: 'partial', friction: 'slow', detail: 'second' },
      { type: 'note', ts: '2026-01-01T00:00:03.000Z', outcome: 'ok', friction: 'none' },
    ];
    assert.equal(
      summarize(events),
      [
        'requests: 2',
        'ended: 3',
        'duration (s): median 10, max 20',
        'by status:',
        '  ok: 2',
        '  blocked: 1',
        'by friction:',
        '  slow: 2',
        '  none: 1',
        'outcomes:',
        '  ok: 2',
        '  partial: 1',
        'recent notes:',
        '  2026-01-01T00:00:03.000Z ok none',
        '  2026-01-01T00:00:02.000Z partial slow second',
        '  2026-01-01T00:00:01.000Z ok slow first',
      ].join('\n'),
    );
  });
});
