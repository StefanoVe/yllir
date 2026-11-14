import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from "@angular/core";
import type {
  BoardModuleView,
  CardColor,
  CockpitAction,
  CockpitStateView,
  Frame,
  LayoutItem,
  Rect,
} from "@shared/cockpit-types";
import { Icon } from "../support/icon";
import { MODULE_KINDS } from "../board/module-kinds";
import { CombatOverlayService } from "../combat/combat-overlay.service";
import { I18n } from "../../i18n";
import {
  borderPoint,
  center,
  clampZoom,
  detailLevel,
  fitRectWithin,
  fitView,
  isRectVisible,
  linkSegment,
  padRect,
  percentBox,
  summaryLines,
  textScale,
  unionBounds,
  withAspect,
} from "./geometry";
import type { CardText, Detail, Point, Size, View } from "./geometry";
import { capitalizeParts } from "./labels";
import { tiltCss, tornEdgePolygon } from "./paper-edge";
import { TooltipDirective } from "../../core/tooltip.directive";
import {
  CanvasPointer,
  hasImageFiles,
  imageFiles,
  isTextEntry,
  readHit,
} from "./interactions";
import type { CanvasPort, Scene } from "./interactions";

type Board = CockpitStateView["board"];
type Viewport = { zoom: number; x: number; y: number };
/** The note or frame title being edited in place. */
type Editing = { kind: "note" | "frame"; id: string };
/** Floating action bar above the selection, in screen space. */
interface ContextBar {
  left: number;
  top: number;
  multi: boolean;
  card: BoardModuleView | null;
  highlighted: boolean;
}

/** Screen px between the desk and the viewport edges in the fit view. */
const FIT_MARGIN = 24;
const MINIMAP_RATIO = 180 / 120;
const MINIMAP_MARGIN = 40;
const KEY_PAN = 60;
const SAVE_DELAY_MS = 300;
const ANIMATION_MS = 300;
const FOCUS_RATIO = 0.9;
/** Margin around the cards the agent just touched, in canvas units. */
const FOLLOW_MARGIN = 80;
/** Lowest zoom when following one card, or a group of cards. */
const FOLLOW_MIN_ZOOM_ONE = 0.25;
const FOLLOW_MIN_ZOOM_GROUP = 0.15;
const MAX_MEASURE_FRAMES = 60;
const GRID_BASE_PX = 24;
/** Canvas offset between several images dropped or pasted at once. */
const DROP_OFFSET_PX = 24;
const BAR_GAP_PX = 44;
/** Gap between the header icons and the body, as in the card stylesheet. */
const CARD_GAP = 6;
const BAR_MARGIN_PX = 8;
const HIT_WIDTH_PX = 14;
const COLORS: CardColor[] = ["red", "amber", "green", "blue", "violet"];

let canvasCount = 0;

function viewportKey(sessionId: string): string {
  return `cockpit-viewport:${sessionId}`;
}

/** Per-viewer convenience only: a lost value just means the board is fitted. */
function readViewport(sessionId: string): Viewport | null {
  try {
    const raw = localStorage.getItem(viewportKey(sessionId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Viewport>;
    const finite = [value.zoom, value.x, value.y].every(
      (n) => typeof n === "number" && Number.isFinite(n),
    );
    return finite ? (value as Viewport) : null;
  } catch {
    return null;
  }
}

function writeViewport(sessionId: string, viewport: Viewport): void {
  try {
    localStorage.setItem(viewportKey(sessionId), JSON.stringify(viewport));
  } catch {
    // Storage can be blocked or full: the viewport simply is not remembered.
  }
}

function fieldValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
}

@Component({
  selector: "cockpit-canvas",
  standalone: true,
  imports: [Icon, TooltipDirective],
  templateUrl: "./canvas.html",
  styleUrl: "./canvas.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CockpitCanvas {
  board = input.required<Board>();
  /** Ids touched by the latest action group: pulse them briefly. */
  latestIds = input<Set<string>>(new Set());
  /** Used as localStorage key for the viewport. */
  sessionId = input<string>("");
  /** Music controls show only when the music module is on. */
  musicOn = input(false);

  action = output<CockpitAction[]>();
  layout = output<LayoutItem[]>();
  open = output<BoardModuleView>();
  /** Show a card's image fullscreen (maps, battlemaps, images, item cards…). */
  fullscreen = output<BoardModuleView>();
  play = output<string>();
  addDoc = output<{ x: number; y: number }>();
  upload = output<{ file: File; x: number; y: number }>();

  /** Selected card/frame ids. */
  selection = signal<Set<string>>(new Set());
  selectedLink = signal<string | null>(null);
  editing = signal<Editing | null>(null);
  colorOpen = signal(false);
  fileOver = signal(false);
  /** Viewport: canvas = (screen - pan) / zoom. */
  zoom = signal(1);
  panX = signal(0);
  panY = signal(0);
  animating = signal(false);
  /** Closed by default: the minimap takes room, the toolbar button opens it. */
  minimapOpen = signal(false);
  viewSize = signal<Size>({ width: 0, height: 0 });

  readonly markerId = `canvas-arrow-${canvasCount++}`;
  readonly colors = COLORS;
  readonly i18n = inject(I18n);
  private readonly combat = inject(CombatOverlayService);
  /** Card colours are named in the campaign language. */
  protected colorLabel(color: CardColor): string {
    return this.i18n.t(`liveAgent.color.${color}` as "liveAgent.color.red");
  }
  readonly frames = computed(() => this.board().frames);
  readonly cards = computed<BoardModuleView[]>(() => this.board().modules);
  /** Frames and cards with the pointer machine's local geometry applied. */
  readonly displayFrames = computed(() =>
    this.frames().map((frame) => this.shown(frame)),
  );
  readonly displayCards = computed(() =>
    this.cards().map((card) => this.shown(card)),
  );
  readonly isEmpty = computed(
    () => this.frames().length === 0 && this.cards().length === 0,
  );
  readonly rects = computed(() => {
    const entries = [...this.displayFrames(), ...this.displayCards()];
    return new Map<string, Rect>(
      entries.map((rect): [string, Rect] => [rect.id, rect]),
    );
  });
  readonly lines = computed(() =>
    this.board().links.flatMap((link) => {
      const from = this.rects().get(link.from);
      const to = this.rects().get(link.to);
      if (!from || !to) return [];
      const segment = linkSegment(from, to);
      return [
        {
          id: link.id,
          label: link.label,
          ...segment,
          mx: (segment.x1 + segment.x2) / 2,
          my: (segment.y1 + segment.y2) / 2,
        },
      ];
    }),
  );
  /** Dashed preview of the link being drawn, from its source to the pointer. */
  readonly pendingLine = computed(() => {
    const from = this.rects().get(this.pointer.connectFrom() ?? "");
    const to = this.pointer.connectTo();
    if (!from || !to) return null;
    const start = borderPoint(from, to);
    return { x1: start.x, y1: start.y, x2: to.x, y2: to.y };
  });
  readonly detail = computed<Detail>(() => detailLevel(this.zoom()));
  protected readonly capitalizeParts = capitalizeParts;
  /** Torn-edge clip and fixed tilt of a card, both derived from its id. */
  protected readonly tornEdge = tornEdgePolygon;
  protected readonly tiltCss = tiltCss;
  readonly textScale = computed(() => textScale(this.zoom()));
  readonly arrowSize = computed(() => 12 / this.zoom());
  readonly strokeWidth = computed(() => 2 / this.zoom());
  readonly hitWidth = computed(() => HIT_WIDTH_PX / this.zoom());
  readonly dashPattern = computed(
    () => `${6 / this.zoom()} ${4 / this.zoom()}`,
  );
  readonly worldTransform = computed(
    () => `translate(${this.panX()}px, ${this.panY()}px) scale(${this.zoom()})`,
  );
  readonly gridSize = computed(() => {
    const step = GRID_BASE_PX * this.zoom();
    return `${step}px ${step}px`;
  });
  readonly gridPosition = computed(() => `${this.panX()}px ${this.panY()}px`);
  readonly zoomPercent = computed(() => Math.round(this.zoom() * 100));

  /**
   * Box of the links SVG in canvas coordinates. A 0×0 SVG with overflow
   * visible is not painted by Chrome, so it spans the content (plus room for
   * the pending connection line) and its contents are shifted back by -x,-y.
   */
  readonly linksBox = computed(() =>
    padRect(
      unionBounds([...this.displayFrames(), ...this.displayCards()]),
      1000,
    ),
  );

  /** What the viewport currently shows, in canvas coordinates. */
  readonly viewRect = computed<Rect>(() => {
    const { width, height } = this.viewSize();
    const zoom = this.zoom();
    return {
      x: -this.panX() / zoom,
      y: -this.panY() / zoom,
      w: width / zoom,
      h: height / zoom,
    };
  });
  /** Minimap extent: all content plus the viewport, with a fixed 180:120 ratio. */
  readonly minimapBounds = computed(() =>
    withAspect(
      padRect(
        unionBounds([
          ...this.displayFrames(),
          ...this.displayCards(),
          this.viewRect(),
        ]),
        MINIMAP_MARGIN,
      ),
      MINIMAP_RATIO,
    ),
  );
  readonly miniFrames = computed(() =>
    this.displayFrames().map((frame) => ({
      id: frame.id,
      color: frame.color ?? null,
      box: percentBox(frame, this.minimapBounds()),
    })),
  );
  readonly miniCards = computed(() =>
    this.displayCards().map((card) => ({
      id: card.id,
      color: card.color ?? null,
      box: percentBox(card, this.minimapBounds()),
    })),
  );
  readonly miniView = computed(() =>
    percentBox(this.viewRect(), this.minimapBounds()),
  );

  /** Floating bar over the selection; hidden while dragging or linking. */
  readonly bar = computed<ContextBar | null>(() => {
    const rects = this.rects();
    const selected = [...this.selection()];
    if (
      !selected.length ||
      this.pointer.dragging() ||
      this.pointer.marquee() ||
      this.pointer.connectFrom()
    ) {
      return null;
    }
    const boxes = selected.flatMap((id) => rects.get(id) ?? []);
    const box = unionBounds(boxes);
    const zoom = this.zoom();
    const single = selected.length === 1 ? selected[0] : null;
    return {
      left: (box.x + box.w / 2) * zoom + this.panX(),
      top: Math.max(BAR_MARGIN_PX, box.y * zoom + this.panY() - BAR_GAP_PX),
      multi: selected.length > 1,
      card: single ? (this.cards().find((c) => c.id === single) ?? null) : null,
      highlighted: !!single && this.board().highlightId === single,
    };
  });

  readonly marqueeBox = computed(() => {
    const m = this.pointer.marquee();
    if (!m) return null;
    const zoom = this.zoom();
    return {
      left: m.x * zoom + this.panX(),
      top: m.y * zoom + this.panY(),
      width: m.w * zoom,
      height: m.h * zoom,
    };
  });

  private readonly editor =
    viewChild<ElementRef<HTMLInputElement | HTMLTextAreaElement>>("editor");
  private readonly host: HTMLElement =
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly destroyRef = inject(DestroyRef);
  /** Adapter giving the pointer machine access to the viewport and selection. */
  private readonly port: CanvasPort = {
    zoom: () => this.zoom(),
    pan: () => ({ x: this.panX(), y: this.panY() }),
    setPan: (x, y) => {
      this.panX.set(x);
      this.panY.set(y);
    },
    toCanvas: (clientX, clientY) => this.screenToCanvas(clientX, clientY),
    scene: () => this.buildScene(),
    selection: () => this.selection(),
    setSelection: (ids) => this.setSelection(ids),
    selectLink: (id) => {
      this.selectedLink.set(id);
      if (id) this.selection.set(new Set());
    },
    commit: (items) => this.layout.emit(items),
    link: (from, to) => this.action.emit([{ type: "link.add", from, to }]),
  };
  protected readonly pointer = new CanvasPointer(this.port);
  /** Session whose viewport has been restored or fitted. */
  private initialized: string | null = null;
  private lastHighlight: string | null = null;
  /** Last values seen by followLatest(), to tell a change from a re-run. */
  private followedSession: string | null = null;
  private followedLatest: Set<string> | null = null;
  private followedHighlight: string | null = null;
  private hovered = false;
  private dragDepth = 0;
  private miniDragging = false;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private animationTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.host.addEventListener("wheel", this.onWheel, { passive: false });
    this.host.addEventListener("pointerenter", this.onHostEnter);
    this.host.addEventListener("pointerleave", this.onHostLeave);
    window.addEventListener("paste", this.onWindowPaste);
    const resize = new ResizeObserver(() => this.viewSize.set(this.measure()));
    resize.observe(this.host);
    this.destroyRef.onDestroy(() => {
      resize.disconnect();
      this.host.removeEventListener("wheel", this.onWheel);
      this.host.removeEventListener("pointerenter", this.onHostEnter);
      this.host.removeEventListener("pointerleave", this.onHostLeave);
      window.removeEventListener("paste", this.onWindowPaste);
      this.pointer.dispose();
      clearTimeout(this.saveTimer);
      clearTimeout(this.animationTimer);
    });

    effect(() => this.restoreOrFit());
    effect(() => this.followHighlight());
    effect(() => this.followLatest());
    effect(() => this.persist());
    effect(() => {
      const board = this.board();
      untracked(() => this.pointer.settle([...board.modules, ...board.frames]));
    });
    effect(() => {
      const el = this.editor()?.nativeElement;
      if (!el) return;
      untracked(() => {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      });
    });
  }

  // ───────────────────────────── Public API ─────────────────────────────

  /** Fits every frame and card in the view (zoom at most 1). */
  fitAll(): void {
    const frames = this.frames();
    const cards = this.cards();
    const size = this.measure();
    if (!size.width) return;
    if (!frames.length && !cards.length) {
      this.setView({ zoom: 1, x: size.width / 2, y: size.height / 2 });
      return;
    }
    this.setView(fitView(unionBounds([...frames, ...cards]), size, FIT_MARGIN));
  }

  /** Smoothly centres a card or frame. Zooms out only if it would not fit. */
  centerOn(id: string): void {
    const rect = this.rects().get(id);
    const size = this.measure();
    if (!rect || !size.width) return;
    const fitZoom = Math.min(
      (size.width * FOCUS_RATIO) / Math.max(rect.w, 1),
      (size.height * FOCUS_RATIO) / Math.max(rect.h, 1),
    );
    const zoom = fitZoom < this.zoom() ? clampZoom(fitZoom) : this.zoom();
    const c = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    this.animateTo({
      zoom,
      x: size.width / 2 - c.x * zoom,
      y: size.height / 2 - c.y * zoom,
    });
  }

  /** Canvas point under a client (viewport) position. */
  screenToCanvas(clientX: number, clientY: number): Point {
    const local = this.localPoint(clientX, clientY);
    const zoom = this.zoom();
    return {
      x: (local.x - this.panX()) / zoom,
      y: (local.y - this.panY()) / zoom,
    };
  }

  // ───────────────────────────── Toolbar ─────────────────────────────

  protected zoomIn(): void {
    this.zoomBy(1.25);
  }

  protected zoomOut(): void {
    this.zoomBy(0.8);
  }

  protected resetZoom(): void {
    this.zoomBy(1 / this.zoom());
  }

  protected goToHighlight(): void {
    const id = this.board().highlightId;
    if (id) this.centerOn(id);
  }

  protected addDocument(): void {
    const point = this.viewportCenterCanvas();
    this.addDoc.emit({ x: Math.round(point.x), y: Math.round(point.y) });
  }

  protected addNote(): void {
    this.emitNoteAt(this.viewportCenterCanvas());
  }

  protected arrange(): void {
    this.action.emit([{ type: "board.arrange" }]);
  }

  private emitNoteAt(point: Point): void {
    this.action.emit([
      {
        type: "module.show",
        module: {
          kind: "note",
          ref: { type: "note", text: this.i18n.t("liveAgent.canvas.newNote") },
          reason: this.i18n.t("liveAgent.reasonNote"),
          x: Math.round(point.x),
          y: Math.round(point.y),
        },
      },
    ]);
  }

  // ───────────────────────────── Cards ─────────────────────────────

  protected kindIcon(card: BoardModuleView): string {
    return (
      MODULE_KINDS[card.kind]?.icon ??
      (card.kind === "image" ? "image" : "file")
    );
  }

  protected kindLabel(card: BoardModuleView): string {
    return this.i18n.t(MODULE_KINDS[card.kind]?.label ?? "liveAgent.kind.image");
  }

  protected isImageCard(card: BoardModuleView): boolean {
    const visual =
      card.kind === "map" ||
      card.kind === "battlemap" ||
      card.kind === "image" ||
      this.isArtCard(card);
    return visual && !!card.content.image;
  }

  /** Item cards show the printed item card whole: it already carries title and text. */
  /**
   * Frame title size in canvas px: grows when zoomed out (like card text) but
   * never beyond what fits the frame width on one line (glyph ≈ 0.56 em).
   */
  protected frameTitleSize(frame: { w: number; title: string }): number {
    const chars = Math.max(1, [...frame.title].length);
    const fits = (frame.w - 32) / (chars * 0.56);
    return Math.max(12, Math.min(28 * this.textScale(), fits));
  }

  protected isArtCard(card: BoardModuleView): boolean {
    return card.kind === "item" && !!card.content.image;
  }

  protected linkWidth(id: string): number {
    return this.selectedLink() === id
      ? this.strokeWidth() * 2.5
      : this.strokeWidth();
  }

  protected activate(card: BoardModuleView): void {
    if (card.kind === "note") this.editing.set({ kind: "note", id: card.id });
    else if (card.kind === "music") this.playCard(card);
    else this.open.emit(card);
  }

  /** Character and creature cards with a sheet can start or open a combat. */
  protected canFight(card: BoardModuleView): boolean {
    return (
      (card.kind === "npc" || card.kind === "enemy") && card.ref.type === "doc"
    );
  }

  /**
   * Whole lines of the card summary that fit: the line clamp uses this count, so
   * the last visible line is never cut in half. Compact cards stay at three lines.
   */
  protected cardSummaryLines(card: BoardModuleView): number {
    const k = this.textScale();
    const text: CardText = {
      w: card.w,
      h: card.h,
      k,
      title: card.content.title,
      headIconsWidth:
        (card.pinned ? 14 * k + CARD_GAP : 0) +
        (card.content.missing ? 14 * k + CARD_GAP : 0) +
        (this.musicOn() && card.kind === "music" ? 24 + CARD_GAP : 0),
      hasThumb: !!card.content.image,
      hasSubtitle: !!card.content.subtitle,
      hasStats:
        this.detail() === "full" && !!card.content.stats?.length,
      hasFooter: this.canFight(card),
    };
    const lines = summaryLines(text);
    return this.detail() === "compact" ? Math.min(3, lines) : lines;
  }

  protected fight(card: BoardModuleView, event: Event): void {
    event.stopPropagation();
    if (!this.canFight(card) || card.ref.type !== "doc") return;
    this.combat.openFor({
      cardId: card.id,
      name: card.content.title,
      path: card.ref.path,
      kind: card.kind as "npc" | "enemy",
    });
  }

  protected playCard(card: BoardModuleView, event?: Event): void {
    event?.stopPropagation();
    if (!this.musicOn()) return;
    if (card.ref.type === "track") this.play.emit(card.ref.trackId);
  }

  protected noteText(card: BoardModuleView): string {
    return card.ref.type === "note" ? card.ref.text : "";
  }

  protected isEditingNote(card: BoardModuleView): boolean {
    const edit = this.editing();
    return edit?.kind === "note" && edit.id === card.id;
  }

  protected isEditingFrame(frame: Frame): boolean {
    const edit = this.editing();
    return edit?.kind === "frame" && edit.id === frame.id;
  }

  protected startFrameEdit(frame: Frame): void {
    this.editing.set({ kind: "frame", id: frame.id });
  }

  protected onEditBlur(event: Event): void {
    this.finishEdit(fieldValue(event), true);
  }

  /** Enter saves a frame title; Ctrl/Cmd+Enter saves a note; Escape cancels both. */
  protected onEditKey(event: KeyboardEvent): void {
    const edit = this.editing();
    if (!edit) return;
    const value = fieldValue(event);
    if (event.key === "Escape") {
      event.preventDefault();
      this.finishEdit(value, false);
      return;
    }
    const saves =
      edit.kind === "frame"
        ? event.key === "Enter"
        : event.key === "Enter" && (event.ctrlKey || event.metaKey);
    if (saves) {
      event.preventDefault();
      this.finishEdit(value, true);
    }
  }

  /** Ends the in-place edit. Idempotent: a blur after Escape finds nothing to do. */
  private finishEdit(value: string, save: boolean): void {
    const edit = this.editing();
    if (!edit) return;
    this.editing.set(null);
    if (!save) return;
    if (edit.kind === "note") {
      const card = this.cards().find((c) => c.id === edit.id);
      const changed =
        !!card &&
        card.ref.type === "note" &&
        value.trim() !== "" &&
        value !== card.ref.text;
      if (changed) {
        this.action.emit([
          { type: "module.update", id: edit.id, patch: { text: value } },
        ]);
      }
    } else {
      const frame = this.frames().find((f) => f.id === edit.id);
      const title = value.trim();
      if (frame && title && title !== frame.title) {
        this.action.emit([
          { type: "frame.update", id: edit.id, patch: { title } },
        ]);
      }
    }
  }

  // ───────────────────────────── Selection actions ─────────────────────────────

  protected openCard(card: BoardModuleView): void {
    this.open.emit(card);
  }

  protected fullscreenCard(card: BoardModuleView): void {
    if (card.content.image) this.fullscreen.emit(card);
  }

  /** F: the single selected card's image, fullscreen. */
  private fullscreenSelected(): boolean {
    const selected = [...this.selection()];
    const card = this.cards().find((c) => c.id === selected[0]);
    if (selected.length !== 1 || !card?.content.image) return false;
    this.fullscreen.emit(card);
    return true;
  }

  protected toggleHighlight(): boolean {
    const selected = [...this.selection()];
    if (selected.length !== 1) return false;
    const id = selected[0];
    const next = this.board().highlightId === id ? null : id;
    this.action.emit([{ type: "module.highlight", id: next }]);
    return true;
  }

  /** Pins every selected card, or unpins them all when all are pinned. */
  protected pinSelection(): boolean {
    const cards = this.cards().filter((c) => this.selection().has(c.id));
    if (!cards.length) return false;
    const pinned = !cards.every((c) => c.pinned);
    const actions = cards
      .filter((c) => c.pinned !== pinned)
      .map((c): CockpitAction => ({ type: "module.pin", id: c.id, pinned }));
    if (actions.length) this.action.emit(actions);
    return true;
  }

  protected removeSelected(): boolean {
    const link = this.selectedLink();
    if (link) {
      this.selectedLink.set(null);
      this.action.emit([{ type: "link.remove", id: link }]);
      return true;
    }
    const ids = [...this.selection()];
    if (!ids.length) return false;
    const frames = this.frameIds();
    this.action.emit(
      ids.map((id): CockpitAction =>
        frames.has(id)
          ? { type: "frame.remove", id, withCards: false }
          : { type: "module.remove", id },
      ),
    );
    this.selection.set(new Set());
    return true;
  }

  protected toggleColorPicker(): void {
    this.colorOpen.update((open) => !open);
  }

  protected setColor(color: CardColor | null): void {
    const frames = this.frameIds();
    const actions = [...this.selection()].map((id): CockpitAction =>
      frames.has(id)
        ? { type: "frame.update", id, patch: { color } }
        : { type: "module.update", id, patch: { color } },
    );
    this.colorOpen.set(false);
    if (actions.length) this.action.emit(actions);
  }

  protected connectSelection(): void {
    const [id] = this.selection();
    if (!id) return;
    this.colorOpen.set(false);
    this.pointer.startConnect(id);
  }

  // ───────────────────────────── Pointer and keys ─────────────────────────────

  protected onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const target = event.target as Element;
    // Buttons, fields and the note editor keep their own pointer behaviour.
    if (target.closest("textarea, input, button, select")) return;
    this.stopAnimation();
    this.pointer.press(event, readHit(target));
  }

  protected onPointerMove(event: PointerEvent): void {
    this.pointer.move(event);
  }

  protected onPointerUp(event: PointerEvent): void {
    this.pointer.release(event);
  }

  protected onPointerCancel(): void {
    this.pointer.abort();
  }

  /** Double click on empty background adds a note at that point. */
  protected onBackgroundDblClick(event: MouseEvent): void {
    const target = event.target as Element;
    if (
      target.closest(
        "[data-id], [data-link-id], .toolbar, .context-bar, .minimap",
      )
    ) {
      return;
    }
    this.emitNoteAt(this.screenToCanvas(event.clientX, event.clientY));
  }

  protected onKey(event: KeyboardEvent): void {
    if (isTextEntry(event.target)) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      this.selectAll();
      return;
    }
    if (this.handleKey(event.key)) event.preventDefault();
  }

  private handleKey(key: string): boolean {
    switch (key) {
      case "ArrowLeft":
        return this.panBy(KEY_PAN, 0);
      case "ArrowRight":
        return this.panBy(-KEY_PAN, 0);
      case "ArrowUp":
        return this.panBy(0, KEY_PAN);
      case "ArrowDown":
        return this.panBy(0, -KEY_PAN);
      case "+":
      case "=":
        this.zoomIn();
        return true;
      case "-":
        this.zoomOut();
        return true;
      case "0":
        this.fitAll();
        return true;
      case "Escape":
        return this.escape();
      case "Delete":
      case "Backspace":
        return this.removeSelected();
      case "h":
      case "H":
        return this.toggleHighlight();
      case "p":
      case "P":
        return this.pinSelection();
      case "f":
      case "F":
        return this.fullscreenSelected();
      default:
        return false;
    }
  }

  private escape(): boolean {
    if (this.pointer.abort()) return true;
    if (this.colorOpen()) {
      this.colorOpen.set(false);
      return true;
    }
    this.setSelection(new Set());
    this.selectedLink.set(null);
    return true;
  }

  private selectAll(): void {
    this.setSelection(
      new Set([...this.frames(), ...this.cards()].map((item) => item.id)),
    );
  }

  private setSelection(ids: Set<string>): void {
    this.selection.set(ids);
    if (ids.size) this.selectedLink.set(null);
    this.colorOpen.set(false);
  }

  private panBy(dx: number, dy: number): boolean {
    this.stopAnimation();
    this.panX.update((x) => x + dx);
    this.panY.update((y) => y + dy);
    return true;
  }

  /**
   * Ctrl/Cmd + wheel (and trackpad pinch) zooms around the cursor; any other
   * wheel or two-finger scroll pans. Scrollable card bodies keep their scroll.
   */
  private readonly onWheel = (event: WheelEvent): void => {
    if (this.isInsideScrollableCard(event)) return;
    event.preventDefault();
    const dx = wheelPixels(event.deltaX, event.deltaMode);
    const dy = wheelPixels(event.deltaY, event.deltaMode);
    if (event.ctrlKey || event.metaKey) {
      // Trackpad pinch sends small deltas, a mouse wheel large ones.
      const rate = Math.abs(dy) < 20 ? 0.01 : 0.0025;
      this.zoomAt(Math.exp(-dy * rate), event.clientX, event.clientY);
      return;
    }
    this.stopAnimation();
    this.panX.update((x) => x - dx);
    this.panY.update((y) => y - dy);
  };

  private isInsideScrollableCard(event: WheelEvent): boolean {
    const target = event.target;
    if (!(target instanceof Element)) return false;
    const body = target.closest(".card-body");
    return !!body && body.scrollHeight > body.clientHeight;
  }

  // ───────────────────────────── Images ─────────────────────────────

  private readonly onHostEnter = (): void => {
    this.hovered = true;
  };

  private readonly onHostLeave = (): void => {
    this.hovered = false;
  };

  /** Pasted images go to the viewport centre, when the canvas is the working area. */
  private readonly onWindowPaste = (event: ClipboardEvent): void => {
    if (isTextEntry(document.activeElement)) return;
    if (!this.hovered && !this.host.contains(document.activeElement)) return;
    const files = imageFiles(event.clipboardData?.files);
    if (!files.length) return;
    event.preventDefault();
    this.uploadAt(files, this.viewportCenterCanvas());
  };

  protected onDragEnter(event: DragEvent): void {
    if (!hasImageFiles(event.dataTransfer)) return;
    this.dragDepth += 1;
    this.fileOver.set(true);
  }

  protected onDragOver(event: DragEvent): void {
    if (!hasImageFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }

  protected onDragLeave(): void {
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (!this.dragDepth) this.fileOver.set(false);
  }

  protected onDrop(event: DragEvent): void {
    this.dragDepth = 0;
    this.fileOver.set(false);
    const files = imageFiles(event.dataTransfer?.files);
    if (!files.length) return;
    event.preventDefault();
    this.uploadAt(files, this.screenToCanvas(event.clientX, event.clientY));
  }

  private uploadAt(files: File[], point: Point): void {
    files.forEach((file, index) =>
      this.upload.emit({
        file,
        x: Math.round(point.x + index * DROP_OFFSET_PX),
        y: Math.round(point.y + index * DROP_OFFSET_PX),
      }),
    );
  }

  // ───────────────────────────── Minimap ─────────────────────────────

  protected minimapDown(event: PointerEvent): void {
    this.miniDragging = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.centerOnMinimapPoint(event);
  }

  protected minimapMove(event: PointerEvent): void {
    if (this.miniDragging) this.centerOnMinimapPoint(event);
  }

  protected minimapUp(): void {
    this.miniDragging = false;
  }

  private centerOnMinimapPoint(event: PointerEvent): void {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const bounds = this.minimapBounds();
    const fx = (event.clientX - box.left) / box.width;
    const fy = (event.clientY - box.top) / box.height;
    this.centerAt(bounds.x + fx * bounds.w, bounds.y + fy * bounds.h);
  }

  // ───────────────────────────── Viewport internals ─────────────────────────────

  /** Geometry and membership for the pointer machine, read at each gesture start. */
  private buildScene(): Scene {
    const cards = this.cards();
    return {
      rects: this.rects(),
      frameIds: this.frameIds(),
      cardIds: new Set(cards.map((card) => card.id)),
      frameOf: new Map(
        cards.map((card): [string, string | undefined] => [
          card.id,
          card.frameId,
        ]),
      ),
      imageIds: new Set(
        cards.filter((card) => this.isImageCard(card)).map((card) => card.id),
      ),
    };
  }

  private frameIds(): Set<string> {
    return new Set(this.frames().map((frame) => frame.id));
  }

  /** Frame or card with the local overrides of an ongoing or pending gesture. */
  private shown<T extends Rect & { id: string }>(item: T): T {
    const override = this.pointer.overrides().get(item.id);
    return override ? { ...item, ...override } : item;
  }

  /** Runs once per session, when the board has content and the host is measured. */
  private restoreOrFit(): void {
    const id = this.sessionId();
    const hasContent = this.frames().length + this.cards().length > 0;
    untracked(() => {
      if (!hasContent || id === this.initialized) return;
      this.initialized = id;
      // Opening a session shows the whole desk, not the highlighted item.
      this.lastHighlight = this.board().highlightId;
      this.whenMeasured(() => {
        const saved = id ? readViewport(id) : null;
        if (saved)
          this.setView({ zoom: clampZoom(saved.zoom), x: saved.x, y: saved.y });
        else this.fitAll();
      });
    });
  }

  private followHighlight(): void {
    const id = this.board().highlightId;
    if (id === this.lastHighlight) return;
    this.lastHighlight = id;
    if (id) untracked(() => this.whenMeasured(() => this.centerOn(id)));
  }

  /**
   * Brings the view to the cards or frames the agent just added or changed, if
   * any is off screen. The first value of each session is only recorded, so
   * opening a board never jumps; an active gesture, link or edit skips the update.
   */
  private followLatest(): void {
    const latest = this.latestIds();
    const session = this.sessionId();
    const highlight = this.board().highlightId;
    untracked(() => {
      const fresh =
        session !== this.followedSession || this.initialized !== session;
      const changed = latest !== this.followedLatest;
      const highlightMoved = highlight !== this.followedHighlight;
      this.followedSession = session;
      this.followedLatest = latest;
      this.followedHighlight = highlight;
      // A highlight set in the same update wins: followHighlight centres on it.
      if (fresh || !changed || (highlightMoved && highlight)) return;
      if (
        this.pointer.dragging() ||
        this.pointer.marquee() ||
        this.pointer.connectFrom() ||
        this.editing()
      )
        return;

      const size = this.measure();
      if (!size.width || !size.height) return;
      // Only cards and frames have rects: ledger and combat ids are ignored.
      const rects = this.rects();
      const targets = [...latest].flatMap((id) => rects.get(id) ?? []);
      const view: View = { zoom: this.zoom(), x: this.panX(), y: this.panY() };
      if (!targets.length || targets.every((r) => isRectVisible(r, view, size)))
        return;

      const single = targets.length === 1;
      const bounds = padRect(unionBounds(targets), FOLLOW_MARGIN);
      const zoom = fitRectWithin(
        bounds,
        size,
        single ? FOLLOW_MIN_ZOOM_ONE : FOLLOW_MIN_ZOOM_GROUP,
        view.zoom,
      );
      const c = center(bounds);
      this.animateTo({
        zoom,
        x: size.width / 2 - c.x * zoom,
        y: size.height / 2 - c.y * zoom,
      });
    });
  }

  /** Debounced save; skipped until this session's viewport is known. */
  private persist(): void {
    const viewport: Viewport = {
      zoom: this.zoom(),
      x: this.panX(),
      y: this.panY(),
    };
    const id = this.sessionId();
    untracked(() => {
      if (!id || id !== this.initialized) return;
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(
        () => writeViewport(id, viewport),
        SAVE_DELAY_MS,
      );
    });
  }

  private whenMeasured(apply: () => void, frame = 0): void {
    const size = this.measure();
    if (size.width && size.height) apply();
    else if (frame < MAX_MEASURE_FRAMES)
      requestAnimationFrame(() => this.whenMeasured(apply, frame + 1));
  }

  private zoomBy(factor: number): void {
    const rect = this.host.getBoundingClientRect();
    this.zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  /** Zooms by `factor` keeping the canvas point under the cursor still. */
  private zoomAt(factor: number, clientX: number, clientY: number): void {
    this.stopAnimation();
    const zoom = clampZoom(this.zoom() * factor);
    const point = this.screenToCanvas(clientX, clientY);
    const local = this.localPoint(clientX, clientY);
    this.setView({
      zoom,
      x: local.x - point.x * zoom,
      y: local.y - point.y * zoom,
    });
  }

  private centerAt(cx: number, cy: number): void {
    const size = this.measure();
    this.stopAnimation();
    const zoom = this.zoom();
    this.panX.set(size.width / 2 - cx * zoom);
    this.panY.set(size.height / 2 - cy * zoom);
  }

  /** Short transform transition, enabled only for this one move. */
  private animateTo(view: View): void {
    this.animating.set(true);
    this.setView(view);
    clearTimeout(this.animationTimer);
    this.animationTimer = setTimeout(
      () => this.animating.set(false),
      ANIMATION_MS,
    );
  }

  private stopAnimation(): void {
    clearTimeout(this.animationTimer);
    this.animating.set(false);
  }

  private setView(view: View): void {
    this.zoom.set(view.zoom);
    this.panX.set(view.x);
    this.panY.set(view.y);
  }

  private viewportCenterCanvas(): Point {
    const rect = this.host.getBoundingClientRect();
    return this.screenToCanvas(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
  }

  private localPoint(clientX: number, clientY: number): Point {
    const rect = this.host.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  private measure(): Size {
    return { width: this.host.clientWidth, height: this.host.clientHeight };
  }
}

/** Wheel deltas reported in lines (deltaMode 1) become roughly pixels. */
function wheelPixels(delta: number, mode: number): number {
  return mode === 1 ? delta * 16 : delta;
}
