import { test } from "node:test";
import { expect } from "./test-helpers/expect.js";
import { CockpitBus } from "./bus.js";
import type { CockpitEvent } from "../../../shared/src/cockpit-types.js";

const event = (value: string): CockpitEvent => ({
  type: "delta",
  messageId: value,
  text: value,
});
async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ms = 500,
) {
  return Promise.race([
    reader.read(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout stream SSE")), ms),
    ),
  ]);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

test("IDs sono monotoni e replay rispetta Last-Event-ID", async () => {
  const bus = new CockpitBus(1000);
  bus.publish("s", event("one"));
  bus.publish("s", event("two"));
  const response = await bus.subscribe("s", "1", async () => ({
    type: "deleted",
  }));
  const reader = response.body!.getReader();
  const replay = new TextDecoder().decode(
    (await readWithTimeout(reader)).value,
  );
  expect(replay).toContain("id: 2");
  expect(replay).toContain('"text":"two"');
  bus.publish("s", event("three"));
  const next = new TextDecoder().decode((await readWithTimeout(reader)).value);
  expect(next).toContain("id: 3");
  await reader.cancel();
  bus.close();
});

test("snapshot fuori copertura usa la sequenza corrente senza occupare il ring", async () => {
  const bus = new CockpitBus(1000);
  for (let i = 0; i < 501; i++) bus.publish("s", event(`e${i}`));
  const response = await bus.subscribe("s", "0", async () => ({
    type: "deleted",
  }));
  const reader = response.body!.getReader();
  const text = new TextDecoder().decode((await readWithTimeout(reader)).value);
  expect(text).toContain("id: 501");
  expect(text).toContain('"type":"deleted"');
  bus.publish("s", event("after"));
  const next = new TextDecoder().decode((await readWithTimeout(reader)).value);
  expect(next).toContain("id: 502");
  expect(next).toContain('"text":"after"');
  await reader.cancel();
  bus.close();
});

test("eventi pubblicati durante snapshot arrivano dopo, in ordine e senza duplicati", async () => {
  const bus = new CockpitBus(1000);
  const started = deferred<void>();
  const snapshot = deferred<CockpitEvent>();
  const response = await bus.subscribe("s", null, () => {
    started.resolve();
    return snapshot.promise;
  });
  const reader = response.body!.getReader();
  await started.promise;
  bus.publish("s", event("a"));
  bus.publish("s", event("b"));
  snapshot.resolve({ type: "deleted" });
  const messages = [];
  for (let i = 0; i < 3; i++)
    messages.push(
      new TextDecoder().decode((await readWithTimeout(reader)).value),
    );
  expect(messages[0]).toContain('"type":"deleted"');
  expect(messages[0]).toContain("id: 0");
  expect(messages[1]).toContain("id: 1");
  expect(messages[1]).toContain('"text":"a"');
  expect(messages[2]).toContain("id: 2");
  expect(messages[2]).toContain('"text":"b"');
  await reader.cancel();
  bus.close();
});

test("heartbeat, cancel rimuove subscriber e close chiude gli stream", async () => {
  const bus = new CockpitBus(5);
  const response = await bus.subscribe("s", null, async () => ({
    type: "deleted",
  }));
  const reader = response.body!.getReader();
  await readWithTimeout(reader);
  expect(
    new TextDecoder().decode((await readWithTimeout(reader)).value),
  ).toContain(": ping");
  await reader.cancel();
  const subscribers = (
    bus as unknown as { subscribers: Map<string, Set<unknown>> }
  ).subscribers;
  expect(subscribers.has("s")).toBe(false);
  const open = await bus.subscribe("s", null, async () => ({
    type: "deleted",
  }));
  const openReader = open.body!.getReader();
  await readWithTimeout(openReader);
  bus.close();
  expect(await readWithTimeout(openReader)).toMatchObject({ done: true });
});
