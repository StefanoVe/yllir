import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { describe, it } from 'node:test';
import { Bus } from './bus.js';

class FakeResponse extends EventEmitter {
  headers: Record<string, unknown> | undefined;
  status: number | undefined;
  chunks: string[] = [];
  ended = false;
  failWrites = false;

  writeHead(status: number, headers: Record<string, unknown>): this {
    this.status = status;
    this.headers = headers;
    return this;
  }

  write(chunk: string): boolean {
    if (this.failWrites) throw new Error('socket gone');
    this.chunks.push(chunk);
    return true;
  }

  end(): this {
    this.ended = true;
    return this;
  }

  text(): string {
    return this.chunks.join('');
  }

  asResponse(): ServerResponse {
    return this as unknown as ServerResponse;
  }
}

function idsIn(text: string): number[] {
  return [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
}

function fakeFor(bus: Bus): FakeResponse {
  const res = new FakeResponse();
  bus.subscribe(res.asResponse());
  return res;
}

describe('Bus publish and subscribe', () => {
  it('returns increasing ids and writes an SSE frame to subscribed clients', () => {
    const bus = new Bus();
    const res = fakeFor(bus);
    const id = bus.publish('files', { changed: ['a.md'], removed: [] });
    assert.equal(id, 1);
    assert.equal(bus.publish('changes', {}), 2);
    assert.ok(
      res.text().includes(
        'id: 1\nevent: files\ndata: {"changed":["a.md"],"removed":[]}\n\n',
      ),
    );
    assert.ok(res.text().includes('id: 2\nevent: changes\ndata: {}\n\n'));
    bus.close();
  });

  it('sets SSE headers and sends the retry line first', () => {
    const bus = new Bus();
    const res = fakeFor(bus);
    assert.equal(res.status, 200);
    assert.equal(res.headers?.['Content-Type'], 'text/event-stream; charset=utf-8');
    assert.equal(res.headers?.['Cache-Control'], 'no-cache');
    assert.equal(res.headers?.Connection, 'keep-alive');
    assert.equal(res.headers?.['X-Accel-Buffering'], 'no');
    assert.equal(res.chunks[0], 'retry: 3000\n\n');
    bus.close();
  });

  it('replays only the events after lastEventId', () => {
    const bus = new Bus();
    bus.publish('changes', {});
    bus.publish('changes', {});
    bus.publish('changes', {});
    const res = new FakeResponse();
    bus.subscribe(res.asResponse(), '1');
    assert.deepEqual(idsIn(res.text()), [2, 3]);
    bus.close();
  });

  it('replays nothing for an unknown or future lastEventId', () => {
    const bus = new Bus();
    bus.publish('changes', {});
    bus.publish('changes', {});
    for (const lastId of ['abc', '-4', '', '99']) {
      const res = new FakeResponse();
      bus.subscribe(res.asResponse(), lastId);
      assert.deepEqual(idsIn(res.text()), [], `lastEventId ${JSON.stringify(lastId)}`);
    }
    bus.close();
  });

  it('keeps 500 events and replays nothing when the client is older than the buffer', () => {
    const bus = new Bus();
    for (let i = 0; i < 600; i++) bus.publish('changes', {});

    const tooOld = new FakeResponse();
    bus.subscribe(tooOld.asResponse(), '0');
    assert.deepEqual(idsIn(tooOld.text()), []);

    const edge = new FakeResponse();
    bus.subscribe(edge.asResponse(), '100');
    const ids = idsIn(edge.text());
    assert.equal(ids.length, 500);
    assert.equal(ids[0], 101);
    assert.equal(ids[499], 600);
    bus.close();
  });

  it('counts clients and notifies on connect and disconnect', () => {
    const bus = new Bus();
    const counts: number[] = [];
    bus.onClientsChange((count) => counts.push(count));

    const a = new FakeResponse();
    const b = new FakeResponse();
    bus.subscribe(a.asResponse());
    bus.subscribe(b.asResponse());
    assert.equal(bus.clientCount(), 2);

    a.emit('close');
    assert.equal(bus.clientCount(), 1);
    a.emit('close');
    assert.equal(bus.clientCount(), 1, 'a second close of the same client changes nothing');

    b.emit('error', new Error('reset'));
    assert.equal(bus.clientCount(), 0);
    assert.deepEqual(counts, [1, 2, 1, 0]);
    bus.close();
  });

  it('drops a client whose write fails', () => {
    const bus = new Bus();
    const counts: number[] = [];
    bus.onClientsChange((count) => counts.push(count));
    const res = fakeFor(bus);
    res.failWrites = true;
    bus.publish('changes', {});
    assert.equal(bus.clientCount(), 0);
    assert.deepEqual(counts, [1, 0]);
    bus.close();
  });

  it('sends a heartbeat comment to every client and stops after close', async () => {
    const bus = new Bus({ heartbeatMs: 20 });
    const res = fakeFor(bus);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.ok(res.text().includes(': ping\n\n'));

    bus.close();
    assert.equal(res.ended, true);
    assert.equal(bus.clientCount(), 0);
    const size = res.chunks.length;
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(res.chunks.length, size, 'no heartbeat after close');
  });

  it('keeps heartbeats out of the replay buffer', () => {
    const bus = new Bus({ heartbeatMs: 1000 });
    fakeFor(bus);
    assert.equal(bus.publish('changes', {}), 1);
    bus.close();
  });
});
