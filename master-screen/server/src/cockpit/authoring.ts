/**
 * Sheets written at the table. A new sheet goes through the campaign's own save process:
 * the draft is written under `.campaign/drafts/`, then `engine.mjs check --files <path>` and
 * `engine.mjs commit --files <path> --message <text>`. The engine links the mentions of existing
 * sheets and keeps the version, so the sheet shows in "what changed" and can be undone there.
 * The cockpit only rewrites sheets it created in the same cockpit session.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CockpitCategories, Detail } from "./ports.js";
import type { CockpitFramework } from "./framework.js";

export const SHEET_KINDS = ["npc", "enemy", "item", "location"] as const;
export type SheetKind = (typeof SHEET_KINDS)[number];

/** Metadata block the engine expects in every document (see authoring.md, section 4). */
const METADATA: Record<SheetKind, { kind: string; template?: string }> = {
  npc: { kind: "character", template: "npc" },
  enemy: { kind: "creature", template: "enemy" },
  item: { kind: "item", template: "item" },
  location: { kind: "place" },
};

const MAX_BODY = 20000;
/** Folders of an area that never hold sheets. */
const NOT_AREAS = new Set(["img", "Master"]);

export interface SheetDeps {
  /** Campaign folder. */
  root: string;
  categories: CockpitCategories;
  framework: CockpitFramework;
  docs(): Map<string, Detail>;
  /** Campaign language (campaign.yaml `language.main`), used for the commit message. */
  language: string;
  /** Re-indexes the archive so the new file is readable right away. */
  refresh(): Promise<void>;
  /** Sheets created by this cockpit session. */
  created(): Promise<{ path: string; title: string }[]>;
  /** Records a sheet created by this cockpit session. */
  remember(sheet: { path: string; title: string }): Promise<void>;
}

export interface WrittenSheet {
  path: string;
  title: string;
}

const folded = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("it")
    .replace(/[^a-z0-9]/g, "");

/** Existing areas of a folder: every folder between it and a document. */
export function areasOf(docs: Map<string, Detail>, folder: string): string[] {
  const root = folder + "/";
  const areas = new Set<string>();
  for (const file of docs.keys()) {
    if (!file.startsWith(root)) continue;
    const parts = file.slice(root.length).split("/").slice(0, -1);
    if (!parts.length || parts.some((part) => NOT_AREAS.has(part))) continue;
    for (let depth = 1; depth <= parts.length; depth++)
      areas.add(parts.slice(0, depth).join("/"));
  }
  return [...areas].sort((a, b) => a.localeCompare(b, "it"));
}

function checkTitle(title: string) {
  const value = title.trim();
  if (!value || value.length > 120)
    throw new Error("Il titolo deve avere da 1 a 120 caratteri");
  if (/[\\/:*?"<>|#\n]/.test(value) || value.startsWith("."))
    throw new Error(
      'Il titolo non può contenere / \\ : * ? " < > | # né iniziare con un punto',
    );
  return value;
}

function checkBody(body: string) {
  const value = body.trim();
  if (!value) throw new Error("La scheda non può essere vuota");
  if (value.length > MAX_BODY)
    throw new Error(`La scheda supera ${MAX_BODY} caratteri`);
  if (/^# /m.test(value))
    throw new Error(
      "Non scrivere il titolo # nel testo: lo aggiunge il cockpit. Usa ## per le sezioni.",
    );
  if (/<!--\s*yllir/.test(value))
    throw new Error("Non scrivere il blocco dei metadati: lo aggiunge il cockpit.");
  return value;
}

/** Plain ASCII id from a title, e.g. "Ilde Varno" → "ilde-varno". */
function idOf(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `scheda-${Date.now()}`;
}

const MESSAGES = {
  it: { created: (t: string) => `Scheda creata al tavolo: ${t}.`, updated: (t: string) => `Scheda aggiornata al tavolo: ${t}.` },
  en: { created: (t: string) => `Sheet created at the table: ${t}.`, updated: (t: string) => `Sheet updated at the table: ${t}.` },
} as const;

function messagesFor(language: string) {
  return language === "it" ? MESSAGES.it : MESSAGES.en;
}

/** The plain message of a failed engine call: its errors, or a fixed sentence. */
export function engineProblem(json: unknown): string {
  const errors = (json as { errors?: { message?: unknown }[] } | null)?.errors;
  const messages = Array.isArray(errors)
    ? errors.map((item) => (typeof item?.message === "string" ? item.message : "")).filter(Boolean)
    : [];
  return messages.length
    ? messages.join("; ")
    : "Non sono riuscito a salvare la scheda. Non è stato perso nulla: possiamo riprovare.";
}

/** The plain message of a review that did not approve: the reviewer's objections, or a fixed sentence. */
export function reviewProblem(language: string, objections: string[]): string {
  const it = language === "it";
  if (objections.length === 0)
    return it
      ? "La scheda non è stata salvata: la revisione non è disponibile da questo tavolo."
      : "The sheet was not saved: the review is not available from this table.";
  const head = it ? "La scheda non è stata salvata. La revisione ha trovato:" : "The sheet was not saved. The review found:";
  return `${head} ${objections.join(" ")}`;
}

/**
 * Writes the draft, runs check and commit on it, and refreshes the archive.
 * Throws the engine's plain message when the batch is refused.
 */
async function save(deps: SheetDeps, rel: string, message: string, intent: string) {
  const draft = path.join(deps.root, ".campaign", "drafts", rel);
  await mkdir(path.dirname(draft), { recursive: true });
  const pending = await readFile(draft, "utf8").catch(() => "");
  if (pending === "") throw new Error("La bozza della scheda è vuota");
  const check = await deps.framework.engine(["check", "--files", rel]);
  if (check.code !== 0) throw new Error(engineProblem(check.json));
  const checked = check.json as { reviewRequired?: boolean; finalFiles?: string[] } | null;
  if (checked?.reviewRequired) {
    // A batch that adds facts to the canon is saved only on the reviewer's APPLY.
    const verdict = deps.framework.review
      ? await deps.framework.review({ drafts: [rel], finalFiles: checked.finalFiles ?? [rel], intent })
      : { approved: false, objections: [] };
    if (!verdict.approved) throw new Error(reviewProblem(deps.language, verdict.objections));
  }
  const commit = await deps.framework.engine(["commit", "--files", rel, "--message", message]);
  if (commit.code !== 0) throw new Error(engineProblem(commit.json));
  await deps.refresh();
}

/** Writes a new sheet at the table. Fails on unknown areas and on subjects that already have a sheet. */
export async function createSheet(
  deps: SheetDeps,
  input: { kind: SheetKind; area?: string; title: string; body: string },
): Promise<WrittenSheet> {
  const title = checkTitle(input.title);
  const body = checkBody(input.body);
  const folder = deps.categories.folderFor(input.kind);
  if (!folder) throw new Error("Questo campo non ha una cartella per le schede di questo tipo");
  const all = deps.docs();
  const area = (input.area || "").trim().replace(/^\/+|\/+$/g, "");
  const areas = areasOf(all, folder);
  if (input.kind === "location" ? !areas.includes(area) : area && !areas.includes(area))
    throw new Error(
      `Area inesistente in ${folder}/: «${area}». Aree disponibili: ${areas.join(", ")}`,
    );
  const rel = [folder, area, `${title}.md`].filter(Boolean).join("/");
  refuseExternal(deps, rel);
  const same = [...all.values()].find(
    (doc) => doc.path === rel || (doc.master === false && folded(doc.title) === folded(title)),
  );
  if (same)
    throw new Error(
      `Esiste già una scheda «${same.title}»: ${same.path}. Mostrala con board_place invece di crearne un'altra.`,
    );
  const meta = METADATA[input.kind];
  const header = [
    "<!-- yllir",
    `id: ${idOf(title)}`,
    `kind: ${meta.kind}`,
    ...(meta.template ? [`template: ${meta.template}`] : []),
    "provenance: generated",
    "location: []",
    "-->",
  ].join("\n");
  const text = `${header}\n\n# ${title}\n\n${body}\n`;
  await writeDraft(deps.root, rel, text);
  await save(deps, rel, messagesFor(deps.language).created(title), `Create the ${input.kind} sheet "${title}" at the table`);
  await deps.remember({ path: rel, title });
  return { path: rel, title };
}

/** Rewrites the body of a sheet this cockpit session created. The metadata and the title stay. */
export async function updateSheet(
  deps: SheetDeps,
  input: { path: string; body: string },
): Promise<WrittenSheet> {
  const body = checkBody(input.body);
  refuseExternal(deps, input.path);
  const created = (await deps.created()).find((sheet) => sheet.path === input.path);
  if (!created)
    throw new Error(
      "Puoi riscrivere solo le schede create in questa sessione: le altre sono in sola lettura.",
    );
  const current = await readFile(path.join(deps.root, input.path), "utf8");
  const titleAt = current.search(/^# .+$/m);
  if (titleAt < 0) throw new Error("La scheda non ha un titolo: non la posso riscrivere");
  const head = current.slice(0, titleAt);
  const text = `${head}# ${created.title}\n\n${body}\n`;
  await writeDraft(deps.root, input.path, text);
  await save(deps, input.path, messagesFor(deps.language).updated(created.title), `Rewrite the body of the sheet "${created.title}" created at the table`);
  return { path: input.path, title: created.title };
}

/** A document of an external category belongs to the shared world: nothing writes it. */
function refuseExternal(deps: SheetDeps, rel: string) {
  if (deps.categories.isExternal?.(rel))
    throw new Error("Il documento appartiene al mondo condiviso ed è in sola lettura");
}

async function writeDraft(root: string, rel: string, text: string) {
  const draft = path.join(root, ".campaign", "drafts", rel);
  await mkdir(path.dirname(draft), { recursive: true });
  await writeFile(draft, text, { encoding: "utf8", flag: "w" });
}
