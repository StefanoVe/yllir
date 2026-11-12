/** DataTransfer type of a card dragged from a panel onto the table. The table reads the same shape. */
export const CARD_DRAG_TYPE = 'application/x-yllir-card';

export interface CardDragPayload {
  kind: 'document' | 'image';
  path: string;
}

export function documentPayload(path: string): CardDragPayload {
  return { kind: 'document', path };
}

/** Writes the payload of a drag as JSON. Does nothing when the browser gave no DataTransfer. */
export function writeCardDrag(data: DataTransfer | null, payload: CardDragPayload): void {
  if (!data) return;
  data.effectAllowed = 'copy';
  data.setData(CARD_DRAG_TYPE, JSON.stringify(payload));
}

/** Reads a payload back. Anything that is not a valid campaign-relative path to a card kind is rejected. */
export function readCardDrag(raw: string): CardDragPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { kind, path } = value as { kind?: unknown; path?: unknown };
  if (kind !== 'document' && kind !== 'image') return null;
  if (typeof path !== 'string' || path === '' || path.startsWith('/') || path.split('/').includes('..')) return null;
  return { kind, path };
}
