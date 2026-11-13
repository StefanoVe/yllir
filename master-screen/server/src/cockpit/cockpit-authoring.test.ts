import { afterEach, test } from "node:test";
import { expect } from "./test-helpers/expect.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSheet, updateSheet, type SheetDeps } from "./authoring.js";
import { createFakeFramework, type FakeFramework } from "./test-helpers/fake-framework.js";
import { fakeKindOf } from "./fake-ports.js";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

function deps(fake: FakeFramework): SheetDeps {
  const created: { path: string; title: string }[] = [];
  return {
    root,
    categories: {
      kindOf: fakeKindOf,
      folderFor: (kind) => ({ npc: "NPCs", enemy: "Enemies", item: "Items", location: "World" })[kind],
      playersFolder: () => "Players",
    },
    framework: fake.framework,
    docs: () => new Map(),
    language: "it",
    refresh: async () => {},
    created: async () => created,
    remember: async (sheet) => {
      created.push(sheet);
    },
  };
}

test("a sheet goes through check and commit; a refused check answers with the engine's own message", async () => {
  root = await mkdtemp(path.join(tmpdir(), "cockpit-authoring-"));
  const fake = createFakeFramework();
  fake.engine = (args) =>
    args[0] === "check"
      ? { code: 1, json: { ok: false, errors: [{ file: "NPCs/Ada.md", code: "duplicate-id", message: "l'id ada è già usato" }] } }
      : { code: 0, json: { ok: true } };
  await expect(createSheet(deps(fake), { kind: "npc", title: "Ada", body: "Una guardia." })).rejects.toThrow(
    "l'id ada è già usato",
  );
  expect(fake.engineCalls).toEqual([["check", "--files", "NPCs/Ada.md"]]);
});

test("a batch that adds facts needs the model review; without a reviewer the sheet is not saved", async () => {
  root = await mkdtemp(path.join(tmpdir(), "cockpit-authoring-"));
  const fake = createFakeFramework();
  fake.engine = () => ({ code: 0, json: { ok: true, reviewRequired: true, finalFiles: ["Enemies/Custode.md"] } });
  await expect(
    createSheet(deps(fake), { kind: "enemy", title: "Custode", body: "Un guardiano." }),
  ).rejects.toThrow("revisione");
  expect(fake.engineCalls.map((call) => call[0])).toEqual(["check"]);
});

test("sheet_update rewrites only the sheets this session created, keeping the metadata block", async () => {
  root = await mkdtemp(path.join(tmpdir(), "cockpit-authoring-"));
  const fake = createFakeFramework({ withReview: true, reviewApproves: true });
  fake.engine = () => ({ code: 0, json: { ok: true, reviewRequired: true, finalFiles: [] } });
  const sheetDeps = deps(fake);
  await expect(updateSheet(sheetDeps, { path: "NPCs/Ada.md", body: "x" })).rejects.toThrow("Puoi riscrivere solo");
  const created = await createSheet(sheetDeps, { kind: "npc", title: "Ada", body: "Una guardia." });
  expect(created.path).toBe("NPCs/Ada.md");
  expect(fake.engineCalls.map((call) => call[0])).toEqual(["check", "review", "commit"]);
});

test("an external category is read-only: sheet_update and sheet_create refuse its documents", async () => {
  root = await mkdtemp(path.join(tmpdir(), "cockpit-authoring-"));
  const fake = createFakeFramework();
  const base = deps(fake);
  const sheetDeps: SheetDeps = {
    ...base,
    categories: { ...base.categories, isExternal: (rel) => rel.startsWith("shared/") },
    created: async () => [{ path: "shared/Luoghi/Raatnagar.md", title: "Raatnagar" }],
  };
  await expect(updateSheet(sheetDeps, { path: "shared/Luoghi/Raatnagar.md", body: "x" })).rejects.toThrow(
    "Il documento appartiene al mondo condiviso ed è in sola lettura",
  );
  expect(fake.engineCalls).toEqual([]);
});
