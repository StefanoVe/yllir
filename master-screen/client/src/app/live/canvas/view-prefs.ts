import { DEFAULT_VIEW, clampZoom, type View } from './geometry';

/** Preference key (PrefsService adds the campaign prefix). Pan and zoom are per campaign, never in the board. */
export const VIEW_PREF_KEY = 'table.view';

/** Reads a saved view. Anything malformed gives null, so the caller uses the default. */
export function parseView(raw: string | null): View | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<View>;
    if (!Number.isFinite(value.panX) || !Number.isFinite(value.panY) || !Number.isFinite(value.zoom)) return null;
    return { panX: value.panX as number, panY: value.panY as number, zoom: clampZoom(value.zoom as number) };
  } catch {
    return null;
  }
}

export function serializeView(view: View): string {
  return JSON.stringify({
    panX: Math.round(view.panX),
    panY: Math.round(view.panY),
    zoom: Math.round(view.zoom * 100) / 100,
  });
}

export function defaultView(): View {
  return { ...DEFAULT_VIEW };
}
