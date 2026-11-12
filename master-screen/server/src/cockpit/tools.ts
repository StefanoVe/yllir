import { z } from "zod";
import { resolveReference } from "./vendor/markdown-reference.js";
import { searchImages } from "./vendor/image-search.js";
import type {
  CockpitArchive,
  CockpitBattle,
  CockpitCategories,
  CockpitKind,
  CockpitMusic,
  Detail,
  ImageAsset,
  MapAsset,
  PlotGraph,
} from "./ports.js";
import type {
  CardColor,
  CockpitAction,
  ModuleInput,
  ModuleKind,
  ModuleRef,
  SourceRef,
} from "../../../shared/src/cockpit-types.js";
import type { CockpitStore } from "./store.js";
import type { CockpitLive } from "./live.js";
import type { CockpitBus } from "./bus.js";
import { stateView, type Resolver } from "./view.js";
import type { TrackCache } from "./resolvers.js";
import { combatantInputSchema } from "./actions.js";
import { sessionOutline, type OutlineRef } from "./outline.js";
import {
  SHEET_KINDS,
  createSheet,
  updateSheet,
  type SheetDeps,
  type SheetKind,
  type WrittenSheet,
} from "./authoring.js";

export interface ToolContext {
  sessionId: string;
  turnId: string;
  groupId?: string;
  onActivity(label: string): void;
  setGroupId(id: string): void;
}
export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}
export interface CockpitTool {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  handler(args: unknown, context: ToolContext): Promise<ToolResult>;
}
export interface CockpitToolsDeps {
  store: CockpitStore;
  archive: Pick<CockpitArchive, "docs" | "search">;
  maps: () => MapAsset[];
  /** Every image of the archive (server/images.ts); none when omitted. */
  images?: () => ImageAsset[];
  tracks: TrackCache;
  getPlotGraph(): PlotGraph;
  resolve: Resolver;
  bus: CockpitBus;
  music: Pick<CockpitMusic, "request" | "search">;
  /** Categories of the campaign: folders, kinds of documents, players' folder. */
  categories: CockpitCategories;
  /** Ledger and combat go to the framework; board, position and party to the store. */
  live: Pick<CockpitLive, "apply" | "hydrate">;
  /** Sheet writer of one cockpit session (engine save). Without it sheet_create and sheet_update fail. */
  sheets?: (sessionId: string) => SheetDeps;
  /** Battle screen of the live session. Without it the battle tools answer "not supported". */
  battle?: CockpitBattle;
}

const fieldDescriptions: Record<string, string> = {
  query: "Testo da cercare o filtro facoltativo.",
  category: "Categoria documentale facoltativa.",
  path: "Percorso relativo restituito dagli strumenti di ricerca.",
  anchor: "ID della heading che identifica la sezione, se serve.",
  kind: "Tipo di modulo, voce o partecipante richiesto.",
  trackId: "ID della traccia restituito dalla ricerca musicale.",
  text: "Testo breve da mostrare o registrare secondo il tool.",
  pinned: "Se true, mantiene fissato il modulo.",
  reason: "Motivo breve per cui la modifica serve adesso.",
  id: "ID esistente del modulo, voce o partecipante.",
  location: "Luogo attuale del gruppo.",
  moment: "Momento o fase attuale della scena.",
  summary: "Riassunto breve della scena corrente.",
  party: "Nomi dei personaggi del gruppo.",
  title: "Titolo breve e descrittivo.",
  evidence: "ID dei messaggi DM che sostengono la voce.",
  sources: "Fonti documentali pertinenti.",
  status: "Stato della voce del registro.",
  addEvidence: "Nuovi ID di messaggi DM da aggiungere.",
  addSources: "Nuove fonti da aggiungere.",
  participants: "Partecipanti dichiarati dal master.",
  participant: "Partecipante dichiarato dal master.",
  patch: "Campi del partecipante da aggiornare.",
  activeId: "ID del partecipante attivo, oppure null.",
  round: "Numero del round dichiarato dal master.",
  notes: "Note dello scontro dichiarate dal master.",
  name: "Nome del partecipante allo scontro.",
  initiative: "Iniziativa dichiarata dal master, oppure null.",
  resources: "Risorse numeriche dichiarate per il partecipante.",
  hp: "Punti ferita dichiarati, quando si tratta di un nemico o alleato.",
  maxHp: "Punti ferita massimi dichiarati.",
  tempHp: "Punti ferita temporanei dichiarati.",
  phase: "Fase dichiarata del partecipante.",
  conditions: "Condizioni dichiarate dal master.",
  cards:
    "Per board_place: voci delle carte da mostrare (1–40), ciascuna con kind, path ed eventualmente anchor, trackId per la musica, text per le note, e facoltativi frame, near, pinned, color e reason. Per board_frame: ID delle carte da inserire nel riquadro.",
  frame:
    "ID del riquadro che contiene la carta, oppure null per toglierla da ogni riquadro.",
  links:
    "Collegamenti da aggiungere in una sola chiamata (1–30): ciascuno con from, to ed eventuale label.",
  after:
    "ID di carte o riquadri che precedono il riquadro: una freccia va da ciascuno al riquadro.",
  before:
    "ID di carte o riquadri che seguono il riquadro: una freccia va dal riquadro a ciascuno.",
  near: "ID di una carta o di un riquadro vicino cui collocare l'elemento.",
  color: "Colore facoltativo: red, amber, green, blue o violet.",
  ids: "ID di carte o riquadri da rimuovere.",
  replace: "Se true, svuota prima la scrivania; le carte fissate restano.",
  from: "ID della carta o del riquadro di partenza.",
  to: "ID della carta o del riquadro di arrivo.",
  label: "Etichetta breve della freccia.",
};
function describeInputFields<S extends z.ZodObject<z.ZodRawShape>>(
  schema: S,
): S;
function describeInputFields(schema: z.ZodType): z.ZodType;
function describeInputFields(schema: z.ZodType): z.ZodType {
  if (!(schema instanceof z.ZodObject)) return schema;
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [
      key,
      (field instanceof z.ZodObject
        ? describeInputFields(field)
        : field
      ).describe(
        fieldDescriptions[key] ||
          `Valore ${key} richiesto da questo strumento.`,
      ),
    ]),
  );
  return schema.extend(shape);
}

const MAX_DOC_CHARS = 24000;
/** Which category kinds each document module kind accepts (a session of a player is a plot document too). */
const ACCEPTED_KINDS: Partial<Record<ModuleKind, CockpitKind[]>> = {
  npc: ["npc"],
  pc: ["pc", "session"],
  enemy: ["enemy"],
  item: ["item"],
  location: ["location"],
  lore: ["lore"],
  plot: ["plot", "session"],
};
export const COCKPIT_TOOL_NAMES = [
  "search_docs",
  "read_doc",
  "plot_neighbors",
  "list_maps",
  "find_images",
  "search_music",
  "session_outline",
  "board_stage",
  "board_place",
  "sheet_create",
  "sheet_update",
  "board_remove",
  "board_highlight",
  "board_pin",
  "board_frame",
  "board_link",
  "board_arrange",
  "board_move",
  "get_board",
  "scene_set",
  "ledger_note",
  "ledger_update",
  "ledger_remove",
  "combat_start",
  "combat_add",
  "combat_update",
  "combat_remove",
  "combat_turn",
  "combat_notes",
  "combat_end",
  "find_battle_map",
  "battle_map_set",
  "battle_move",
  "music_play",
  "music_stop",
  "open_source",
] as const;
const tool = (
  name: string,
  description: string,
  inputSchema: z.ZodType,
  fn: (args: Record<string, unknown>, context: ToolContext) => Promise<unknown>,
  activity: (args: Record<string, unknown>) => string,
): CockpitTool => ({
  name,
  description,
  inputSchema: describeInputFields(inputSchema),
  async handler(raw, context) {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) {
      context.onActivity(`Tool · ${name}`);
      return error(
        `Input non valido: ${parsed.error.issues[0]?.message || "parametri errati"}`,
      );
    }
    const args = parsed.data as Record<string, unknown>;
    context.onActivity(activity(args));
    try {
      return success(await fn(args, context));
    } catch (e) {
      return error(e instanceof Error ? e.message : String(e));
    }
  },
});
const success = (value: unknown): ToolResult => ({
  content: [
    {
      type: "text",
      text: typeof value === "string" ? value : JSON.stringify(value),
    },
  ],
});
const error = (message: string): ToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});
function checkedPath(
  deps: Pick<CockpitToolsDeps, "categories">,
  value: string,
) {
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((part) => !part || part === "." || part === "..") ||
    deps.categories.kindOf(value) === "other"
  )
    throw new Error("Percorso fuori dalle cartelle consentite");
  return value;
}
const normalized = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it")
    .replace(/[^a-z0-9]/g, "");
function findAnchor(doc: Detail, requested: string) {
  const exact = doc.headings.find((heading) => heading.id === requested);
  if (exact) return exact.id;
  const key = normalized(requested);
  const matches = doc.headings.filter(
    (heading) => normalized(heading.id) === key,
  );
  if (matches.length === 1) return matches[0]!.id;
  if (matches.length > 1)
    throw new Error(
      `Ancora ambigua. Heading disponibili: ${doc.headings.map((h) => `${h.title} (#${h.id})`).join(", ")}`,
    );
  throw new Error(
    `Ancora non trovata. Heading disponibili: ${doc.headings.map((h) => `${h.title} (#${h.id})`).join(", ") || "nessuna"}`,
  );
}
function readSection(doc: Detail, anchor?: string) {
  if (!anchor) return doc.raw;
  const heading = doc.headings.find((item) => item.id === anchor);
  if (!heading) throw new Error("Ancora non trovata");
  const lines = doc.raw.split("\n");
  const level = (lines[heading.line - 1] || "").match(/^#+/)?.[0].length || 6;
  let end = lines.length;
  for (const next of doc.headings) {
    if (next.line <= heading.line) continue;
    const nextLevel =
      (lines[next.line - 1] || "").match(/^#+/)?.[0].length || 6;
    if (nextLevel <= level) {
      end = next.line - 1;
      break;
    }
  }
  return lines.slice(heading.line - 1, end).join("\n");
}
function sourceExists(
  deps: Pick<CockpitToolsDeps, "archive" | "categories">,
  source: SourceRef,
) {
  checkedPath(deps, source.path);
  const doc = deps.archive.docs.get(source.path);
  if (!doc) throw new Error(`Documento non trovato: ${source.path}`);
  return source.anchor
    ? { ...source, anchor: findAnchor(doc, source.anchor) }
    : source;
}
function verifyCombatSources(
  deps: CockpitToolsDeps,
  action: CockpitAction,
): CockpitAction {
  const source = (value: SourceRef | undefined) =>
    value ? sourceExists(deps, value) : undefined;
  if (action.type === "combat.start")
    return {
      ...action,
      participants: action.participants.map((participant) => ({
        ...participant,
        ...(participant.source ? { source: source(participant.source) } : {}),
      })),
    };
  if (action.type === "combat.add")
    return {
      ...action,
      participant: {
        ...action.participant,
        ...(action.participant.source
          ? { source: source(action.participant.source) }
          : {}),
      },
    };
  if (action.type === "combat.update" && action.patch.source)
    return {
      ...action,
      patch: { ...action.patch, source: source(action.patch.source) },
    };
  return action;
}
function apply(
  deps: CockpitToolsDeps,
  action: CockpitAction,
  context: ToolContext,
) {
  return deps.live
    .apply(context.sessionId, action, {
      origin: "agent",
      turnId: context.turnId,
      ...(context.groupId ? { groupId: context.groupId } : {}),
    })
    .then((result) => {
      context.setGroupId(result.group.id);
      const summary = result.group.actions.at(-1);
      return {
        id: summary?.targetId || result.group.id,
        title: summary?.label || "Azione applicata",
      };
    });
}

const cardColorSchema = z.enum(["red", "amber", "green", "blue", "violet"]);
const kindSchema = z.enum([
  "npc",
  "pc",
  "lore",
  "enemy",
  "item",
  "location",
  "map",
  "battlemap",
  "image",
  "music",
  "plot",
  "note",
]);
const placeItemSchema = z
  .object({
    kind: kindSchema,
    path: z.string().max(500).optional(),
    anchor: z.string().max(300).optional(),
    trackId: z.string().max(200).optional(),
    text: z.string().max(4000).optional(),
    frame: z.string().min(1).max(200).optional(),
    near: z.string().min(1).max(200).optional(),
    pinned: z.boolean().optional(),
    color: cardColorSchema.optional(),
    reason: z.string().max(300),
  })
  .strict();
type PlaceItem = z.infer<typeof placeItemSchema>;

const linkInputSchema = z
  .object({
    from: z.string().min(1).max(200),
    to: z.string().min(1).max(200),
    label: z.string().max(200).optional(),
  })
  .strict();
type LinkInput = z.infer<typeof linkInputSchema>;
const linkAction = (link: LinkInput): CockpitAction => ({
  type: "link.add",
  from: String(link.from),
  to: String(link.to),
  ...(link.label ? { label: String(link.label) } : {}),
});

const errorText = (value: unknown) =>
  value instanceof Error ? value.message : String(value);
/** Appended to board_place errors: cards already on the board are moved, not re-placed. */
const MOVE_HINT =
  " Per spostare o raggruppare carte già sulla plancia usa board_move (o board_frame con cards) con i loro id.";
/** Short, readable reference of where a card comes from. */
function sourceOf(ref: ModuleRef): string {
  if (ref.type === "doc")
    return ref.anchor ? `${ref.path}#${ref.anchor}` : ref.path;
  if (ref.type === "track") return ref.trackId;
  if (ref.type === "asset" || ref.type === "image") return ref.path;
  return "nota";
}
/**
 * Records every tool call of a turn in the session folder (`tools.jsonl`). A logging
 * failure never changes the result of the call.
 */
function withToolLog(deps: CockpitToolsDeps, item: CockpitTool): CockpitTool {
  return {
    ...item,
    async handler(raw, context) {
      const result = await item.handler(raw, context);
      const text = result.content.map((part) => part.text).join("\n");
      const args = JSON.stringify(raw) ?? "";
      await deps.store
        .appendToolLog(context.sessionId, {
          at: new Date().toISOString(),
          turnId: context.turnId,
          tool: item.name,
          ok: !result.isError,
          ...(result.isError ? { error: text.slice(0, 500) } : {}),
          args: args.slice(0, 500),
        })
        .catch(() => {});
      return result;
    },
  };
}
/** JSON replacer that drops empty arrays, to keep outlines compact. */
const withoutEmptyArrays = (_key: string, value: unknown) =>
  Array.isArray(value) && value.length === 0 ? undefined : value;

/** Builds the reference of a card from a document, keeping the anchor only when present. */
function docRef(source: SourceRef): ModuleRef {
  return {
    type: "doc",
    path: source.path,
    ...(source.anchor ? { anchor: source.anchor } : {}),
  };
}

/** Resolves a card for a placement item, validating its reference against its kind. */
function refOf(
  deps: CockpitToolsDeps,
  kind: ModuleKind,
  item: PlaceItem,
): ModuleRef {
  const accepted = ACCEPTED_KINDS[kind];
  if (accepted) {
    if (!item.path) throw new Error("Il modulo richiede path");
    if (item.trackId !== undefined || item.text !== undefined)
      throw new Error("Riferimento non coerente con il tipo di modulo");
    const path = item.path;
    if (!accepted.includes(deps.categories.kindOf(path)))
      throw new Error(
        `Il tipo ${kind} richiede un documento di tipo ${accepted.join(" o ")}: per ${path} usa il tipo corrispondente alla sua cartella.`,
      );
    const source = sourceExists(deps, {
      path,
      ...(item.anchor ? { anchor: item.anchor } : {}),
    });
    return docRef(source);
  }
  if (kind === "map" || kind === "battlemap") {
    if (!item.path) throw new Error("Il modulo mappa richiede path");
    if (
      item.anchor !== undefined ||
      item.trackId !== undefined ||
      item.text !== undefined
    )
      throw new Error("Riferimento non coerente con il tipo di modulo");
    const asset = deps.maps().find((map) => map.path === item.path);
    if (asset) {
      if (
        (kind === "map" && asset.category !== "Mappa") ||
        (kind === "battlemap" && asset.category !== "Battlemap")
      )
        throw new Error("Riferimento non coerente con il tipo di modulo");
      return { type: "asset", path: asset.path };
    }
    // Any other archive image (portrait, illustration, item card) is an asset too.
    const images = imagesOf(deps);
    if (images.some((image) => image.path === item.path))
      return { type: "asset", path: item.path };
    throw new Error(unavailableImage(item.path, images));
  }
  if (kind === "music") {
    if (
      item.path !== undefined ||
      item.anchor !== undefined ||
      item.text !== undefined
    )
      throw new Error("Riferimento non coerente con il tipo di modulo");
    if (!item.trackId) throw new Error("Il modulo musica richiede trackId");
    const title = deps.tracks.get(item.trackId)?.title;
    return {
      type: "track",
      trackId: item.trackId,
      ...(title ? { title } : {}),
    };
  }
  if (
    item.path !== undefined ||
    item.anchor !== undefined ||
    item.trackId !== undefined
  )
    throw new Error("Riferimento non coerente con il tipo di modulo");
  if (typeof item.text !== "string")
    throw new Error("Il modulo nota richiede text");
  return { type: "note", text: item.text };
}

/** Archive images known to the cockpit. */
const imagesOf = (deps: CockpitToolsDeps): ImageAsset[] =>
  deps.images?.() ?? [];

/**
 * Error for an archive path that is not an image, with up to three images
 * whose names resemble it.
 */
function unavailableImage(value: string, images: ImageAsset[]) {
  const name = (value.split("/").at(-1) ?? value).replace(/\.[^.]+$/, "");
  const close = searchImages(images, name)
    .slice(0, 3)
    .map((image) => image.path);
  return `Immagine o mappa non disponibile nell'archivio: ${value}${close.length ? `. Forse: ${close.join(", ")}` : ""}`;
}

function moduleInputOf(deps: CockpitToolsDeps, item: PlaceItem): ModuleInput {
  // The board stores archive images as asset cards of kind map: the reducer
  // pairs the image kind with session uploads only.
  const kind = (item.kind === "image" ? "map" : item.kind) as ModuleKind;
  return {
    kind,
    ref: refOf(deps, kind, item),
    reason: item.reason,
    ...(item.frame ? { frameId: item.frame } : {}),
    ...(item.near ? { near: item.near } : {}),
    ...(item.pinned !== undefined ? { pinned: item.pinned } : {}),
    ...(item.color ? { color: item.color } : {}),
  };
}

// ─────────────────────────── Session staging ───────────────────────────

interface StagedFrame {
  id: string;
  title: string;
  cards: number;
}
/** A card the staging wants on the board; `key` identifies it across the whole call. */
interface StageCard {
  key: string;
  label: string;
  kind: ModuleKind;
  ref: ModuleRef;
  reason: string;
}
interface StageResult {
  frames: StagedFrame[];
  cards: number;
  links: number;
  skipped: string[];
}

function docCard(
  kind: ModuleKind,
  source: SourceRef,
  reason: string,
): StageCard {
  const label = source.anchor ? `${source.path}#${source.anchor}` : source.path;
  return {
    key: `${kind}|${source.path}|${source.anchor ?? ""}`,
    label,
    kind,
    ref: docRef(source),
    reason,
  };
}

function refCard(ref: OutlineRef, reason: string): StageCard {
  return docCard(ref.kind, { path: ref.path, anchor: ref.anchor }, reason);
}

/** An archive image that is not a MapAsset, as a map card. */
function imageCard(image: ImageAsset, reason: string): StageCard {
  return {
    key: `map|${image.path}|`,
    label: image.path,
    kind: "map",
    ref: { type: "asset", path: image.path },
    reason,
  };
}

/** A map card, when the asset is known to the archive; session uploads are not staged. */
function assetCard(
  maps: Map<string, MapAsset>,
  path: string,
  reason: string,
): StageCard | undefined {
  const map = maps.get(path);
  if (!map) return undefined;
  const kind: ModuleKind = map.category === "Battlemap" ? "battlemap" : "map";
  return {
    key: `${kind}|${path}|`,
    label: path,
    kind,
    ref: { type: "asset", path },
    reason,
  };
}

async function openFrame(
  deps: CockpitToolsDeps,
  context: ToolContext,
  title: string,
  result: StageResult,
): Promise<StagedFrame | null> {
  try {
    const { id } = await apply(
      deps,
      { type: "frame.add", frame: { title } },
      context,
    );
    const frame: StagedFrame = { id, title, cards: 0 };
    result.frames.push(frame);
    return frame;
  } catch (e) {
    result.skipped.push(`Riquadro ${title}: ${errorText(e)}`);
    return null;
  }
}

/**
 * Stages the cards of one frame. The frame is created lazily on the first card
 * not yet placed, and removed again when none of its cards could be placed.
 */
async function stageGroup(
  deps: CockpitToolsDeps,
  context: ToolContext,
  result: StageResult,
  placed: Set<string>,
  title: string,
  cards: (StageCard | undefined)[],
): Promise<StagedFrame | undefined> {
  let frame: StagedFrame | null | undefined;
  for (const card of cards) {
    if (!card || placed.has(card.key)) continue;
    if (frame === undefined)
      frame = await openFrame(deps, context, title, result);
    if (!frame) break;
    try {
      await apply(
        deps,
        {
          type: "module.show",
          module: {
            kind: card.kind,
            ref: card.ref,
            reason: card.reason,
            frameId: frame.id,
          },
        },
        context,
      );
      placed.add(card.key);
      frame.cards++;
      result.cards++;
    } catch (e) {
      result.skipped.push(`${card.label}: ${errorText(e)}`);
    }
  }
  if (!frame) return undefined;
  if (frame.cards > 0) return frame;
  result.frames = result.frames.filter((item) => item !== frame);
  try {
    await apply(
      deps,
      { type: "frame.remove", id: frame.id, withCards: false },
      context,
    );
  } catch (e) {
    result.skipped.push(`Riquadro ${title}: ${errorText(e)}`);
  }
  return undefined;
}

/**
 * Stages a whole session on the board: one frame per scene, context and loose
 * maps in their own frames, arrows for the branches, then automatic layout.
 * Every change goes through `apply`, so the call is one undo group.
 */
/** «@N» in a batch points at the N-th (1-based) card placed earlier in the same call. */
function resolveBatchRef(
  near: string | undefined,
  placed: ({ id: string } | { error: string })[],
): string | undefined {
  const match = near?.match(/^@(\d+)$/);
  if (!match) return near;
  const target = placed[Number(match[1]) - 1];
  if (!target || !("id" in target))
    throw new Error(
      `${near} non indica una carta già messa in questa chiamata`,
    );
  return target.id;
}

async function stageSession(
  deps: CockpitToolsDeps,
  context: ToolContext,
  path: string,
  replace: boolean,
): Promise<StageResult> {
  const outline = sessionOutline(deps.archive.docs, deps.maps(), path, deps.categories);
  const maps = new Map(deps.maps().map((map) => [map.path, map]));
  // Images that the document itself shows, which are not MapAssets; item cards stay out.
  const images = imagesOf(deps).filter(
    (image) => image.kind !== "card" && !maps.has(image.path),
  );
  const showing = (docPath: string, reason: string) =>
    images
      .filter((image) => image.docs.some((doc) => doc.path === docPath))
      .map((image) => imageCard(image, reason));
  const result: StageResult = { frames: [], cards: 0, links: 0, skipped: [] };
  const placed = new Set<string>();
  if (replace) await apply(deps, { type: "board.clear" }, context);
  const sceneFrames: (StagedFrame | undefined)[] = [];
  for (const [index, scene] of outline.scenes.entries()) {
    sceneFrames.push(
      await stageGroup(
        deps,
        context,
        result,
        placed,
        `${index + 1} · ${scene.title}`,
        [
          docCard(
            "plot",
            { path: scene.path, anchor: scene.anchor },
            `Scena ${index + 1}`,
          ),
          ...scene.sections.map((section) =>
            docCard(
              "plot",
              { path: scene.path, anchor: section.anchor },
              "Sezione",
            ),
          ),
          ...scene.refs.map((ref) => refCard(ref, "Collegato alla scena")),
          ...scene.assets.map((asset) =>
            assetCard(maps, asset.path, "Mappa della scena"),
          ),
          ...showing(scene.path, "Immagine della scena"),
        ],
      ),
    );
  }
  await stageGroup(
    deps,
    context,
    result,
    placed,
    "Contesto",
    outline.context.map((ref) => refCard(ref, "Contesto della sessione")),
  );
  await stageGroup(deps, context, result, placed, "Mappe", [
    ...outline.looseAssets.map((asset) =>
      assetCard(maps, asset.path, "Mappa della sessione"),
    ),
    ...showing(path, "Immagine della sessione"),
  ]);
  for (const edge of outline.edges) {
    const from = sceneFrames[edge.from];
    const to = sceneFrames[edge.to];
    if (!from || !to) continue;
    try {
      await apply(
        deps,
        {
          type: "link.add",
          from: from.id,
          to: to.id,
          ...(edge.label ? { label: edge.label } : {}),
        },
        context,
      );
      result.links++;
    } catch (e) {
      result.skipped.push(
        `Collegamento ${from.title} → ${to.title}: ${errorText(e)}`,
      );
    }
  }
  await apply(deps, { type: "board.arrange" }, context);
  const first = sceneFrames.find(Boolean);
  if (first)
    await apply(deps, { type: "module.highlight", id: first.id }, context);
  return result;
}

export function createCockpitTools(deps: CockpitToolsDeps): CockpitTool[] {
  const tools: CockpitTool[] = [];
  tools.push(
    tool(
      "search_docs",
      "Cerca nomi o temi nelle fonti ammesse quando devi identificare qualcosa citato dal master. Restituisce fino a 12 risultati con percorso, titolo, categoria, area, ancora ed estratto.",
      z
        .object({
          query: z.string().min(1).max(500),
          category: z.string().max(50).optional(),
        })
        .strict(),
      async (args) => {
        const result = deps.archive.search(
          String(args.query),
          String(args.category || ""),
          "",
          0,
        );
        return result.hits
          .filter((hit) =>
            deps.categories.kindOf(hit.path) !== "other",
          )
          .slice(0, 12);
      },
      (args) => `Cerca · ${args.query}`,
    ),
  );
  tools.push(
    tool(
      "read_doc",
      "Usalo dopo la ricerca per verificare una fonte o leggere una sezione precisa. Restituisce testo Markdown e l’elenco delle heading disponibili, con avviso se il testo è stato troncato.",
      z
        .object({
          path: z.string().min(1).max(500),
          anchor: z.string().max(300).optional(),
        })
        .strict(),
      async (args) => {
        const file = checkedPath(deps, String(args.path));
        const doc = deps.archive.docs.get(file);
        if (!doc) throw new Error(`Documento non trovato: ${file}`);
        const anchor = args.anchor
          ? findAnchor(doc, String(args.anchor))
          : undefined;
        let body = readSection(doc, anchor);
        const truncated = body.length > MAX_DOC_CHARS;
        if (truncated)
          body =
            body.slice(0, MAX_DOC_CHARS) +
            "\n\n[Documento troncato a 24.000 caratteri.]";
        return {
          path: file,
          anchor: anchor || null,
          text: body,
          headings: doc.headings.map(({ id, title }) => ({ id, title })),
          truncated,
        };
      },
      (args) => `Legge · ${String(args.path).split("/").at(-1)}`,
    ),
  );
  tools.push(
    tool(
      "plot_neighbors",
      "Usalo per ricostruire la scena corrente e le diramazioni prima di aggiornare la posizione. Restituisce il nodo Plot, i predecessori e i successori con etichette e indicazione delle diramazioni facoltative.",
      z
        .object({
          path: z.string().min(1).max(500),
          anchor: z.string().max(300).optional(),
        })
        .strict(),
      async (args) => {
        const source = sourceExists(deps, {
          path: String(args.path),
          ...(args.anchor ? { anchor: String(args.anchor) } : {}),
        });
        const graph = deps.getPlotGraph();
        const nodes = graph.nodes;
        const node = nodes.find(
          (item) =>
            item.target?.path === source.path &&
            (!source.anchor || item.target.anchor === source.anchor),
        );
        if (!node) throw new Error("Nodo non presente nel grafo della trama");
        const neighbors = (direction: "from" | "to") =>
          graph.edges
            .filter((edge) => edge[direction] === node.id)
            .map((edge) => ({
              node: nodes.find(
                (item) =>
                  item.id === (direction === "from" ? edge.to : edge.from),
              ),
              label: edge.label,
              optional: edge.optional,
            }));
        return {
          node,
          predecessors: neighbors("to"),
          successors: neighbors("from"),
        };
      },
      (args) => `Trama · ${String(args.path).split("/").at(-1)}`,
    ),
  );
  tools.push(
    tool(
      "list_maps",
      "Usalo quando la scena richiede una mappa o battlemap da mostrare; per richieste in linguaggio naturale («la mappa della capitale…», «la pianta di Shuren») preferisci find_images. Restituisce gli asset disponibili, filtrati per nome o area se specifichi query.",
      z.object({ query: z.string().max(200).optional() }).strict(),
      async (args) => {
        const query = String(args.query || "").toLocaleLowerCase("it");
        return deps
          .maps()
          .filter(
            (map) =>
              !query ||
              `${map.title} ${map.area} ${map.category}`
                .toLocaleLowerCase("it")
                .includes(query),
          );
      },
      (args) => `Mappe · ${args.query || "tutte"}`,
    ),
  );
  tools.push(
    tool(
      "find_images",
      "Trova immagini nell'archivio (mappe, piante, vedute, battlemap, ritratti, illustrazioni, carte degli oggetti) da un nome o da una descrizione. Passa il nome del soggetto (luogo, personaggio, oggetto); se il master usa una descrizione indiretta, identifica prima il soggetto con search_docs. Restituisce i risultati divisi in players (versione per i giocatori) e master (versione riservata), ognuno in ordine di pertinenza, con percorso da passare a board_place e variante; le carte degli oggetti (kind card) sono separate in cards.",
      z
        .object({
          query: z.string().min(1).max(300),
          audience: z.enum(["master", "players"]).optional(),
        })
        .strict(),
      async (args) => {
        const query = String(args.query);
        const related = deps.archive
          .search(query, "", "", 0)
          .hits.slice(0, 8)
          .map((hit) => hit.path);
        const found = searchImages(imagesOf(deps), query, related)
          .filter((image) => !args.audience || image.audience === args.audience)
          .map((image) => ({
            path: image.path,
            title: image.title,
            kind: image.kind,
            audience: image.audience,
            ...(image.variant ? { variant: image.variant } : {}),
            docs: image.docs.map((doc) => doc.title),
          }));
        // Grouped so the model sees at once whether both versions exist.
        const pictures = found.filter((image) => image.kind !== "card");
        return {
          players: pictures
            .filter((image) => image.audience === "players")
            .slice(0, 5),
          master: pictures
            .filter((image) => image.audience === "master")
            .slice(0, 5),
          cards: found.filter((image) => image.kind === "card").slice(0, 3),
        };
      },
      (args) => `Immagini · ${args.query}`,
    ),
  );
  tools.push(
    tool(
      "search_music",
      "Usalo per trovare musica adatta alla scena; cercare non avvia la riproduzione. Restituisce fino a otto tracce utilizzabili con board_place o music_play.",
      z.object({ query: z.string().min(1).max(500) }).strict(),
      async (args) => {
        const tracks = await deps.music.search(String(args.query));
        for (const track of tracks) deps.tracks.set(track.id, track);
        return tracks.slice(0, 8);
      },
      (args) => `Musica · ${args.query}`,
    ),
  );
  tools.push(
    tool(
      "session_outline",
      "Usalo per vedere tutta una sessione o attività (un documento di Plot o la sessione di un personaggio): scene in ordine, sezioni, rami, schede collegate, mappe.",
      z.object({ path: z.string().min(1).max(500) }).strict(),
      async (args) => {
        const source = sourceExists(deps, {
          path: String(args.path),
        });
        return JSON.stringify(
          sessionOutline(deps.archive.docs, deps.maps(), source.path, deps.categories),
          withoutEmptyArrays,
        );
      },
      (args) => `Sessione · ${String(args.path).split("/").at(-1)}`,
    ),
  );
  tools.push(
    tool(
      "board_stage",
      "Prepara la scrivania con l'intera sessione: un riquadro per scena con la scena, le sue sezioni, le schede e le mappe collegate, frecce per i rami, un riquadro Contesto. replace=true svuota prima la scrivania (le carte fissate restano). Usalo quando il master chiede di inizializzare/preparare/aprire una sessione. Restituisce riquadri, numero di carte e collegamenti, con le voci saltate e il motivo.",
      z
        .object({
          path: z.string().min(1).max(500),
          replace: z.boolean().optional(),
        })
        .strict(),
      async (args, context) => {
        const source = sourceExists(deps, {
          path: String(args.path),
        });
        return stageSession(deps, context, source.path, Boolean(args.replace));
      },
      (args) => `Prepara scrivania · ${String(args.path).split("/").at(-1)}`,
    ),
  );
  tools.push(
    tool(
      "board_place",
      "Usalo per mettere sulla scrivania ciò che entra in scena: NPC, nemici, mappe, oggetti, musica, sezioni di Plot e note. Per mappe, battlemap, ritratti, illustrazioni e carte dell'archivio usa kind map o battlemap (o image) con il path restituito da find_images. Una fonte già presente viene aggiornata, e spostata se cambia frame. Le posizioni sono automatiche: frame sceglie il riquadro, near la carta o il riquadro vicino. Aggiungi con generosità: la scrivania è una vista d'insieme. Per carte già presenti da spostare usa board_move. In near puoi indicare «@1», «@2»… per una carta messa prima nella stessa chiamata (es. la versione per i giocatori accanto a quella del master). Restituisce per ogni voce id e titolo, oppure l'errore.",
      z.object({ cards: z.array(placeItemSchema).min(1).max(40) }).strict(),
      async (args, context) => {
        const results: ({ id: string; title: string } | { error: string })[] =
          [];
        for (const item of args.cards as PlaceItem[]) {
          try {
            const near = resolveBatchRef(item.near, results);
            const input = moduleInputOf(deps, { ...item, near });
            results.push(
              await apply(
                deps,
                { type: "module.show", module: input },
                context,
              ),
            );
          } catch (e) {
            results.push({ error: errorText(e) + MOVE_HINT });
          }
        }
        return results;
      },
      (args) => `Pone ${(args.cards as unknown[]).length} carte`,
    ),
  );
  const sheetSummary = (sheet: WrittenSheet) => ({
    path: sheet.path,
    title: sheet.title,
  });
  const sheetsOf = (sessionId: string): SheetDeps => {
    if (!deps.sheets)
      throw new Error(
        "Scrittura delle schede non disponibile in questo server",
      );
    return deps.sheets(sessionId);
  };
  const sheetFolders = SHEET_KINDS.map(
    (kind) => `${kind} → ${deps.categories.folderFor(kind) ?? "nessuna"}/`,
  ).join(", ");
  tools.push(
    tool(
      "sheet_create",
      "Crea al volo una scheda nuova nell'archivio (NPC, creatura, oggetto o luogo improvvisato al tavolo) e la mostra sulla scrivania. Usalo solo dopo aver verificato con search_docs che il soggetto non abbia già una scheda. kind: " + sheetFolders + ". area: cartella dell'area esistente (es. «Alos», «Grafreitur», per World il percorso a cascata «Austur/Alos»); un'area sbagliata restituisce l'elenco di quelle disponibili. markdown: il corpo senza il titolo #, con sezioni ##; non scrivere link: il salvataggio collega da solo ogni menzione delle schede esistenti. La scheda è salvata come ogni altra modifica della campagna: compare in «cosa è cambiato» e si può annullare da lì. Correggila con sheet_update. Restituisce percorso, id della carta e titolo.",
      z
        .object({
          kind: z.enum(["npc", "enemy", "item", "location"]),
          area: z.string().max(200).optional(),
          title: z.string().min(1).max(120),
          markdown: z.string().min(1).max(20000),
          show: z.boolean().optional(),
          frame: z.string().min(1).max(200).optional(),
          near: z.string().min(1).max(200).optional(),
          color: cardColorSchema.optional(),
          reason: z.string().max(300),
        })
        .strict(),
      async (args, context) => {
        const kind = args.kind as SheetKind;
        const sheet = await createSheet(sheetsOf(context.sessionId), {
          kind,
          ...(args.area ? { area: String(args.area) } : {}),
          title: String(args.title),
          body: String(args.markdown),
        });
        if (args.show === false) return sheetSummary(sheet);
        const card = await apply(
          deps,
          {
            type: "module.show",
            module: {
              kind,
              ref: { type: "doc", path: sheet.path },
              reason: String(args.reason),
              ...(args.frame ? { frameId: String(args.frame) } : {}),
              ...(args.near ? { near: String(args.near) } : {}),
              ...(args.color ? { color: args.color as CardColor } : {}),
            },
          },
          context,
        );
        return { id: card.id, ...sheetSummary(sheet) };
      },
      (args) => `Nuova scheda · ${args.title}`,
    ),
  );
  tools.push(
    tool(
      "sheet_update",
      "Riscrive il corpo di una scheda creata in questa sessione dal cockpit, per esempio quando il master aggiunge o corregge dettagli. Passa il testo completo aggiornato, senza titolo # e senza link. Le schede scritte a mano restano in sola lettura. La carta sulla scrivania si aggiorna da sola.",
      z
        .object({
          path: z.string().min(1).max(500),
          markdown: z.string().min(1).max(20000),
        })
        .strict(),
      async (args, context) => {
        const sheet = await updateSheet(sheetsOf(context.sessionId), {
          path: checkedPath(deps, String(args.path)),
          body: String(args.markdown),
        });
        // No action changed the state: push the board again so cards show the new text.
        const session = await deps.live.hydrate(
          await deps.store.get(context.sessionId),
        );
        deps.bus.publish(session.id, {
          type: "state",
          revision: session.revision,
          state: stateView(session.state, deps.resolve, session.id),
          history: session.history,
        });
        return sheetSummary(sheet);
      },
      (args) => `Aggiorna scheda · ${String(args.path).split("/").at(-1)}`,
    ),
  );
  tools.push(
    tool(
      "board_remove",
      "Usalo per togliere dalla scrivania ciò che è chiaramente superato: carte, riquadri o frecce (gli id delle frecce sono in get_board). Un id di riquadro toglie il riquadro e lascia le sue carte fuori dai riquadri. Non rimuovere le carte fissate se il master non lo chiede. Restituisce il riepilogo per ogni id, oppure l'errore.",
      z
        .object({
          ids: z.array(z.string().min(1).max(200)).min(1).max(40),
        })
        .strict(),
      async (args, context) => {
        const { state } = await deps.store.get(context.sessionId);
        const frameIds = new Set(state.board.frames.map((frame) => frame.id));
        const linkIds = new Set(state.board.links.map((link) => link.id));
        const results: unknown[] = [];
        for (const id of args.ids as string[]) {
          const action: CockpitAction = frameIds.has(id)
            ? { type: "frame.remove", id, withCards: false }
            : linkIds.has(id)
              ? { type: "link.remove", id }
              : { type: "module.remove", id };
          try {
            results.push(await apply(deps, action, context));
          } catch (e) {
            results.push({ error: errorText(e) });
          }
        }
        return results;
      },
      (args) => `Rimuove ${(args.ids as unknown[]).length} elementi`,
    ),
  );
  tools.push(
    tool(
      "board_highlight",
      "Evidenzia la carta o il riquadro che serve adesso: il canvas ci si centra. Passa null per togliere l'evidenza. Restituisce il riepilogo dell'azione.",
      z.object({ id: z.string().min(1).max(200).nullable() }).strict(),
      (args, context) =>
        apply(
          deps,
          { type: "module.highlight", id: args.id as string | null },
          context,
        ),
      () => "Evidenzia",
    ),
  );
  tools.push(
    tool(
      "board_pin",
      "Usalo per proteggere un modulo importante dalla potatura automatica o renderlo rimovibile. Restituisce il riepilogo dell’azione.",
      z
        .object({ id: z.string().min(1).max(200), pinned: z.boolean() })
        .strict(),
      (args, context) =>
        apply(
          deps,
          {
            type: "module.pin",
            id: String(args.id),
            pinned: Boolean(args.pinned),
          },
          context,
        ),
      (args) => (args.pinned ? "Fissa modulo" : "Sblocca modulo"),
    ),
  );
  tools.push(
    tool(
      "board_frame",
      "Usalo per creare un riquadro che raggruppa carte, per esempio una scena o un luogo. Con cards ci mette subito le carte indicate (anche già sulla plancia). Con after e before collega il riquadro in sequenza: after sono le carte o i riquadri che lo precedono, before quelli che lo seguono; «il gruppo X tra A e B» si fa in una sola chiamata. La scrivania viene riordinata automaticamente alla fine del turno. Restituisce id e titolo del riquadro.",
      z
        .object({
          title: z.string().min(1).max(200),
          color: cardColorSchema.optional(),
          near: z.string().min(1).max(200).optional(),
          cards: z.array(z.string().min(1).max(200)).max(40).optional(),
          after: z.array(z.string().min(1).max(200)).max(40).optional(),
          before: z.array(z.string().min(1).max(200)).max(40).optional(),
        })
        .strict(),
      async (args, context) => {
        const frame = await apply(
          deps,
          {
            type: "frame.add",
            frame: {
              title: String(args.title),
              ...(args.color ? { color: args.color as CardColor } : {}),
              ...(args.near ? { near: String(args.near) } : {}),
            },
          },
          context,
        );
        const errors: string[] = [];
        for (const id of (args.cards as string[] | undefined) ?? []) {
          try {
            await apply(
              deps,
              { type: "module.update", id, patch: { frameId: frame.id } },
              context,
            );
          } catch (e) {
            errors.push(`${id}: ${errorText(e)}`);
          }
        }
        const links: CockpitAction[] = [
          ...((args.after as string[] | undefined) ?? []).map(
            (from): CockpitAction => ({
              type: "link.add",
              from,
              to: frame.id,
            }),
          ),
          ...((args.before as string[] | undefined) ?? []).map(
            (to): CockpitAction => ({
              type: "link.add",
              from: frame.id,
              to,
            }),
          ),
        ];
        for (const action of links) {
          try {
            await apply(deps, action, context);
          } catch (e) {
            const pair =
              action.type === "link.add" ? `${action.from} → ${action.to}` : "";
            errors.push(`collegamento ${pair}: ${errorText(e)}`);
          }
        }
        return {
          id: frame.id,
          title: String(args.title),
          ...(errors.length ? { errors } : {}),
        };
      },
      (args) => `Riquadro · ${String(args.title)}`,
    ),
  );
  tools.push(
    tool(
      "board_link",
      "Usalo per collegare due carte o riquadri con una freccia, per esempio un ramo di Plot o un NPC e la sua scena: passa from e to, oppure links con più collegamenti in una sola chiamata (1–30). Non devi posizionare nulla: la scrivania viene riordinata automaticamente alla fine del turno. Restituisce il riepilogo del collegamento; con links, un esito per ciascuno.",
      z
        .object({
          from: z.string().min(1).max(200).optional(),
          to: z.string().min(1).max(200).optional(),
          label: z.string().max(200).optional(),
          links: z.array(linkInputSchema).min(1).max(30).optional(),
        })
        .strict(),
      async (args, context) => {
        const hasPair = args.from !== undefined || args.to !== undefined;
        if (args.links && hasPair)
          throw new Error("Usa o from e to, oppure links: non entrambi");
        if (args.links) {
          const results: unknown[] = [];
          for (const link of args.links as LinkInput[]) {
            try {
              results.push(await apply(deps, linkAction(link), context));
            } catch (e) {
              results.push({
                from: link.from,
                to: link.to,
                error: errorText(e),
              });
            }
          }
          return results;
        }
        if (args.from === undefined || args.to === undefined)
          throw new Error("Servono from e to, oppure links");
        return apply(deps, linkAction(args as LinkInput), context);
      },
      () => "Collega",
    ),
  );
  tools.push(
    tool(
      "board_move",
      "Sposta carte già presenti dentro un riquadro esistente (o fuori da ogni riquadro con null). Per spostare non serve conoscere la fonte della carta: bastano gli id dal digest o da get_board. Restituisce per ogni id il riepilogo o l'errore.",
      z
        .object({
          ids: z.array(z.string().min(1).max(200)).min(1).max(40),
          frame: z.string().min(1).max(200).nullable(),
        })
        .strict(),
      async (args, context) => {
        const target = args.frame as string | null;
        const { state } = await deps.store.get(context.sessionId);
        if (
          target !== null &&
          !state.board.frames.some((frame) => frame.id === target)
        )
          throw new Error(`Riquadro non trovato: ${target}`);
        const results: unknown[] = [];
        for (const id of args.ids as string[]) {
          try {
            results.push(
              await apply(
                deps,
                { type: "module.update", id, patch: { frameId: target } },
                context,
              ),
            );
          } catch (e) {
            results.push({ id, error: errorText(e) });
          }
        }
        return results;
      },
      () => "Sposta carte",
    ),
  );
  tools.push(
    tool(
      "board_arrange",
      "Riordina esplicitamente riquadri e carte, solo quando il master lo chiede (per esempio «riordina»). Non serve dopo le modifiche strutturali: la scrivania viene già riordinata automaticamente alla fine del turno. Restituisce il riepilogo dell'azione.",
      z.object({}).strict(),
      (_args, context) => apply(deps, { type: "board.arrange" }, context),
      () => "Riordina scrivania",
    ),
  );
  tools.push(
    tool(
      "get_board",
      "Di solito il digest basta; usalo dopo molte modifiche nello stesso turno per controllare lo stato aggiornato, o per trovare id e provenienza (source: percorso, mappa, trackId o nota) di una carta. Restituisce posizione, gruppo, carte, riquadri, collegamenti, evidenza, registro e combattimento.",
      z.object({}).strict(),
      async (_args, context) => {
        const { state } = await deps.live.hydrate(
          await deps.store.get(context.sessionId),
        );
        const board = state.board;
        return {
          position: state.position,
          party: state.party,
          cards: board.modules.map((module) => ({
            id: module.id,
            kind: module.kind,
            title: deps.resolve(module).title,
            source: sourceOf(module.ref),
            ...(module.frameId ? { frameId: module.frameId } : {}),
            ...(module.pinned ? { pinned: true } : {}),
          })),
          frames: board.frames.map((frame) => ({
            id: frame.id,
            title: frame.title,
          })),
          links: board.links.map((link) => ({
            id: link.id,
            from: link.from,
            to: link.to,
            ...(link.label ? { label: link.label } : {}),
          })),
          highlightId: board.highlightId,
          ledger: state.ledger,
          combat: state.combat,
        };
      },
      () => "Scrivania",
    ),
  );
  tools.push(
    tool(
      "scene_set",
      "Usalo quando il gruppo cambia luogo, momento o sezione di Plot; path#anchor identifica la sezione di Plot corrente. Puoi aggiornare anche il gruppo dei personaggi. Restituisce posizione e gruppo aggiornati in forma compatta.",
      z
        .object({
          path: z.string().max(500).optional(),
          anchor: z.string().max(300).optional(),
          location: z.string().max(200).optional(),
          moment: z.string().max(200).optional(),
          summary: z.string().max(4000).optional(),
          party: z.array(z.string().max(200)).max(100).optional(),
        })
        .strict(),
      async (args, context) => {
        if (args.anchor && !args.path)
          throw new Error("Un'ancora richiede il percorso della fonte");
        const actions: CockpitAction[] = [];
        if (args.path) {
          const source = sourceExists(deps, {
            path: String(args.path),
            ...(args.anchor ? { anchor: String(args.anchor) } : {}),
          });
          actions.push({ type: "position.set", patch: { source } });
        }
        const patch = {
          ...(args.location !== undefined
            ? { location: String(args.location) }
            : {}),
          ...(args.moment !== undefined ? { moment: String(args.moment) } : {}),
          ...(args.summary !== undefined
            ? { summary: String(args.summary) }
            : {}),
        };
        if (Object.keys(patch).length)
          actions.push({ type: "position.set", patch });
        if (args.party)
          actions.push({ type: "party.set", names: args.party as string[] });
        if (!actions.length)
          throw new Error("Nessun cambiamento di scena specificato");
        const result = await deps.store.apply(context.sessionId, actions, {
          origin: "agent",
          turnId: context.turnId,
          ...(context.groupId ? { groupId: context.groupId } : {}),
        });
        context.setGroupId(result.group.id);
        const summary = result.group.actions.at(-1);
        return {
          id: summary?.targetId || result.group.id,
          title: summary?.label || "Scena aggiornata",
        };
      },
      () => "Scena",
    ),
  );
  tools.push(
    tool(
      "ledger_note",
      "Usalo solo per un resoconto dichiarato dal master: fact = accaduto al tavolo, decision = deciso dai giocatori, intention = vogliono o progettano, open = questione irrisolta. evidence contiene gli id dei messaggi DM indicati nel digest come NUOVO MESSAGGIO DM (<id>); se esiste già una voce sul tema, usa ledger_update con addEvidence. Restituisce id e titolo della voce.",
      z
        .object({
          kind: z.enum(["fact", "decision", "intention", "open"]),
          title: z.string().min(1).max(200),
          text: z.string().max(4000),
          evidence: z.array(z.string().min(1).max(200)).min(1).max(50),
          sources: z
            .array(
              z
                .object({
                  path: z.string().min(1).max(500),
                  anchor: z.string().max(300).optional(),
                })
                .strict(),
            )
            .max(50)
            .optional(),
        })
        .strict(),
      (args, context) => {
        const entry = args as Extract<
          CockpitAction,
          { type: "ledger.add" }
        >["entry"];
        entry.sources = entry.sources?.map((source) =>
          sourceExists(deps, source),
        );
        return apply(deps, { type: "ledger.add", entry }, context);
      },
      (args) => `Registra · ${args.title}`,
    ),
  );
  tools.push(
    tool(
      "ledger_update",
      "Usalo per unire nuovi frammenti, correggere una voce, risolverla con status resolved o scartarla con dropped. Le prove e le fonti aggiunte vengono deduplicate. Restituisce id e titolo della voce aggiornata.",
      z
        .object({
          id: z.string().min(1).max(200),
          kind: z.enum(["fact", "decision", "intention", "open"]).optional(),
          status: z.enum(["active", "resolved", "dropped"]).optional(),
          title: z.string().min(1).max(200).optional(),
          text: z.string().max(4000).optional(),
          addEvidence: z.array(z.string().min(1).max(200)).max(50).optional(),
          addSources: z
            .array(
              z
                .object({
                  path: z.string().min(1).max(500),
                  anchor: z.string().max(300).optional(),
                })
                .strict(),
            )
            .max(50)
            .optional(),
        })
        .strict(),
      (args, context) => {
        const { id, ...patch } = args;
        const typedPatch = patch as Extract<
          CockpitAction,
          { type: "ledger.update" }
        >["patch"];
        typedPatch.addSources = typedPatch.addSources?.map((source) =>
          sourceExists(deps, source),
        );
        return apply(
          deps,
          { type: "ledger.update", id: String(id), patch: typedPatch },
          context,
        );
      },
      (args) => `Aggiorna · ${args.id}`,
    ),
  );
  tools.push(
    tool(
      "ledger_remove",
      "Usalo per eliminare una voce errata o non più pertinente dal registro. Restituisce il riepilogo dell’azione.",
      z.object({ id: z.string().min(1).max(200) }).strict(),
      (args, context) =>
        apply(deps, { type: "ledger.remove", id: String(args.id) }, context),
      () => "Rimuove voce",
    ),
  );

  const combatant = describeInputFields(combatantInputSchema);
  const combatTools: [
    string,
    string,
    z.ZodType,
    (args: Record<string, unknown>) => CockpitAction,
    string,
  ][] = [
    [
      "combat_start",
      "Usalo quando il master dichiara l’inizio dello scontro e fornisce partecipanti e iniziative. Non tirare dadi né inventare dati; per i PG registra solo nome e iniziativa. Restituisce il riepilogo dello scontro avviato.",
      z
        .object({
          title: z.string().min(1).max(200),
          participants: z.array(combatant).max(100),
        })
        .strict(),
      (a) => ({
        type: "combat.start",
        title: String(a.title),
        participants: a.participants as Extract<
          CockpitAction,
          { type: "combat.start" }
        >["participants"],
      }),
      "Avvia combattimento",
    ],
    [
      "combat_add",
      "Usalo quando il master aggiunge un partecipante allo scontro. Non tirare dadi; per i PG registra solo nome e iniziativa. Restituisce il riepilogo del partecipante aggiunto.",
      z.object({ participant: combatant }).strict(),
      (a) => ({
        type: "combat.add",
        participant: a.participant as Extract<
          CockpitAction,
          { type: "combat.add" }
        >["participant"],
      }),
      "Aggiunge combattente",
    ],
    [
      "combat_update",
      "Usalo per correggere dati dichiarati dal master su un partecipante. Non inventare valori o tattiche; per i PG mantieni solo nome e iniziativa. Restituisce il riepilogo del partecipante aggiornato.",
      z
        .object({
          id: z.string().min(1).max(200),
          patch: combatant.partial().strict(),
        })
        .strict(),
      (a) => ({
        type: "combat.update",
        id: String(a.id),
        patch: a.patch as Extract<
          CockpitAction,
          { type: "combat.update" }
        >["patch"],
      }),
      "Aggiorna combattente",
    ],
    [
      "combat_remove",
      "Usalo quando il master dichiara che un partecipante esce dal tracciamento. Non dedurre esiti o tirare dadi. Restituisce il riepilogo dell’azione.",
      z.object({ id: z.string().min(1).max(200) }).strict(),
      (a) => ({ type: "combat.remove", id: String(a.id) }),
      "Rimuove combattente",
    ],
    [
      "combat_turn",
      "Usalo per cambiare il turno soltanto su comando esplicito del master; non avanzarlo autonomamente. Non tirare dadi né scegliere tattiche. Restituisce il riepilogo del turno impostato.",
      z
        .object({
          activeId: z.string().max(200).nullable(),
          round: z.number().int().min(1).optional(),
        })
        .strict(),
      (a) => ({
        type: "combat.turn",
        activeId: a.activeId as string | null,
        ...(a.round !== undefined ? { round: a.round as number } : {}),
      }),
      "Turno combattimento",
    ],
    [
      "combat_notes",
      "Usalo per annotare o correggere informazioni sullo scontro dichiarate dal master. Per i PG registra solo nome e iniziativa; niente dadi o tattiche. Restituisce il riepilogo dell’azione.",
      z.object({ notes: z.string().max(4000) }).strict(),
      (a) => ({ type: "combat.notes", notes: String(a.notes) }),
      "Note combattimento",
    ],
    [
      "combat_end",
      "Usalo solo quando il master dichiara concluso lo scontro. Non dedurre la conclusione dagli eventi. Restituisce il riepilogo dell’azione.",
      z.object({}).strict(),
      () => ({ type: "combat.end" }),
      "Fine combattimento",
    ],
  ];
  for (const [name, description, schema, action, label] of combatTools)
    tools.push(
      tool(
        name,
        description,
        schema,
        (args, context) =>
          apply(deps, verifyCombatSources(deps, action(args)), context),
        () => label,
      ),
    );
  tools.push(
    tool(
      "music_play",
      "Usalo esclusivamente se il master chiede esplicitamente di avviare la musica; una ricerca o un suggerimento non autorizzano la riproduzione. Restituisce l’esito della richiesta al bridge musicale.",
      z.object({ trackId: z.string().min(1).max(200) }).strict(),
      async (args) => {
        const trackId = String(args.trackId);
        if (!deps.tracks.has(trackId)) {
          const matches = await deps.music.search(trackId);
          for (const track of matches) deps.tracks.set(track.id, track);
        }
        return deps.music.request({ command: "play", trackId });
      },
      () => "Avvia musica",
    ),
  );
  tools.push(
    tool(
      "music_stop",
      "Usalo esclusivamente se il master chiede esplicitamente di fermare la musica. Restituisce l’esito della richiesta al bridge musicale.",
      z.object({}).strict(),
      () => deps.music.request({ command: "stop" }),
      () => "Ferma musica",
    ),
  );
  tools.push(
    tool(
      "open_source",
      "Usalo solo su richiesta esplicita del master per aprire una fonte nel lettore. Restituisce conferma dell’evento di apertura.",
      z
        .object({
          path: z.string().min(1).max(500),
          anchor: z.string().max(300).optional(),
        })
        .strict(),
      async (args, context) => {
        const source = sourceExists(deps, {
          path: String(args.path),
          ...(args.anchor ? { anchor: String(args.anchor) } : {}),
        });
        deps.bus.publish(context.sessionId, { type: "open", source });
        return { source };
      },
      (args) => `Apre · ${String(args.path).split("/").at(-1)}`,
    ),
  );
  tools.push(
    tool(
      "find_battle_map",
      "Cerca le battlemap della campagna, filtrate per luogo (titolo o percorso della scheda che le contiene). Usalo quando inizia uno scontro, con il luogo della scena. Restituisce ref, scheda, titolo e, se noti, colonne e righe della griglia.",
      z.object({ place: z.string().max(200).optional() }).strict(),
      async (args) => {
        if (!deps.battle) throw new Error("La schermata di battaglia non è disponibile.");
        return deps.battle.find(args.place ? String(args.place) : undefined);
      },
      (args) => `Battlemap · ${args.place || "tutte"}`,
    ),
  );
  tools.push(
    tool(
      "battle_map_set",
      "Mostra una battlemap sulla schermata di battaglia della sessione in corso. ref: il ref restituito da find_battle_map. cols e rows: le dimensioni della griglia, se find_battle_map le ha restituite.",
      z
        .object({
          ref: z.string().min(1).max(500),
          cols: z.number().int().min(1).max(200).optional(),
          rows: z.number().int().min(1).max(200).optional(),
        })
        .strict(),
      async (args) => {
        if (!deps.battle) throw new Error("La schermata di battaglia non è disponibile.");
        const view = await deps.battle.setMap({
          ref: String(args.ref),
          ...(args.cols !== undefined ? { cols: Number(args.cols) } : {}),
          ...(args.rows !== undefined ? { rows: Number(args.rows) } : {}),
        });
        return { map: view.map };
      },
      () => "Mappa di battaglia",
    ),
  );
  tools.push(
    tool(
      "battle_move",
      "Sposta la pedina di un combattente sulla schermata di battaglia. Usalo solo quando il master dice dove si trova. participant: l'id o il nome del combattente dello scontro in corso. x e y: la cella della griglia (da 0, origine in alto a sinistra).",
      z
        .object({
          participant: z.string().min(1).max(200),
          x: z.number().finite(),
          y: z.number().finite(),
        })
        .strict(),
      async (args, context) => {
        if (!deps.battle) throw new Error("La schermata di battaglia non è disponibile.");
        const session = await deps.live.hydrate(await deps.store.get(context.sessionId));
        const combat = session.state.combat;
        if (!combat) throw new Error("Nessun combattimento attivo");
        const wanted = String(args.participant);
        const folded = (value: string) => value.toLocaleLowerCase("it").trim();
        const byId = combat.participants.filter((p) => p.id === wanted);
        const byName = combat.participants.filter((p) => folded(p.name) === folded(wanted));
        const matches = byId.length ? byId : byName;
        if (matches.length === 0) throw new Error("Partecipante non trovato nello scontro");
        if (matches.length > 1) throw new Error("Più partecipanti hanno questo nome: indica l'id");
        const view = await deps.battle.move(matches[0]!.id, Number(args.x), Number(args.y));
        return { id: matches[0]!.id, positions: view.positions[matches[0]!.id] };
      },
      (args) => `Pedina · ${args.participant}`,
    ),
  );
  return tools.map((item) => withToolLog(deps, item));
}
