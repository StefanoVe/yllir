// Pure copy of the image search of the prototype (images.ts, searchImages and its word
// helpers). Scores an in-memory image index; no I/O.
import path from "node:path";
import type { ImageAsset } from "../ports.js";

/** Italian articles and prepositions: they never name a subject. */
const STOPWORDS = new Set(
  (
    "a ai agli al alla alle allo con che da dal dalla dallo dei degli del " +
    "della delle dello e fra gli il in la le lo nel nella nelle nello o per " +
    "sul sulla su tra un una uno di d mi ti ci si non the of"
  ).split(" "),
);
/** Words naming the kind of image: they only feed the kind bonus. */
const KIND_WORDS = new Set(
  "mappa mappe pianta piante carta carte veduta vedute battlemap battlemaps".split(
    " ",
  ),
);
/** Bonuses: kind of a map-like query, and the best related document. */
const KIND_BONUS = 2;
const DOC_BONUS = 6;

const extensionOf = (file: string) => path.posix.extname(file).toLowerCase();
const stemOf = (file: string) =>
  file.slice(0, file.length - extensionOf(file).length);
/** Stem without the "senza etichette" / "senza griglia" suffix: shared by variants. */
const baseStemOf = (file: string) =>
  stemOf(file).replace(/-senza-(etichette|griglia)$/, "");

/** Normalized words of a text: lowercase, no accents, letters and digits only. */
export function tokenize(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("it")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1);
}

/** A query word matches a word of the text, or a longer word that starts with it. */
function hasToken(words: Set<string>, token: string) {
  if (words.has(token)) return true;
  return token.length >= 5 && [...words].some((word) => word.startsWith(token));
}

/**
 * Scores images: subject words +3 in the file name, +2 in title, area, alt or
 * document titles; related documents (best first) add a bonus shrinking with
 * their position; map-like queries add a kind bonus.
 */
export function searchImages(
  index: ImageAsset[],
  query: string,
  relatedDocPaths: string[] = [],
): (ImageAsset & { score: number })[] {
  const words = tokenize(query).filter((word) => !STOPWORDS.has(word));
  const subjects = [...new Set(words.filter((word) => !KIND_WORDS.has(word)))];
  const mapQuery = words.some((word) => KIND_WORDS.has(word));
  if (!subjects.length && !mapQuery) return [];
  const scored: (ImageAsset & { score: number })[] = [];
  for (const image of index) {
    const stem = new Set(tokenize(path.posix.basename(stemOf(image.path))));
    const fields = new Set(
      tokenize([image.title, image.area, ...image.alt].join(" ")),
    );
    const docTitles = new Set(image.docs.flatMap((doc) => tokenize(doc.title)));
    let score = 0;
    for (const word of subjects) {
      if (hasToken(stem, word)) score += 3;
      if (hasToken(fields, word) || hasToken(docTitles, word)) score += 2;
    }
    // The image's own documents, and the document named after its folder.
    const folder = path.posix.dirname(path.posix.dirname(image.path));
    const folderDoc = `${folder}/${path.posix.basename(folder)}.md`;
    const positions = [...image.docs.map((doc) => doc.path), folderDoc]
      .map((docPath) => relatedDocPaths.indexOf(docPath))
      .filter((index) => index >= 0);
    // Related documents only rank images that already match the words.
    const kind =
      mapQuery && (image.kind === "map" || image.kind === "battlemap");
    if (score === 0 && !kind) continue;
    if (positions.length) {
      const best = Math.min(...positions);
      score += Math.ceil(DOC_BONUS * (1 - best / relatedDocPaths.length));
    }
    if (kind) score += KIND_BONUS;
    scored.push({ ...image, score });
  }
  return scored.sort(
    (a, b) => b.score - a.score || a.path.localeCompare(b.path, "it"),
  );
}
