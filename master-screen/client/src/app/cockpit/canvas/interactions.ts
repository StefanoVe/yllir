import { signal } from "@angular/core";
import type { LayoutItem, Rect } from "@shared/cockpit-types";
import { center, containsPoint, intersects, rectBetween } from "./geometry";
import type { Point, Size } from "./geometry";

/** Pointer travel, in screen pixels, before a press turns into a drag. */
export const DRAG_THRESHOLD_PX = 4;
/** Local overrides are dropped after this long if the server never echoes them. */
const SETTLE_FALLBACK_MS = 2000;
const CARD_MIN: Size = { width: 120, height: 72 };
const FRAME_MIN: Size = { width: 240, height: 160 };

/** Geometry and membership the machine reads when a gesture starts. */
export interface Scene {
  /** Displayed geometry (local overrides applied) of every card and frame. */
  rects: Map<string, Rect>;
  frameIds: Set<string>;
  cardIds: Set<string>;
  /** Frame each card sits in, if any. */
  frameOf: Map<string, string | undefined>;
  /** Map and image cards: their resize keeps the aspect ratio on Shift. */
  imageIds: Set<string>;
}

/** What the machine needs from the canvas component. */
export interface CanvasPort {
  zoom(): number;
  pan(): Point;
  setPan(x: number, y: number): void;
  /** Client (screen) point to canvas coordinates. */
  toCanvas(clientX: number, clientY: number): Point;
  scene(): Scene;
  selection(): Set<string>;
  setSelection(ids: Set<string>): void;
  selectLink(id: string | null): void;
  /** Geometry-only changes: a single `layout` event. */
  commit(items: LayoutItem[]): void;
  /** A new link between two cards or frames. */
  link(from: string, to: string): void;
}

/** What a pointer press landed on. */
export type Hit =
  | { kind: "item"; id: string; canDrag: boolean }
  | { kind: "handle"; id: string }
  | { kind: "link"; id: string }
  | { kind: "background" };

interface Press {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
}

interface MovePlan {
  scene: Scene;
  frames: string[];
  movers: string[];
  /** Geometry at drag start of every item that moves, carried cards included. */
  origin: Map<string, Rect>;
}

interface MoveGesture extends Press {
  kind: "move";
  primary: string;
  canDrag: boolean;
  /** Shift was held on press: the press adds to the selection. */
  additive: boolean;
  /** Shift on an already selected item: a plain click deselects it. */
  removeOnRelease: boolean;
  plan?: MovePlan;
}

interface ResizeGesture extends Press {
  kind: "resize";
  id: string;
  origin: Rect;
  min: Size;
  lockAspect: boolean;
}

interface MarqueeGesture extends Press {
  kind: "marquee";
  start: Point;
  base: Set<string>;
}

interface PanGesture extends Press {
  kind: "pan";
  pan: Point;
}

type Gesture = MoveGesture | ResizeGesture | MarqueeGesture | PanGesture;

/** Reads what the pointer landed on from the DOM under it. */
export function readHit(target: Element): Hit {
  const link = target.closest("[data-link-id]");
  if (link)
    return { kind: "link", id: link.getAttribute("data-link-id") ?? "" };
  const item = target.closest<HTMLElement>("[data-id]");
  const id = item?.dataset['id'];
  if (!item || !id) return { kind: "background" };
  if (target.closest(".resize-handle")) return { kind: "handle", id };
  // A scrollable body keeps its own scrolling: pressing it does not drag.
  const body = target.closest(".card-body, .note-text");
  const scrolls = !!body && body.scrollHeight > body.clientHeight;
  return { kind: "item", id, canDrag: !scrolls };
}

/** Typing targets keep their keys: the canvas shortcuts stand aside. */
export function isTextEntry(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("input, textarea, select, [contenteditable]") !== null
  );
}

export function imageFiles(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((file) =>
    file.type.startsWith("image/"),
  );
}

/** During dragover browsers may hide the MIME type: a file of unknown type counts. */
export function hasImageFiles(data: DataTransfer | null): boolean {
  return Array.from(data?.items ?? []).some(
    (item) =>
      item.kind === "file" &&
      (item.type === "" || item.type.startsWith("image/")),
  );
}

/** Smallest frame containing the point: frames nest visually, the tightest wins. */
export function frameAt(
  point: Point,
  frameIds: Iterable<string>,
  rectOf: (id: string) => Rect | undefined,
): string | undefined {
  let found: string | undefined;
  let best = Infinity;
  for (const id of frameIds) {
    const rect = rectOf(id);
    if (!rect || !containsPoint(rect, point)) continue;
    const area = rect.w * rect.h;
    if (area < best) {
      best = area;
      found = id;
    }
  }
  return found;
}

/**
 * Pointer state machine of the canvas: pan, move (cards and frames), resize,
 * rubber-band selection and linking. The component forwards pointer events and
 * reads the signals below; the machine never touches the DOM beyond capture.
 */
export class CanvasPointer {
  /** Local geometry during a drag, and until the server echoes it back. */
  readonly overrides = signal<Map<string, Rect>>(new Map());
  readonly dropTarget = signal<string | null>(null);
  readonly marquee = signal<Rect | null>(null);
  readonly dragging = signal(false);
  /** Card or frame that starts a link while linking. */
  readonly connectFrom = signal<string | null>(null);
  /** Pointer position in canvas coordinates while linking. */
  readonly connectTo = signal<Point | null>(null);

  private gesture?: Gesture;
  private settleTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly port: CanvasPort) {}

  startConnect(id: string): void {
    this.connectFrom.set(id);
    this.connectTo.set(null);
  }

  dispose(): void {
    clearTimeout(this.settleTimer);
  }

  press(event: PointerEvent, hit: Hit): void {
    const from = this.connectFrom();
    if (from) {
      // Linking: the next card or frame clicked becomes the target.
      if (hit.kind === "item") {
        if (hit.id !== from) {
          this.port.link(from, hit.id);
          this.endConnect();
        }
        return;
      }
      if (hit.kind !== "background") return;
    }

    const base = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    const selected = this.port.selection();
    switch (hit.kind) {
      case "link":
        this.port.selectLink(hit.id);
        return;
      case "handle": {
        const scene = this.port.scene();
        const origin = scene.rects.get(hit.id);
        if (!selected.has(hit.id)) this.port.setSelection(new Set([hit.id]));
        if (!origin) return;
        this.gesture = {
          ...base,
          kind: "resize",
          id: hit.id,
          origin,
          min: scene.frameIds.has(hit.id) ? FRAME_MIN : CARD_MIN,
          lockAspect: scene.imageIds.has(hit.id),
        };
        return;
      }
      case "item": {
        // Shift toggles membership; a plain press on an unselected item selects it alone.
        const additive = event.shiftKey;
        const removeOnRelease = additive && selected.has(hit.id);
        if (additive && !selected.has(hit.id)) {
          this.port.setSelection(new Set([...selected, hit.id]));
        } else if (!additive && !selected.has(hit.id)) {
          this.port.setSelection(new Set([hit.id]));
        }
        this.gesture = {
          ...base,
          kind: "move",
          primary: hit.id,
          canDrag: hit.canDrag,
          additive,
          removeOnRelease,
        };
        return;
      }
      case "background":
        this.gesture = event.shiftKey
          ? {
              ...base,
              kind: "marquee",
              start: this.port.toCanvas(event.clientX, event.clientY),
              base: new Set(selected),
            }
          : { ...base, kind: "pan", pan: this.port.pan() };
        return;
    }
  }

  move(event: PointerEvent): void {
    if (this.connectFrom()) {
      this.connectTo.set(this.port.toCanvas(event.clientX, event.clientY));
    }
    const g = this.gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;
    if (!g.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      if (g.kind === "move" && !g.canDrag) return;
      g.moved = true;
      this.dragging.set(true);
      (event.currentTarget as Element | null)?.setPointerCapture?.(
        event.pointerId,
      );
      if (g.kind === "move") g.plan = this.planMove();
    }

    // Screen deltas become canvas deltas: divide by the zoom.
    const zoom = this.port.zoom();
    switch (g.kind) {
      case "pan":
        this.port.setPan(g.pan.x + dx, g.pan.y + dy);
        return;
      case "marquee":
        this.marquee.set(
          rectBetween(
            g.start,
            this.port.toCanvas(event.clientX, event.clientY),
          ),
        );
        return;
      case "resize":
        this.previewResize(g, event.shiftKey, dx / zoom, dy / zoom);
        return;
      case "move":
        if (g.plan) this.previewMove(g, g.plan, dx / zoom, dy / zoom);
        return;
    }
  }

  release(event: PointerEvent): void {
    const g = this.gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    this.gesture = undefined;
    this.dragging.set(false);
    this.dropTarget.set(null);
    if (!g.moved) {
      this.click(g);
      return;
    }
    switch (g.kind) {
      case "move":
        this.commitMove(g);
        return;
      case "resize":
        this.commitResize(g.id);
        return;
      case "marquee":
        this.pickMarquee(g);
        return;
      case "pan":
        return;
    }
  }

  /** Cancels the current gesture or link. Returns whether anything was active. */
  abort(): boolean {
    const active = this.gesture !== undefined || this.connectFrom() !== null;
    if (this.gesture?.moved) this.clearOverrides();
    this.gesture = undefined;
    this.dragging.set(false);
    this.dropTarget.set(null);
    this.marquee.set(null);
    this.endConnect();
    return active;
  }

  /**
   * Drops the local overrides once the board shows the same geometry, or after
   * a fallback delay if the server never echoes them.
   */
  settle(items: ReadonlyArray<Rect & { id: string }>): void {
    if (this.gesture?.moved || this.overrides().size === 0) return;
    const byId = new Map(items.map((item) => [item.id, item]));
    const synced = [...this.overrides()].every(([id, r]) => {
      const item = byId.get(id);
      return (
        !item ||
        (item.x === r.x && item.y === r.y && item.w === r.w && item.h === r.h)
      );
    });
    if (synced) this.clearOverrides();
  }

  // ───────────────────────────── Gestures ─────────────────────────────

  /** A press that never became a drag: a plain click. */
  private click(g: Gesture): void {
    if (g.kind === "pan") {
      this.port.setSelection(new Set());
      this.port.selectLink(null);
      this.endConnect();
      return;
    }
    if (g.kind !== "move") return;
    if (g.removeOnRelease) {
      const next = new Set(this.port.selection());
      next.delete(g.primary);
      this.port.setSelection(next);
    } else if (!g.additive) {
      this.port.setSelection(new Set([g.primary]));
    }
  }

  /**
   * Selected frames move with their cards (the server does it on `layout`), so
   * only the frame is sent. Selected cards that are not inside a moved frame move
   * on their own, and may change frame. Cards inside a moved frame are carried.
   */
  private planMove(): MovePlan {
    const scene = this.port.scene();
    const selected = [...this.port.selection()];
    const frames = selected.filter((id) => scene.frameIds.has(id));
    const dragged = new Set(frames);
    const carried = (id: string): boolean => {
      const frame = scene.frameOf.get(id);
      return frame !== undefined && dragged.has(frame);
    };
    const movers = selected.filter(
      (id) => scene.cardIds.has(id) && !carried(id),
    );
    const origin = new Map<string, Rect>();
    const add = (id: string): void => {
      const rect = scene.rects.get(id);
      if (rect) origin.set(id, rect);
    };
    frames.forEach(add);
    movers.forEach(add);
    for (const id of scene.cardIds) if (carried(id)) add(id);
    return { scene, frames, movers, origin };
  }

  private previewMove(
    g: MoveGesture,
    plan: MovePlan,
    dx: number,
    dy: number,
  ): void {
    const next = new Map(this.overrides());
    for (const [id, o] of plan.origin) {
      next.set(id, { ...o, x: Math.round(o.x + dx), y: Math.round(o.y + dy) });
    }
    this.overrides.set(next);
    this.dropTarget.set(this.dropFrame(g.primary, plan, next));
  }

  /** Frame to highlight: where the primary card's centre lands, if not its own. */
  private dropFrame(
    primary: string,
    plan: MovePlan,
    overrides: Map<string, Rect>,
  ): string | null {
    const rect = overrides.get(primary);
    if (!rect || !plan.movers.includes(primary)) return null;
    const target = frameAt(
      center(rect),
      plan.scene.frameIds,
      (id) => overrides.get(id) ?? plan.scene.rects.get(id),
    );
    return target && target !== plan.scene.frameOf.get(primary) ? target : null;
  }

  private commitMove(g: MoveGesture): void {
    const plan = g.plan;
    if (!plan) return;
    const overrides = this.overrides();
    const rectOf = (id: string) =>
      overrides.get(id) ?? plan.scene.rects.get(id);
    const items: LayoutItem[] = [];
    for (const id of plan.frames) {
      const r = overrides.get(id);
      if (r) items.push({ id, x: r.x, y: r.y });
    }
    for (const id of plan.movers) {
      const r = overrides.get(id);
      if (!r) continue;
      // A card that ends outside every frame leaves its frame; one that ends in a frame joins it.
      const was = plan.scene.frameOf.get(id) ?? null;
      const now = frameAt(center(r), plan.scene.frameIds, rectOf) ?? null;
      items.push(
        now === was
          ? { id, x: r.x, y: r.y }
          : { id, x: r.x, y: r.y, frameId: now },
      );
    }
    if (items.length) this.port.commit(items);
    this.armSettle();
  }

  private previewResize(
    g: ResizeGesture,
    shift: boolean,
    dw: number,
    dh: number,
  ): void {
    const { origin, min } = g;
    let w = Math.max(min.width, origin.w + dw);
    let h = Math.max(min.height, origin.h + dh);
    if (g.lockAspect && shift) {
      const ratio = origin.w / origin.h;
      const scale = Math.max(w / origin.w, h / origin.h);
      w = Math.max(min.width, origin.w * scale);
      h = w / ratio;
      if (h < min.height) {
        h = min.height;
        w = h * ratio;
      }
    }
    const next = new Map(this.overrides());
    next.set(g.id, {
      x: origin.x,
      y: origin.y,
      w: Math.round(w),
      h: Math.round(h),
    });
    this.overrides.set(next);
  }

  private commitResize(id: string): void {
    const r = this.overrides().get(id);
    if (r) this.port.commit([{ id, x: r.x, y: r.y, w: r.w, h: r.h }]);
    this.armSettle();
  }

  private pickMarquee(g: MarqueeGesture): void {
    const rect = this.marquee();
    this.marquee.set(null);
    if (!rect) return;
    const hits = [...this.port.scene().rects]
      .filter(([, r]) => intersects(rect, r))
      .map(([id]) => id);
    this.port.setSelection(new Set([...g.base, ...hits]));
  }

  // ───────────────────────────── Internals ─────────────────────────────

  private endConnect(): void {
    this.connectFrom.set(null);
    this.connectTo.set(null);
  }

  private armSettle(): void {
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      if (!this.gesture?.moved) this.clearOverrides();
    }, SETTLE_FALLBACK_MS);
  }

  private clearOverrides(): void {
    clearTimeout(this.settleTimer);
    if (this.overrides().size) this.overrides.set(new Map());
  }
}
