import { test } from "node:test";
import { expect } from "./test-helpers/expect.js";
import { createResolver } from "./resolvers.js";
import type { BoardModule } from "../../../shared/src/cockpit-types.js";
import type { Detail, MapAsset } from "./ports.js";
import type { MusicTrack } from "./ports.js";

function doc(path: string, raw: string, extra: Partial<Detail> = {}): Detail {
  return {
    path,
    title: path.split("/").at(-1)!.replace(".md", ""),
    category: path.split("/")[0]!,
    area: "Shuren",
    scope: "Campagna",
    master: false,
    raw,
    html: "",
    headings: [
      { id: "intro", title: "Introduzione", line: 1 },
      { id: "scena", title: "Scena", line: 8 },
      { id: "dopo", title: "Dopo", line: 14 },
    ],
    ...extra,
  };
}
const module = (
  kind: BoardModule["kind"],
  ref: BoardModule["ref"],
): BoardModule => ({
  id: "m",
  kind,
  ref,
  pinned: false,
  reason: "r",
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  addedBy: "agent",
  addedAt: "",
  updatedAt: "",
});
test("risolve documento, sezione, ancora assente e carta item", () => {
  const document = doc(
    "Enemies/Shuren/Custode.md",
    "# Custode\nPrima descrizione.\n\n**CA** 15\n**PF** 27\n**GS** 2\n\n## Scena\nQui combatte.\n\n### Dettaglio\nCorpo annidato.\n\n## Dopo\nNon incluso.",
    { card: "Items/Shuren/img/carta-thumbnail.png" },
  );
  const item = {
    ...document,
    path: "Items/Shuren/Lettera.md",
    category: "Items",
    card: "Items/Shuren/img/lettera-thumbnail.png",
  };
  const resolver = createResolver({
    archive: {
      docs: new Map([
        [document.path, document],
        [item.path, item],
      ]),
    },
    maps: () => [],
    tracks: new Map(),
  });
  expect(
    resolver(module("enemy", { type: "doc", path: document.path })),
  ).toMatchObject({
    title: "Custode",
    subtitle: "Shuren · Enemies",
    summary: "Prima descrizione.",
    image: "/api/file?path=Items%2FShuren%2Fimg%2Fcarta-thumbnail.png",
    stats: [
      { label: "CA", value: "15" },
      { label: "PF", value: "27" },
      { label: "GS", value: "2" },
    ],
  });
  expect(
    resolver(
      module("enemy", { type: "doc", path: document.path, anchor: "scena" }),
    ).summary,
  ).toContain("Qui combatte");
  expect(
    resolver(
      module("enemy", {
        type: "doc",
        path: document.path,
        anchor: "inesistente",
      }),
    ).missing,
  ).toBe(true);
  expect(
    resolver(module("item", { type: "doc", path: item.path })).image,
  ).toContain("lettera-thumbnail.png");
});
test("risolve asset, traccia presente/assente e nota", () => {
  const map: MapAsset = {
    path: "World/Shuren/img/mappa.png",
    src: "/api/file?path=World%2FShuren%2Fimg%2Fmappa.png",
    title: "Mappa di Shuren",
    area: "Vestur / Shuren",
    category: "Mappa",
    format: "PNG",
  };
  const track: MusicTrack = {
    id: "track-1",
    title: "Pioggia",
    scene: "Notte",
    path: "Items/Shuren/Lettera.md",
    line: 4,
    area: "Shuren",
    provider: "fake",
    context: "Musica lenta",
    snippet: "piano",
  };
  const resolver = createResolver({
    archive: { docs: new Map() },
    maps: () => [map],
    tracks: new Map([[track.id, track]]),
  });
  expect(
    resolver(module("map", { type: "asset", path: map.path })),
  ).toMatchObject({ title: map.title, subtitle: map.area, image: map.src });
  expect(
    resolver(module("music", { type: "track", trackId: track.id })),
  ).toMatchObject({ title: "Pioggia", summary: "Notte · piano" });
  expect(
    resolver(module("music", { type: "track", trackId: "unknown" })),
  ).toEqual({ title: "Brano" });
  // Not in the cache (e.g. after a restart): the title saved on the card.
  expect(
    resolver(
      module("music", { type: "track", trackId: "gone", title: "BGM Deserto" }),
    ),
  ).toEqual({ title: "BGM Deserto" });
  expect(
    resolver(
      module("note", {
        type: "note",
        text: "Titolo\nSeconda riga descrittiva",
      }),
    ),
  ).toEqual({
    title: "Nota",
    summary: "Titolo\nSeconda riga descrittiva",
  });
});
