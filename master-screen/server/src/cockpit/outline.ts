import { posix } from "node:path";
import { resolveReference } from "./vendor/markdown-reference.js";
import type { CockpitCategories, CockpitKind, Detail, Heading, MapAsset } from "./ports.js";
import type { ModuleKind } from "../../../shared/src/cockpit-types.js";

/** A document linked from a session, staged on the canvas as a card. */
export interface OutlineRef {
  kind: ModuleKind;
  path: string;
  anchor?: string;
  title: string;
}

/** A map, battlemap or embedded image attached to a session or scene. */
export interface OutlineAsset {
  kind: "map" | "battlemap" | "image";
  path: string;
  title: string;
}

/** A scene of a session: its own document or a heading section of the session. */
export interface OutlineScene {
  /** Scene document (or the session doc itself) and heading anchor when the scene is a heading. */
  path: string;
  anchor?: string;
  title: string;
  /** Distinct docs linked from the scene text (excluding other scenes and the session doc itself), in order of first appearance. */
  refs: OutlineRef[];
  /** Maps/battlemaps/images belonging to the scene: images embedded with ![..](..) in the scene text, plus MapAssets whose path is inside the scene doc's folder `img/` AND whose file name was referenced or embedded by the scene (if a scene doc embeds nothing, attach no folder assets to it). */
  assets: OutlineAsset[];
  /** Top-level headings inside the scene (events), capped at 12. */
  sections: OutlineSection[];
}

/** A sub-heading inside a scene, identified by its heading id. */
export interface OutlineSection {
  anchor: string;
  title: string;
}

/** A dependency between two scenes, given as indexes into `scenes`. */
export interface OutlineEdge {
  from: number;
  to: number;
  label?: string;
}

/** The full outline of a session, ready to be staged on the canvas. */
export interface SessionOutline {
  path: string;
  title: string;
  /** Docs linked from the session doc outside the scene list (e.g. "Riferimenti", PG sheet, places). */
  context: OutlineRef[];
  scenes: OutlineScene[];
  edges: OutlineEdge[];
  /** Assets in the session folder tree that no scene claimed (e.g. Sessione 0/img battlemaps). Only MapAssets (maps()) under the session's subfolder, or under the session doc's own folder img/ when there is no subfolder. */
  looseAssets: OutlineAsset[];
}

/** A link or image embed found in a document, with its resolved archive path. */
interface Link {
  line: number;
  path: string;
  anchor: string;
  image: boolean;
  alt: string;
  dependency: boolean;
}

/** A scene before its refs, assets and edges are computed. */
interface SceneDraft {
  path: string;
  anchor?: string;
  title: string;
  links: Link[];
  sections: OutlineSection[];
}

/** Maximum number of sub-headings listed for one scene. */
const MAX_SECTIONS = 12;

/** A heading section of a document, lines 1-based with `end` exclusive. */
interface Section {
  title: string;
  anchor?: string;
  start: number;
  end: number;
}

/** The scenes of a session together with the links that connect them. */
interface Layout {
  drafts: SceneDraft[];
  edges: OutlineEdge[];
  /** Links of the session doc that do not belong to a scene. */
  contextLinks: Link[];
  /** Folder whose MapAssets may be loose session assets. */
  assetPrefix: string;
}

const LINK_PATTERN = /(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const DEPENDENCY_PREFIX = "**Dipende da:**";
/** Module kind of a doc, from the campaign's categories; undefined for docs that are not linked as refs. */
const MODULE_KIND: Partial<Record<CockpitKind, ModuleKind>> = {
  npc: "npc",
  pc: "pc",
  enemy: "enemy",
  item: "item",
  location: "location",
  lore: "lore",
  plot: "plot",
  session: "plot",
};
function refKind(docPath: string, categories: CockpitCategories): ModuleKind | undefined {
  return MODULE_KIND[categories.kindOf(docPath)];
}

/** Returns the heading level of a 1-based line, 6 when the line is not a heading. */
function levelOf(lines: string[], line: number): number {
  return (lines[line - 1] ?? "").match(/^#+/)?.[0].length ?? 6;
}

/** Returns the internal links and image embeds of a document, including those inside code fences (DM notes). */
function linksOf(doc: Detail): Link[] {
  const links: Link[] = [];
  doc.raw.split("\n").forEach((text, index) => {
    const dependency = text.startsWith(DEPENDENCY_PREFIX);
    for (const [, bang, alt, href] of text.matchAll(LINK_PATTERN)) {
      const ref = resolveReference(doc.path, href!);
      if (!ref || ref.external) continue;
      links.push({
        line: index + 1,
        path: ref.path,
        anchor: ref.anchor,
        image: bang === "!",
        alt: alt ?? "",
        dependency,
      });
    }
  });
  return links;
}

/** Returns the scene documents of a session: direct `.md` children of the session's subfolder. */
function sceneDocsOf(docs: Map<string, Detail>, sessionPath: string): string[] {
  const folder = `${sessionPath.replace(/\.md$/, "")}/`;
  return [...docs.keys()]
    .filter((p) => {
      const rest = p.slice(folder.length);
      return p.startsWith(folder) && !rest.includes("/") && p.endsWith(".md");
    })
    .sort();
}

/** Orders scene docs by first link from the session, leaving unlinked ones alphabetically at the end. */
function orderScenes(sessionLinks: Link[], sceneDocs: string[]): string[] {
  const candidates = new Set(sceneDocs);
  const ordered: string[] = [];
  for (const link of sessionLinks) {
    if (candidates.has(link.path) && !ordered.includes(link.path))
      ordered.push(link.path);
  }
  return [...ordered, ...sceneDocs.filter((p) => !ordered.includes(p))];
}

/** Returns the `img/` folder next to a document. */
function imgFolderOf(docPath: string): string {
  const dir = posix.dirname(docPath);
  return dir === "." ? "img/" : `${dir}/img/`;
}

/** Returns the file name without its extension. */
function stemOf(filePath: string): string {
  return posix.basename(filePath, posix.extname(filePath));
}

/** Keeps the first item for each path. */
function uniqueByPath<T extends { path: string }>(items: T[]): T[] {
  const seen = new Map<string, T>();
  for (const item of items) if (!seen.has(item.path)) seen.set(item.path, item);
  return [...seen.values()];
}

/** Returns the doc refs of a list of links, deduplicated by path with the first occurrence winning. */
function refsOf(
  links: Link[],
  docs: Map<string, Detail>,
  excluded: Set<string>,
  categories: CockpitCategories,
): OutlineRef[] {
  const refs = new Map<string, OutlineRef>();
  for (const link of links) {
    if (link.image || link.dependency || excluded.has(link.path)) continue;
    if (refs.has(link.path)) continue;
    const doc = docs.get(link.path);
    const kind = refKind(link.path, categories);
    if (!doc || !kind) continue;
    refs.set(link.path, {
      kind,
      path: link.path,
      anchor: link.anchor || undefined,
      title: doc.title,
    });
  }
  return [...refs.values()];
}

/** Returns the asset kind for a MapAsset category. */
function assetFromMap(map: MapAsset): OutlineAsset {
  return {
    kind: map.category === "Battlemap" ? "battlemap" : "map",
    path: map.path,
    title: map.title,
  };
}

/** Returns the asset for an embedded image, using the MapAsset category when one exists. */
function embeddedAsset(
  link: Link,
  mapsByPath: Map<string, MapAsset>,
): OutlineAsset {
  const map = mapsByPath.get(link.path);
  return {
    kind: map ? assetFromMap(map).kind : "image",
    path: link.path,
    title: link.alt.trim() || stemOf(link.path),
  };
}

/** Returns the assets of a scene: its embedded images and the folder maps it references. */
function assetsOf(
  scenePath: string,
  links: Link[],
  maps: MapAsset[],
  mapsByPath: Map<string, MapAsset>,
): OutlineAsset[] {
  const embeds = links.filter((link) => link.image);
  if (embeds.length === 0) return [];
  const names = new Set(links.map((link) => posix.basename(link.path)));
  const folder = imgFolderOf(scenePath);
  const folderAssets = maps
    .filter(
      (map) =>
        map.path.startsWith(folder) && names.has(posix.basename(map.path)),
    )
    .map(assetFromMap);
  return uniqueByPath([
    ...embeds.map((link) => embeddedAsset(link, mapsByPath)),
    ...folderAssets,
  ]);
}

/** Builds the edges of a list of scenes, reversing dependency links so the prerequisite comes first. */
function collectEdges(
  drafts: SceneDraft[],
  targetOf: (link: Link) => number | undefined,
): OutlineEdge[] {
  const edges: OutlineEdge[] = [];
  drafts.forEach((draft, from) => {
    for (const link of draft.links) {
      const to = targetOf(link);
      if (to === undefined || to === from) continue;
      edges.push(link.dependency ? { from: to, to: from } : { from, to });
    }
  });
  return uniqueEdges(edges);
}

/** Drops a backward edge (j→i with j>i) when the forward edge i→j also exists. */
function dropBackwardEdges(edges: OutlineEdge[]): OutlineEdge[] {
  return edges.filter(
    (edge) =>
      !(
        edge.from > edge.to &&
        edges.some((o) => o.from === edge.to && o.to === edge.from)
      ),
  );
}

/** Returns the top-level headings inside a line range (the doc title excluded), capped. */
function subsectionsOf(
  doc: Detail,
  from: number,
  to: number,
): OutlineSection[] {
  const lines = doc.raw.split("\n");
  // Line 1 is the document title, not a section.
  const inside = doc.headings.filter(
    (h) => h.line > Math.max(from, 1) && h.line < to,
  );
  // Session documents use `#` for events, `##` for actions, `###` for checks: take the top level present.
  const top = Math.min(...inside.map((h) => levelOf(lines, h.line)));
  const chosen = inside.filter((h) => levelOf(lines, h.line) === top);
  return chosen
    .slice(0, MAX_SECTIONS)
    .map((h) => ({ anchor: h.id, title: h.title }));
}

/** Removes duplicate edges, keeping the first occurrence. */
function uniqueEdges(edges: OutlineEdge[]): OutlineEdge[] {
  const seen = new Map<string, OutlineEdge>();
  for (const edge of edges) {
    const key = `${edge.from}>${edge.to}`;
    if (!seen.has(key)) seen.set(key, edge);
  }
  return [...seen.values()];
}

/** Chains scenes 0→1→2… in order. */
function chainEdges(count: number): OutlineEdge[] {
  return Array.from({ length: Math.max(0, count - 1) }, (_, i) => ({
    from: i,
    to: i + 1,
  }));
}

/** Lays out a session whose scenes are the subfolder docs next to it. */
function subfolderLayout(
  docs: Map<string, Detail>,
  sessionPath: string,
  sceneDocs: string[],
  sessionLinks: Link[],
): Layout {
  const ordered = orderScenes(sessionLinks, sceneDocs);
  const drafts = ordered.map((p) => {
    const doc = docs.get(p)!;
    const end = doc.raw.split("\n").length + 1;
    return {
      path: p,
      title: doc.title,
      links: linksOf(doc),
      sections: subsectionsOf(doc, 0, end),
    };
  });
  const index = new Map(ordered.map((p, i) => [p, i]));
  const found = collectEdges(drafts, (link) => index.get(link.path));
  return {
    drafts,
    edges: found.length ? found : chainEdges(drafts.length),
    contextLinks: sessionLinks,
    assetPrefix: `${sessionPath.replace(/\.md$/, "")}/`,
  };
}

/** Returns the `#` headings that are scenes, or the `##` headings when there are fewer than two `#` scenes. */
function sceneHeadings(doc: Detail): Heading[] {
  const lines = doc.raw.split("\n");
  const top = doc.headings.filter(
    (h) => h.line !== 1 && levelOf(lines, h.line) === 1,
  );
  if (top.length >= 2) return top;
  const second = doc.headings.filter((h) => levelOf(lines, h.line) === 2);
  return second.length ? second : top;
}

/** Returns the sections of the chosen headings, each running to the next heading of same or higher level. */
function sectionsOf(doc: Detail, chosen: Heading[]): Section[] {
  const lines = doc.raw.split("\n");
  return chosen.map((heading) => {
    const level = levelOf(lines, heading.line);
    const next = doc.headings.find(
      (h) => h.line > heading.line && levelOf(lines, h.line) <= level,
    );
    return {
      title: heading.title,
      anchor: heading.id,
      start: heading.line,
      end: next?.line ?? lines.length + 1,
    };
  });
}

/** Lays out a session whose scenes are heading sections of the session doc itself. */
function sectionLayout(session: Detail, sessionLinks: Link[]): Layout {
  const chosen = sceneHeadings(session);
  const sections: Section[] = chosen.length
    ? sectionsOf(session, chosen)
    : [
        {
          title: session.title,
          start: 1,
          end: session.raw.split("\n").length + 1,
        },
      ];
  const drafts = sections.map((section) => ({
    path: session.path,
    anchor: section.anchor,
    title: section.title,
    links: sessionLinks.filter(
      (link) => link.line >= section.start && link.line < section.end,
    ),
    sections: subsectionsOf(session, section.start, section.end),
  }));
  const targetOf = (link: Link) => {
    if (link.path !== session.path || !link.anchor) return undefined;
    const index = sections.findIndex((s) => s.anchor === link.anchor);
    return index < 0 ? undefined : index;
  };
  const contextLinks = sessionLinks.filter(
    (link) => !sections.some((s) => link.line >= s.start && link.line < s.end),
  );
  return {
    drafts,
    edges: uniqueEdges([
      ...chainEdges(drafts.length),
      ...collectEdges(drafts, targetOf),
    ]),
    contextLinks,
    assetPrefix: imgFolderOf(session.path),
  };
}

/** Chooses the layout of a session: scene docs in its subfolder, or heading sections of the session doc. */
function layoutOf(
  docs: Map<string, Detail>,
  session: Detail,
  sessionLinks: Link[],
): Layout {
  const sceneDocs = sceneDocsOf(docs, session.path);
  return sceneDocs.length
    ? subfolderLayout(docs, session.path, sceneDocs, sessionLinks)
    : sectionLayout(session, sessionLinks);
}

/** Returns the outline of a session document: its scenes, the docs and assets they use, and how they depend on each other. */
export function sessionOutline(
  docs: Map<string, Detail>,
  maps: MapAsset[],
  path: string,
  categories: CockpitCategories,
): SessionOutline {
  const session = docs.get(path);
  if (!session) throw new Error(`Documento non trovato: ${path}`);
  const layout = layoutOf(docs, session, linksOf(session));
  const excluded = new Set([path, ...layout.drafts.map((d) => d.path)]);
  const mapsByPath = new Map(maps.map((map) => [map.path, map]));
  const scenes: OutlineScene[] = layout.drafts.map((draft) => ({
    path: draft.path,
    anchor: draft.anchor,
    title: draft.title,
    refs: refsOf(draft.links, docs, excluded, categories),
    assets: assetsOf(draft.path, draft.links, maps, mapsByPath),
    sections: draft.sections,
  }));
  const claimed = new Set(
    scenes.flatMap((scene) => scene.assets.map((asset) => asset.path)),
  );
  const looseAssets = maps
    .filter(
      (map) =>
        map.path.startsWith(layout.assetPrefix) && !claimed.has(map.path),
    )
    .map(assetFromMap);
  return {
    path,
    title: session.title,
    context: refsOf(layout.contextLinks, docs, excluded, categories),
    scenes,
    edges: dropBackwardEdges(layout.edges),
    looseAssets,
  };
}
