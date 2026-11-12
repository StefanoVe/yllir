// Test helpers for the live session and plot tests: temporary campaigns, stand-in framework
// libraries that follow the contract of API.md, and a real app on a free port whose bus
// publishes are recorded. Used only by *.test.ts files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';
import { createCtx, type Ctx } from '../context.js';
import { request, startServer, type RunningServer, type TestResponse } from '../testing.js';

export interface Recorded {
  event: string;
  data: unknown;
}

export function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function campaignYaml(language: 'en' | 'it'): string {
  return [
    'schema: 1',
    'campaign:',
    '  name: Test Campaign',
    '  slug: test-campaign',
    'language:',
    `  main: ${language}`,
    '',
  ].join('\n');
}

/** A temporary campaign folder with campaign.yaml and the given files (relative path -> text). */
export function makeCampaign(files: Record<string, string> = {}, language: 'en' | 'it' = 'en'): string {
  const root = tempDir('ms-live-campaign-');
  const all: Record<string, string> = { 'campaign.yaml': campaignYaml(language), ...files };
  for (const [rel, text] of Object.entries(all)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return root;
}

const LOG_STORE_SOURCE = [
  "import fs from 'node:fs';",
  "import path from 'node:path';",
  '',
  "const KINDS = ['fact', 'decision', 'intention', 'thread'];",
  "const dirOf = (root) => path.join(root, '.campaign', 'state', 'live');",
  'function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }',
  'function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\\n"); }',
  'function fail(code, message) { return { ok: false, error: { code, message } }; }',
  'function activeId(root) { const a = readJson(path.join(dirOf(root), "active.json"), null); return a && a.sessionId ? a.sessionId : null; }',
  'const sessionFile = (root, id) => path.join(dirOf(root), id, "session.json");',
  'const logFile = (root, id) => path.join(dirOf(root), id, "log.json");',
  'function entriesOf(root) { const id = activeId(root); return id ? readJson(logFile(root, id), []) : []; }',
  'function saveEntries(root, entries) { writeJson(logFile(root, activeId(root)), entries); }',
  '',
  'export function getActive(root) {',
  '  const id = activeId(root);',
  '  if (!id) return { ok: true, session: null };',
  '  return { ok: true, session: readJson(sessionFile(root, id), null) };',
  '}',
  'export function openSession(root, opts = {}) {',
  '  if (activeId(root)) return fail("already-open", "A session is already open.");',
  '  const day = new Date().toISOString().slice(0, 10);',
  '  let id = day;',
  '  for (let n = 2; fs.existsSync(path.join(dirOf(root), id)); n++) id = day + "-" + n;',
  '  const session = { id, title: opts.title || id, startedAt: new Date().toISOString() };',
  '  if (opts.sessionRef) session.sessionRef = opts.sessionRef;',
  '  writeJson(sessionFile(root, id), session);',
  '  writeJson(logFile(root, id), []);',
  '  writeJson(path.join(dirOf(root), "active.json"), { sessionId: id });',
  '  return { ok: true, session };',
  '}',
  'export function endSession(root) {',
  '  const id = activeId(root);',
  '  if (!id) return fail("no-live-session", "No session is open.");',
  '  const session = readJson(sessionFile(root, id), null);',
  '  session.endedAt = new Date().toISOString();',
  '  writeJson(sessionFile(root, id), session);',
  '  writeJson(path.join(dirOf(root), "active.json"), { sessionId: null });',
  '  return { ok: true, session };',
  '}',
  'export function listEntries(root) { return { ok: true, entries: entriesOf(root) }; }',
  'export function addEntry(root, input) {',
  '  if (!activeId(root)) return fail("no-live-session", "No session is open.");',
  '  if (!KINDS.includes(input.kind)) return fail("validation", "Unknown kind.");',
  '  const entries = entriesOf(root);',
  '  const entry = { id: "e-" + String(entries.length + 1).padStart(4, "0"), at: new Date().toISOString(), kind: input.kind, text: input.text, by: input.by || "master" };',
  '  if (input.scene) entry.scene = input.scene;',
  '  if (input.subjects) entry.subjects = input.subjects;',
  '  entries.push(entry);',
  '  saveEntries(root, entries);',
  '  return { ok: true, entry };',
  '}',
  'export function updateEntry(root, id, patch) {',
  '  const entries = entriesOf(root);',
  '  const entry = entries.find((e) => e.id === id);',
  '  if (!entry) return fail("not-found", "No such entry.");',
  '  Object.assign(entry, patch);',
  '  saveEntries(root, entries);',
  '  return { ok: true, entry };',
  '}',
  'export function removeEntry(root, id) {',
  '  const entries = entriesOf(root);',
  '  const next = entries.filter((e) => e.id !== id);',
  '  if (next.length === entries.length) return fail("not-found", "No such entry.");',
  '  saveEntries(root, next);',
  '  return { ok: true };',
  '}',
  '',
].join('\n');

const COMBAT_STORE_SOURCE = [
  "import fs from 'node:fs';",
  "import path from 'node:path';",
  '',
  "const CONDITIONS = ['blinded', 'prone'];",
  "const dirOf = (root) => path.join(root, '.campaign', 'state', 'live');",
  'function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }',
  'function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\\n"); }',
  'function fail(code, message) { return { ok: false, error: { code, message } }; }',
  'function activeId(root) { const a = readJson(path.join(dirOf(root), "active.json"), null); return a && a.sessionId ? a.sessionId : null; }',
  'const combatFile = (root, id) => path.join(dirOf(root), id, "combat.json");',
  '',
  'export function getCombat(root) {',
  '  const id = activeId(root);',
  '  if (!id) return { ok: true, combat: null };',
  '  return { ok: true, combat: readJson(combatFile(root, id), null) };',
  '}',
  'export function applyOp(root, op) {',
  '  const id = activeId(root);',
  '  if (!id) return fail("no-live-session", "No session is open.");',
  '  let combat = readJson(combatFile(root, id), null);',
  '  if (op.op === "start") {',
  '    if (combat && combat.active) return fail("already-active", "A combat is already running.");',
  '    combat = { active: true, round: 1, turn: 0, order: [], combatants: [], events: [], revision: 0 };',
  '  } else {',
  '    if (!combat || !combat.active) return fail("invalid-state", "No combat is running.");',
  '    if (op.op === "add") {',
  '      if (op.sheet === "missing.md") return fail("bad-sheet", "The sheet does not exist.");',
  '      const cid = "c-" + (combat.combatants.length + 1);',
  '      combat.combatants.push({ id: cid, name: op.name, side: op.side, initiative: op.initiative ?? null, conditions: [], resources: {} });',
  '      combat.order.push(cid);',
  '    } else if (op.op === "condition-add") {',
  '      if (!CONDITIONS.includes(op.condition)) return fail("unknown-condition", "Unknown condition: " + op.condition);',
  '    } else if (op.op === "end") {',
  '      combat.active = false;',
  '    } else if (op.op === "next") {',
  '      combat.turn = (combat.turn + 1) % Math.max(1, combat.order.length);',
  '    } else {',
  '      return fail("validation", "Not supported by the stand-in.");',
  '    }',
  '  }',
  '  combat.revision = (combat.revision || 0) + 1;',
  '  writeJson(combatFile(root, id), combat);',
  '  return { ok: true, combat };',
  '}',
  '',
].join('\n');

/**
 * A framework folder with the scripts the server reads. With `libs` true it also has the
 * stand-in session log and combat tracker (contract signatures, file-backed).
 */
export function makeFramework(opts: { libs: boolean }): string {
  const root = tempDir('ms-live-framework-');
  fs.writeFileSync(path.join(root, 'scripts-marker.txt'), 'stand-in framework\n');
  if (opts.libs) {
    const logDir = path.join(root, 'skills', 'library', 'session-log', 'scripts', 'lib');
    const combatDir = path.join(root, 'skills', 'library', 'combat-tracker', 'scripts', 'lib');
    fs.mkdirSync(logDir, { recursive: true });
    fs.mkdirSync(combatDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, 'log-store.mjs'), LOG_STORE_SOURCE);
    fs.writeFileSync(path.join(combatDir, 'combat-store.mjs'), COMBAT_STORE_SOURCE);
  }
  return root;
}

export interface Harness {
  port: number;
  ctx: Ctx;
  events: Recorded[];
  server: RunningServer;
}

/** The real app on a free port. Bus publishes are recorded (and still delivered to clients). */
export async function startApp(campaignRoot: string, frameworkRoot: string): Promise<Harness> {
  const events: Recorded[] = [];
  let ctx: Ctx | undefined;
  const server = await startServer((port) => {
    ctx = createCtx({ campaignRoot, frameworkRoot, port, log: () => undefined });
    const bus = ctx.bus as unknown as { publish: (event: string, data: unknown) => number };
    const original = bus.publish.bind(ctx.bus);
    bus.publish = (event: string, data: unknown) => {
      events.push({ event, data });
      return original(event as never, data as never);
    };
    return createApp(ctx);
  });
  if (!ctx) throw new Error('context was not created');
  return { port: server.port, ctx, events, server };
}

export function get(h: Harness, route: string): Promise<TestResponse> {
  return request(h.port, { path: `/api${route}` });
}

export function send(h: Harness, method: string, route: string, body?: unknown): Promise<TestResponse> {
  return request(h.port, {
    method,
    path: `/api${route}`,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function sendRaw(h: Harness, method: string, route: string, raw: string): Promise<TestResponse> {
  return request(h.port, {
    method,
    path: `/api${route}`,
    headers: { 'Content-Type': 'application/json' },
    body: raw,
  });
}
