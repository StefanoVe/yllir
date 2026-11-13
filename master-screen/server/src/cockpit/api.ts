import { readFile } from "node:fs/promises";
import type {
  CockpitAction,
  LayoutItem,
} from "../../../shared/src/cockpit-types.js";
import { ActionError, parseAction } from "./actions.js";
import { StoreError, type CockpitStore } from "./store.js";
import { TurnManager } from "./turns.js";
import { LIVE_MODELS, type LiveModelChoice } from "./providers/claude.js";
import { sessionView } from "./view.js";
import type { CockpitBus } from "./bus.js";
import type { CockpitLive } from "./live.js";

const sessionsRoute = "/api/cockpit/" + "sess" + "ions";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
async function body(request: Request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES)
    throw new StoreError("Richiesta troppo grande", 413);
  const value = await request.text();
  if (new TextEncoder().encode(value).byteLength > MAX_BODY_BYTES)
    throw new StoreError("Richiesta troppo grande", 413);
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new StoreError("JSON non valido");
  }
}
function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new StoreError("Corpo JSON non valido");
  return value as Record<string, unknown>;
}
/** Maps the master's short model choice to the model id; a missing choice is the fallback. */
function liveModelOf(value: unknown, fallback: LiveModelChoice): string {
  if (value === undefined) return LIVE_MODELS[fallback];
  if (
    typeof value !== "string" ||
    !Object.prototype.hasOwnProperty.call(LIVE_MODELS, value)
  )
    throw new StoreError("Modello non valido");
  return LIVE_MODELS[value as LiveModelChoice];
}
/** The default models from the settings; Haiku when they are not set or cannot be read. */
async function defaultModelsOf(
  deps: CockpitApiDeps,
): Promise<{ live: LiveModelChoice; combat: LiveModelChoice }> {
  const haiku: { live: LiveModelChoice; combat: LiveModelChoice } = {
    live: "haiku",
    combat: "haiku",
  };
  try {
    return (await deps.defaultModels?.()) ?? haiku;
  } catch {
    return haiku;
  }
}
const errorResponse = (error: unknown) => {
  const status =
    error instanceof StoreError || error instanceof ActionError
      ? error.status
      : 400;
  return json(
    { error: error instanceof Error ? error.message : String(error) },
    status,
  );
};

export interface CockpitApiDeps {
  store: CockpitStore;
  turns: TurnManager;
  bus: CockpitBus;
  /** Ledger and combat go through it; state reads are filled from the framework. */
  live: CockpitLive;
  resolve: Parameters<typeof sessionView>[1];
  /** The only provider of the cockpit. */
  provider: "claude";
  /** Default models of the live table and of combat, read when a session or a thread is created. */
  defaultModels?: () => Promise<{ live: LiveModelChoice; combat: LiveModelChoice }>;
}
export function cockpitApi(deps: CockpitApiDeps) {
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (
      !url.pathname.startsWith("/api/cockpit/") &&
      url.pathname !== sessionsRoute
    )
      return null;
    try {
      if (url.pathname === sessionsRoute && request.method === "GET")
        return json(await deps.store.list());
      if (url.pathname === sessionsRoute && request.method === "POST") {
        const input = asObject(await body(request));
        // Claude is the only provider: a request for another one is refused.
        if (input.provider !== undefined && input.provider !== deps.provider)
          throw new StoreError("Provider non valido");
        if (
          typeof input.title !== "string" ||
          input.title.length < 1 ||
          input.title.length > 200
        )
          throw new StoreError("Titolo non valido");
        const defaults = await defaultModelsOf(deps);
        const session = await deps.store.create({
          title: input.title,
          provider: deps.provider,
          model: liveModelOf(input.model, defaults.live),
        });
        // The session opens the framework's live session (or joins the one already open).
        await deps.live.ensure(session.id).catch(() => {});
        return json(
          sessionView(
            await deps.live.hydrate(await deps.store.get(session.id)),
            deps.resolve,
          ),
          201,
        );
      }
      const match = url.pathname.match(
        /^\/api\/cockpit\/sessions\/([^/]+)(?:\/(.*))?$/,
      );
      if (match) {
        const id = decodeURIComponent(match[1]!);
        const route = match[2] || "";
        // Table-only routes: a combat thread refuses them.
        const refuseThread = async (sessionId: string) => {
          if ((await deps.store.get(sessionId)).kind === "combat")
            throw new StoreError("Non disponibile nella chat dello scontro", 409);
        };
        if (route === "" && request.method === "GET")
          return json(
            sessionView(
              await deps.live.hydrate(await deps.store.get(id)),
              deps.resolve,
            ),
          );
        if (route === "" && request.method === "PATCH") {
          const input = asObject(await body(request));
          const model = liveModelOf(input.model, "haiku");
          await deps.store.setProviderSession(id, { model });
          return json(
            sessionView(
              await deps.live.hydrate(await deps.store.get(id)),
              deps.resolve,
            ),
          );
        }
        if (route === "" && request.method === "DELETE") {
          if (deps.turns.hasRunningSession(id))
            throw new StoreError("Sessione con turno in esecuzione", 409);
          await deps.store.delete(id);
          return json({ ok: true });
        }
        if (route === "events" && request.method === "GET") {
          const last =
            request.headers.get("last-event-id") ||
            url.searchParams.get("lastEventId");
          await deps.store.get(id);
          return deps.bus.subscribe(id, last, async () => ({
            type: "snapshot",
            session: sessionView(
              await deps.live.hydrate(await deps.store.get(id)),
              deps.resolve,
            ),
          }));
        }
        if (route === "combat/thread" && request.method === "POST") {
          const defaults = await defaultModelsOf(deps);
          return json({
            threadId: await deps.live.combatThread(id, LIVE_MODELS[defaults.combat]),
          });
        }
        if (route === "messages" && request.method === "POST") {
          const input = asObject(await body(request));
          if (
            typeof input.text !== "string" ||
            input.text.length < 1 ||
            input.text.length > 8000
          )
            throw new StoreError(
              "Il messaggio deve contenere da 1 a 8000 caratteri",
            );
          if (
            input.clientId !== undefined &&
            (typeof input.clientId !== "string" || input.clientId.length > 200)
          )
            throw new StoreError("clientId non valido");
          const target = await deps.store.get(id);
          if (target.kind === "combat" && !(await deps.live.isOpenThread(target)))
            throw new StoreError("Lo scontro è finito: la sua chat è chiusa", 409);
          return json(
            await deps.turns.submit(
              id,
              input.text,
              input.clientId as string | undefined,
            ),
            202,
          );
        }
        const cancel = route.match(/^turns\/([^/]+)\/cancel$/);
        if (cancel && request.method === "POST") {
          await deps.turns.cancel(id, decodeURIComponent(cancel[1]!));
          return json({ ok: true });
        }
        if (route === "actions" && request.method === "POST") {
          await refuseThread(id);
          const input = asObject(await body(request));
          if (
            !Array.isArray(input.actions) ||
            input.actions.length < 1 ||
            input.actions.length > 20
          )
            throw new StoreError("Sono richieste da 1 a 20 azioni");
          let actions: CockpitAction[];
          try {
            actions = input.actions.map(parseAction);
          } catch (error) {
            if (error instanceof ActionError) throw error;
            throw new StoreError("Azioni non valide");
          }
          // One group for the whole request: each action joins the group of the one before.
          let last: Awaited<ReturnType<CockpitLive["apply"]>> | undefined;
          for (const action of actions)
            last = await deps.live.apply(id, action, {
              origin: "dm",
              ...(last ? { groupId: last.group.id } : {}),
            });
          return json({
            revision: last!.session.revision,
            group: last!.group,
          });
        }
        if (route === "files" && request.method === "POST") {
          await refuseThread(id);
          const length = Number(request.headers.get("content-length") || 0);
          if (length > MAX_IMAGE_BYTES)
            throw new StoreError("Immagine troppo grande", 413);
          const bytes = new Uint8Array(await request.arrayBuffer());
          if (bytes.byteLength > MAX_IMAGE_BYTES)
            throw new StoreError("Immagine troppo grande", 413);
          const name = await deps.store.saveFile(
            id,
            bytes,
            request.headers.get("content-type") || "",
          );
          return json({ name }, 201);
        }
        const file = route.match(/^files\/([^/]+)$/);
        if (file && request.method === "GET") {
          const name = decodeURIComponent(file[1]!);
          const path = await deps.store.filePath(id, name);
          const extension = name.split(".").pop() || "";
          return new Response(await readFile(path), {
            headers: {
              "Content-Type":
                IMAGE_TYPES[extension] || "application/octet-stream",
              "X-Content-Type-Options": "nosniff",
              "Cache-Control": "private, max-age=31536000, immutable",
            },
          });
        }
        if (route === "undo" && request.method === "POST") {
          await refuseThread(id);
          const input = asObject(await body(request));
          if (typeof input.groupId !== "string")
            throw new StoreError("groupId non valido");
          const session = await deps.store.undo(id, input.groupId);
          return json({ revision: session.revision });
        }
        if (route === "layout" && request.method === "POST") {
          await refuseThread(id);
          const input = asObject(await body(request));
          if (
            !Array.isArray(input.items) ||
            input.items.length < 1 ||
            input.items.length > 300
          )
            throw new StoreError("Sono richiesti da 1 a 300 elementi");
          const session = await deps.store.layout(
            id,
            input.items as LayoutItem[],
          );
          return json({ revision: session.revision });
        }
      }
      if (url.pathname === "/api/cockpit/runtime" && request.method === "GET") {
        const sessionId = url.searchParams.get("sessionId") || undefined;
        return json(await deps.turns.runtime(sessionId));
      }
      return json({ error: "Route cockpit inesistente" }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
