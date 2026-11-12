import { randomUUID } from "node:crypto";
import {
  appendFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  ActionGroup,
  ActionSummary,
  SourceRef,
  Board,
  BoardModule,
  ChatMessage,
  CockpitSession,
  CockpitSessionSummary,
  CockpitState,
  LayoutItem,
  ProviderId,
  Rect,
  Turn,
  CockpitAction,
} from "../../../shared/src/cockpit-types.js";
import {
  ActionError,
  applyActions,
  coordinateSchema,
  dimensionSchema,
  emptyState,
  parseAction,
} from "./actions.js";
import { defaultSize, fitFrame, moveFrame, placeCard } from "./layout.js";

const MAX_UNDO_GROUPS = 50;
const MAX_HISTORY_GROUPS = 200;
const MAX_COMPLETED_TURNS = 20;
const MAX_SESSION_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
const IMAGE_FILE_NAME = /^img-[0-9a-f-]{36}\.(png|jpg|webp|gif)$/;

export class StoreError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "StoreError";
  }
}
const layoutItemSchema = z
  .object({
    id: z.string().min(1).max(200),
    x: coordinateSchema,
    y: coordinateSchema,
    w: dimensionSchema.optional(),
    h: dimensionSchema.optional(),
    frameId: z.string().min(1).max(200).nullable().optional(),
  })
  .strict();
const layoutSchema = z.array(layoutItemSchema).min(1).max(300);

type LegacyCard = Partial<BoardModule> & { zone?: unknown; priority?: unknown };
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Removes the pre-canvas fields (zone, priority) from a card. */
function withoutLegacyFields(card: LegacyCard): LegacyCard {
  const next = { ...card };
  delete next.zone;
  delete next.priority;
  return next;
}

/**
 * Brings a stored state to the canvas model. Old list-based boards become cards
 * without frames: the `focus` card is highlighted and the others are placed by the layout engine.
 * States that already have `board.frames` are returned unchanged.
 */
export function migrateState(input: unknown): CockpitState {
  const state = input as CockpitState;
  if (Array.isArray(state.board?.frames)) return state;
  const legacy = (state.board?.modules ?? []) as LegacyCard[];
  const focus = legacy.find((m) => m.zone === "focus");
  const board: Board = {
    modules: [],
    frames: [],
    links: [],
    highlightId: focus?.id ?? null,
  };
  const unplaced: LegacyCard[] = [];
  for (const raw of legacy) {
    const card = withoutLegacyFields(raw);
    if (!isNumber(card.x) || !isNumber(card.y)) {
      unplaced.push(card);
      continue;
    }
    const size = sizeOf(card);
    board.modules.push({
      ...card,
      ...size,
      x: Math.round(card.x),
      y: Math.round(card.y),
    } as BoardModule);
  }
  for (const card of unplaced) {
    const size = sizeOf(card);
    const spot = placeCard(board, size);
    board.modules.push({ ...card, ...size, ...spot } as BoardModule);
  }
  return { ...state, board };
}

function sizeOf(card: LegacyCard): { w: number; h: number } {
  const fallback = defaultSize(card.kind ?? "note");
  return {
    w: isNumber(card.w) ? Math.round(card.w) : fallback.w,
    h: isNumber(card.h) ? Math.round(card.h) : fallback.h,
  };
}

/** Applies one geometry-only item to a board (card or frame). */
function applyLayoutItem(
  board: Board,
  item: z.infer<typeof layoutItemSchema>,
): Board {
  if (board.frames.some((f) => f.id === item.id))
    return layoutFrame(board, item);
  const card = board.modules.find((m) => m.id === item.id);
  if (!card) throw new StoreError("Elemento non trovato", 404);
  return layoutCard(board, card, item);
}

function resized<T extends Rect>(rect: T, item: { w?: number; h?: number }): T {
  return {
    ...rect,
    ...(item.w !== undefined ? { w: Math.round(item.w) } : {}),
    ...(item.h !== undefined ? { h: Math.round(item.h) } : {}),
  };
}

function layoutFrame(
  board: Board,
  item: z.infer<typeof layoutItemSchema>,
): Board {
  const moved = moveFrame(board, item.id, item.x, item.y);
  return {
    ...moved,
    frames: moved.frames.map((f) => (f.id === item.id ? resized(f, item) : f)),
  };
}

function layoutCard(
  board: Board,
  card: BoardModule,
  item: z.infer<typeof layoutItemSchema>,
): Board {
  const frameId =
    item.frameId === undefined ? card.frameId : (item.frameId ?? undefined);
  if (frameId !== undefined && !board.frames.some((f) => f.id === frameId))
    throw new StoreError("Riquadro non trovato", 404);
  const next: BoardModule = {
    ...resized(card, item),
    x: Math.round(item.x),
    y: Math.round(item.y),
  };
  delete next.frameId;
  if (frameId !== undefined) next.frameId = frameId;
  const moved = {
    ...board,
    modules: board.modules.map((m) => (m.id === card.id ? next : m)),
  };
  return frameId !== undefined ? fitFrame(moved, frameId) : moved;
}

/**
 * Undo restores the snapshot's content but keeps the DM's current geometry
 * (position, size and frame) for every card and frame that still exists.
 */
function keepDmLayout(snapshot: CockpitState, current: Board): CockpitState {
  const currentCards = new Map(current.modules.map((m) => [m.id, m]));
  const currentFrames = new Map(current.frames.map((f) => [f.id, f]));
  const snapshotFrameIds = new Set(snapshot.board.frames.map((f) => f.id));
  const modules = snapshot.board.modules.map((m): BoardModule => {
    const now = currentCards.get(m.id);
    if (!now) return m;
    const next: BoardModule = {
      ...m,
      x: now.x,
      y: now.y,
      w: now.w,
      h: now.h,
    };
    delete next.frameId;
    if (now.frameId && snapshotFrameIds.has(now.frameId))
      next.frameId = now.frameId;
    return next;
  });
  const frames = snapshot.board.frames.map((f) => {
    const now = currentFrames.get(f.id);
    return now ? { ...f, x: now.x, y: now.y, w: now.w, h: now.h } : f;
  });
  return { ...snapshot, board: { ...snapshot.board, modules, frames } };
}

/** Ledger and combat metadata that the framework libraries do not keep (evidence, sources, titles). */
export interface LedgerMeta {
  title: string;
  text: string;
  status: "active" | "resolved";
  evidence: string[];
  sources: SourceRef[];
}
export interface CombatMeta {
  title: string;
  notes: string;
  participants: Record<
    string,
    { source?: SourceRef; phase?: string; tempHp?: number; maxHp?: number }
  >;
}
/** Per cockpit session, in `live.json`. The ledger and combat themselves live in the framework. */
export interface LiveSide {
  /** Keyed by the framework's entry id (e-0001). */
  ledger: Record<string, LedgerMeta>;
  combat: CombatMeta | null;
  /** Sheets this cockpit session created: the only ones sheet_update may rewrite. */
  sheets: { path: string; title: string }[];
}
const emptySide = (): LiveSide => ({ ledger: {}, combat: null, sheets: [] });
const LIVE_FILE = "live.json";

type Change =
  | { kind: "state"; group?: ActionGroup }
  | { kind: "message"; message: ChatMessage }
  | { kind: "turn"; turn: Turn }
  | { kind: "deleted" };
export class CockpitStore {
  private root: string;
  private sessionsRoot?: string;
  private queues = new Map<string, Promise<unknown>>();
  private onChange?: (session: CockpitSession, change: Change) => void;
  constructor(
    root: string,
    options: {
      onChange?: (session: CockpitSession, change: Change) => void;
      sessionsRoot?: string;
    } = {},
  ) {
    this.root = path.resolve(root);
    this.onChange = options.onChange;
    this.sessionsRoot = options.sessionsRoot
      ? path.resolve(options.sessionsRoot)
      : undefined;
  }
  private async safeContainer() {
    await mkdir(this.root, { recursive: true });
    const root = await realpath(this.root);
    const requested =
      this.sessionsRoot ||
      path.join(root, ".campaign", "state", "live", "cockpit");
    await mkdir(path.dirname(requested), { recursive: true });
    const parent = await realpath(path.dirname(requested));
    const target = path.join(parent, path.basename(requested));
    const stat = await lstat(target).catch(() => null);
    if (stat?.isSymbolicLink() || (stat && !stat.isDirectory()))
      throw new StoreError("Cartella delle sessioni non sicura");
    if (!stat)
      await mkdir(target, { mode: 0o700 }).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error;
        },
      );
    const current = await lstat(target);
    if (current.isSymbolicLink() || !current.isDirectory())
      throw new StoreError("Cartella delle sessioni non sicura");
    const resolved = await realpath(target);
    if (resolved !== target) throw new StoreError("Cartella delle sessioni fuori radice");
    return resolved;
  }
  private async dir(id: string) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      throw new StoreError("ID sessione non valido");
    const container = await this.safeContainer();
    const target = path.join(container, id);
    const stat = await lstat(target).catch(() => null);
    if (stat?.isSymbolicLink() || (stat && !stat.isDirectory()))
      throw new StoreError("Directory sessione non sicura");
    const resolved = await realpath(target).catch(() => {
      throw new StoreError("Sessione non trovata", 404);
    });
    if (!resolved.startsWith(container + path.sep))
      throw new StoreError("Percorso sessione non consentito");
    return resolved;
  }
  private async enqueue<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(id) || Promise.resolve();
    const current = prev.catch(() => {}).then(fn);
    this.queues.set(id, current);
    try {
      return (await current) as T;
    } finally {
      if (this.queues.get(id) === current) this.queues.delete(id);
    }
  }
  private async read(dir: string): Promise<CockpitSession> {
    const file = path.join(dir, "session.json");
    const s = await lstat(file).catch(() => null);
    if (!s || !s.isFile() || s.isSymbolicLink())
      throw new StoreError("Snapshot sessione assente o non sicuro", 500);
    if (s.size > MAX_SESSION_BYTES)
      throw new StoreError("Sessione oltre il limite", 413);
    try {
      const session = JSON.parse(
        await readFile(file, "utf8"),
      ) as CockpitSession;
      session.state = migrateState(session.state);
      return session;
    } catch {
      throw new StoreError("Snapshot sessione illeggibile", 500);
    }
  }
  private async commit(dir: string, s: CockpitSession) {
    s.updatedAt = new Date().toISOString();
    const raw = JSON.stringify(s);
    if (Buffer.byteLength(raw) > MAX_SESSION_BYTES)
      throw new StoreError("Sessione oltre il limite", 413);
    const tmp = path.join(dir, `.session-${randomUUID()}.tmp`);
    await writeFile(tmp, raw, { mode: 0o600 });
    await rename(tmp, path.join(dir, "session.json"));
  }
  private async undoMap(dir: string): Promise<Record<string, CockpitState>> {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(await readFile(path.join(dir, "undo.json"), "utf8"));
    } catch {
      return {};
    }
    return Object.fromEntries(
      Object.entries(raw).map(([key, snapshot]) => [
        key,
        migrateState(snapshot),
      ]),
    );
  }
  private async saveUndo(dir: string, map: Record<string, CockpitState>) {
    const tmp = path.join(dir, `.undo-${randomUUID()}.tmp`);
    await writeFile(tmp, JSON.stringify(map), { mode: 0o600 });
    await rename(tmp, path.join(dir, "undo.json"));
  }
  async list(): Promise<CockpitSessionSummary[]> {
    const root = await this.safeContainer();
    const entries = await readdir(root, { withFileTypes: true });
    const out: CockpitSessionSummary[] = [];
    for (const e of entries) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue;
      try {
        const s = await this.read(await this.dir(e.name));
        out.push({
          id: s.id,
          title: s.title,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          location: s.state.position.location,
        });
      } catch {}
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async create(input: {
    title: string;
    provider: ProviderId;
    model: string;
  }): Promise<CockpitSession> {
    if (
      !input.title?.trim() ||
      input.title.length > 200 ||
      !input.model?.trim() ||
      input.model.length > 200 ||
      input.provider !== "claude"
    )
      throw new StoreError("Dati sessione non validi");
    const id = randomUUID();
    const dir = path.join(await this.safeContainer(), id);
    await mkdir(dir, { mode: 0o700 });
    const now = new Date().toISOString();
    const s: CockpitSession = {
      id,
      title: input.title.trim(),
      createdAt: now,
      updatedAt: now,
      revision: 0,
      provider: input.provider,
      model: input.model,
      state: emptyState(),
      messages: [],
      turns: [],
      history: [],
    };
    await this.commit(dir, s);
    await this.saveUndo(dir, {});
    return s;
  }
  async get(id: string) {
    return this.enqueue(id, async () => this.read(await this.dir(id)));
  }
  async delete(id: string) {
    return this.enqueue(id, async () => {
      const dir = await this.dir(id);
      const s = await this.read(dir);
      await rm(dir, { recursive: true });
      this.onChange?.(s, { kind: "deleted" });
    });
  }
  async apply(
    id: string,
    actions: CockpitAction[],
    meta: { origin: "agent" | "dm"; turnId?: string; groupId?: string },
  ): Promise<{ session: CockpitSession; group: ActionGroup }> {
    return this.enqueue(id, async () => {
      const dir = await this.dir(id);
      const s = await this.read(dir);
      let parsed: CockpitAction[];
      try {
        parsed = actions.map(parseAction);
      } catch (e) {
        if (e instanceof ActionError) throw new StoreError(e.message, e.status);
        throw e;
      }
      let result;
      try {
        result = applyActions(s.state, parsed, {
          now: new Date().toISOString(),
          newId: (p) => `${p}-${randomUUID()}`,
          knownMessageIds: new Set(
            s.messages.filter((m) => m.role === "dm").map((m) => m.id),
          ),
          origin: meta.origin,
        });
      } catch (e) {
        if (e instanceof ActionError) throw new StoreError(e.message, e.status);
        throw e;
      }
      return this.persistGroup(dir, s, result.state, result.summaries, meta);
    });
  }
  /**
   * Records a group whose effects live outside the cockpit state (ledger and combat, kept by
   * the framework). The group gets an undo snapshot like any other, but undo restores only the
   * board, position and party, so it never touches the ledger or the combat.
   */
  async recordGroup(
    id: string,
    summaries: ActionSummary[],
    meta: { origin: "agent" | "dm"; turnId?: string; groupId?: string },
  ): Promise<{ session: CockpitSession; group: ActionGroup }> {
    return this.enqueue(id, async () => {
      const dir = await this.dir(id);
      const s = await this.read(dir);
      return this.persistGroup(dir, s, s.state, summaries, meta);
    });
  }
  private async persistGroup(
    dir: string,
    s: CockpitSession,
    nextState: CockpitState,
    summaries: ActionSummary[],
    meta: { origin: "agent" | "dm"; turnId?: string; groupId?: string },
  ): Promise<{ session: CockpitSession; group: ActionGroup }> {
    const lastActiveGroup = [...s.history].reverse().find((g) => !g.undone);
    const requestedGroup = meta.groupId
      ? s.history.find((g) => g.id === meta.groupId)
      : undefined;
    const prevGroup =
      requestedGroup &&
      !requestedGroup.undone &&
      lastActiveGroup?.id === requestedGroup.id
        ? requestedGroup
        : undefined;
    const undo = await this.undoMap(dir);
    const groupId =
      prevGroup?.id ||
      (meta.groupId && !requestedGroup ? meta.groupId : randomUUID());
    if (!prevGroup) undo[groupId] = structuredClone(s.state);
    const group: ActionGroup = prevGroup
      ? { ...prevGroup, actions: [...prevGroup.actions, ...summaries] }
      : {
          id: groupId,
          at: new Date().toISOString(),
          origin: meta.origin,
          ...(meta.turnId ? { turnId: meta.turnId } : {}),
          actions: summaries,
          undone: false,
        };
    s.state = nextState;
    s.revision++;
    if (prevGroup)
      s.history = s.history.map((g) => (g.id === groupId ? group : g));
    else s.history = [...s.history, group].slice(-MAX_HISTORY_GROUPS);
    const keep = new Set(s.history.filter((g) => !g.undone).map((g) => g.id));
    for (const k of Object.keys(undo)) if (!keep.has(k)) delete undo[k];
    const keys = Object.keys(undo);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_UNDO_GROUPS)))
      delete undo[k];
    await this.saveUndo(dir, undo);
    await this.commit(dir, s);
    this.onChange?.(s, { kind: "state", group });
    return { session: s, group };
  }
  /** The framework session this cockpit session is attached to, if any. */
  async setLiveSession(id: string, liveSessionId: string) {
    return this.enqueue(id, async () => {
      const dir = await this.dir(id);
      const s = await this.read(dir);
      s.liveSessionId = liveSessionId;
      await this.commit(dir, s);
      return s;
    });
  }
  /** Reads the side file of a cockpit session (empty when it has none yet). */
  async sideGet(id: string): Promise<LiveSide> {
    return this.enqueue(id, async () => this.readSide(await this.dir(id)));
  }
  /** Changes the side file of a cockpit session in one step. */
  async sideUpdate(id: string, change: (side: LiveSide) => LiveSide): Promise<LiveSide> {
    return this.enqueue(id, async () => {
      const dir = await this.dir(id);
      const next = change(await this.readSide(dir));
      const tmp = path.join(dir, `.live-${randomUUID()}.tmp`);
      await writeFile(tmp, JSON.stringify(next), { mode: 0o600 });
      await rename(tmp, path.join(dir, LIVE_FILE));
      return next;
    });
  }
  private async readSide(dir: string): Promise<LiveSide> {
    try {
      const raw = JSON.parse(await readFile(path.join(dir, LIVE_FILE), "utf8")) as Partial<LiveSide>;
      return { ...emptySide(), ...raw };
    } catch {
      return emptySide();
    }
  }
  /**
   * Geometry-only change from the canvas: persisted and broadcast, but it adds
   * no history group and no undo snapshot.
   */
  async layout(id: string, items: LayoutItem[]): Promise<CockpitSession> {
    const parsed = layoutSchema.safeParse(items);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new StoreError(
        `Layout non valido${issue?.path.length ? ` in ${issue.path.join(".")}` : ""}: ${issue?.message ?? ""}`,
      );
    }
    return this.enqueue(id, async () => {
      const dir = await this.dir(id);
      const s = await this.read(dir);
      let board = s.state.board;
      for (const item of parsed.data) board = applyLayoutItem(board, item);
      s.state.board = board;
      s.revision++;
      await this.commit(dir, s);
      this.onChange?.(s, { kind: "state" });
      return s;
    });
  }
  async undo(id: string, groupId: string) {
    return this.enqueue(id, async () => {
      const dir = await this.dir(id);
      const s = await this.read(dir);
      const g = s.history.find((x) => x.id === groupId);
      if (!g) throw new StoreError("Gruppo non trovato", 404);
      if (g.undone) throw new StoreError("Gruppo già annullato", 409);
      const latest = [...s.history].reverse().find((x) => !x.undone);
      if (latest?.id !== groupId)
        throw new StoreError("Si può annullare soltanto l’ultimo gruppo", 409);
      const undo = await this.undoMap(dir);
      if (!undo[groupId]) throw new StoreError("Snapshot undo assente", 409);
      // Undo restores board, position and party only: ledger and combat are never in the snapshot.
      s.state = {
        ...keepDmLayout(undo[groupId], s.state.board),
        ledger: s.state.ledger,
        combat: s.state.combat,
      };
      delete undo[groupId];
      s.history = s.history.map((x) =>
        x.id === groupId ? { ...x, undone: true } : x,
      );
      s.revision++;
      await this.saveUndo(dir, undo);
      await this.commit(dir, s);
      this.onChange?.(s, { kind: "state", group: g });
      return s;
    });
  }
  /** Appends one line to the diagnostics log of the session (`tools.jsonl`). */
  async appendToolLog(id: string, entry: Record<string, unknown>) {
    const dir = await this.dir(id);
    await appendFile(
      path.join(dir, "tools.jsonl"),
      `${JSON.stringify(entry)}\n`,
      "utf8",
    );
  }
  async appendMessage(id: string, message: ChatMessage) {
    return this.enqueue(id, async () => {
      const dir = await this.dir(id);
      const s = await this.read(dir);
      if (s.messages.some((m) => m.id === message.id)) return s;
      s.messages.push(structuredClone(message));
      await this.commit(dir, s);
      this.onChange?.(s, { kind: "message", message });
      return s;
    });
  }
  async updateMessage(
    id: string,
    messageId: string,
    patch: Partial<ChatMessage>,
  ) {
    return this.enqueue(id, async () => {
      const dir = await this.dir(id);
      const s = await this.read(dir);
      const m = s.messages.find((x) => x.id === messageId);
      if (!m) throw new StoreError("Messaggio non trovato", 404);
      Object.assign(m, structuredClone(patch));
      await this.commit(dir, s);
      this.onChange?.(s, { kind: "message", message: m });
      return s;
    });
  }
  async upsertTurn(id: string, turn: Turn) {
    return this.enqueue(id, async () => {
      const dir = await this.dir(id);
      const s = await this.read(dir);
      const index = s.turns.findIndex((t) => t.id === turn.id);
      if (index < 0) s.turns.push(structuredClone(turn));
      else s.turns[index] = structuredClone(turn);
      const done = s.turns.filter((t) =>
        ["done", "error", "cancelled"].includes(t.status),
      );
      const excess = Math.max(0, done.length - MAX_COMPLETED_TURNS);
      for (const t of done.slice(0, excess))
        s.turns = s.turns.filter((x) => x.id !== t.id);
      await this.commit(dir, s);
      this.onChange?.(s, { kind: "turn", turn });
      return s;
    });
  }
  async setProviderSession(
    id: string,
    patch: {
      provider?: ProviderId;
      model?: string;
      providerSessionId?: string | undefined;
    },
  ) {
    return this.enqueue(id, async () => {
      const dir = await this.dir(id);
      const s = await this.read(dir);
      if (patch.provider) s.provider = patch.provider;
      if (patch.model) s.model = patch.model;
      if ("providerSessionId" in patch) {
        if (patch.providerSessionId === undefined) delete s.providerSessionId;
        else s.providerSessionId = patch.providerSessionId;
      }
      await this.commit(dir, s);
      this.onChange?.(s, { kind: "state" });
      return s;
    });
  }
  /** Saves an uploaded image in `<session>/files/` and returns its file name. */
  async saveFile(
    id: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<string> {
    const mime = contentType.split(";")[0]!.trim().toLowerCase();
    const extension = IMAGE_EXTENSIONS[mime];
    if (!extension)
      throw new StoreError("Formato immagine non supportato", 415);
    if (bytes.byteLength > MAX_IMAGE_BYTES)
      throw new StoreError("Immagine troppo grande", 413);
    return this.enqueue(id, async () => {
      const files = path.join(await this.dir(id), "files");
      await mkdir(files, { recursive: true, mode: 0o700 });
      const stat = await lstat(files);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new StoreError("Directory file non sicura");
      const name = `img-${randomUUID()}.${extension}`;
      const tmp = path.join(files, `.upload-${randomUUID()}.tmp`);
      await writeFile(tmp, bytes, { mode: 0o600 });
      await rename(tmp, path.join(files, name));
      return name;
    });
  }
  /** Absolute path of a previously saved image; refuses anything but a plain file. */
  async filePath(id: string, name: string): Promise<string> {
    if (!IMAGE_FILE_NAME.test(name))
      throw new StoreError("Nome file non valido");
    const files = path.join(await this.dir(id), "files");
    const dirStat = await lstat(files).catch(() => null);
    if (!dirStat?.isDirectory() || dirStat.isSymbolicLink())
      throw new StoreError("File non trovato", 404);
    const file = path.join(files, name);
    const stat = await lstat(file).catch(() => null);
    if (!stat) throw new StoreError("File non trovato", 404);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new StoreError("File non sicuro", 403);
    return file;
  }
  async close() {
    await Promise.allSettled([...this.queues.values()]);
  }
}
