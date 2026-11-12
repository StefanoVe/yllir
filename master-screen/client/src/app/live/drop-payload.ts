/**
 * Drag and drop of a campaign item onto the live canvas (the quick look-up panel is the source).
 * The panel calls `setDragPayload(event, payload)` in its `dragstart` handler; the canvas accepts the drop.
 */
export const DRAG_MIME = 'application/x-yllir-card';

export interface DragPayload {
  kind: 'document' | 'image';
  /** Campaign-relative path. */
  path: string;
}

/** Writes the payload on a dragstart event. Does nothing when the event has no dataTransfer. */
export function setDragPayload(event: DragEvent, payload: DragPayload): void {
  const transfer = event.dataTransfer;
  if (!transfer) return;
  transfer.effectAllowed = 'copy';
  transfer.setData(DRAG_MIME, JSON.stringify(payload));
}

/** True when the drag carries a Yllir card. Readable during dragover, unlike the payload itself. */
export function hasDragPayload(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  return types !== undefined && Array.from(types).includes(DRAG_MIME);
}

/** Reads and validates the payload on drop. Anything else gives null. */
export function readDragPayload(event: DragEvent): DragPayload | null {
  const transfer = event.dataTransfer;
  if (!transfer) return null;
  let value: unknown;
  try {
    value = JSON.parse(transfer.getData(DRAG_MIME));
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { kind, path } = value as Partial<DragPayload>;
  if (kind !== 'document' && kind !== 'image') return null;
  if (typeof path !== 'string' || path.length === 0 || path.startsWith('/') || path.split('/').includes('..')) return null;
  return { kind, path };
}
