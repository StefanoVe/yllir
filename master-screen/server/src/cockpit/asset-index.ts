// Index of the maps and images of the campaign. A refresh runs when the archive version
// changes; when it changes the set of paths, `onChange` lets the owner republish the board,
// because a card resolved while the index was still empty shows as missing.
import type { Detail, ImageAsset, MapAsset } from "./ports.js";

export function createAssetIndex(deps: {
  /** Current archive version; a new value triggers a new refresh. */
  version: () => string;
  docs: () => Iterable<Detail>;
  listMaps: (docs: Iterable<Detail>) => Promise<MapAsset[]>;
  listImages: (docs: Iterable<Detail>, maps: MapAsset[]) => Promise<ImageAsset[]>;
  /** Called after a refresh that changed the set of map or image paths. */
  onChange: () => void;
}): { maps: () => MapAsset[]; images: () => ImageAsset[]; ready: () => Promise<void> } {
  let version = "";
  let mapValues: MapAsset[] = [];
  let imageValues: ImageAsset[] = [];
  let running: Promise<void> | undefined;
  // Key of the last successful refresh: the initial one is the key of two empty lists.
  let lastKey = keyOf([], []);

  const refresh = () => {
    const current = deps.version();
    if (version === current || running) return;
    running = deps
      .listMaps(deps.docs())
      .then(async (maps) => {
        mapValues = maps;
        version = current;
        imageValues = await deps
          .listImages(deps.docs(), maps)
          .catch(() => imageValues);
        const key = keyOf(mapValues, imageValues);
        if (key !== lastKey) {
          lastKey = key;
          deps.onChange();
        }
      })
      .catch(() => {})
      .finally(() => {
        running = undefined;
      });
  };
  refresh();

  return {
    maps: () => {
      refresh();
      return mapValues;
    },
    images: () => {
      refresh();
      return imageValues;
    },
    ready: () => running ?? Promise.resolve(),
  };
}

/** Sorted paths of the maps, a separator, then sorted paths of the images. */
function keyOf(maps: { path: string }[], images: { path: string }[]): string {
  const paths = (items: { path: string }[]) =>
    items.map((item) => item.path).sort().join("\n");
  return paths(maps) + "|" + paths(images);
}
