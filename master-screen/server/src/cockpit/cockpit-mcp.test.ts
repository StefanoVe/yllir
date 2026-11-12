import { CockpitLive } from "./live.js";
import { createFakeFramework } from "./test-helpers/fake-framework.js";
import { fakeKindOf } from "./fake-ports.js";
import { afterEach, test } from "node:test";
import { expect } from "./test-helpers/expect.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CockpitStore } from "./store.js";
import { CockpitBus } from "./bus.js";
import { COCKPIT_TOOL_NAMES, createCockpitTools, type ToolContext } from "./tools.js";
import { createResolver } from "./resolvers.js";
import { TurnTokens, mcpHandler } from "./mcp.js";
import { webHandlerServer } from "./http-bridge.js";
import { listenLoopback, type Listening } from "./test-helpers/listen.js";
import type { Detail } from "./ports.js";
let root = "";
let server: Listening | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});
test("MCP streamable HTTP autentica token turno e vincola la sessione", async () => {
  root = await mkdtemp(path.join(tmpdir(), "cockpit-mcp-"));
  const store = new CockpitStore(root);
  const first = await store.create({
    title: "Uno",
    provider: "claude",
    model: "m",
  });
  const second = await store.create({
    title: "Due",
    provider: "claude",
    model: "m",
  });
  const doc: Detail = {
    path: "NPCs/Ada.md",
    title: "Ada",
    category: "NPCs",
    area: "",
    scope: "Campagna",
    master: false,
    raw: "# Ada",
    html: "",
    headings: [{ id: "ada", title: "Ada", line: 1 }],
  };
  const docs = new Map([[doc.path, doc]]);
  const bus = new CockpitBus();
  const tracks = new Map();
  const resolve = createResolver({ archive: { docs }, maps: () => [], tracks });
  const fake = createFakeFramework();
  const live = new CockpitLive(store, fake.framework);
  const tools = createCockpitTools({
    store,
    live,
    categories: { kindOf: fakeKindOf, folderFor: () => null, playersFolder: () => "Players" },
    archive: { docs, search: () => ({ hits: [], total: 0 }) },
    maps: () => [],
    tracks,
    getPlotGraph: () => ({
      source: "",
      nodes: [],
      groups: [],
      edges: [],
      unresolved: [],
    }),
    resolve,
    bus,
    music: { search: async () => [], request: async () => ({}) } as never,
  });
  const tokens = new TurnTokens();
  let context: ToolContext = {
    sessionId: first.id,
    turnId: "turn",
    tools: COCKPIT_TOOL_NAMES,
    onActivity: () => {},
    setGroupId() {},
  };
  const token = tokens.issue(context);
  const handler = mcpHandler({ tokens, tools });
  server = await listenLoopback(
    webHandlerServer(
      async (request) =>
        (await handler(request)) || new Response("not found", { status: 404 }),
    ),
  );
  const url = new URL("/mcp/cockpit", server.url);
  expect((await fetch(url)).status).toBe(401);
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "mcp-test", version: "1.0.0" });
  await client.connect(transport);
  const listed = await client.listTools();
  expect(listed.tools.some((item) => item.name === "board_place")).toBe(true);
  const result = await client.callTool({
    name: "board_place",
    arguments: {
      cards: [{ kind: "npc", path: "NPCs/Ada.md", reason: "serve" }],
    },
  });
  expect(result.isError).not.toBe(true);
  expect((await store.get(first.id)).state.board.modules).toHaveLength(1);
  expect((await store.get(second.id)).state.board.modules).toHaveLength(0);
  await client.close();
  tokens.revoke(token);
  const revoked = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  expect(revoked.status).toBe(401);
  bus.close();
  await store.close();
});

test("tools/list lists only the tools of the turn", async () => {
  root = await mkdtemp(path.join(tmpdir(), "cockpit-mcp-tools-"));
  const store = new CockpitStore(root);
  const session = await store.create({ title: "Uno", provider: "claude", model: "m" });
  const doc: Detail = {
    path: "NPCs/Ada.md",
    title: "Ada",
    category: "NPCs",
    area: "",
    scope: "Campagna",
    master: false,
    raw: "# Ada",
    html: "",
    headings: [{ id: "ada", title: "Ada", line: 1 }],
  };
  const docs = new Map([[doc.path, doc]]);
  const bus = new CockpitBus();
  const tracks = new Map();
  const resolve = createResolver({ archive: { docs }, maps: () => [], tracks });
  const fake = createFakeFramework();
  const live = new CockpitLive(store, fake.framework);
  const tools = createCockpitTools({
    store,
    live,
    categories: { kindOf: fakeKindOf, folderFor: () => null, playersFolder: () => "Players" },
    archive: { docs, search: () => ({ hits: [], total: 0 }) },
    maps: () => [],
    tracks,
    getPlotGraph: () => ({ source: "", nodes: [], groups: [], edges: [], unresolved: [] }),
    resolve,
    bus,
    music: { search: async () => [], request: async () => ({}) } as never,
  });
  const tokens = new TurnTokens();
  const token = tokens.issue({
    sessionId: session.id,
    turnId: "turn",
    tools: ["search_docs"],
    onActivity: () => {},
    setGroupId() {},
  });
  const handler = mcpHandler({ tokens, tools });
  server = await listenLoopback(
    webHandlerServer(
      async (request) =>
        (await handler(request)) || new Response("not found", { status: 404 }),
    ),
  );
  const url = new URL("/mcp/cockpit", server.url);
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "mcp-test", version: "1.0.0" });
  await client.connect(transport);
  const listed = await client.listTools();
  expect(listed.tools.map((item) => item.name)).toEqual(["search_docs"]);
  await client.close();
  tokens.revoke(token);
  bus.close();
  await store.close();
});
