import path from "node:path";
import { resolveReference } from "./vendor/markdown-reference.js";
import type {
  CockpitArchive,
  Detail,
  ImageAsset,
  MapAsset,
  MusicTrack,
} from "./ports.js";
import type { BoardModule, ResolvedContent } from "../../../shared/src/cockpit-types.js";
import type { Resolver } from "./view.js";

export type TrackCache = Map<string, MusicTrack>;

export function plainSummary(markdown: string): string {
  const lines = markdown.split("\n");
  const candidates: string[] = [];
  let inFence = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !line || line.startsWith("#")) continue;
    if (/^\*\*(Dipende da:|Riferimenti:)\*\*/i.test(line)) continue;
    if (
      /^<!--|^\|/.test(line) ||
      /^[-*+]\s/.test(line) ||
      /^\d+\.\s/.test(line)
    ) {
      if (/^[-*+]\s/.test(line) || /^\d+\.\s/.test(line)) candidates.push(line);
      continue;
    }
    if (/^!\[[^\]]*\]\([^)]+\)$/.test(line)) continue;
    candidates.push(line.startsWith(">") ? line.replace(/^>\s?/, "") : line);
  }
  const tableRow = lines
    .filter((line) => line.trim().startsWith("|"))
    .filter((line) => !/^\s*\|\s*[-:| ]+\|?\s*$/.test(line))
    .slice(1, 2)[0]
    ?.split("|")
    .slice(1, -1)
    .map((cell) => cell.trim())
    .filter(Boolean)
    .join(" · ");
  const value = (
    candidates[0] ||
    tableRow ||
    "Consulta la fonte per i dettagli."
  )
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/<!--.*?-->/gs, "")
    .replace(/\*\*|__|~~|[*_`]/g, "")
    .replace(/^[-*+]\s*/, "")
    .replace(/\\([\\`*_{}[\]()#+.!|>-])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return value.length > 240 ? value.slice(0, 237).trimEnd() + "…" : value;
}

export function openingSummary(markdown: string): string {
  const opening = markdown
    .split("\n")
    .filter((line) => {
      const value = line.trim();
      return (
        value &&
        !/^\*\*(?:Dipende da|Riferimenti):\*\*/i.test(value) &&
        !/^!\[[^\]]*\]\([^)]+\)$/.test(value) &&
        !/^\[[^\]]+\]\(https?:\/\/[^)]+\)$/.test(value) &&
        !/^<!--/.test(value) &&
        !/^```/.test(value) &&
        !/^---+$/.test(value)
      );
    })
    .join("\n");
  return plainSummary(opening);
}

function section(doc: Detail, anchor: string) {
  const headingIndex = doc.headings.findIndex(
    (heading) => heading.id === anchor,
  );
  if (headingIndex < 0) return undefined;
  const heading = doc.headings[headingIndex]!;
  const lines = doc.raw.split("\n");
  const headingLine = lines[heading.line - 1] || "";
  const level = headingLine.match(/^#+/)?.[0].length || 6;
  let end = lines.length;
  for (let index = headingIndex + 1; index < doc.headings.length; index++) {
    const next = doc.headings[index]!;
    const nextLevel =
      (lines[next.line - 1] || "").match(/^#+/)?.[0].length || 6;
    if (nextLevel <= level) {
      end = next.line - 1;
      break;
    }
  }
  return { heading, body: lines.slice(heading.line, end).join("\n").trim() };
}

function imageFor(doc: Detail, body: string): string | undefined {
  if (doc.card) return `/api/file?path=${encodeURIComponent(doc.card)}`;
  for (const match of body.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    const ref = resolveReference(doc.path, match[1]!);
    if (ref && !ref.external)
      return `/api/file?path=${encodeURIComponent(ref.path)}`;
  }
  return undefined;
}

function statsFor(body: string) {
  const stats: { label: string; value: string }[] = [];
  for (const label of ["CA", "PF", "GS"]) {
    const match = body.match(
      new RegExp(`^\\s*\\*\\*${label}\\*\\*\\s*:?\\s*([^\\n|]+)`, "im"),
    );
    if (match?.[1]?.trim()) stats.push({ label, value: match[1].trim() });
  }
  return stats.length ? stats : undefined;
}

function docContent(
  module: BoardModule,
  doc: Detail | undefined,
): ResolvedContent {
  if (!doc)
    return {
      title:
        module.ref.type === "doc"
          ? path.basename(module.ref.path, ".md")
          : module.kind,
      missing: true,
    };
  const anchor = module.ref.type === "doc" ? module.ref.anchor : undefined;
  const selected = anchor ? section(doc, anchor) : undefined;
  if (anchor && !selected)
    return {
      title: doc.title,
      subtitle: doc.area || doc.category,
      source: { path: doc.path, anchor },
      missing: true,
    };
  const body = selected?.body || doc.raw;
  const content: ResolvedContent = {
    title: selected?.heading.title || doc.title,
    subtitle: [doc.area, doc.category].filter(Boolean).join(" · "),
    summary: anchor ? plainSummary(body) : openingSummary(body),
    source: { path: doc.path, ...(anchor ? { anchor } : {}) },
  };
  const image = imageFor(doc, body);
  if (image) content.image = image;
  if (module.kind === "enemy") {
    const stats = statsFor(body);
    if (stats) content.stats = stats;
  }
  return content;
}

export function createResolver(deps: {
  archive: Pick<CockpitArchive, "docs">;
  maps: () => MapAsset[];
  /** Archive images that are not MapAssets (server/images.ts). */
  images?: () => ImageAsset[];
  tracks: TrackCache;
}): Resolver {
  return (module) => {
    if (module.ref.type === "doc")
      return docContent(module, deps.archive.docs.get(module.ref.path));
    if (module.ref.type === "asset") {
      const ref = module.ref;
      const asset = deps.maps().find((item) => item.path === ref.path);
      if (asset)
        return { title: asset.title, subtitle: asset.area, image: asset.src };
      const image = deps.images?.().find((item) => item.path === ref.path);
      if (image)
        return {
          title: image.title,
          subtitle: [image.area, image.variant].filter(Boolean).join(" · "),
          image: "/api/file?path=" + encodeURIComponent(image.path),
        };
      return { title: path.basename(ref.path), missing: true };
    }
    if (module.ref.type === "track") {
      const track = deps.tracks.get(module.ref.trackId);
      return track
        ? {
            title: track.title,
            subtitle: track.area,
            summary: [track.scene, track.snippet || track.context]
              .filter(Boolean)
              .join(" · "),
          }
        : { title: module.ref.title || "Brano" };
    }
    if (module.ref.type === "image")
      return { title: path.parse(module.ref.path).name || "Immagine" };
    // A note is the DM's own text: shown once, whole, under a plain title.
    return { title: "Nota", summary: module.ref.text.trim() };
  };
}
