import { test } from "node:test";
import assert from "node:assert/strict";
import { createAssetIndex } from "./asset-index.js";
import type { Detail, ImageAsset, MapAsset } from "./ports.js";

const map = (path: string): MapAsset => ({
  path,
  src: `/api/file?path=${encodeURIComponent(path)}`,
  title: path,
  area: "Shuren",
  category: "Mappa",
  format: "png",
});

const image = (path: string): ImageAsset => ({
  path,
  title: path,
  area: "Shuren",
  kind: "image",
  audience: "master",
  docs: [],
  alt: [],
});

const docs = (): Iterable<Detail> => [];

test("le mappe arrivano dopo il refresh e onChange parte una volta", async () => {
  let onChange = 0;
  const index = createAssetIndex({
    version: () => "1",
    docs,
    listMaps: async () => [map("a.png")],
    listImages: async () => [],
    onChange: () => onChange++,
  });
  assert.deepEqual(index.maps(), []);
  await index.ready();
  assert.deepEqual(
    index.maps().map((item) => item.path),
    ["a.png"],
  );
  assert.equal(onChange, 1);
});

test("un refresh che non trova nulla non chiama onChange", async () => {
  let onChange = 0;
  const index = createAssetIndex({
    version: () => "1",
    docs,
    listMaps: async () => [],
    listImages: async () => [],
    onChange: () => onChange++,
  });
  await index.ready();
  assert.equal(onChange, 0);
});

test("stessa versione: listMaps una sola volta e onChange invariato", async () => {
  let listMapsCalls = 0;
  let onChange = 0;
  const index = createAssetIndex({
    version: () => "1",
    docs,
    listMaps: async () => {
      listMapsCalls++;
      return [map("a.png")];
    },
    listImages: async () => [],
    onChange: () => onChange++,
  });
  await index.ready();
  index.maps();
  index.maps();
  await index.ready();
  assert.equal(listMapsCalls, 1);
  assert.equal(onChange, 1);
});

test("nuova versione con gli stessi percorsi non chiama onChange; percorsi nuovi sì", async () => {
  let version = "1";
  let extraImages: string[] = [];
  let onChange = 0;
  const index = createAssetIndex({
    version: () => version,
    docs,
    listMaps: async () => [map("a.png")],
    listImages: async () => extraImages.map(image),
    onChange: () => onChange++,
  });
  await index.ready();
  assert.equal(onChange, 1);

  version = "2";
  index.maps();
  await index.ready();
  assert.equal(onChange, 1);

  version = "3";
  extraImages = ["new.png"];
  index.images();
  await index.ready();
  assert.equal(onChange, 2);
  assert.deepEqual(
    index.images().map((item) => item.path),
    ["new.png"],
  );
});

test("listMaps che rifiuta: nessuna eccezione, mappe vuote, nessun onChange", async () => {
  let onChange = 0;
  const index = createAssetIndex({
    version: () => "1",
    docs,
    listMaps: async () => {
      throw new Error("disco non disponibile");
    },
    listImages: async () => [],
    onChange: () => onChange++,
  });
  await index.ready();
  assert.deepEqual(index.maps(), []);
  assert.equal(onChange, 0);
});
