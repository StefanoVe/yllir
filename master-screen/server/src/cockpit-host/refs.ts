// Image references of the campaign documents: which raster images a document embeds or
// links, and with which alt text. Shared by the map and image indexes. Owner: cockpit host.
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import type { Detail } from '../cockpit/ports.js';
import { resolveRef } from '../docs/markdown.js';
import { RASTER_EXTENSIONS } from './files.js';

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
type Token = ReturnType<typeof md.parse>[number];

export interface ImageRef {
  /** Campaign-relative path of the image. */
  path: string;
  alt: string;
}

/** What the documents say about one image. */
export interface ImageReference {
  /** Documents that embed or link it, by path, with their titles. */
  docs: Map<string, string>;
  /** Distinct alt texts used when embedding it. */
  alts: string[];
  /** A document that is not master-only embeds or links it. */
  shownToPlayers: boolean;
}

/** The raster images a document embeds (image) or links (link), resolved to campaign paths. */
export function imageRefsOf(docRel: string, source: string): ImageRef[] {
  const out: ImageRef[] = [];
  for (const token of md.parse(source, {}) as Token[]) {
    if (token.type !== 'inline') continue;
    for (const child of token.children ?? []) {
      let attribute: string | number | null;
      let alt = '';
      if (child.type === 'image') {
        attribute = child.attrGet('src');
        alt = child.content.trim();
      } else if (child.type === 'link_open') {
        attribute = child.attrGet('href');
      } else {
        continue;
      }
      if (attribute === null) continue;
      const ref = resolveRef(String(attribute), docRel);
      if (ref?.kind !== 'file') continue;
      if (!RASTER_EXTENSIONS.has(path.posix.extname(ref.rel).toLowerCase())) continue;
      out.push({ path: ref.rel, alt });
    }
  }
  return out;
}

/** The references of every document, grouped by image path. */
export function referencesOf(documents: Iterable<Detail>): Map<string, ImageReference> {
  const out = new Map<string, ImageReference>();
  for (const doc of documents) {
    for (const ref of imageRefsOf(doc.path, doc.raw)) {
      const entry = out.get(ref.path) ?? { docs: new Map<string, string>(), alts: [], shownToPlayers: false };
      entry.docs.set(doc.path, doc.title);
      if (ref.alt !== '' && !entry.alts.includes(ref.alt)) entry.alts.push(ref.alt);
      if (!doc.master) entry.shownToPlayers = true;
      out.set(ref.path, entry);
    }
  }
  return out;
}
