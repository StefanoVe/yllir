import { fakeKindOf } from "./fake-ports.js";
const categories = { kindOf: fakeKindOf, folderFor: () => null, playersFolder: () => null };
import { test } from "node:test";
import { expect } from "./test-helpers/expect.js";
import { sessionOutline } from "./outline.js";
import type { Detail, MapAsset } from "./ports.js";

/** Builds a Detail with headings computed from the raw markdown (ids slugged simply). */
function doc(
  file: string,
  raw: string,
  title = file.split("/").pop()!.replace(/\.md$/, ""),
): Detail {
  const headings: Detail["headings"] = [];
  raw.split("\n").forEach((text, index) => {
    const match = text.match(/^#+ (.*)$/);
    if (!match) return;
    const id = match[1]!.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    headings.push({ id, title: match[1]!, line: index + 1 });
  });
  return {
    path: file,
    title,
    category: file.split("/")[0] ?? "",
    area: "",
    scope: "",
    master: false,
    raw,
    html: "",
    headings,
  };
}

/** Indexes documents by path, as the archive does. */
function mapOf(docs: Detail[]) {
  return new Map(docs.map((d) => [d.path, d]));
}

test("modalità cartella: scene nell'ordine dei link, dipendenze e contesto", () => {
  const session = doc(
    "Players/Aria/Sessione 0.md",
    [
      "# Sessione 0",
      "",
      "**Dipende da:** nessuna, vedi [Sessione 1](../../Plot/Sessione%201.md).",
      "",
      "Riferimenti: [Scheda](Aria.md) · [Luogo](../../World/Vestur/Shuren/Shuren.md).",
      "",
      "- [Secondo](Sessione%200/Secondo.md)",
      "- [Primo](Sessione%200/Primo.md)",
    ].join("\n"),
  );
  const primo = doc(
    "Players/Aria/Sessione 0/Primo.md",
    [
      "# Primo",
      "**Dipende da:** [Secondo](Secondo.md), all'inizio.",
      "Un nemico: [Neris](../../../Enemies/Grafreitur/Neris.md), e la [scheda](../Aria.md).",
      "Vedi [Secondo](Secondo.md) e [Sessione](../Sessione%200.md).",
      "",
      "```",
      "[Finto](../../../NPCs/Finto.md)",
      "```",
    ].join("\n"),
  );
  const secondo = doc(
    "Players/Aria/Sessione 0/Secondo.md",
    "# Secondo\n\nFine con [Neris](../../../Enemies/Grafreitur/Neris.md#colpo).\n",
  );
  const terzo = doc("Players/Aria/Sessione 0/Terzo.md", "# Terzo\n");
  const aria = doc("Players/Aria/Aria.md", "# Aria\n", "Scheda di Aria");
  const shuren = doc("World/Vestur/Shuren/Shuren.md", "# Shuren\n", "Shuren");
  const neris = doc("Enemies/Grafreitur/Neris.md", "# Neris\n", "Neris Veld");
  const plot = doc("Plot/Sessione 1.md", "# Sessione 1\n", "Sessione 1");
  const finto = doc("NPCs/Finto.md", "# Finto\n", "Finto");
  const docs = mapOf([
    session,
    primo,
    secondo,
    terzo,
    aria,
    shuren,
    neris,
    plot,
    finto,
  ]);

  const outline = sessionOutline(docs, [], session.path, categories);

  expect(outline.scenes.map((s) => s.path)).toEqual([
    "Players/Aria/Sessione 0/Secondo.md",
    "Players/Aria/Sessione 0/Primo.md",
    "Players/Aria/Sessione 0/Terzo.md",
  ]);
  expect(outline.scenes[0]!.title).toBe("Secondo");
  expect(outline.scenes[0]!.anchor).toBeUndefined();
  // Primo's dependency line makes Secondo the prerequisite; its plain link back (1→0) is a backward edge and is dropped.
  expect(outline.edges).toEqual([{ from: 0, to: 1 }]);
  // The first occurrence of Neris keeps its anchor.
  expect(outline.scenes[0]!.refs).toEqual([
    {
      kind: "enemy",
      path: "Enemies/Grafreitur/Neris.md",
      anchor: "colpo",
      title: "Neris Veld",
    },
  ]);
  // Dependency links are not refs; the session doc and the other scenes are excluded.
  // Links inside code fences (DM notes) count as refs.
  expect(outline.scenes[1]!.refs.map((r) => r.path)).toEqual([
    "Enemies/Grafreitur/Neris.md",
    "Players/Aria/Aria.md",
    "NPCs/Finto.md",
  ]);
  expect(outline.scenes.map((s) => s.sections)).toEqual([[], [], []]);
  expect(outline.context.map((r) => [r.kind, r.path])).toEqual([
    ["pc", "Players/Aria/Aria.md"],
    ["location", "World/Vestur/Shuren/Shuren.md"],
  ]);
});

test("modalità cartella: senza dipendenze le scene si concatenano in ordine", () => {
  const session = doc(
    "Plot/Notte/Sessione.md",
    "# Sessione\n[A](Sessione/Uno.md)\n[B](Sessione/Due.md)\n",
  );
  const uno = doc("Plot/Notte/Sessione/Uno.md", "# Uno\n");
  const due = doc("Plot/Notte/Sessione/Due.md", "# Due\n");
  const outline = sessionOutline(mapOf([session, uno, due]), [], session.path, categories);
  expect(outline.scenes.map((s) => s.title)).toEqual(["Uno", "Due"]);
  expect(outline.edges).toEqual([{ from: 0, to: 1 }]);
});

test("modalità intestazioni: sezioni `#`, dipendenze tra ancore, contesto e asset", () => {
  const raw = [
    "# Sessione 1",
    "",
    "Riferimenti: [Shuren](../World/Vestur/Shuren/Shuren.md).",
    "",
    "# Arrivo",
    "",
    "Si arriva da [Lucevena](../World/Austur/Lucevena.md). ![Mappa del porto](img/porto.png)",
    "",
    "## Dettaglio",
    "",
    "Il cancello. [Guardia](../NPCs/Guardia.md)",
    "",
    "# Scontro",
    "",
    "**Dipende da:** [Arrivo](#arrivo), sempre.",
    "",
    "Un mostro: [Ombra](../Enemies/Ombra.md). ![Battaglia](img/battaglia.png)",
    "![Caverna](img/caverna.png)",
    "Vedi anche [Arrivo](#arrivo).",
  ].join("\n");
  const session = doc("Plot/Sessione 1.md", raw, "Sessione 1");
  const base: MapAsset = {
    path: "",
    src: "",
    title: "",
    area: "",
    category: "Mappa",
    format: "png",
  };
  const porto = { ...base, path: "Plot/img/porto.png", title: "Porto" };
  const battaglia = {
    ...base,
    path: "Plot/img/battaglia.png",
    title: "Battaglia",
    category: "Battlemap" as const,
  };
  const relitto = {
    ...base,
    path: "Plot/img/relitto.png",
    title: "Relitto",
    category: "Battlemap" as const,
  };
  const docs = mapOf([
    session,
    doc("World/Vestur/Shuren/Shuren.md", "# Shuren\n", "Shuren"),
    doc("NPCs/Guardia.md", "# Guardia\n", "Guardia"),
    doc("Enemies/Ombra.md", "# Ombra\n", "Ombra"),
  ]);

  const outline = sessionOutline(
    docs,
    [porto, battaglia, relitto],
    session.path, categories);

  expect(outline.scenes.map((s) => [s.title, s.anchor])).toEqual([
    ["Arrivo", "arrivo"],
    ["Scontro", "scontro"],
  ]);
  // The sub-section Dettaglio belongs to Arrivo.
  expect(outline.scenes[0]!.refs.map((r) => [r.kind, r.path])).toEqual([
    ["npc", "NPCs/Guardia.md"],
  ]);
  expect(outline.scenes[0]!.sections).toEqual([
    { anchor: "dettaglio", title: "Dettaglio" },
  ]);
  expect(outline.scenes[1]!.sections).toEqual([]);
  expect(outline.scenes[1]!.refs.map((r) => [r.kind, r.path])).toEqual([
    ["enemy", "Enemies/Ombra.md"],
  ]);
  expect(outline.scenes[0]!.assets).toEqual([
    { kind: "map", path: "Plot/img/porto.png", title: "Mappa del porto" },
  ]);
  expect(outline.scenes[1]!.assets).toEqual([
    { kind: "battlemap", path: "Plot/img/battaglia.png", title: "Battaglia" },
    { kind: "image", path: "Plot/img/caverna.png", title: "Caverna" },
  ]);
  // Dipende da gives 0→1; the plain "Vedi anche" link (1→0) is a backward edge and is dropped.
  expect(outline.edges).toEqual([{ from: 0, to: 1 }]);
  expect(outline.context.map((r) => [r.kind, r.path])).toEqual([
    ["location", "World/Vestur/Shuren/Shuren.md"],
  ]);
  expect(outline.looseAssets).toEqual([
    { kind: "battlemap", path: "Plot/img/relitto.png", title: "Relitto" },
  ]);
});

test("modalità intestazioni: il documento intero è una scena se non ci sono sezioni", () => {
  const session = doc(
    "Lore/Nota.md",
    "Solo testo con [Cosmo](Cosmo.md).\n",
    "Nota",
  );
  const docs = mapOf([session, doc("Lore/Cosmo.md", "# Cosmo\n", "Cosmo")]);
  const outline = sessionOutline(docs, [], session.path, categories);
  expect(outline.scenes).toEqual([
    {
      path: "Lore/Nota.md",
      title: "Nota",
      refs: [{ kind: "lore", path: "Lore/Cosmo.md", title: "Cosmo" }],
      assets: [],
      sections: [],
    },
  ]);
  expect(outline.context).toEqual([]);
  expect(outline.edges).toEqual([]);
});

test("documento mancante: errore in italiano", () => {
  expect(() => sessionOutline(new Map(), [], "Plot/Assente.md", categories)).toThrow(
    "Documento non trovato: Plot/Assente.md",
  );
});
