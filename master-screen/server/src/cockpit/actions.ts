import { z } from "zod";
import type {
  ActionSummary,
  Board,
  BoardModule,
  CockpitAction,
  CockpitState,
  Combatant,
  Frame,
  FrameInput,
  Link,
  ModuleInput,
  ModuleKind,
  SourceRef,
} from "../../../shared/src/cockpit-types.js";
import {
  arrange,
  defaultSize,
  fitFrame,
  MIN_FRAME,
  minFrameWidth,
  placeCard,
  placeFrame,
} from "./layout.js";

export const MAX_CARDS = 300;
export const MAX_FRAMES = 60;
export const MAX_LINKS = 300;
const MAX_TEXT_PREVIEW = 60;
const IMAGE_PATH = /^img-[0-9a-f-]{36}\.(png|jpg|webp|gif)$/;
const CARD_COLORS = ["red", "amber", "green", "blue", "violet"] as const;
const MODULE_KINDS = [
  "npc",
  "pc",
  "lore",
  "enemy",
  "item",
  "location",
  "map",
  "battlemap",
  "music",
  "plot",
  "image",
  "note",
] as const;
const DOC_KINDS: readonly ModuleKind[] = [
  "npc",
  "pc",
  "enemy",
  "item",
  "location",
  "plot",
  "lore",
];
const BOARD_ACTION = /^(module|frame|link|board)\./;

const id = z.string().min(1).max(200);
export const coordinateSchema = z.number().finite().min(-1e6).max(1e6);
export const dimensionSchema = z.number().finite().min(40).max(4000);
const colorSchema = z.enum(CARD_COLORS);

export const sourceRefSchema = z
  .object({
    path: z.string().min(1).max(500),
    anchor: z.string().max(300).optional(),
  })
  .strict();
export const moduleRefSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("doc"),
      path: z.string().min(1).max(500),
      anchor: z.string().max(300).optional(),
    })
    .strict(),
  z
    .object({ type: z.literal("asset"), path: z.string().min(1).max(500) })
    .strict(),
  z
    .object({
      type: z.literal("track"),
      trackId: id,
      title: z.string().max(300).optional(),
    })
    .strict(),
  z
    .object({ type: z.literal("image"), path: z.string().regex(IMAGE_PATH) })
    .strict(),
  z.object({ type: z.literal("note"), text: z.string().max(4000) }).strict(),
]);
export const moduleInputSchema = z
  .object({
    id: id.optional(),
    kind: z.enum(MODULE_KINDS),
    ref: moduleRefSchema,
    pinned: z.boolean().optional(),
    reason: z.string().max(300),
    frameId: id.optional(),
    near: id.optional(),
    x: coordinateSchema.optional(),
    y: coordinateSchema.optional(),
    w: dimensionSchema.optional(),
    h: dimensionSchema.optional(),
    color: colorSchema.optional(),
  })
  .strict();
const moduleUpdateSchema = z
  .object({
    text: z.string().max(4000).optional(),
    reason: z.string().max(300).optional(),
    color: colorSchema.nullable().optional(),
    frameId: id.nullable().optional(),
  })
  .strict();
const frameInputSchema = z
  .object({
    title: z.string().min(1).max(200),
    color: colorSchema.optional(),
    near: id.optional(),
    x: coordinateSchema.optional(),
    y: coordinateSchema.optional(),
    w: dimensionSchema.optional(),
    h: dimensionSchema.optional(),
  })
  .strict();
const frameUpdateSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    color: colorSchema.nullable().optional(),
  })
  .strict();
export const ledgerInputSchema = z
  .object({
    kind: z.enum(["fact", "decision", "intention", "open"]),
    title: z.string().min(1).max(200),
    text: z.string().max(4000),
    evidence: z.array(id).min(1).max(50),
    sources: z.array(sourceRefSchema).max(50).optional(),
  })
  .strict();
export const combatantInputSchema = z
  .object({
    name: z.string().min(1).max(200),
    kind: z.enum(["pc", "enemy", "ally"]),
    initiative: z.number().int().min(-100).max(100).nullable(),
    source: sourceRefSchema.optional(),
    hp: z.number().int().min(0).max(100000).optional(),
    maxHp: z.number().int().min(0).max(100000).optional(),
    tempHp: z.number().int().min(0).max(100000).optional(),
    phase: z.string().max(300).optional(),
    conditions: z.array(z.string().max(200)).max(100).optional(),
    resources: z
      .record(z.string().max(80), z.number().int().min(0).max(100000))
      .optional(),
  })
  .strict();
const combatantSchema = combatantInputSchema;
const partialCombatant = combatantInputSchema
  .partial()
  .extend({
    name: z.string().min(1).max(200).optional(),
    kind: z.enum(["pc", "enemy", "ally"]).optional(),
    initiative: z.number().int().min(-100).max(100).nullable().optional(),
  })
  .strict();
export const actionSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("module.show"), module: moduleInputSchema })
    .strict(),
  z.object({ type: z.literal("module.remove"), id }).strict(),
  z
    .object({
      type: z.literal("module.update"),
      id,
      patch: moduleUpdateSchema,
    })
    .strict(),
  z.object({ type: z.literal("module.highlight"), id: id.nullable() }).strict(),
  z.object({ type: z.literal("module.pin"), id, pinned: z.boolean() }).strict(),
  z.object({ type: z.literal("frame.add"), frame: frameInputSchema }).strict(),
  z
    .object({
      type: z.literal("frame.update"),
      id,
      patch: frameUpdateSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("frame.remove"),
      id,
      withCards: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("link.add"),
      from: id,
      to: id,
      label: z.string().max(200).optional(),
    })
    .strict(),
  z.object({ type: z.literal("link.remove"), id }).strict(),
  z.object({ type: z.literal("board.arrange") }).strict(),
  z.object({ type: z.literal("board.clear") }).strict(),
  z
    .object({
      type: z.literal("position.set"),
      patch: z
        .object({
          source: sourceRefSchema.optional(),
          location: z.string().max(200).optional(),
          moment: z.string().max(200).optional(),
          summary: z.string().max(4000).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("party.set"),
      names: z.array(z.string().max(200)).max(100),
    })
    .strict(),
  z
    .object({ type: z.literal("ledger.add"), entry: ledgerInputSchema })
    .strict(),
  z
    .object({
      type: z.literal("ledger.update"),
      id,
      patch: z
        .object({
          kind: z.enum(["fact", "decision", "intention", "open"]).optional(),
          status: z.enum(["active", "resolved", "dropped"]).optional(),
          title: z.string().min(1).max(200).optional(),
          text: z.string().max(4000).optional(),
          addEvidence: z.array(id).max(50).optional(),
          addSources: z.array(sourceRefSchema).max(50).optional(),
        })
        .strict(),
    })
    .strict(),
  z.object({ type: z.literal("ledger.remove"), id }).strict(),
  z
    .object({
      type: z.literal("combat.start"),
      title: z.string().min(1).max(200),
      participants: z.array(combatantSchema).max(100),
    })
    .strict(),
  z
    .object({ type: z.literal("combat.add"), participant: combatantSchema })
    .strict(),
  z
    .object({ type: z.literal("combat.update"), id, patch: partialCombatant })
    .strict(),
  z.object({ type: z.literal("combat.remove"), id }).strict(),
  z
    .object({
      type: z.literal("combat.turn"),
      activeId: id.nullable(),
      round: z.number().int().min(1).max(100000).optional(),
    })
    .strict(),
  z
    .object({ type: z.literal("combat.notes"), notes: z.string().max(4000) })
    .strict(),
  z.object({ type: z.literal("combat.end") }).strict(),
]);

export class ActionError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "ActionError";
  }
}

export interface ActionContext {
  now: string;
  newId: (prefix: string) => string;
  knownMessageIds: Set<string>;
  origin?: "agent" | "dm";
}

export function parseAction(value: unknown): CockpitAction {
  const parsed = actionSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ActionError(
      `Input non valido${issue.path.length ? ` in ${issue.path.join(".")}` : ""}: ${issue.message}`,
    );
  }
  return parsed.data as CockpitAction;
}

export function emptyState(): CockpitState {
  return {
    position: { location: "", moment: "", summary: "" },
    party: [],
    board: { modules: [], frames: [], links: [], highlightId: null },
    ledger: [],
    combat: null,
  };
}

type BoardAction = Extract<
  CockpitAction,
  {
    type:
      | `module.${string}`
      | `frame.${string}`
      | `link.${string}`
      | `board.${string}`;
  }
>;
type RecordAction = Exclude<CockpitAction, BoardAction>;
/** What an action reports: a short label and the id it touched, if any. */
type Outcome = { label: string; targetId?: string };

const refsEqual = (a: BoardModule["ref"], b: BoardModule["ref"]) => {
  if (a.type !== b.type) return false;
  if (a.type === "note" && b.type === "note") return a.text === b.text;
  if (a.type === "track" && b.type === "track") return a.trackId === b.trackId;
  if (a.type === "asset" && b.type === "asset") return a.path === b.path;
  if (a.type === "image" && b.type === "image") return a.path === b.path;
  if (a.type === "doc" && b.type === "doc")
    return a.path === b.path && a.anchor === b.anchor;
  return false;
};
const need = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new ActionError(`${what} non trovato`, 404);
  return value;
};
const capError = (message: string) => new ActionError(message, 409);
export function compareInitiative(a: Combatant, b: Combatant): number {
  if (a.initiative === null && b.initiative !== null) return 1;
  if (a.initiative !== null && b.initiative === null) return -1;
  if (a.initiative === null || b.initiative === null) return 0;
  return b.initiative - a.initiative;
}
function moduleLabel(ref: BoardModule["ref"]): string {
  if (ref.type === "note") {
    const preview = ref.text.slice(0, MAX_TEXT_PREVIEW);
    return preview.length < ref.text.length ? `${preview}…` : preview;
  }
  if (ref.type === "track") return ref.title || ref.trackId;
  const file = ref.path.split("/").at(-1) || ref.path;
  return file.endsWith(".md") ? file.slice(0, -3) : file;
}
function summary(
  action: CockpitAction,
  label: string,
  targetId?: string,
): ActionSummary {
  return { type: action.type, label, ...(targetId ? { targetId } : {}) };
}

// ───────────────────────────── board lookups ─────────────────────────────

const findCard = (board: Board, cardId: string) =>
  board.modules.find((m) => m.id === cardId);
const findFrame = (board: Board, frameId: string) =>
  board.frames.find((f) => f.id === frameId);
const cardOrThrow = (board: Board, cardId: string): BoardModule =>
  need(findCard(board, cardId), "Modulo");
const frameOrThrow = (board: Board, frameId: string): Frame =>
  need(findFrame(board, frameId), "Riquadro");
const withoutCard = (board: Board, cardId?: string): Board =>
  cardId
    ? { ...board, modules: board.modules.filter((m) => m.id !== cardId) }
    : board;

/** Stores a card (replacing the same id) and grows its frame to contain it. */
function storeCard(state: CockpitState, card: BoardModule): void {
  const exists = findCard(state.board, card.id) !== undefined;
  state.board.modules = exists
    ? state.board.modules.map((m) => (m.id === card.id ? card : m))
    : [...state.board.modules, card];
  if (card.frameId) state.board = fitFrame(state.board, card.frameId);
}

/** Card addressed by id, or else an existing card with the same kind and ref. */
function findExistingCard(
  board: Board,
  input: ModuleInput,
): BoardModule | undefined {
  if (input.id !== undefined) return cardOrThrow(board, input.id);
  return board.modules.find(
    (x) => x.kind === input.kind && refsEqual(x.ref, input.ref),
  );
}

function assertKindMatchesRef(kind: ModuleKind, ref: BoardModule["ref"]) {
  const expected = DOC_KINDS.includes(kind)
    ? "doc"
    : kind === "map" || kind === "battlemap"
      ? "asset"
      : kind === "music"
        ? "track"
        : kind === "image"
          ? "image"
          : "note";
  if (ref.type !== expected)
    throw new ActionError("Tipo di riferimento incoerente con il modulo");
}

// ───────────────────────────── cards ─────────────────────────────

function showModule(
  state: CockpitState,
  input: ModuleInput,
  ctx: ActionContext,
): Outcome {
  assertKindMatchesRef(input.kind, input.ref);
  const board = state.board;
  const old = findExistingCard(board, input);
  if (!old && board.modules.length >= MAX_CARDS)
    throw capError("Troppe carte sulla scrivania");
  if (input.frameId !== undefined) frameOrThrow(board, input.frameId);
  const frameId = input.frameId ?? old?.frameId;
  const defaults = defaultSize(input.kind);
  const size = {
    w: Math.round(input.w ?? old?.w ?? defaults.w),
    h: Math.round(input.h ?? old?.h ?? defaults.h),
  };
  const relocated =
    !old || (input.frameId !== undefined && input.frameId !== old.frameId);
  const spot =
    old && !relocated
      ? { x: old.x, y: old.y }
      : placeCard(withoutCard(board, old?.id), size, {
          frameId,
          near: input.near,
        });
  const color = input.color ?? old?.color;
  const card: BoardModule = {
    id: old?.id ?? ctx.newId("m"),
    kind: input.kind,
    ref: structuredClone(input.ref),
    x: Math.round(input.x ?? spot.x),
    y: Math.round(input.y ?? spot.y),
    ...size,
    ...(frameId ? { frameId } : {}),
    ...(color ? { color } : {}),
    pinned: input.pinned ?? old?.pinned ?? false,
    reason: input.reason,
    addedBy: old?.addedBy ?? ctx.origin ?? "agent",
    addedAt: old?.addedAt ?? ctx.now,
    updatedAt: ctx.now,
  };
  storeCard(state, card);
  return { label: `Mostra · ${moduleLabel(input.ref)}`, targetId: card.id };
}

function removeModule(state: CockpitState, cardId: string): Outcome {
  const board = state.board;
  cardOrThrow(board, cardId);
  board.modules = board.modules.filter((m) => m.id !== cardId);
  board.links = board.links.filter((l) => l.from !== cardId && l.to !== cardId);
  if (board.highlightId === cardId) board.highlightId = null;
  return { label: "Rimuove carta", targetId: cardId };
}

/** Moves a card into a frame, placing it in the frame grid, then grows the frame. */
function moveIntoFrame(
  state: CockpitState,
  card: BoardModule,
  frameId: string,
) {
  frameOrThrow(state.board, frameId);
  const spot = placeCard(
    withoutCard(state.board, card.id),
    { w: card.w, h: card.h },
    { frameId },
  );
  Object.assign(card, spot, { frameId });
  state.board = fitFrame(state.board, frameId);
}

function updateModule(
  state: CockpitState,
  cardId: string,
  patch: Extract<CockpitAction, { type: "module.update" }>["patch"],
  ctx: ActionContext,
): Outcome {
  const card = cardOrThrow(state.board, cardId);
  if (patch.text !== undefined) {
    if (card.ref.type !== "note")
      throw new ActionError("Solo le note hanno un testo");
    card.ref = { type: "note", text: patch.text };
  }
  if (patch.reason !== undefined) card.reason = patch.reason;
  if (patch.color === null) delete card.color;
  else if (patch.color !== undefined) card.color = patch.color;
  if (patch.frameId === null) delete card.frameId;
  else if (patch.frameId !== undefined && patch.frameId !== card.frameId)
    moveIntoFrame(state, card, patch.frameId);
  card.updatedAt = ctx.now;
  return { label: "Modifica carta", targetId: cardId };
}

function highlight(state: CockpitState, targetId: string | null): Outcome {
  const board = state.board;
  if (
    targetId !== null &&
    !findCard(board, targetId) &&
    !findFrame(board, targetId)
  )
    throw new ActionError("Carta o riquadro non trovato", 404);
  board.highlightId = targetId;
  return { label: "Evidenzia", targetId: targetId ?? undefined };
}

function pinModule(
  state: CockpitState,
  cardId: string,
  pinned: boolean,
  ctx: ActionContext,
): Outcome {
  const card = cardOrThrow(state.board, cardId);
  card.pinned = pinned;
  card.updatedAt = ctx.now;
  return { label: pinned ? "Fissa" : "Sblocca", targetId: card.id };
}

// ───────────────────────────── frames ─────────────────────────────

function addFrame(
  state: CockpitState,
  input: FrameInput,
  ctx: ActionContext,
): Outcome {
  const board = state.board;
  if (board.frames.length >= MAX_FRAMES)
    throw capError("Troppi riquadri sulla scrivania");
  const size = {
    w: Math.round(input.w ?? minFrameWidth(input.title)),
    h: Math.round(input.h ?? MIN_FRAME.h),
  };
  const spot = placeFrame(board, size, { near: input.near });
  const frame: Frame = {
    id: ctx.newId("f"),
    title: input.title,
    x: Math.round(input.x ?? spot.x),
    y: Math.round(input.y ?? spot.y),
    ...size,
    ...(input.color ? { color: input.color } : {}),
    addedBy: ctx.origin ?? "agent",
    addedAt: ctx.now,
    updatedAt: ctx.now,
  };
  board.frames = [...board.frames, frame];
  return { label: `Riquadro · ${input.title}`, targetId: frame.id };
}

function updateFrame(
  state: CockpitState,
  frameId: string,
  patch: Extract<CockpitAction, { type: "frame.update" }>["patch"],
  ctx: ActionContext,
): Outcome {
  const frame = frameOrThrow(state.board, frameId);
  if (patch.title !== undefined) {
    frame.title = patch.title;
    // A longer title widens the frame so it is never cut.
    frame.w = Math.max(frame.w, minFrameWidth(patch.title));
  }
  if (patch.color === null) delete frame.color;
  else if (patch.color !== undefined) frame.color = patch.color;
  frame.updatedAt = ctx.now;
  return { label: "Modifica riquadro", targetId: frameId };
}

/** Cards that leave with their frame: its unpinned cards, when `withCards` is set. */
function cardsLeavingWithFrame(
  board: Board,
  frameId: string,
  withCards: boolean,
): string[] {
  if (!withCards) return [];
  return board.modules
    .filter((m) => m.frameId === frameId && !m.pinned)
    .map((m) => m.id);
}

function removeFrame(
  state: CockpitState,
  frameId: string,
  withCards: boolean,
): Outcome {
  const board = state.board;
  frameOrThrow(board, frameId);
  const gone = new Set([
    frameId,
    ...cardsLeavingWithFrame(board, frameId, withCards),
  ]);
  board.frames = board.frames.filter((f) => f.id !== frameId);
  board.modules = board.modules
    .filter((m) => !gone.has(m.id))
    .map((m) => {
      if (m.frameId !== frameId) return m;
      const card = { ...m };
      delete card.frameId;
      return card;
    });
  board.links = board.links.filter((l) => !gone.has(l.from) && !gone.has(l.to));
  if (board.highlightId !== null && gone.has(board.highlightId))
    board.highlightId = null;
  return { label: "Rimuove riquadro", targetId: frameId };
}

// ───────────────────────────── links ─────────────────────────────

function addLink(
  state: CockpitState,
  input: { from: string; to: string; label?: string },
  ctx: ActionContext,
): Outcome {
  const board = state.board;
  if (input.from === input.to)
    throw new ActionError("Un collegamento unisce due elementi diversi");
  for (const end of [input.from, input.to])
    if (!findCard(board, end) && !findFrame(board, end))
      throw new ActionError("Elemento non trovato", 404);
  const existing = board.links.find(
    (l) => l.from === input.from && l.to === input.to,
  );
  if (existing) {
    if (input.label !== undefined) existing.label = input.label;
    return { label: "Aggiorna collegamento", targetId: existing.id };
  }
  if (board.links.length >= MAX_LINKS)
    throw capError("Troppi collegamenti sulla scrivania");
  const link: Link = {
    id: ctx.newId("k"),
    from: input.from,
    to: input.to,
    ...(input.label ? { label: input.label } : {}),
    addedBy: ctx.origin ?? "agent",
  };
  board.links = [...board.links, link];
  return { label: "Collega", targetId: link.id };
}

function removeLink(state: CockpitState, linkId: string): Outcome {
  need(
    state.board.links.find((l) => l.id === linkId),
    "Collegamento",
  );
  state.board.links = state.board.links.filter((l) => l.id !== linkId);
  return { label: "Rimuove collegamento", targetId: linkId };
}

// ───────────────────────────── whole board ─────────────────────────────

function arrangeBoard(state: CockpitState): Outcome {
  state.board = arrange(state.board);
  return { label: "Riordina scrivania" };
}

/** Keeps pinned cards, the frames still holding one, and the links between survivors. */
function clearBoard(state: CockpitState): Outcome {
  const board = state.board;
  const modules = board.modules.filter((m) => m.pinned);
  const frames = board.frames.filter((f) =>
    modules.some((m) => m.frameId === f.id),
  );
  const alive = new Set([...modules, ...frames].map((r) => r.id));
  state.board = {
    modules,
    frames,
    links: board.links.filter((l) => alive.has(l.from) && alive.has(l.to)),
    highlightId:
      board.highlightId !== null && alive.has(board.highlightId)
        ? board.highlightId
        : null,
  };
  return { label: "Svuota scrivania" };
}

function applyBoardAction(
  state: CockpitState,
  action: BoardAction,
  ctx: ActionContext,
): Outcome {
  switch (action.type) {
    case "module.show":
      return showModule(state, action.module, ctx);
    case "module.remove":
      return removeModule(state, action.id);
    case "module.update":
      return updateModule(state, action.id, action.patch, ctx);
    case "module.highlight":
      return highlight(state, action.id);
    case "module.pin":
      return pinModule(state, action.id, action.pinned, ctx);
    case "frame.add":
      return addFrame(state, action.frame, ctx);
    case "frame.update":
      return updateFrame(state, action.id, action.patch, ctx);
    case "frame.remove":
      return removeFrame(state, action.id, action.withCards);
    case "link.add":
      return addLink(state, action, ctx);
    case "link.remove":
      return removeLink(state, action.id);
    case "board.arrange":
      return arrangeBoard(state);
    case "board.clear":
      return clearBoard(state);
  }
}

// ───────────────────────────── record (non-board) ─────────────────────────────

function applyRecordAction(
  state: CockpitState,
  action: RecordAction,
  ctx: ActionContext,
): Outcome {
  let label = "";
  let targetId: string | undefined;
  switch (action.type) {
    case "position.set":
      state.position = { ...state.position, ...structuredClone(action.patch) };
      label = "Posizione";
      break;
    case "party.set":
      state.party = [
        ...new Set(action.names.map((x) => x.trim()).filter(Boolean)),
      ];
      label = "Gruppo";
      break;
    case "ledger.add":
    case "ledger.update":
    case "ledger.remove":
    case "combat.start":
    case "combat.add":
    case "combat.update":
    case "combat.remove":
    case "combat.turn":
    case "combat.notes":
    case "combat.end":
      // The ledger and the combat live in the framework libraries: see live.ts.
      throw new ActionError("Azione gestita dal registro della sessione live");
  }
  return { label, targetId };
}

// ───────────────────────────── entry points ─────────────────────────────

function isBoardAction(action: CockpitAction): action is BoardAction {
  return BOARD_ACTION.test(action.type);
}

export function applyAction(
  input: CockpitState,
  action: CockpitAction,
  ctx: ActionContext,
): { state: CockpitState; summary: ActionSummary } {
  const state = structuredClone(input);
  const outcome = isBoardAction(action)
    ? applyBoardAction(state, action, ctx)
    : applyRecordAction(state, action, ctx);
  return {
    state,
    summary: summary(action, outcome.label, outcome.targetId),
  };
}

export function applyActions(
  state: CockpitState,
  actions: CockpitAction[],
  ctx: ActionContext,
): { state: CockpitState; summaries: ActionSummary[] } {
  let next = structuredClone(state);
  const summaries = actions.map((action) => {
    const result = applyAction(next, action, ctx);
    next = result.state;
    return result.summary;
  });
  return { state: next, summaries };
}
