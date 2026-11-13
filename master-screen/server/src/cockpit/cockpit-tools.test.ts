import { afterEach, test } from "node:test";
import { expect } from "./test-helpers/expect.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CockpitStore } from "./store.js";
import { CockpitBus } from "./bus.js";
import { CARD_TOOL_NAMES, COCKPIT_TOOL_NAMES, TABLE_TOOL_NAMES, createCockpitTools, type ToolContext } from "./tools.js";
import { CockpitLive } from "./live.js";
import { createFakeFramework } from "./test-helpers/fake-framework.js";
import { fakeKindOf } from "./fake-ports.js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createResolver } from "./resolvers.js";
import type {
  Board,
  BoardModule,
  ChatMessage,
  CockpitSession,
  Frame,
} from "../../../shared/src/cockpit-types.js";
import { buildUserPrompt } from "./prompt.js";
import { emptyState } from "./actions.js";
import { markdownFiles } from "./test-helpers/walk.js";
import type { CockpitArchive, CockpitBattle, Detail, Hit, MapAsset } from "./ports.js";
import { CampaignCategories, categoryEntries } from "../cockpit-host/categories.js";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

/** Heading ids as the archive computes them: lowercase, without accents or punctuation. */
function headingsOf(raw: string): Detail["headings"] {
  const headings: Detail["headings"] = [];
  raw.split("\n").forEach((text, index) => {
    const match = text.match(/^#+ (.*)$/);
    if (!match) return;
    const id = match[1]!.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    headings.push({ id, title: match[1]!, line: index + 1 });
  });
  return headings;
}

const detail = (
  file: string,
  raw: string,
  headings: Detail["headings"] = headingsOf(raw),
  title = "Atto",
): Detail => ({
  path: file,
  title,
  category: file.split("/")[0] ?? "",
  area: "Shuren",
  scope: "Campagna",
  master: false,
  raw,
  html: "",
  headings,
});

const overlaps = (a: Frame | BoardModule, b: Frame | BoardModule) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** A store with one session, a fake archive and the cockpit tools bound to them. */
async function setup(
  docs: Map<string, Detail>,
  maps: MapAsset[] = [],
  battle?: CockpitBattle,
  options: { categories?: CampaignCategories; search?: CockpitArchive["search"] } = {},
) {
  root = await mkdtemp(path.join(tmpdir(), "cockpit-tools-"));
  const store = new CockpitStore(root);
  const session = await store.create({
    title: "Test",
    provider: "claude",
    model: "fake",
  });
  await store.appendMessage(session.id, {
    id: "dm-1",
    role: "dm",
    text: "La porta si apre",
    at: new Date().toISOString(),
    turnId: "turn-1",
    status: "complete",
  });
  const played: unknown[] = [];
  const fake = createFakeFramework();
  // The engine saves a batch by copying its draft into the campaign: the fake does the same.
  fake.engine = (args) => {
    if (args[0] === "commit") {
      const rel = args[args.indexOf("--files") + 1]!;
      const draft = path.join(root, ".campaign", "drafts", rel);
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), readFileSync(draft, "utf8"));
    }
    return { code: 0, json: { ok: true } };
  };
  const live = new CockpitLive(store, fake.framework);
  await live.ensure(session.id);
  const categories = options.categories ?? {
    kindOf: fakeKindOf,
    folderFor: (kind: "npc" | "enemy" | "item" | "location") =>
      ({ npc: "NPCs", enemy: "Enemies", item: "Items", location: "World" })[kind],
    playersFolder: () => "Players",
  };
  const tracks = new Map();
  const resolve = createResolver({
    archive: { docs },
    maps: () => maps,
    tracks,
  });
  const bus = new CockpitBus(1000);
  const tools = createCockpitTools({
    store,
    archive: { docs, search: options.search ?? (() => ({ hits: [], total: 0 })) },
    maps: () => maps,
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
    categories,
    live,
    battle,
    // Written sheets enter the fake archive like a rescan would add them.
    sheets: (sessionId) => ({
      root,
      categories,
      framework: fake.framework,
      docs: () => docs,
      language: "it",
      async refresh() {
        for (const file of await markdownFiles(root, [
          "NPCs",
          "Enemies",
          "Items",
          "World",
        ])) {
          const raw = await readFile(path.join(root, file), "utf8");
          const title = raw.match(/^# (.*)$/m)?.[1] ?? file;
          docs.set(file, detail(file, raw, headingsOf(raw), title));
        }
      },
      async created() {
        return (await store.sideGet(sessionId)).sheets;
      },
      async remember(sheet) {
        await store.sideUpdate(sessionId, (side) => ({
          ...side,
          sheets: [...side.sheets, sheet],
        }));
      },
    }),
    music: {
      search: async () => [],
      request: async (value: unknown) => {
        played.push(value);
        return { ok: true };
      },
    } as never,
  });
  const context: ToolContext = {
    sessionId: session.id,
    turnId: "turn-1",
    tools: COCKPIT_TOOL_NAMES,
    onActivity: () => {},
    setGroupId(id) {
      context.groupId = id;
    },
  };
  const call = async (name: string, args: Record<string, unknown>) => {
    const found = tools.find((item) => item.name === name)!;
    return found.handler(args, context);
  };
  /** Parses the JSON text of a successful tool result. */
  const json = (result: { content: { text: string }[] }) =>
    JSON.parse(result.content[0]!.text);
  return {
    store,
    live,
    fake,
    session,
    context,
    call,
    json,
    played,
    tracks,
    async close() {
      bus.close();
      await store.close();
    },
  };
}

test("lettura, scritture MCP, validazioni e raggruppamento delle azioni", async () => {
  const docs = new Map<string, Detail>();
  docs.set(
    "Plot/Atto.md",
    detail(
      "Plot/Atto.md",
      "# Atto\nApertura.\n\n## Scena\nSezione desiderata.\n\n## Chiusura\nFine.",
      [
        { id: "atto", title: "Atto", line: 1 },
        { id: "scena", title: "Scena", line: 4 },
        { id: "chiusura", title: "Chiusura", line: 7 },
      ],
    ),
  );
  docs.set(
    "Players/Vincent Voss/scheda.md",
    detail(
      "Players/Vincent Voss/scheda.md",
      "# Vincent Voss\nUditore.",
      [{ id: "vincent-voss", title: "Vincent Voss", line: 1 }],
      "Vincent Voss",
    ),
  );
  docs.set(
    "Plot/Doppia.md",
    detail("Plot/Doppia.md", "# Doppia\n## Café\nA\n## Caf-e\nB", [
      { id: "cafe", title: "Café", line: 2 },
      { id: "caf-e", title: "Caf-e", line: 4 },
    ]),
  );
  const maps: MapAsset[] = [
    {
      path: "World/Shuren/img/mappa.png",
      src: "/api/file?path=World%2FShuren%2Fimg%2Fmappa.png",
      title: "Mappa porto",
      area: "Shuren",
      category: "Mappa",
      format: "PNG",
    },
  ];
  const h = await setup(docs, maps);
  const { store, session, call, json } = h;

  const read = await call("read_doc", {
    path: "Plot/Atto.md",
    anchor: "scena",
  });
  expect(read.isError).toBeUndefined();
  expect(read.content[0]!.text).toContain("Sezione desiderata");
  expect(read.content[0]!.text).not.toContain("Apertura");
  expect((await call("read_doc", { path: "../secret.md" })).isError).toBe(true);

  // Per-card errors do not fail the call: each item gets its own result.
  const rejected = json(
    await call("board_place", {
      cards: [
        { kind: "npc", path: "NPCs/Assente.md", reason: "x" },
        { kind: "plot", path: "Plot/Doppia.md", anchor: "café", reason: "x" },
        { kind: "npc", path: "Plot/Atto.md", reason: "x" },
      ],
    }),
  );
  expect(rejected[0].error).toContain("Documento non trovato");
  expect(rejected[1].error).toContain("Ancora ambigua");
  // The error tells the model which kind fits the document's folder.
  expect(rejected[2].error).toContain("richiede un documento di tipo npc");

  const sheet = json(
    await call("board_place", {
      cards: [
        {
          kind: "pc",
          path: "Players/Vincent Voss/scheda.md",
          reason: "il giocatore chiede la sua scheda",
        },
      ],
    }),
  );
  expect(sheet[0].id).toBeString();
  const sheetModule = (await store.get(session.id)).state.board.modules.find(
    (m) => m.kind === "pc",
  );
  expect(sheetModule?.ref).toEqual({
    type: "doc",
    path: "Players/Vincent Voss/scheda.md",
  });
  await call("board_remove", { ids: [sheetModule!.id] });

  const frame = json(await call("board_frame", { title: "Scena 1" }));
  const shown = json(
    await call("board_place", {
      cards: [
        {
          kind: "plot",
          path: "Plot/Atto.md",
          anchor: "scena",
          reason: "serve ora",
          frame: frame.id,
          pinned: true,
        },
      ],
    }),
  );
  const moduleId = shown[0].id as string;
  expect((await store.get(session.id)).state.board.modules[0]!.frameId).toBe(
    frame.id,
  );
  await call("board_highlight", { id: moduleId });
  await call("scene_set", {
    path: "Plot/Atto.md",
    anchor: "scena",
    location: "Porto",
    moment: "sera",
    party: ["Ada"],
  });
  const ledger = await call("ledger_note", {
    kind: "decision",
    title: "Entrare",
    text: "Il gruppo entra",
    evidence: ["dm-1"],
    sources: [{ path: "Plot/Atto.md", anchor: "scena" }],
  });
  expect(ledger.isError).toBeUndefined();
  const hydrated = async () => (await h.live.hydrate(await store.get(session.id))).state;
  const entryId = (await hydrated()).ledger[0]!.id;
  const badEvidence = await call("ledger_update", {
    id: entryId,
    status: "resolved",
    addEvidence: ["sconosciuto"],
  });
  expect(badEvidence.isError).toBe(true);
  expect((await hydrated()).ledger[0]!.status).toBe("active");
  expect(
    (
      await call("ledger_note", {
        kind: "fact",
        title: "x",
        text: "y",
        evidence: ["no"],
      })
    ).isError,
  ).toBe(true);
  await call("ledger_update", { id: entryId, title: "Entrati" });
  await call("ledger_remove", { id: entryId });
  await call("combat_start", {
    title: "Scontro",
    participants: [{ name: "Custode", kind: "enemy", initiative: 12, hp: 20, maxHp: 20 }],
  });
  let after = await store.get(session.id);
  const combatantId = (await hydrated()).combat!.participants[0]!.id;
  await call("combat_add", {
    participant: { name: "Ada", kind: "pc", initiative: 10 },
  });
  await call("combat_update", { id: combatantId, patch: { hp: 12 } });
  await call("combat_turn", { activeId: combatantId, round: 2 });
  await call("combat_notes", { notes: "La porta è chiusa" });
  await call("combat_remove", { id: combatantId });
  await call("combat_end", {});
  await call("music_play", { trackId: "track" });
  await call("music_stop", {});
  await call("open_source", { path: "Plot/Atto.md", anchor: "scena" });
  await call("board_remove", { ids: [frame.id] });
  after = await store.get(session.id);
  expect(after.history).toHaveLength(1);
  expect(new Set(after.history.map((group) => group.id)).size).toBe(1);
  expect(h.played).toHaveLength(2);
  expect(after.state.position.location).toBe("Porto");
  expect(after.state.board.highlightId).toBe(moduleId);
  expect(after.state.board.frames).toHaveLength(0);
  expect((await call("get_board", {})).isError).toBeUndefined();
  await h.close();
});

test("board_place: più carte in una chiamata, con errori singoli e senza sovrapposizioni", async () => {
  const docs = new Map<string, Detail>([
    [
      "NPCs/Ada.md",
      detail("NPCs/Ada.md", "# Ada\nLocandiera.", undefined, "Ada"),
    ],
  ]);
  const h = await setup(docs);
  const results = h.json(
    await h.call("board_place", {
      cards: [
        { kind: "npc", path: "NPCs/Ada.md", reason: "presente" },
        { kind: "note", text: "Porta chiusa", reason: "promemoria" },
        { kind: "npc", path: "NPCs/Nope.md", reason: "inesistente" },
      ],
    }),
  );
  expect(results).toHaveLength(3);
  expect(results[0].id).toBeString();
  expect(results[1].id).toBeString();
  expect(results[2].error).toBeString();
  const modules = (await h.store.get(h.session.id)).state.board.modules;
  expect(modules).toHaveLength(2);
  expect(overlaps(modules[0]!, modules[1]!)).toBe(false);
  await h.close();
});

test("board_place colloca la carta nel riquadro indicato", async () => {
  const h = await setup(new Map());
  const frame = h.json(await h.call("board_frame", { title: "Taverna" }));
  const placed = h.json(
    await h.call("board_place", {
      cards: [
        { kind: "note", text: "Fuoco acceso", frame: frame.id, reason: "r" },
      ],
    }),
  );
  const card = (await h.store.get(h.session.id)).state.board.modules.find(
    (module) => module.id === placed[0].id,
  );
  expect(card?.frameId).toBe(frame.id);
  await h.close();
});

test("board_remove su un riquadro ne toglie il contenuto e lascia le carte fuori", async () => {
  const h = await setup(new Map());
  const frame = h.json(
    await h.call("board_frame", { title: "Scena", color: "amber" }),
  );
  const note = h.json(
    await h.call("board_place", {
      cards: [{ kind: "note", text: "Ricordo", reason: "r" }],
    }),
  );
  await h.call("board_frame", { title: "Altra", cards: [note[0].id] });
  const framed = (await h.store.get(h.session.id)).state.board;
  expect(framed.frames).toHaveLength(2);
  const moved = framed.modules[0]!;
  expect(moved.frameId).toBeDefined();
  const removed = h.json(
    await h.call("board_remove", { ids: [moved.frameId!] }),
  );
  expect(removed[0].id).toBe(moved.frameId);
  const board = (await h.store.get(h.session.id)).state.board;
  expect(board.frames).toHaveLength(1);
  expect(board.modules).toHaveLength(1);
  expect(board.modules[0]!.frameId).toBeUndefined();
  expect(frame.id).toBeString();
  await h.close();
});

test("board_stage prepara una sessione: un riquadro per scena, un'unica carta per PNG condiviso, una freccia e un'evidenza", async () => {
  const session = detail(
    "Players/PG/Sessione 0.md",
    "# Sessione 0\n\n- [Scena A](Sessione%200/A.md)\n- [Scena B](Sessione%200/B.md)\n",
    undefined,
    "Sessione 0",
  );
  const sceneA = detail(
    "Players/PG/Sessione 0/A.md",
    "# Scena A\n\nAda parla: [Ada](../../../NPCs/Ada.md).\n",
    undefined,
    "Scena A",
  );
  const sceneB = detail(
    "Players/PG/Sessione 0/B.md",
    "# Scena B\n\nAda e il custode: [Ada](../../../NPCs/Ada.md) e [Custode](../../../Enemies/Porta/Custode.md).\n",
    undefined,
    "Scena B",
  );
  const docs = new Map<string, Detail>([
    [session.path, session],
    [sceneA.path, sceneA],
    [sceneB.path, sceneB],
    ["NPCs/Ada.md", detail("NPCs/Ada.md", "# Ada\n", undefined, "Ada")],
    [
      "Enemies/Porta/Custode.md",
      detail("Enemies/Porta/Custode.md", "# Custode\n", undefined, "Custode"),
    ],
  ]);
  const h = await setup(docs);

  const outline = h.json(
    await h.call("session_outline", { path: "Players/PG/Sessione 0.md" }),
  );
  expect(outline.scenes).toHaveLength(2);
  expect(outline.edges).toEqual([{ from: 0, to: 1 }]);

  const staged = h.json(
    await h.call("board_stage", { path: "Players/PG/Sessione 0.md" }),
  );
  expect(staged.skipped).toEqual([]);
  expect(staged.links).toBe(1);
  expect(staged.frames.map((frame: { title: string }) => frame.title)).toEqual([
    expect.stringContaining("Scena A"),
    expect.stringContaining("Scena B"),
  ]);
  const [frameA, frameB] = staged.frames as { id: string }[];

  const board: Board = (await h.store.get(h.session.id)).state.board;
  expect(board.frames).toHaveLength(2);
  const npcs = board.modules.filter(
    (module) => module.ref.type === "doc" && module.ref.path === "NPCs/Ada.md",
  );
  expect(npcs).toHaveLength(1);
  expect(npcs[0]!.frameId).toBe(frameA!.id);
  expect(
    board.modules.filter(
      (module) =>
        module.ref.type === "doc" &&
        module.ref.path === "Enemies/Porta/Custode.md",
    ),
  ).toHaveLength(1);
  expect(
    board.links.some(
      (link) => link.from === frameA!.id && link.to === frameB!.id,
    ),
  ).toBe(true);
  expect(board.highlightId).toBe(frameA!.id);
  expect(overlaps(board.frames[0]!, board.frames[1]!)).toBe(false);
  expect((await h.store.get(h.session.id)).history).toHaveLength(1);
  await h.close();
});

test("il digest elenca riquadri e carte, con evidenza e troncamento", () => {
  const titles: Record<string, string> = {
    m1: "Ada",
    m2: "Mappa del porto",
    m3: "Nota",
  };
  const board: Board = {
    frames: [
      {
        id: "f1",
        title: "1 · Porto",
        x: 0,
        y: 0,
        w: 300,
        h: 200,
        addedBy: "agent",
        addedAt: "",
        updatedAt: "",
      },
    ],
    modules: [
      card("m1", "npc", "f1"),
      card("m2", "map", undefined, true),
      card("m3", "note", undefined),
    ],
    links: [],
    highlightId: "f1",
  };
  const session = sessionWith(board);
  const message = currentMessage();
  const digest = buildUserPrompt(session, message, {
    resolve: (module) => ({ title: titles[module.id] ?? "modulo" }),
  });
  expect(digest).toContain("DESK: 3 cards, 1 frames, highlight: 1 · Porto");
  expect(digest).toContain("- f1 · frame «1 · Porto»: m1 Ada (npc)");
  expect(digest).toContain(
    "- outside frames: m2 Mappa del porto (map) (pinned), m3 Nota (note)",
  );
  expect(digest.length).toBeLessThanOrEqual(12000);

  const crowded: Board = {
    frames: [
      {
        id: "f1",
        title: "Tutto",
        x: 0,
        y: 0,
        w: 300,
        h: 200,
        addedBy: "agent",
        addedAt: "",
        updatedAt: "",
      },
    ],
    modules: Array.from({ length: 150 }, (_, index) =>
      card(`c${index}`, "note", "f1", false, "x".repeat(80)),
    ),
    links: [],
    highlightId: null,
  };
  const long = buildUserPrompt(sessionWith(crowded), message, {
    resolve: (module) => ({ title: `${module.id} ${"titolo ".repeat(10)}` }),
  });
  expect(long).toContain("more cards not shown");
  expect(long).toContain("highlight: none");
  expect(long).toContain("NEW MASTER MESSAGE (current-id)");
  expect(long.length).toBeLessThanOrEqual(12000);
});

function card(
  id: string,
  kind: BoardModule["kind"],
  frameId: string | undefined,
  pinned = false,
  text = "",
): BoardModule {
  return {
    id,
    kind,
    ref: { type: "note", text },
    ...(frameId ? { frameId } : {}),
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    pinned,
    reason: "r",
    addedBy: "agent",
    addedAt: "",
    updatedAt: "",
  };
}

function sessionWith(board: Board): CockpitSession {
  return {
    id: "s",
    title: "Test",
    provider: "claude",
    model: "m",
    createdAt: "",
    updatedAt: "",
    revision: 0,
    state: { ...emptyState(), board },
    history: [],
    messages: [],
    turns: [],
  };
}

function currentMessage(): ChatMessage {
  return {
    id: "current-id",
    role: "dm",
    text: "Si parte",
    at: "",
    turnId: "t",
    status: "complete",
  };
}

test("board_link accetta un elenco di collegamenti con esiti singoli e mantiene la forma singola", async () => {
  const h = await setup(new Map());
  const [a, b, c] = ["Alfa", "Beta", "Gamma"].map(async (title) =>
    h.json(await h.call("board_frame", { title })),
  );
  const [fa, fb, fc] = await Promise.all([a, b, c]);
  const single = h.json(
    await h.call("board_link", { from: fa.id, to: fb.id, label: "uno" }),
  );
  expect(single.id).toBeString();
  const batch = h.json(
    await h.call("board_link", {
      links: [
        { from: fb.id, to: fc.id },
        { from: fa.id, to: "inesistente" },
      ],
    }),
  );
  expect(batch).toHaveLength(2);
  expect(batch[0].id).toBeString();
  expect(batch[1].error).toBeString();
  const board = (await h.store.get(h.session.id)).state.board;
  expect(board.links).toHaveLength(2);
  const mixed = await h.call("board_link", {
    from: fa.id,
    to: fb.id,
    links: [{ from: fb.id, to: fc.id }],
  });
  expect(mixed.isError).toBe(true);
  await h.close();
});

test("board_frame con cards, after e before crea il riquadro, sposta le carte e aggiunge i due collegamenti", async () => {
  const h = await setup(new Map());
  const [prima, dopo] = [
    h.json(await h.call("board_frame", { title: "Prima" })),
    h.json(await h.call("board_frame", { title: "Dopo" })),
  ];
  const note = h.json(
    await h.call("board_place", {
      cards: [{ kind: "note", text: "Dettaglio", reason: "r" }],
    }),
  );
  const frame = h.json(
    await h.call("board_frame", {
      title: "Ramo",
      cards: [note[0].id],
      after: [prima.id],
      before: [dopo.id],
    }),
  );
  const board = (await h.store.get(h.session.id)).state.board;
  const moved = board.modules.find((module) => module.id === note[0].id)!;
  expect(moved.frameId).toBe(frame.id);
  expect(board.frames.some((item) => item.id === frame.id)).toBe(true);
  expect(board.links.map((link) => `${link.from}>${link.to}`).sort()).toEqual(
    [`${prima.id}>${frame.id}`, `${frame.id}>${dopo.id}`].sort(),
  );
  expect(frame.errors).toBeUndefined();
  await h.close();
});

test("board_move sposta carte dentro un riquadro e fuori con null", async () => {
  const h = await setup(new Map());
  const frame = h.json(await h.call("board_frame", { title: "Musiche" }));
  const note = h.json(
    await h.call("board_place", {
      cards: [{ kind: "note", text: "Brano", reason: "r" }],
    }),
  );
  const cardId = note[0].id as string;
  const inside = h.json(
    await h.call("board_move", { ids: [cardId], frame: frame.id }),
  );
  expect(inside[0].id).toBe(cardId);
  let board = (await h.store.get(h.session.id)).state.board;
  expect(board.modules[0]!.frameId).toBe(frame.id);
  await h.call("board_move", { ids: [cardId], frame: null });
  board = (await h.store.get(h.session.id)).state.board;
  expect(board.modules[0]!.frameId).toBeUndefined();
  const missing = await h.call("board_move", {
    ids: [cardId],
    frame: "non-esiste",
  });
  expect(missing.isError).toBe(true);
  await h.close();
});

test("board_place con musica senza trackId indica board_move", async () => {
  const h = await setup(new Map());
  const result = h.json(
    await h.call("board_place", {
      cards: [{ kind: "music", reason: "r" }],
    }),
  );
  expect(result[0].error).toContain("board_move");
  await h.close();
});

test("get_board riporta la provenienza di ogni carta", async () => {
  const h = await setup(new Map());
  await h.call("board_place", {
    cards: [{ kind: "note", text: "Appunto", reason: "r" }],
  });
  const board = h.json(await h.call("get_board", {}));
  expect(board.cards[0].source).toBe("nota");
  await h.close();
});

test("ogni chiamata di strumento scrive una riga in tools.jsonl della sessione", async () => {
  const h = await setup(new Map());
  await h.call("board_place", {
    cards: [{ kind: "music", reason: "r" }],
  });
  const file = path.join(root, ".campaign", "state", "live", "cockpit", h.session.id, "tools.jsonl");
  const lines = (await readFile(file, "utf8")).trim().split("\n");
  expect(lines).toHaveLength(1);
  const entry = JSON.parse(lines[0]!);
  expect(entry.tool).toBe("board_place");
  expect(entry.turnId).toBe("turn-1");
  expect(entry.ok).toBe(true);
  expect(entry.args.length).toBeLessThanOrEqual(500);
  await h.close();
});

test("board_place: «@N» mette una carta accanto a una messa prima nella stessa chiamata", async () => {
  const h = await setup(new Map());
  const placed = h.json(
    await h.call("board_place", {
      cards: [
        { kind: "note", text: "Versione master", reason: "master" },
        { kind: "note", text: "Versione giocatori", near: "@1", reason: "pg" },
        { kind: "note", text: "Rotta", near: "@9", reason: "errore" },
      ],
    }),
  );
  const board = (await h.store.get(h.session.id)).state.board;
  const first = board.modules.find((m) => m.id === placed[0].id)!;
  const second = board.modules.find((m) => m.id === placed[1].id)!;
  // Placed right of or below the first card, touching its edge (plus the gap).
  expect(
    second.x === first.x + first.w + 24 || second.y === first.y + first.h + 24,
  ).toBe(true);
  expect(placed[2].error).toContain("@9");
  await h.close();
});

test("board_remove toglie anche una singola freccia", async () => {
  const h = await setup(new Map());
  const placed = h.json(
    await h.call("board_place", {
      cards: [
        { kind: "note", text: "A", reason: "a" },
        { kind: "note", text: "B", reason: "b" },
      ],
    }),
  );
  await h.call("board_link", { from: placed[0].id, to: placed[1].id });
  const link = (await h.store.get(h.session.id)).state.board.links[0]!;
  const result = h.json(await h.call("board_remove", { ids: [link.id] }));
  expect(result[0].error).toBeUndefined();
  const board = (await h.store.get(h.session.id)).state.board;
  expect(board.links).toHaveLength(0);
  expect(board.modules).toHaveLength(2);
  await h.close();
});

test("board_place salva il titolo del brano nella carta musicale", async () => {
  const h = await setup(new Map());
  h.tracks.set("track-1", { id: "track-1", title: "BGM Grafreitur" } as never);
  await h.call("board_place", {
    cards: [{ kind: "music", trackId: "track-1", reason: "atmosfera" }],
  });
  const card = (await h.store.get(h.session.id)).state.board.modules[0]!;
  expect(card.ref).toEqual({
    type: "track",
    trackId: "track-1",
    title: "BGM Grafreitur",
  });
  // After a restart the cache is empty: the saved title still names the card.
  h.tracks.clear();
  const board = h.json(await h.call("get_board", {}));
  expect(board.cards[0].title).toBe("BGM Grafreitur");
  await h.close();
});

test("sheet_create scrive la scheda, la mostra e sheet_update la riscrive", async () => {
  const docs = new Map([
    [
      "NPCs/Shuren/Kaelen.md",
      detail(
        "NPCs/Shuren/Kaelen.md",
        "# Kaelen\n\nGuardia.",
        undefined,
        "Kaelen",
      ),
    ],
  ]);
  const h = await setup(docs);
  const created = h.json(
    await h.call("sheet_create", {
      kind: "npc",
      area: "Shuren",
      title: "Oste Lun",
      markdown: "Amico di Kaelen.",
      reason: "Improvvisato al tavolo",
    }),
  );
  expect(created.path).toBe("NPCs/Shuren/Oste Lun.md");
  // The draft went through check and commit of the engine, with the campaign's own message.
  expect(h.fake.engineCalls.map((call) => call[0])).toEqual(["check", "commit"]);
  expect(h.fake.engineCalls[1]).toEqual([
    "commit",
    "--files",
    "NPCs/Shuren/Oste Lun.md",
    "--message",
    "Scheda creata al tavolo: Oste Lun.",
  ]);
  expect(await readFile(path.join(root, created.path), "utf8")).not.toContain("<!-- cockpit");
  const { state } = await h.store.get(h.session.id);
  const card = state.board.modules.find((module) => module.id === created.id)!;
  expect(card.kind).toBe("npc");
  expect(card.ref).toEqual({ type: "doc", path: created.path });
  const again = await h.call("sheet_create", {
    kind: "npc",
    area: "Shuren",
    title: "Oste Lun",
    markdown: "x",
    reason: "doppione",
  });
  expect(again.isError).toBe(true);
  const updated = await h.call("sheet_update", {
    path: created.path,
    markdown: "Cugino di Kaelen.",
  });
  expect(updated.isError).toBeUndefined();
  expect(await readFile(path.join(root, created.path), "utf8")).toContain(
    "Cugino di Kaelen.",
  );
  const locked = await h.call("sheet_update", {
    path: "NPCs/Shuren/Kaelen.md",
    markdown: "x",
  });
  expect(locked.isError).toBe(true);
  await h.close();
});

test("combat_condition: il partecipante si trova per nome; ogni risultato di combattimento riporta solo gli avvisi nuovi", async () => {
  const h = await setup(new Map());
  await h.call("combat_start", {
    title: "Porto",
    participants: [
      { name: "Custode", kind: "enemy", initiative: 12, hp: 5, maxHp: 20 },
      { name: "Ada", kind: "pc", initiative: 10 },
    ],
  });
  const added = h.json(await h.call("combat_condition", { participant: "custode", condition: "prone" }));
  expect(added.participant.conditions).toEqual(["prone"]);
  expect(added.notices).toEqual([]);
  const id = added.participant.id as string;

  // Damage that takes the creature to 0 hp: the result carries the defeat, once.
  const hurt = h.json(await h.call("combat_update", { id, patch: { hp: 0 } }));
  expect(hurt.notices.map((n: { kind: string; name: string }) => [n.kind, n.name])).toEqual([["defeated", "Custode"]]);
  const turn = h.json(await h.call("combat_turn", { activeId: id }));
  expect(turn.notices).toEqual([]);

  const removed = h.json(await h.call("combat_condition", { participant: id, condition: "prone", remove: true }));
  expect(removed.participant.conditions).toEqual([]);
  expect(removed.notices).toEqual([]);

  expect((await h.call("combat_condition", { participant: "Ada", condition: "prone" })).isError).toBe(true);
  expect((await h.call("combat_condition", { participant: "Nessuno", condition: "prone" })).isError).toBe(true);
  expect((await h.call("combat_condition", { participant: id, condition: "prone", rounds: 2 })).isError).toBe(true);
  const ended = h.json(await h.call("combat_end", {}));
  expect(ended.notices).toEqual([]);
  await h.close();
});

test("combat_card_set passa l'input validato a setCard e rifiuta un'azione senza effetto", async () => {
  const calls: Array<{ sheet: string; input: unknown }> = [];
  const battle: CockpitBattle = {
    find: async () => [],
    setMap: async () => ({ map: null, positions: {}, revision: 0 }),
    move: async () => ({ map: null, positions: {}, revision: 0 }),
    setCard: async (sheet, input) => {
      calls.push({ sheet, input });
      return { sheet, sheetHash: "0123456789abcdef", actions: input.actions, at: "" };
    },
  };
  const h = await setup(new Map(), [], battle);
  const morso = {
    name: "Morso",
    timing: "own_turn",
    cost: "action",
    kind: "attack",
    toHit: 5,
    damage: [{ dice: "2d6+3", type: "perforante" }],
    effect: "Morde un bersaglio vicino.",
  };
  const traits = [{ name: "Calore", text: "Scalda chi la tocca." }];
  const ok = h.json(await h.call("combat_card_set", { sheet: "Creature/Verme.md", actions: [morso], traits }));
  expect(ok).toEqual({ sheet: "Creature/Verme.md", actions: 1 });
  expect(calls).toEqual([{ sheet: "Creature/Verme.md", input: { actions: [morso], traits } }]);

  const senza = {
    name: "Morso",
    timing: "own_turn",
    cost: "action",
    kind: "attack",
  };
  const bad = await h.call("combat_card_set", { sheet: "Creature/Verme.md", actions: [senza] });
  expect(bad.isError).toBe(true);
  expect(calls).toHaveLength(1);
  await h.close();
});

test("combat_card_set è solo dello strumento di carte, non della tavola", () => {
  expect(COCKPIT_TOOL_NAMES).toContain("combat_card_set");
  expect(CARD_TOOL_NAMES).toEqual(["combat_card_set"]);
  expect(TABLE_TOOL_NAMES).not.toContain("combat_card_set");
});

test("un documento di una cartella esterna si legge e si cerca, ma non si riscrive", async () => {
  const raw = "# Raatnagar\nCittà sul delta.";
  const docs = new Map<string, Detail>();
  docs.set("shared/Luoghi/Raatnagar.md", detail("shared/Luoghi/Raatnagar.md", raw, headingsOf(raw), "Raatnagar"));
  const categories = new CampaignCategories();
  categories.load(
    categoryEntries([
      { id: "shared", folder: "shared", type: "external" },
      { id: "characters", folder: "Personaggi", type: "subjects" },
    ]),
  );
  const hit: Hit = {
    path: "shared/Luoghi/Raatnagar.md",
    title: "Raatnagar",
    category: "shared",
    area: "Luoghi",
    scope: "Campagna",
    master: false,
    excerpt: "Città sul delta",
    anchor: "raatnagar",
  };
  const h = await setup(docs, [], undefined, {
    categories,
    search: () => ({ hits: [hit], total: 1 }),
  });
  const { call, json } = h;

  const read = await call("read_doc", { path: "shared/Luoghi/Raatnagar.md" });
  expect(read.isError).toBeUndefined();
  expect(read.content[0]!.text).toContain("Città sul delta");

  const found = json(await call("search_docs", { query: "delta" }));
  expect(found.map((item: Hit) => item.path)).toEqual(["shared/Luoghi/Raatnagar.md"]);

  // A symbolic link that leaves the campaign is not a document of any category: refused as before.
  const outside = await call("read_doc", { path: "linked.md" });
  expect(outside.isError).toBe(true);
  expect(outside.content[0]!.text).toContain("Percorso fuori");

  const written = await call("sheet_update", { path: "shared/Luoghi/Raatnagar.md", markdown: "Nuovo testo." });
  expect(written.isError).toBe(true);
  expect(written.content[0]!.text).toContain("Il documento appartiene al mondo condiviso ed è in sola lettura");
  await h.close();
});
