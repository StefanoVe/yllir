// Maps and battle maps of the campaign. An image is a map when its name or the alt text of a
// document that embeds it says map (mappa, pianta, carta, battlemap...), or when the images
// skill made it (a "<slug>-map" stem, its grid version "<slug>-map-grid" being the one shown;
// the "-map" file without grid is only a variant of it). Owner: cockpit host.
import path from 'node:path';
import type { Detail, MapAsset } from '../cockpit/ports.js';
import { areaOf, comparePaths, fileUrl, labelOf, listRasterImages, SKILL_GRID, SKILL_MAP, stemOf, THUMBNAIL, VARIANT, type FolderOf } from './files.js';
import { referencesOf } from './refs.js';

/** A map by name: mappa, pianta, carta, planimetria, veduta, itinerario, battlemap. */
const MAP_NAME = /(^|[-_ ])(battlemap|mappa|carta|pianta|planimetria|veduta|itinerario)([-_. ]|$)/i;
/** A map by the alt text of a document that embeds it. */
const MAP_ALT = /battlemap|tabletop|mappa|mappe|cartografia|planimetria|pianta|veduta|itinerario|battaglia/i;
/** A battle map by the alt text or the name. */
const BATTLE_ALT = /battlemap|tabletop|tattic|battaglia/i;
const BATTLE_NAME = /^battlemap-/i;
/** Preference between two files of the same stem: the first extension wins. */
const EXTENSION_ORDER = ['.png', '.webp', '.jpg', '.jpeg'];

export async function listMapAssets(
  root: string,
  documents: Iterable<Detail>,
  folderOf: FolderOf,
): Promise<MapAsset[]> {
  const references = referencesOf(documents);
  const files = await listRasterImages(root);
  const stems = new Set(files.map((file) => stemOf(file.rel)));
  const chosen = new Map<string, MapAsset>();
  const rank = (file: string) => {
    const index = EXTENSION_ORDER.indexOf(path.posix.extname(file).toLowerCase());
    return index < 0 ? EXTENSION_ORDER.length : index;
  };

  for (const file of files) {
    const stem = stemOf(file.rel);
    const name = path.posix.basename(stem);
    if (THUMBNAIL.test(name)) continue;
    const isSkillMap = SKILL_MAP.test(name);
    // The images skill writes "<slug>-map.png" without grid next to "<slug>-map-grid.png": the first is a variant.
    if (isSkillMap && !SKILL_GRID.test(name) && stems.has(`${stem}-grid`)) continue;
    const alt = references.get(file.rel)?.alts[0] ?? '';
    if (!isSkillMap && !MAP_NAME.test(name) && !MAP_ALT.test(alt)) continue;

    const variant = VARIANT.exec(name)?.[1];
    const base = !isSkillMap && !MAP_NAME.test(name) && alt !== '' ? alt : labelOf(name);
    const asset: MapAsset = {
      path: file.rel,
      src: fileUrl(file.rel),
      title: variant ? `${base} · Senza ${variant}` : base,
      area: areaOf(file.rel, folderOf(file.rel)),
      category: isSkillMap || BATTLE_ALT.test(alt) || BATTLE_NAME.test(name) ? 'Battlemap' : 'Mappa',
      format: path.posix.extname(file.rel).slice(1).toUpperCase(),
    };
    const previous = chosen.get(stem);
    if (previous === undefined || rank(file.rel) < rank(previous.path)) chosen.set(stem, asset);
  }
  return [...chosen.values()].sort((a, b) => comparePaths(a.path, b.path));
}
