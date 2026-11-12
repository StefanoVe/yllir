import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { Board, BoardArrow, BoardCard, BoardFrame } from '@shared/types';
import { PrefsService } from '../../core/prefs.service';
import { LiveStateService, failureText } from '../live-api.service';
import { hasDragPayload, readDragPayload } from '../drop-payload';
import { isLiveFailure, type LiveFailure } from '../live-types';
import { LiveStrings } from '../strings';
import { LiveCard, type CardPress } from './card';
import { LiveFrame } from './frame';
import { LiveCanvasToolbar, type ToolbarCommand } from './canvas-toolbar';
import { LiveDocPicker } from './doc-picker';
import { BoardSync, type SaveStatus } from './board-sync';
import * as Edit from './board-edit';
import type { ItemSelection } from './board-edit';
import { isImagePath, MAX_CARDS, validateBoard } from './board-limits';
import {
  DEFAULT_VIEW,
  GRID,
  clampCoord,
  fitView,
  frameForRect,
  panBy,
  pinchView,
  arrowSegment,
  resizedSize,
  screenToBoard,
  snap,
  unionBounds,
  zoomAt,
  type Point,
  type Rect,
  type View,
} from './geometry';
import { trackPointerDrag, type DragHandle } from './pointer-drag';
import { defaultView, parseView, serializeView, VIEW_PREF_KEY } from './view-prefs';

/** Live move or resize, shown before the drop. Offsets are in board units; the save snaps them. */
type Preview = { kind: 'move'; ids: ReadonlySet<string>; dx: number; dy: number } | { kind: 'resize'; id: string; w: number; h: number };

interface ArrowView {
  id: string;
  label: string;
  d: string;
  mid: Point;
}

const EMPTY_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 };
const GRID_CELL = GRID * 3;
const SAVE_VIEW_DEBOUNCE_MS = 300;
const ZOOM_STEP = 1.25;
const WHEEL_ZOOM = 0.01;

export function emptyBoard(): Board {
  return { revision: 0, cards: [], frames: [], arrows: [] };
}

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Board rectangles of every card and frame, with the live preview applied. */
export function rectMap(board: Board, preview: Preview | null): Map<string, Rect> {
  const map = new Map<string, Rect>();
  const place = (item: { id: string; x: number; y: number; w: number; h: number }): Rect => {
    if (preview?.kind === 'move' && preview.ids.has(item.id)) {
      return { x: item.x + preview.dx, y: item.y + preview.dy, w: item.w, h: item.h };
    }
    if (preview?.kind === 'resize' && preview.id === item.id) {
      return { x: item.x, y: item.y, w: preview.w, h: preview.h };
    }
    return { x: item.x, y: item.y, w: item.w, h: item.h };
  };
  for (const frame of board.frames) map.set(frame.id, place(frame));
  for (const card of board.cards) map.set(card.id, place(card));
  return map;
}

/**
 * The table: pan and zoom, cards, scene frames and arrows, the toolbar, and the save loop.
 * All edits go through the pure reducers in board-edit.ts; the server copy is what is shown after a save.
 */
@Component({
  selector: 'ms-live-canvas',
  imports: [LiveCard, LiveFrame, LiveCanvasToolbar, LiveDocPicker],
  templateUrl: './canvas.html',
  styleUrl: './canvas.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveCanvas implements AfterViewInit {
  private readonly live = inject(LiveStateService);
  private readonly prefs = inject(PrefsService);
  private readonly destroyRef = inject(DestroyRef);
  readonly s = inject(LiveStrings);
  private readonly viewportRef = viewChild.required<ElementRef<HTMLElement>>('viewport');

  readonly doc = signal<Board>(emptyBoard());
  readonly view = signal<View>(defaultView());
  readonly preview = signal<Preview | null>(null);
  readonly selection = signal<ItemSelection | null>(null);
  readonly linkFrom = signal<string | null>(null);
  readonly status = signal<SaveStatus>('saved');
  readonly notice = signal<string | null>(null);
  readonly hint = signal<string | null>(null);
  readonly pickerOpen = signal(false);
  readonly imageOpen = signal(false);
  readonly imagePath = signal('');
  readonly imageError = signal<string | null>(null);

  readonly rects = computed(() => rectMap(this.doc(), this.preview()));
  readonly arrows = computed<ArrowView[]>(() => this.arrowViews());
  readonly selectedArrow = computed(() => {
    const sel = this.selection();
    return sel?.kind === 'arrow' ? this.arrows().find((a) => a.id === sel.id) ?? null : null;
  });
  readonly percent = computed(() => Math.round(this.view().zoom * 100));
  readonly worldTransform = computed(() => {
    const v = this.view();
    return `translate(${v.panX}px, ${v.panY}px) scale(${v.zoom})`;
  });
  readonly gridSize = computed(() => `${GRID_CELL * this.view().zoom}px`);
  readonly gridPosition = computed(() => {
    const v = this.view();
    return `${v.panX}px ${v.panY}px`;
  });
  readonly linking = computed(() => this.linkFrom() !== null);

  private readonly sync: BoardSync;
  private appliedRevision = -1;
  private viewRestored = false;
  private viewTimer: ReturnType<typeof setTimeout> | null = null;
  private lastError: string | null = null;
  private spaceHeld = false;
  private readonly pointers = new Map<number, Point>();
  private pinch: { startView: View; startMid: Point; startDist: number } | null = null;
  private gesture: DragHandle | null = null;

  constructor() {
    this.sync = new BoardSync(
      {
        put: (board) => this.save(board),
        onServer: (board, reason) => this.adoptServer(board, reason),
        onStatus: (status) => this.onStatus(status),
      },
      0,
    );

    // Server board: adopted when nothing local is waiting to be saved.
    effect(() => {
      const server = this.live.board();
      untracked(() => this.receive(server));
    });

    // Saved pan and zoom, once the campaign is known.
    effect(() => {
      const slug = this.prefs.slug();
      untracked(() => {
        if (slug === null || this.viewRestored) return;
        this.viewRestored = true;
        const saved = parseView(this.prefs.get(VIEW_PREF_KEY));
        if (saved) this.view.set(saved);
      });
    });

    this.destroyRef.onDestroy(() => {
      this.gesture?.cancel();
      if (this.viewTimer !== null) {
        clearTimeout(this.viewTimer);
        this.prefs.set(VIEW_PREF_KEY, serializeView(this.view()));
      }
      void this.sync.flush();
    });
  }

  ngAfterViewInit(): void {
    const el = this.viewportRef().nativeElement;
    const onDownCapture = (event: PointerEvent) => this.onPointerDownCapture(event);
    const onWheel = (event: WheelEvent) => this.onWheel(event);
    const onMove = (event: PointerEvent) => this.onWindowPointerMove(event);
    const onUp = (event: PointerEvent) => this.onWindowPointerUp(event);
    const onBlur = () => {
      this.spaceHeld = false;
    };
    el.addEventListener('pointerdown', onDownCapture, { capture: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onBlur);
    this.destroyRef.onDestroy(() => {
      el.removeEventListener('pointerdown', onDownCapture, { capture: true });
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onBlur);
    });
  }

  // ---- server state -------------------------------------------------------

  private receive(server: Board | null): void {
    if (server === null || this.sync.dirty) return;
    this.sync.rebase(server.revision);
    if (server.revision === this.appliedRevision) return;
    this.appliedRevision = server.revision;
    this.doc.set(server);
  }

  /** The server copy replaces the local one. A save keeps the selection; a conflict resets it, since its items may be gone. */
  private adoptServer(board: Board, reason: 'saved' | 'conflict'): void {
    this.appliedRevision = board.revision;
    this.doc.set(board);
    if (reason === 'saved') return;
    this.preview.set(null);
    this.selection.set(null);
    this.linkFrom.set(null);
    this.notice.set(this.s.copy('live.notice.conflict'));
  }

  private async save(board: Board): Promise<Board> {
    const check = validateBoard(board);
    if (!check.ok) {
      const failure: LiveFailure = { error: this.s.copy('live.notice.invalid'), status: 0 };
      this.lastError = failure.error;
      throw failure;
    }
    try {
      const saved = await this.live.saveBoard(board);
      this.lastError = null;
      return saved;
    } catch (failure) {
      this.lastError = isLiveFailure(failure) ? failureText(failure, '') || null : null;
      throw failure;
    }
  }

  private onStatus(status: SaveStatus): void {
    this.status.set(status);
    if (status === 'saved') this.notice.set(null);
    if (status === 'error') this.notice.set(this.lastError ?? this.s.copy('live.notice.saveError'));
  }

  /** Every local edit goes through here: shown at once, saved after the debounce. */
  private commit(next: Board): void {
    if (next === this.doc()) return;
    this.doc.set(next);
    this.sync.schedule(next);
  }

  // ---- selection and tools ------------------------------------------------

  setSelection(kind: ItemSelection['kind'], id: string): void {
    this.selection.set({ kind, id });
  }

  /** Pointer press on a card or frame: selects it and brings a card to the front. */
  private selectItem(kind: 'card' | 'frame', id: string): void {
    this.setSelection(kind, id);
    if (kind === 'card') this.commit(Edit.raiseCard(this.doc(), id));
  }

  onItemPress(kind: 'card' | 'frame', id: string, press: CardPress): void {
    if (this.linkFrom() !== null) {
      this.finishLink(id);
      return;
    }
    if (press.action === 'select') {
      this.selectItem(kind, id);
    } else if (press.action === 'move') {
      this.startMove(kind, id, press.event);
    } else {
      this.startResize(kind, id, press.event);
    }
  }

  onArrowPress(event: PointerEvent, id: string): void {
    event.stopPropagation();
    if (this.linkFrom() !== null) return;
    this.setSelection('arrow', id);
  }

  toggleLink(): void {
    if (this.linkFrom() !== null) {
      this.linkFrom.set(null);
      this.hint.set(null);
      return;
    }
    const sel = this.selection();
    if (!sel || sel.kind === 'arrow') {
      this.hint.set(this.s.copy('live.tool.needSelection'));
      return;
    }
    this.linkFrom.set(sel.id);
    this.hint.set(this.s.copy('live.tool.linkHint'));
  }

  private finishLink(targetId: string): void {
    const from = this.linkFrom();
    this.linkFrom.set(null);
    this.hint.set(null);
    if (from === null || from === targetId) return;
    const arrow: BoardArrow = { id: newId('a'), from, to: targetId };
    const next = Edit.addArrow(this.doc(), arrow);
    if (next === this.doc()) return;
    this.commit(next);
    this.setSelection('arrow', arrow.id);
  }

  onCommand(command: ToolbarCommand): void {
    switch (command) {
      case 'note':
        this.addCardAt('note', undefined, this.centre(), 220, 120, '');
        break;
      case 'document':
        this.imageOpen.set(false);
        this.pickerOpen.update((open) => !open);
        break;
      case 'image':
        this.pickerOpen.set(false);
        this.imageOpen.update((open) => !open);
        this.imageError.set(null);
        break;
      case 'frame':
        this.addFrame();
        break;
      case 'link':
        this.toggleLink();
        break;
      case 'zoom-in':
        this.zoomBy(ZOOM_STEP);
        break;
      case 'zoom-out':
        this.zoomBy(1 / ZOOM_STEP);
        break;
      case 'fit':
        this.fit();
        break;
    }
  }

  onPicked(path: string): void {
    this.pickerOpen.set(false);
    this.addCardAt('document', path, this.centre(), 280, 180);
  }

  submitImage(value: string): void {
    const path = value.trim();
    if (!isImagePath(path)) {
      this.imageError.set(this.s.copy('live.image.invalid'));
      return;
    }
    this.imageError.set(null);
    this.imageOpen.set(false);
    this.imagePath.set('');
    this.addCardAt('image', path, this.centre(), 320, 220);
  }

  setNoteText(id: string, text: string): void {
    this.commit(Edit.setCardText(this.doc(), id, text));
  }

  onFrameTitle(id: string, title: string): void {
    this.commit(Edit.setFrameTitle(this.doc(), id, title));
  }

  onArrowLabel(id: string, event: Event): void {
    this.commit(Edit.setArrowLabel(this.doc(), id, (event.target as HTMLInputElement).value));
  }

  dismissNotice(): void {
    this.notice.set(null);
  }

  removeSelected(): void {
    const sel = this.selection();
    if (!sel) return;
    this.commit(Edit.removeSelection(this.doc(), sel));
    this.selection.set(null);
    this.linkFrom.set(null);
  }

  private addCardAt(
    kind: BoardCard['kind'],
    ref: string | undefined,
    at: Point,
    w: number,
    h: number,
    text?: string,
  ): void {
    const board = this.doc();
    if (board.cards.length >= MAX_CARDS) {
      this.notice.set(this.s.copy('live.canvas.full'));
      return;
    }
    const x = clampCoord(snap(at.x - w / 2));
    const y = clampCoord(snap(at.y - h / 2));
    const id = newId(kind === 'document' ? 'd' : kind === 'image' ? 'i' : 'n');
    const frameId = frameForRect(
      board.frames.map((f) => ({ id: f.id, rect: { x: f.x, y: f.y, w: f.w, h: f.h } })),
      { x, y, w, h },
    );
    const card: BoardCard = {
      id,
      kind,
      x,
      y,
      w,
      h,
      z: 0,
      ...(ref !== undefined ? { ref } : {}),
      ...(text !== undefined ? { text } : {}),
      ...(frameId !== null ? { frame: frameId } : {}),
    };
    this.commit(Edit.addCard(board, card));
    this.setSelection('card', id);
  }

  private addFrame(): void {
    const at = this.centre();
    const frame: BoardFrame = {
      id: newId('f'),
      title: this.s.copy('live.frame.defaultTitle'),
      x: clampCoord(snap(at.x - 240)),
      y: clampCoord(snap(at.y - 160)),
      w: 480,
      h: 320,
    };
    this.commit(Edit.addFrame(this.doc(), frame));
    this.setSelection('frame', frame.id);
  }

  // ---- gestures -----------------------------------------------------------

  private startMove(kind: 'card' | 'frame', id: string, event: PointerEvent): void {
    this.selectItem(kind, id);
    const board = this.doc();
    const item = kind === 'card' ? board.cards.find((c) => c.id === id) : board.frames.find((f) => f.id === id);
    if (!item) return;
    const ids = new Set<string>([id]);
    if (kind === 'frame') for (const card of board.cards) if (card.frame === id) ids.add(card.id);
    const origin = { x: item.x, y: item.y };
    this.gesture?.cancel();
    this.gesture = trackPointerDrag(event, () => this.view().zoom, {
      move: (dx, dy) => this.preview.set({ kind: 'move', ids, dx, dy }),
      end: (dx, dy, moved) => {
        this.gesture = null;
        this.preview.set(null);
        if (!moved) return;
        this.placeItem(kind, id, snap(origin.x + dx), snap(origin.y + dy));
      },
    });
  }

  private startResize(kind: 'card' | 'frame', id: string, event: PointerEvent): void {
    this.selectItem(kind, id);
    const board = this.doc();
    const item = kind === 'card' ? board.cards.find((c) => c.id === id) : board.frames.find((f) => f.id === id);
    if (!item) return;
    const origin = { w: item.w, h: item.h };
    const min = kind === 'card' ? Edit.CARD_MIN : Edit.FRAME_MIN;
    this.gesture?.cancel();
    this.gesture = trackPointerDrag(event, () => this.view().zoom, {
      move: (dx, dy) => {
        const size = resizedSize(origin, dx, dy, min);
        this.preview.set({ kind: 'resize', id, w: size.w, h: size.h });
      },
      end: (dx, dy, moved) => {
        this.gesture = null;
        this.preview.set(null);
        if (!moved) return;
        const w = Math.max(min.w, snap(origin.w + dx));
        const h = Math.max(min.h, snap(origin.h + dy));
        this.commit(kind === 'card' ? Edit.resizeCard(this.doc(), id, w, h) : Edit.resizeFrame(this.doc(), id, w, h));
      },
    });
  }

  /** Moves a card or frame to (x, y). A card's frame follows where its centre lands. */
  private placeItem(kind: 'card' | 'frame', id: string, x: number, y: number): void {
    if (kind === 'frame') {
      this.commit(Edit.moveFrame(this.doc(), id, x, y));
      return;
    }
    let next = Edit.moveCard(this.doc(), id, x, y);
    const card = next.cards.find((c) => c.id === id);
    if (!card) return;
    const frameId = frameForRect(
      next.frames.map((f) => ({ id: f.id, rect: { x: f.x, y: f.y, w: f.w, h: f.h } })),
      { x: card.x, y: card.y, w: card.w, h: card.h },
    );
    next = Edit.setCardFrame(next, id, frameId ?? undefined);
    this.commit(next);
  }

  private nudgeSelected(dx: number, dy: number): void {
    const sel = this.selection();
    if (!sel || sel.kind === 'arrow') return;
    const board = this.doc();
    if (sel.kind === 'card') {
      const card = board.cards.find((c) => c.id === sel.id);
      if (card) this.placeItem('card', sel.id, card.x + dx, card.y + dy);
    } else {
      const frame = board.frames.find((f) => f.id === sel.id);
      if (frame) this.placeItem('frame', sel.id, frame.x + dx, frame.y + dy);
    }
  }

  // ---- pan and zoom -------------------------------------------------------

  /** Capture phase: pan starts on empty space (or with Space held) before any child sees the press. */
  private onPointerDownCapture(event: PointerEvent): void {
    this.trackPointer(event);
    if (this.pointers.size === 2) {
      event.stopPropagation();
      this.startPinch();
      return;
    }
    if (this.pointers.size > 1) return;
    if (event.button !== 0 && event.button !== 1) return;
    const onBackground = (event.target as Element | null)?.closest('[data-no-pan]') === null;
    const pans = this.spaceHeld || onBackground || event.button === 1;
    if (!pans) return;
    if (this.spaceHeld) event.stopPropagation();
    event.preventDefault();
    this.startPan(event);
  }

  private startPan(event: PointerEvent): void {
    this.gesture?.cancel();
    // Pressing empty space moves keyboard focus to the table, so Space and Delete work after a click.
    this.viewportRef().nativeElement.focus({ preventScroll: true });
    const startView = this.view();
    this.gesture = trackPointerDrag(event, () => 1, {
      move: (dx, dy) => this.view.set(panBy(startView, dx, dy)),
      end: (_dx, _dy, moved) => {
        this.gesture = null;
        if (!moved) this.clearSelection();
        this.schedulePersist();
      },
    });
  }

  private clearSelection(): void {
    this.selection.set(null);
    this.linkFrom.set(null);
    this.hint.set(null);
    this.pickerOpen.set(false);
  }

  private trackPointer(event: PointerEvent): void {
    this.pointers.set(event.pointerId, this.local(event));
  }

  private onWindowPointerMove(event: PointerEvent): void {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, this.local(event));
    if (this.pinch) {
      const [a, b] = [...this.pointers.values()];
      if (!a || !b) return;
      const dist = distance(a, b) || 1;
      this.view.set(pinchView(this.pinch.startView, this.pinch.startMid, midpoint(a, b), dist / this.pinch.startDist));
    }
  }

  private onWindowPointerUp(event: PointerEvent): void {
    this.pointers.delete(event.pointerId);
    if (this.pinch && this.pointers.size < 2) {
      this.pinch = null;
      this.schedulePersist();
    }
  }

  private startPinch(): void {
    this.gesture?.cancel();
    this.gesture = null;
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    this.pinch = { startView: this.view(), startMid: midpoint(a, b), startDist: distance(a, b) || 1 };
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    const scale = event.deltaMode === 1 ? 16 : 1;
    const v = this.view();
    if (event.ctrlKey || event.metaKey) {
      const factor = Math.exp(-event.deltaY * scale * WHEEL_ZOOM);
      this.view.set(zoomAt(v, factor, this.local(event)));
    } else {
      this.view.set(panBy(v, -event.deltaX * scale, -event.deltaY * scale));
    }
    this.schedulePersist();
  }

  zoomBy(factor: number): void {
    this.view.set(zoomAt(this.view(), factor, this.viewCentre()));
    this.schedulePersist();
  }

  fit(): void {
    const rects = [...this.rects().values()];
    const el = this.viewportRef().nativeElement;
    const size = { width: el.clientWidth, height: el.clientHeight };
    this.view.set(rects.length === 0 ? { ...DEFAULT_VIEW } : fitView(unionBounds(rects), size));
    this.schedulePersist();
  }

  private schedulePersist(): void {
    if (this.viewTimer !== null) clearTimeout(this.viewTimer);
    this.viewTimer = setTimeout(() => {
      this.viewTimer = null;
      this.prefs.set(VIEW_PREF_KEY, serializeView(this.view()));
    }, SAVE_VIEW_DEBOUNCE_MS);
  }

  // ---- keyboard and drop --------------------------------------------------

  onKeydown(event: KeyboardEvent): void {
    const target = event.target as Element | null;
    if (target?.closest('input, textarea, [contenteditable="true"]')) return;
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.linkFrom.set(null);
        this.hint.set(null);
        this.selection.set(null);
        this.pickerOpen.set(false);
        this.imageOpen.set(false);
        break;
      case 'Delete':
      case 'Backspace':
        if (this.selection() === null) return;
        event.preventDefault();
        this.removeSelected();
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        if (this.selection() === null || this.selection()?.kind === 'arrow') return;
        event.preventDefault();
        const step = event.shiftKey ? 32 : 8;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        this.nudgeSelected(dx, dy);
        break;
      }
      case ' ':
        event.preventDefault();
        this.spaceHeld = true;
        break;
    }
  }

  onKeyup(event: KeyboardEvent): void {
    if (event.key === ' ') this.spaceHeld = false;
  }

  onDragOver(event: DragEvent): void {
    if (!hasDragPayload(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  onDrop(event: DragEvent): void {
    const payload = readDragPayload(event);
    if (!payload) return;
    event.preventDefault();
    const at = screenToBoard(this.view(), this.local(event));
    if (payload.kind === 'document') this.addCardAt('document', payload.path, at, 280, 180);
    else this.addCardAt('image', payload.path, at, 320, 220);
  }

  // ---- geometry helpers ---------------------------------------------------

  rectOf(id: string): Rect {
    return this.rects().get(id) ?? EMPTY_RECT;
  }

  isSelected(kind: ItemSelection['kind'], id: string): boolean {
    const sel = this.selection();
    return sel !== null && sel.kind === kind && sel.id === id;
  }

  private arrowViews(): ArrowView[] {
    const rects = this.rects();
    return this.doc().arrows.flatMap((arrow): ArrowView[] => {
      const from = rects.get(arrow.from);
      const to = rects.get(arrow.to);
      if (!from || !to) return [];
      const seg = arrowSegment(from, to);
      return [
        {
          id: arrow.id,
          label: arrow.label ?? '',
          d: `M${seg.x1} ${seg.y1} L${seg.x2} ${seg.y2}`,
          mid: { x: (seg.x1 + seg.x2) / 2, y: (seg.y1 + seg.y2) / 2 },
        },
      ];
    });
  }

  /** Viewport-local screen point of a pointer or drag event. */
  private local(event: { clientX: number; clientY: number }): Point {
    const rect = this.viewportRef().nativeElement.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private viewCentre(): Point {
    const el = this.viewportRef().nativeElement;
    return { x: el.clientWidth / 2, y: el.clientHeight / 2 };
  }

  /** Board point at the centre of what is on screen: where new items appear. */
  private centre(): Point {
    return screenToBoard(this.view(), this.viewCentre());
  }

}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
