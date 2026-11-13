// In-memory stand-in for the framework (session log, combat tracker, engine). Unit tests use
// it through createCockpit({ framework }) and never run the real libraries. It follows the
// same result shapes: { ok: true, ... } or { ok: false, error: { code, message } }.
import type { CombatOp, CombatState, Combatant, LiveSession, LogEntry, LogKind } from "../../../../shared/src/types.js";
import type { CockpitFramework, EngineRun, FrameworkCombatEvent, LogInput, LogPatch } from "../framework.js";
import type { LibResult } from "../framework.js";

const fail = (code: string, message: string) => ({ ok: false as const, error: { code, message } });

export interface FakeFramework {
  framework: CockpitFramework;
  /** Open session, if any. */
  session: LiveSession | null;
  entries: LogEntry[];
  combat: CombatState | null;
  /** Every engine call, as its argument list. */
  engineCalls: string[][];
  /** Answers an engine call. Default: check and commit succeed without review. */
  engine: (args: string[]) => EngineRun;
  /** Reviewer answer; absent means the host has no reviewer. */
  reviewApproves?: boolean;
  /** Calls made to the watch listener by `emitChange()`. */
  emitChange(): void;
  opened: string[];
}

export function createFakeFramework(options: { reviewApproves?: boolean; withReview?: boolean } = {}): FakeFramework {
  let nextEntry = 1;
  let nextCombatant = 1;
  let counter = 0;
  const listeners = new Set<() => void>();
  const fake: FakeFramework = {
    framework: undefined as unknown as CockpitFramework,
    session: null,
    entries: [],
    combat: null,
    engineCalls: [],
    engine: () => ({ code: 0, json: { ok: true, reviewRequired: false, finalFiles: [] } }),
    opened: [],
    emitChange: () => listeners.forEach((listener) => listener()),
  };

  const need = (): LibResult<never> | null => (fake.session ? null : fail("no-active-session", "No live session is open.") as never);

  const log = {
    active: async () => ({ ok: true as const, session: fake.session }),
    open: async (title: string) => {
      if (fake.session) return fail("already-open", "already open") as never;
      counter++;
      fake.session = { id: `2026-11-12${counter > 1 ? `-${counter}` : ""}`, title, startedAt: new Date().toISOString() };
      fake.opened.push(title);
      return { ok: true as const, session: fake.session };
    },
    add: async (input: LogInput) => {
      const missing = need();
      if (missing) return missing;
      const entry: LogEntry = {
        id: `e-${String(nextEntry++).padStart(4, "0")}`,
        at: new Date().toISOString(),
        kind: input.kind as LogKind,
        text: input.text,
        by: input.by,
        ...(input.kind === "thread" ? { resolved: input.resolved ?? false } : {}),
      };
      fake.entries.push(entry);
      return { ok: true as const, entry };
    },
    update: async (id: string, patch: LogPatch) => {
      const missing = need();
      if (missing) return missing;
      const index = fake.entries.findIndex((e) => e.id === id);
      if (index < 0) return fail("entry-not-found", `No entry ${id}.`) as never;
      const next: LogEntry = { ...fake.entries[index]! };
      if (patch.kind !== undefined) {
        next.kind = patch.kind;
        if (next.kind !== "thread") delete next.resolved;
      }
      if (patch.text !== undefined) next.text = patch.text;
      if (patch.resolved !== undefined) {
        if (next.kind !== "thread") return fail("resolved-not-thread", "resolved applies only to threads.") as never;
        next.resolved = patch.resolved;
      }
      fake.entries[index] = next;
      return { ok: true as const, entry: next };
    },
    remove: async (id: string) => {
      const missing = need();
      if (missing) return missing;
      const found = fake.entries.find((e) => e.id === id);
      if (!found) return fail("entry-not-found", `No entry ${id}.`) as never;
      fake.entries = fake.entries.filter((e) => e.id !== id);
      return { ok: true as const, entry: found };
    },
    list: async () => {
      const missing = need();
      if (missing) return { ok: true as const, entries: [] as LogEntry[] };
      return { ok: true as const, entries: [...fake.entries] };
    },
  };

  const apply = (op: CombatOp): CombatState | string => {
    const combat = fake.combat;
    if (op.op === "start") {
      if (combat?.active) return "already-active";
      fake.combat = { active: true, round: 0, turn: 0, order: [], combatants: [], events: [], revision: 0 };
      return fake.combat;
    }
    if (!combat || !combat.active) return "no-combat";
    const byId = (id: string) => combat.combatants.find((c) => c.id === id);
    const reorder = () => {
      combat.combatants.sort((a, b) => (b.initiative ?? -999) - (a.initiative ?? -999));
      combat.order = combat.combatants.map((c) => c.id);
    };
    switch (op.op) {
      case "add": {
        const c: Combatant = {
          id: `c-${nextCombatant++}`,
          name: op.name,
          side: op.side,
          initiative: op.initiative ?? null,
          conditions: [],
          resources: { ...(op.resources ?? {}) },
          ...(op.hp !== undefined ? { hp: op.hp } : {}),
          ...(op.hpMax !== undefined ? { hpMax: op.hpMax } : {}),
          ...(op.ac !== undefined ? { ac: op.ac } : {}),
          ...(op.sheet ? { sheet: op.sheet } : {}),
        };
        combat.combatants.push(c);
        reorder();
        return combat;
      }
      case "remove":
        combat.combatants = combat.combatants.filter((c) => c.id !== op.id);
        reorder();
        return combat;
      case "initiative": {
        const c = byId(op.id);
        if (!c) return "not-found";
        c.initiative = op.value;
        reorder();
        return combat;
      }
      case "damage": {
        const c = byId(op.id);
        if (!c) return "not-found";
        const before = c.hp ?? 0;
        c.hp = Math.max(0, before - op.amount);
        // Like the rules module: a creature that reaches 0 hp is defeated, with a notice.
        if (before > 0 && c.hp === 0)
          (combat.events as FrameworkCombatEvent[]).push({
            at: new Date().toISOString(),
            text: `${c.name} sconfitto`,
            notice: { kind: "defeated", id: c.id, name: c.name },
          });
        return combat;
      }
      case "heal": {
        const c = byId(op.id);
        if (!c) return "not-found";
        c.hp = Math.min(c.hpMax ?? Infinity, (c.hp ?? 0) + op.amount);
        return combat;
      }
      case "condition-add": {
        const c = byId(op.id);
        if (!c) return "not-found";
        c.conditions.push({
          id: op.condition,
          duration: op.duration ?? "",
          ...(op.rounds !== undefined ? { rounds: op.rounds } : {}),
        });
        return combat;
      }
      case "condition-remove": {
        const c = byId(op.id);
        if (!c) return "not-found";
        c.conditions = c.conditions.filter((x) => x.id !== op.condition);
        return combat;
      }
      case "resource": {
        const c = byId(op.id);
        if (!c) return "not-found";
        c.resources[op.resource] = op.value ?? (c.resources[op.resource] ?? 0) + (op.delta ?? 0);
        return combat;
      }
      case "note":
        return combat;
      case "next": {
        if (combat.order.length === 0) return "empty";
        combat.turn = (combat.turn + 1) % combat.order.length;
        if (combat.turn === 0) combat.round = Math.max(1, combat.round + 1);
        if (combat.round === 0) combat.round = 1;
        return combat;
      }
      case "end":
        combat.active = false;
        return combat;
      default:
        return "bad-op";
    }
  };

  const combatLib = {
    get: async () => ({ ok: true as const, sessionId: fake.session?.id ?? "", combat: fake.combat }),
    apply: async (op: CombatOp) => {
      if (!fake.session) return fail("no-live-session", "no game is in progress") as never;
      const result = apply(op);
      if (typeof result === "string") return fail(result, `combat refused: ${result}`) as never;
      fake.combat = result;
      return { ok: true as const, combat: result };
    },
  };

  fake.framework = {
    log,
    combat: combatLib,
    engine: async (args: string[]) => {
      fake.engineCalls.push(args);
      return fake.engine(args);
    },
    ...(options.withReview
      ? {
          review: async () => {
            fake.engineCalls.push(["review"]);
            const approved = options.reviewApproves ?? true;
            return { approved, objections: approved ? [] : ["Ada:3 says the guard is a woman."] };
          },
        }
      : {}),
    watch(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return fake;
}
