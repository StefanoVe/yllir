// Every image of the campaign (png, jpg, jpeg, webp), with the documents that embed or link it,
// its alt texts, its kind (map, battlemap, card or plain image) and its audience. An image is
// for players when a document that is not master-only shows it and it is not in a Master folder.
// Owner: cockpit host.
import path from 'node:path';
import type { Detail, ImageAsset, MapAsset } from '../cockpit/ports.js';
import { areaOf, comparePaths, labelOf, listRasterImages, SKILL_MAP, stemOf, THUMBNAIL, VARIANT, type FolderOf } from './files.js';
import { referencesOf } from './refs.js';

const MAX_DOCS = 6;
const MAX_ALTS = 4;

export async function listImageAssets(
  root: string,
  documents: Iterable<Detail>,
  maps: MapAsset[],
  folderOf: FolderOf,
): Promise<ImageAsset[]> {
  const references = referencesOf(documents);
  const files = await listRasterImages(root);
  const stems = new Set(files.map((file) => stemOf(file.rel)));
  const mapByPath = new Map(maps.map((map) => [map.path, map]));

  return files
    .map((file): ImageAsset => {
      const stem = stemOf(file.rel);
      const name = path.posix.basename(stem);
      const variantWord = VARIANT.exec(name)?.[1];
      const isSkillGridTwin = SKILL_MAP.test(name) && !/-grid$/i.test(name) && stems.has(`${stem}-grid`);
      const variant = variantWord ? `senza ${variantWord}` : isSkillGridTwin ? 'senza griglia' : undefined;
      const map = mapByPath.get(file.rel);
      const kind: ImageAsset['kind'] = THUMBNAIL.test(name)
        ? 'card'
        : map === undefined
          ? 'image'
          : map.category === 'Battlemap'
            ? 'battlemap'
            : 'map';
      const label = map?.title ?? labelOf(name);
      const title =
        variant !== undefined && !label.toLocaleLowerCase('it').includes('senza')
          ? `${label} · ${variant.charAt(0).toLocaleUpperCase('it')}${variant.slice(1)}`
          : label;
      const reference = references.get(file.rel);
      const audience: ImageAsset['audience'] =
        reference?.shownToPlayers === true && !file.rel.split('/').includes('Master') ? 'players' : 'master';
      return {
        path: file.rel,
        title,
        area: areaOf(file.rel, folderOf(file.rel)),
        kind,
        audience,
        ...(variant !== undefined ? { variant } : {}),
        docs: [...(reference?.docs ?? [])]
          .slice(0, MAX_DOCS)
          .map(([docPath, docTitle]) => ({ path: docPath, title: docTitle })),
        alt: (reference?.alts ?? []).slice(0, MAX_ALTS),
      };
    })
    .sort((a, b) => comparePaths(a.path, b.path));
}
