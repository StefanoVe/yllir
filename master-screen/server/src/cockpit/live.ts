// Ledger and combat of the cockpit, kept by the framework: the session log (ledger) and the
// combat tracker. The cockpit state only holds the link to the framework session. Every
// ledger or combat action goes here; every read of the state fills the ledger and combat
// from the libraries (hydrate), so the client and the digest see the same shapes as before.
import type {
  ActionGroup,
  ActionSummary,
  CockpitAction,
  CockpitSession,
  Combat,
  CombatNotice,
  Combatant,
  LedgerEntry,
  LedgerKind,
  SourceRef,
} from "../../../shared/src/cockpit-types.js";
import type { CombatOp, CombatState, LogEntry, LogKind } from "../../../shared/src/types.js";
import type {
  CockpitFramework,
  FrameworkCombatant,
  FrameworkCombatEvent,
  FrameworkCombatState,
} from "./framework.js";
import type { CombatMeta, CockpitStore, LedgerMeta } from "./store.js";
import { StoreError } from "./store.js";
import type { CockpitBattle } from "./ports.js";

const TITLE_MAX = 120;
type Meta = { origin: "agent" | "dm"; turnId?: string; groupId?: string };

export const isLiveAction = (action: CockpitAction) =>
  action.type.startsWith("ledger.") || action.type.startsWith("combat.");

/** Cockpit kind to the framework's kind, and back. */
const toLogKind = (kind: LedgerKind): LogKind => (kind === "open" ? "thread" : kind);
const toLedgerKind = (kind: LogKind): LedgerKind => (kind === "thread" ? "open" : kind);

/** Title and text share one framework text: `title: text`. */
export function composeText(title: string, text: string): string {
  return title && text ? `${title}: ${text}` : title || text;
}

/** Splits the framework text back into title and text, using the saved metadata when it still matches. */
function splitText(entry: LogEntry, meta: LedgerMeta | undefined) {
  if (meta && entry.text === composeText(meta.title, meta.text))
    return { title: meta.title, text: meta.text };
  // The text was changed outside the cockpit (terminal): the whole text is the title.
  return { title: entry.text, text: "" };
}

function ledgerEntryOf(entry: LogEntry, meta: LedgerMeta | undefined): LedgerEntry {
  const { title, text } = splitText(entry, meta);
  const resolved = entry.kind === "thread" && entry.resolved === true;
  return {
    id: entry.id,
    kind: toLedgerKind(entry.kind),
    status: resolved ? "resolved" : (meta?.status ?? "active"),
    title,
    text,
    evidence: meta?.evidence ?? [],
    sources: meta?.sources ?? [],
    createdAt: entry.at,
    updatedAt: entry.at,
  };
}

function combatantOf(
  p: FrameworkCombatant,
  meta: CombatMeta["participants"][string] | undefined,
): Combatant {
  return {
    id: p.id,
    name: p.name,
    kind: p.side,
    initiative: p.initiative,
    ...(meta?.source ? { source: meta.source } : {}),
    ...(p.hp !== undefined ? { hp: p.hp } : {}),
    ...(p.hpMax !== undefined ? { maxHp: p.hpMax } : {}),
    ...(meta?.tempHp !== undefined ? { tempHp: meta.tempHp } : {}),
    ...(meta?.phase ? { phase: meta.phase } : {}),
    conditions: p.conditions.map((c) => c.id),
    conditionDetails: p.conditions.map((c) => ({
      id: c.id,
      ...(c.duration !== undefined ? { duration: c.duration } : {}),
      ...(c.rounds !== undefined ? { rounds: c.rounds } : {}),
    })),
    resources: { ...p.resources },
  };
}

/** The cockpit notice of one framework event, or null when the event has none. */
function noticeOf(event: FrameworkCombatEvent): CombatNotice | null {
  const notice = event.notice;
  if (!notice) return null;
  const base = { at: event.at, kind: notice.kind, id: notice.id, name: notice.name };
  if (notice.kind === "condition-ended") return { ...base, condition: notice.condition };
  if (notice.kind === "turn") return { ...base, round: notice.round, newRound: notice.newRound };
  return base;
}

/** The framework combat as the cockpit shows it: participants in initiative order. */
export function combatOf(state: FrameworkCombatState, meta: CombatMeta | null): Combat {
  const byId = new Map(state.combatants.map((p) => [p.id, p]));
  const ordered = [
    ...state.order.map((id) => byId.get(id)).filter((p): p is FrameworkCombatant => p !== undefined),
    ...state.combatants.filter((p) => !state.order.includes(p.id)),
  ];
  const notices = state.events.flatMap((event) => {
    const notice = noticeOf(event);
    return notice ? [notice] : [];
  });
  return {
    notices: notices.slice(-20),
    title: meta?.title ?? "Combattimento",
    round: Math.max(1, state.round),
    activeId: state.active ? (state.order[state.turn] ?? null) : null,
    participants: ordered.map((p) => combatantOf(p, meta?.participants[p.id])),
    notes: meta?.notes ?? "",
    ...(meta?.threadId ? { threadId: meta.threadId } : {}),
  };
}

const sameRef = (a: SourceRef, b: SourceRef) => a.path === b.path && a.anchor === b.anchor;

export class CockpitLive {
  private threadTasks = new Map<string, Promise<string>>();

  constructor(
    private store: CockpitStore,
    private framework: CockpitFramework,
    /** Reads the HP and AC of a creature's sheet when it joins a fight without them. */
    private battle?: Pick<CockpitBattle, "vitals">,
  ) {}

  /**
   * The combat thread of the active fight of a table session, created when missing.
   * Refused with 409 when no fight is active. Concurrent calls share one creation.
   */
  async combatThread(tableId: string, model: string): Promise<string> {
    const running = this.threadTasks.get(tableId);
    if (running) return running;
    const task = (async () => {
      const state = await this.framework.combat.get();
      if (!state.ok) throw new StoreError(state.error.message, 409);
      if (!state.combat?.active) throw new StoreError("Nessun combattimento attivo", 409);
      const table = await this.store.get(tableId);
      if (table.kind === "combat") throw new StoreError("Non è una sessione del tavolo", 400);
      const side = await this.store.sideGet(tableId);
      if (side.combat?.threadId) {
        try {
          await this.store.get(side.combat.threadId);
          return side.combat.threadId;
        } catch {
          // The remembered thread is gone: a new one is created below.
        }
      }
      const thread = await this.store.create({
        title: (side.combat?.title || "Scontro").slice(0, 200),
        provider: "claude",
        model,
        kind: "combat",
        parentId: tableId,
      });
      await this.store.sideUpdate(tableId, (next) => ({
        ...next,
        combat: {
          ...(next.combat ?? { title: "Scontro", notes: "", participants: {} }),
          threadId: thread.id,
        },
      }));
      return thread.id;
    })();
    this.threadTasks.set(tableId, task);
    try {
      return await task;
    } finally {
      this.threadTasks.delete(tableId);
    }
  }

  /** True when the thread is the chat of the fight that is active now. */
  async isOpenThread(thread: CockpitSession): Promise<boolean> {
    if (thread.kind !== "combat" || !thread.parentId) return false;
    const state = await this.framework.combat.get();
    if (!state.ok || !state.combat?.active) return false;
    return (await this.store.sideGet(thread.parentId)).combat?.threadId === thread.id;
  }

  /** Dm message ids of the table session and of its combat threads: the valid evidence. */
  private async knownEvidence(sessionId: string, session: CockpitSession): Promise<Set<string>> {
    const known = new Set(session.messages.filter((m) => m.role === "dm").map((m) => m.id));
    for (const thread of await this.store.threads(sessionId))
      for (const m of thread.messages) if (m.role === "dm") known.add(m.id);
    return known;
  }

  /**
   * Attaches a cockpit session to the framework's active live session, opening one titled after
   * the cockpit session when none is active. Returns the framework session id.
   */
  async ensure(sessionId: string): Promise<string> {
    const session = await this.store.get(sessionId);
    const active = await this.framework.log.active();
    if (!active.ok) throw new StoreError(active.error.message, 409);
    let liveId = active.session?.id;
    if (!liveId) {
      const title = session.title.replace(/[\r\n]+/g, " ").trim().slice(0, TITLE_MAX) || "Sessione";
      const opened = await this.framework.log.open(title);
      if (!opened.ok) throw new StoreError(opened.error.message, 409);
      liveId = opened.session.id;
    }
    if (session.liveSessionId !== liveId) await this.store.setLiveSession(sessionId, liveId);
    return liveId;
  }

  /** Fills the ledger and the combat of a session from the framework. Never writes. */
  async hydrate(session: CockpitSession): Promise<CockpitSession> {
    let ledger: LedgerEntry[] = [];
    let combat: Combat | null = null;
    const active = await this.framework.log.active();
    if (session.liveSessionId && active.ok && active.session?.id === session.liveSessionId) {
      const side = await this.store.sideGet(session.id);
      const list = await this.framework.log.list();
      if (list.ok) ledger = list.entries.map((entry) => ledgerEntryOf(entry, side.ledger[entry.id]));
      const state = await this.framework.combat.get();
      if (state.ok && state.combat?.active) combat = combatOf(state.combat, side.combat);
    }
    return { ...session, state: { ...session.state, ledger, combat } };
  }

  /** Runs one action. Board, position and party go to the store; ledger and combat to the framework. */
  async apply(
    sessionId: string,
    action: CockpitAction,
    meta: Meta,
  ): Promise<{ group: ActionGroup; session: CockpitSession }> {
    if (!isLiveAction(action)) {
      const result = await this.store.apply(sessionId, [action], meta);
      return { group: result.group, session: result.session };
    }
    await this.ensure(sessionId);
    const summary = action.type.startsWith("ledger.")
      ? await this.ledgerAction(sessionId, action)
      : await this.combatAction(sessionId, action);
    const result = await this.store.recordGroup(sessionId, [summary], meta);
    return { group: result.group, session: result.session };
  }

  // ───────────────────────────── ledger ─────────────────────────────

  private async ledgerAction(sessionId: string, action: CockpitAction): Promise<ActionSummary> {
    if (action.type === "ledger.add") return this.ledgerAdd(sessionId, action.entry);
    if (action.type === "ledger.update") return this.ledgerUpdate(sessionId, action.id, action.patch);
    if (action.type === "ledger.remove") return this.ledgerRemove(sessionId, action.id);
    throw new StoreError("Azione non prevista");
  }

  private async ledgerAdd(
    sessionId: string,
    entry: Extract<CockpitAction, { type: "ledger.add" }>["entry"],
  ): Promise<ActionSummary> {
    const known = await this.knownEvidence(sessionId, await this.store.get(sessionId));
    if (!entry.evidence.length || entry.evidence.some((id) => !known.has(id)))
      throw new StoreError("Prova riferita a un messaggio DM inesistente");
    const kind = toLogKind(entry.kind);
    const added = await this.framework.log.add({
      kind,
      text: composeText(entry.title, entry.text),
      by: "agent",
      ...(kind === "thread" ? { resolved: false } : {}),
    });
    if (!added.ok) throw new StoreError(added.error.message, 409);
    const id = added.entry.id;
    const sources = entry.sources ?? [];
    await this.store.sideUpdate(sessionId, (side) => ({
      ...side,
      ledger: {
        ...side.ledger,
        [id]: { title: entry.title, text: entry.text, status: "active", evidence: [...new Set(entry.evidence)], sources },
      },
    }));
    return { type: "ledger.add", label: `Registra · ${entry.title}`, targetId: id };
  }

  private async ledgerUpdate(
    sessionId: string,
    id: string,
    patch: Extract<CockpitAction, { type: "ledger.update" }>["patch"],
  ): Promise<ActionSummary> {
    const known = await this.knownEvidence(sessionId, await this.store.get(sessionId));
    if ((patch.addEvidence ?? []).some((evidence) => !known.has(evidence)))
      throw new StoreError("Prova riferita a un messaggio DM inesistente");
    const list = await this.framework.log.list();
    if (!list.ok) throw new StoreError(list.error.message, 409);
    const entry = list.entries.find((e) => e.id === id);
    if (!entry) throw new StoreError("Voce non trovata", 404);
    const side = await this.store.sideGet(sessionId);
    const current = ledgerEntryOf(entry, side.ledger[id]);
    const status = patch.status ?? current.status;
    if (status === "dropped") return this.ledgerRemove(sessionId, id);
    const title = patch.title ?? current.title;
    const text = patch.text ?? current.text;
    const kind = patch.kind ?? current.kind;
    const logKind = toLogKind(kind);
    const logPatch: Parameters<CockpitFramework["log"]["update"]>[1] = {};
    if (logKind !== entry.kind) logPatch.kind = logKind;
    if (title !== current.title || text !== current.text) logPatch.text = composeText(title, text);
    if (logKind === "thread") {
      const resolved = status === "resolved";
      if (resolved !== (entry.kind === "thread" && entry.resolved === true)) logPatch.resolved = resolved;
    }
    if (Object.keys(logPatch).length) {
      const updated = await this.framework.log.update(id, logPatch);
      if (!updated.ok) throw new StoreError(updated.error.message, 409);
    }
    const evidence = [...new Set([...current.evidence, ...(patch.addEvidence ?? [])])];
    const sources = [...current.sources];
    for (const source of patch.addSources ?? [])
      if (!sources.some((s) => sameRef(s, source))) sources.push(source);
    await this.store.sideUpdate(sessionId, (next) => ({
      ...next,
      ledger: { ...next.ledger, [id]: { title, text, status, evidence, sources } },
    }));
    return { type: "ledger.update", label: `Aggiorna · ${title}`, targetId: id };
  }

  private async ledgerRemove(sessionId: string, id: string): Promise<ActionSummary> {
    const removed = await this.framework.log.remove(id);
    if (!removed.ok) throw new StoreError(removed.error.message, removed.error.code === "entry-not-found" ? 404 : 409);
    await this.store.sideUpdate(sessionId, (side) => {
      const ledger = { ...side.ledger };
      delete ledger[id];
      return { ...side, ledger };
    });
    return { type: "ledger.remove", label: "Rimuove voce", targetId: id };
  }

  // ───────────────────────────── combat ─────────────────────────────

  private async run(op: CombatOp): Promise<CombatState> {
    const result = await this.framework.combat.apply(op);
    if (!result.ok) throw new StoreError(result.error.message, 409);
    return result.combat;
  }

  private async activeCombat(): Promise<FrameworkCombatState> {
    const current = await this.framework.combat.get();
    if (!current.ok) throw new StoreError(current.error.message, 409);
    if (!current.combat?.active) throw new StoreError("Nessun combattimento attivo", 409);
    return current.combat;
  }

  private async combatAction(sessionId: string, action: CockpitAction): Promise<ActionSummary> {
    switch (action.type) {
      case "combat.start": {
        const existing = await this.framework.combat.get();
        if (!existing.ok) throw new StoreError(existing.error.message, 409);
        if (existing.combat?.active) throw new StoreError("Combattimento già attivo", 409);
        for (const participant of action.participants) if (participant.kind === "pc") refusePcStats(participant);
        await this.run({ op: "start" });
        const meta: CombatMeta = { title: action.title, notes: "", participants: {} };
        await this.store.sideUpdate(sessionId, (side) => ({ ...side, combat: meta }));
        for (const participant of action.participants) await this.addParticipant(sessionId, participant);
        return { type: "combat.start", label: "Inizia combattimento" };
      }
      case "combat.add": {
        await this.activeCombat();
        const id = await this.addParticipant(sessionId, action.participant);
        return { type: "combat.add", label: "Aggiunge combattente", targetId: id };
      }
      case "combat.update":
        return this.combatUpdate(sessionId, action.id, action.patch);
      case "combat.remove": {
        await this.activeCombat();
        await this.run({ op: "remove", id: action.id });
        await this.updateCombatMeta(sessionId, (meta) => {
          const participants = { ...meta.participants };
          delete participants[action.id];
          return { ...meta, participants };
        });
        return { type: "combat.remove", label: "Rimuove combattente", targetId: action.id };
      }
      case "combat.turn": {
        let state = await this.activeCombat();
        if (action.activeId === null) throw new StoreError("Il turno si avanza soltanto con next", 409);
        if (!state.order.includes(action.activeId)) throw new StoreError("Combattente attivo non trovato", 404);
        for (let steps = 0; steps <= state.order.length && state.order[state.turn] !== action.activeId; steps++)
          state = await this.run({ op: "next" });
        const name = state.combatants.find((c) => c.id === action.activeId)?.name ?? "nessuno";
        return { type: "combat.turn", label: `Turno · ${name}`, targetId: action.activeId };
      }
      case "combat.notes": {
        await this.activeCombat();
        await this.updateCombatMeta(sessionId, (meta) => ({ ...meta, notes: action.notes }));
        return { type: "combat.notes", label: "Note combattimento" };
      }
      case "combat.end": {
        await this.activeCombat();
        await this.run({ op: "end" });
        return { type: "combat.end", label: "Fine combattimento" };
      }
      case "combat.condition": {
        if (action.rounds !== undefined && action.duration !== "rounds")
          throw new StoreError("I round valgono solo con la durata in round", 400);
        const state = await this.activeCombat();
        const current = state.combatants.find((c) => c.id === action.id);
        if (!current) throw new StoreError("Combattente non trovato", 404);
        if (current.side === "pc")
          throw new StoreError("Per i personaggi giocanti si registrano solo nome, iniziativa e posizione", 409);
        if (action.remove) {
          await this.run({ op: "condition-remove", id: action.id, condition: action.condition });
        } else {
          await this.run({
            op: "condition-add",
            id: action.id,
            condition: action.condition,
            ...(action.duration !== undefined ? { duration: action.duration } : {}),
            ...(action.rounds !== undefined ? { rounds: action.rounds } : {}),
          });
        }
        return { type: "combat.condition", label: `Condizione · ${current.name}`, targetId: action.id };
      }
      default:
        throw new StoreError("Azione non prevista");
    }
  }

  private async updateCombatMeta(sessionId: string, change: (meta: CombatMeta) => CombatMeta) {
    await this.store.sideUpdate(sessionId, (side) => {
      const base: CombatMeta = side.combat ?? { title: "Combattimento", notes: "", participants: {} };
      return { ...side, combat: change(base) };
    });
  }

  /** HP and AC of a sheet, or null when there is no battle port or the sheet cannot be read. */
  private async sheetVitals(sheet: string): Promise<{ hp?: number; ac?: number } | null> {
    const vitals = this.battle?.vitals;
    if (!vitals) return null;
    try {
      return (await vitals.call(this.battle, sheet)) ?? null;
    } catch {
      return null;
    }
  }

  /** Adds one participant. Player characters keep only name, initiative and position. */
  private async addParticipant(
    sessionId: string,
    p: Omit<Combatant, "id">,
  ): Promise<string> {
    if (p.kind === "pc") refusePcStats(p);
    // A creature from a card has no HP or AC of its own: the sheet's public stats fill them in.
    const sheet = p.kind !== "pc" && p.source && p.hp === undefined ? await this.sheetVitals(p.source.path) : null;
    const hp = p.hp ?? sheet?.hp;
    const hpMax = p.maxHp ?? (p.hp === undefined ? sheet?.hp : undefined);
    const before = new Set((await this.activeCombat()).combatants.map((c) => c.id));
    const added = await this.run({
      op: "add",
      name: p.name,
      side: p.kind,
      initiative: p.initiative,
      ...(p.kind === "pc"
        ? {}
        : {
            ...(hp !== undefined ? { hp } : {}),
            ...(hpMax !== undefined ? { hpMax } : {}),
            ...(sheet?.ac !== undefined ? { ac: sheet.ac } : {}),
            ...(p.resources ? { resources: p.resources } : {}),
          }),
      ...(p.source ? { sheet: p.source.path } : {}),
    });
    // The library keeps the combatants in initiative order: the new one is the id that was not there.
    const id = added.combatants.find((c) => !before.has(c.id))?.id ?? "";
    for (const condition of p.kind === "pc" ? [] : (p.conditions ?? []))
      await this.run({ op: "condition-add", id, condition });
    const info = {
      ...(p.source ? { source: p.source } : {}),
      ...(p.phase ? { phase: p.phase } : {}),
      ...(p.tempHp !== undefined ? { tempHp: p.tempHp } : {}),
      ...(p.maxHp !== undefined ? { maxHp: p.maxHp } : {}),
    };
    await this.updateCombatMeta(sessionId, (meta) => ({
      ...meta,
      participants: { ...meta.participants, [id]: info },
    }));
    return id;
  }

  private async combatUpdate(
    sessionId: string,
    id: string,
    patch: Partial<Omit<Combatant, "id">>,
  ): Promise<ActionSummary> {
    const state = await this.activeCombat();
    const current = state.combatants.find((c) => c.id === id);
    if (!current) throw new StoreError("Combattente non trovato", 404);
    if (patch.name !== undefined && patch.name !== current.name)
      throw new StoreError("Il nome di un combattente non si cambia: rimuovilo e aggiungilo di nuovo", 409);
    if (patch.kind !== undefined && patch.kind !== current.side)
      throw new StoreError("Il lato di un combattente non si cambia", 409);
    const isPc = current.side === "pc";
    if (isPc && (patch.hp !== undefined || patch.maxHp !== undefined || patch.tempHp !== undefined ||
      patch.phase !== undefined || patch.conditions !== undefined || patch.resources !== undefined))
      throw new StoreError("Per i personaggi giocanti si registrano solo nome, iniziativa e posizione", 409);
    if (patch.initiative === null) throw new StoreError("L'iniziativa non si annulla: indica un valore", 409);
    if (patch.initiative !== undefined)
      await this.run({ op: "initiative", id, value: patch.initiative });
    if (patch.maxHp !== undefined && patch.maxHp !== current.hpMax)
      throw new StoreError("I punti ferita massimi si fissano al momento dell'aggiunta: rimuovi e aggiungi di nuovo", 409);
    if (patch.hp !== undefined) {
      if (current.hp === undefined) throw new StoreError("Questo combattente non ha punti ferita registrati", 409);
      const delta = patch.hp - current.hp;
      if (delta < 0) await this.run({ op: "damage", id, amount: -delta });
      if (delta > 0) await this.run({ op: "heal", id, amount: delta });
    }
    if (patch.conditions !== undefined) {
      const wanted = new Set(patch.conditions);
      const have = new Set(current.conditions.map((c) => c.id));
      for (const condition of wanted) if (!have.has(condition)) await this.run({ op: "condition-add", id, condition });
      for (const condition of have) if (!wanted.has(condition)) await this.run({ op: "condition-remove", id, condition });
    }
    for (const [resource, value] of Object.entries(patch.resources ?? {}))
      await this.run({ op: "resource", id, resource, value });
    if (patch.tempHp !== undefined || patch.phase !== undefined || patch.source !== undefined) {
      await this.updateCombatMeta(sessionId, (meta) => {
        const prev = meta.participants[id] ?? {};
        const next = {
          ...prev,
          ...(patch.tempHp !== undefined ? { tempHp: patch.tempHp } : {}),
          ...(patch.phase !== undefined ? { phase: patch.phase } : {}),
          ...(patch.source !== undefined ? { source: patch.source } : {}),
        };
        return { ...meta, participants: { ...meta.participants, [id]: next } };
      });
    }
    return { type: "combat.update", label: `Aggiorna · ${current.name}`, targetId: id };
  }
}

function refusePcStats(p: Omit<Combatant, "id">) {
  if (p.hp !== undefined || p.maxHp !== undefined || p.tempHp !== undefined || p.phase !== undefined ||
    (p.conditions && p.conditions.length) || (p.resources && Object.keys(p.resources).length))
    throw new StoreError("Per i personaggi giocanti si registrano solo nome, iniziativa e posizione", 409);
}
