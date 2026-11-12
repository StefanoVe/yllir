export interface DragHandlers {
  /** Called at most once per animation frame while the pointer moves past the threshold. Offsets are in units of `scale`. */
  move: (dx: number, dy: number) => void;
  /** Called once on release. `moved` is false for a plain click. */
  end: (dx: number, dy: number, moved: boolean) => void;
}

export interface DragHandle {
  /** Stops listening without calling `end`. */
  cancel: () => void;
}

/** Pixels the pointer must travel before a press counts as a drag. */
export const DRAG_THRESHOLD = 3;

function nextFrame(callback: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
  return setTimeout(callback, 16) as unknown as number;
}

function cancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  else clearTimeout(handle);
}

/**
 * Tracks one pointer gesture on the window. Movement is converted to board units
 * with `scale()` (the canvas zoom, or 1 for panning in screen pixels) and delivered
 * once per frame, so dragging stays smooth without re-rendering on every event.
 */
export function trackPointerDrag(
  start: { clientX: number; clientY: number },
  scale: () => number,
  handlers: DragHandlers,
): DragHandle {
  const startX = start.clientX;
  const startY = start.clientY;
  let moved = false;
  let dx = 0;
  let dy = 0;
  let frame: number | null = null;

  const deliver = () => {
    frame = null;
    if (moved) handlers.move(dx, dy);
  };

  const onMove = (event: PointerEvent) => {
    const rawX = event.clientX - startX;
    const rawY = event.clientY - startY;
    if (!moved && Math.hypot(rawX, rawY) < DRAG_THRESHOLD) return;
    moved = true;
    const factor = scale() || 1;
    dx = rawX / factor;
    dy = rawY / factor;
    if (frame === null) frame = nextFrame(deliver);
  };

  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    if (frame !== null) cancelFrame(frame);
    frame = null;
  };

  const onUp = () => {
    cleanup();
    handlers.end(dx, dy, moved);
  };

  const onCancel = () => {
    cleanup();
    handlers.end(0, 0, false);
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);

  return { cancel: cleanup };
}
