import { test } from "node:test";
import { expect } from "./test-helpers/expect.js";
import type {
  CockpitSession,
  CockpitState,
  ChatMessage,
} from "../../../shared/src/cockpit-types.js";
import {
  SYSTEM_PROMPT,
  buildCombatSystemPrompt,
  buildCardSystemPrompt,
  buildCardUserPrompt,
  buildCombatUserPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  combatLine,
  languageName,
} from "./prompt.js";
import { emptyState } from "./actions.js";

test("il digest elimina i messaggi vecchi e preserva posizione, registro e nuovo messaggio", () => {
  const session = {
    id: "s",
    title: "Test",
    provider: "claude",
    model: "m",
    createdAt: "",
    updatedAt: "",
    revision: 0,
    state: emptyState(),
    history: [],
    messages: Array.from({ length: 8 }, (_, index) => ({
      id: `old-${index}`,
      role: "dm",
      text: "x".repeat(1000),
      at: "",
      turnId: "t",
      status: "complete",
    })),
    turns: [],
  } as unknown as CockpitSession;
  session.state.position.location = "Porto del Nord";
  session.state.ledger.push({
    id: "ledger-id",
    kind: "fact",
    title: "Il sigillo è stato consegnato",
    text: "dettaglio ".repeat(500),
    evidence: ["e"],
    sources: [],
    status: "active",
    createdAt: "",
    updatedAt: "",
  });
  const current: ChatMessage = {
    id: "current-id",
    role: "dm",
    text: "y".repeat(8000),
    at: "",
    turnId: "t2",
    status: "complete",
  };
  const digest = buildUserPrompt(session, current);
  expect(digest.length).toBeLessThanOrEqual(12000);
  expect(digest).toContain("POSITION: Porto del Nord");
  expect(digest).toContain("ACTIVE LOG:");
  expect(digest).toContain("RECENT MESSAGES:");
  expect(digest).toContain("Il sigillo è stato consegnato");
  expect(digest).toContain("NEW MASTER MESSAGE (current-id):");
  expect(digest).toContain("y".repeat(100));
  expect(digest).not.toContain("old-0");
  expect(digest).not.toContain("D&D");
});

test("il prompt di sistema separa le richieste di plancia dal registro e spiega il recupero dagli errori", () => {
  const prompt = buildSystemPrompt({ language: "it", systemName: null });
  expect(prompt).toContain("Desk and layout requests");
  expect(prompt).toContain("never remarks about the desk");
  expect(prompt).toContain("board_move");
  expect(prompt).toContain("get_board");
  expect(prompt).toContain(
    "Do not ask the master for technical references",
  );
});

test("il prompt di sistema chiede la risposta nella lingua della campagna", () => {
  expect(buildSystemPrompt({ language: "it", systemName: null })).toContain(
    "Reply to the master in Italian.",
  );
  expect(buildSystemPrompt({ language: "en", systemName: null })).toContain(
    "Reply to the master in English.",
  );
  expect(languageName("it")).toBe("Italian");
  expect(languageName("en-GB")).toBe("English");
});

test("il prompt di sistema nomina il sistema di gioco solo se è noto e non cita D&D", () => {
  const withSystem = buildSystemPrompt({
    language: "it",
    systemName: "dnd-2024",
  });
  expect(withSystem).toContain("The game system is dnd-2024.");
  expect(buildSystemPrompt({ language: "it", systemName: null })).not.toContain(
    "The game system is",
  );
  for (const prompt of [withSystem, SYSTEM_PROMPT]) {
    expect(prompt).not.toContain("D&D");
    expect(prompt).not.toContain("Dungeons");
    expect(prompt).not.toContain("<!-- cockpit -->");
  }
});

test("il prompt di sistema del tavolo avvia lo scontro con combat_start e rimanda alla chat dello scontro", () => {
  const prompt = buildSystemPrompt({ language: "it", systemName: null });
  expect(prompt).toContain("combat_start");
  expect(prompt).not.toContain("combat_turn");
  expect(prompt).not.toContain("battle_move");
  expect(prompt).not.toContain("you have no combat tools");
  expect(prompt).toContain("combat chat");
});

test("il prompt della chat di scontro nomina la lingua e i suoi strumenti", () => {
  const prompt = buildCombatSystemPrompt({ language: "it", systemName: null });
  expect(prompt).toContain("Italian");
  expect(prompt).toContain("combat_turn");
  expect(prompt).toContain("ledger_note");
  expect(prompt).not.toContain("The game system is");
});

test("il digest di scontro riporta la linea COMBAT del tavolo o 'none active' e il nuovo messaggio", () => {
  const combat = {
    title: "Imboscata",
    round: 2,
    activeId: "c1",
    participants: [
      { id: "c1", name: "Ada", kind: "pc", initiative: 15, conditions: [] },
    ],
    notes: "",
  } as unknown as NonNullable<CockpitState["combat"]>;
  const table = {
    id: "table",
    title: "Tavolo",
    provider: "claude",
    model: "m",
    createdAt: "",
    updatedAt: "",
    revision: 0,
    state: { ...emptyState(), combat },
    history: [],
    messages: [],
    turns: [],
  } as unknown as CockpitSession;
  const thread = { ...table, id: "thread", state: emptyState(), messages: [] } as unknown as CockpitSession;
  const message: ChatMessage = {
    id: "msg-combat",
    role: "dm",
    text: "Ada colpisce",
    at: "",
    turnId: "t",
    status: "complete",
  };
  const withCombat = buildCombatUserPrompt(table, thread, message);
  expect(withCombat).toContain(combatLine(combat));
  expect(withCombat).toContain("NEW MASTER MESSAGE (msg-combat): Ada colpisce");
  const withoutCombat = buildCombatUserPrompt(
    { ...table, state: emptyState() } as unknown as CockpitSession,
    thread,
    message,
  );
  expect(withoutCombat).toContain("COMBAT: none active");
  expect(withoutCombat).toContain("msg-combat");
});

test("il digest di scontro elenca condizioni e durate con etichetta e gli avvisi recenti", () => {
  const combat = {
    title: "Imboscata",
    round: 2,
    activeId: "c1",
    participants: [{ id: "c1", name: "Ada", kind: "pc", initiative: 15, conditions: [] }],
    notes: "",
    notices: [
      { at: "t1", kind: "turn", id: "c1", name: "Ada", round: 1, newRound: false },
      { at: "t2", kind: "condition-ended", id: "c2", name: "Ogre", condition: "prone" },
      { at: "t3", kind: "defeated", id: "c2", name: "Ogre" },
    ],
  } as unknown as NonNullable<CockpitState["combat"]>;
  const rules = {
    conditions: [{ id: "prone", label: "Prono" }],
    durations: [{ id: "rounds", label: "Round" }],
  };
  const table = {
    id: "table",
    title: "Tavolo",
    provider: "claude",
    model: "m",
    createdAt: "",
    updatedAt: "",
    revision: 0,
    state: { ...emptyState(), combat },
    history: [],
    messages: [],
    turns: [],
  } as unknown as CockpitSession;
  const thread = { ...table, id: "thread", state: emptyState(), messages: [] } as unknown as CockpitSession;
  const message: ChatMessage = { id: "msg", role: "dm", text: "Ada attacca", at: "", turnId: "t", status: "complete" };
  const digest = buildCombatUserPrompt(table, thread, message, { rules });
  expect(digest).toContain("CONDITIONS: prone (Prono)");
  expect(digest).toContain("DURATIONS: rounds (Round)");
  expect(digest).toContain("RECENT NOTICES: turn Ada round 1, condition-ended Ogre prone, defeated Ogre");
  const plain = buildCombatUserPrompt(table, thread, message);
  expect(plain).not.toContain("CONDITIONS:");
  expect(buildCombatUserPrompt({ ...table, state: emptyState() } as unknown as CockpitSession, thread, message)).toContain(
    "RECENT NOTICES: none",
  );
});

test("il digest di scontro senza luogo dice 'not set' e non scrive 'unknown'", () => {
  const combat = {
    title: "Imboscata nel bosco",
    round: 1,
    activeId: "c1",
    participants: [{ id: "c1", name: "Ada", kind: "pc", initiative: 15, conditions: [] }],
    notes: "",
    notices: [],
  } as unknown as NonNullable<CockpitState["combat"]>;
  const table = {
    id: "table",
    title: "Tavolo",
    provider: "claude",
    model: "m",
    createdAt: "",
    updatedAt: "",
    revision: 0,
    state: { ...emptyState(), combat, position: { ...emptyState().position, location: "", moment: "Notte" } },
    history: [],
    messages: [],
    turns: [],
  } as unknown as CockpitSession;
  const thread = { ...table, id: "thread", state: emptyState(), messages: [] } as unknown as CockpitSession;
  const message: ChatMessage = { id: "msg-map", role: "dm", text: "Trova e imposta la mappa di battaglia del luogo attuale.", at: "", turnId: "t", status: "complete" };
  const digest = buildCombatUserPrompt(table, thread, message);
  expect(digest).toContain("PLACE: not set (work it out from the combat title, the enemies' sheets or the messages; do not ask) · Notte");
  expect(digest).not.toContain("unknown");
});

test("il digest di scontro con luogo noto mantiene il formato del luogo", () => {
  const table = {
    id: "table",
    title: "Tavolo",
    provider: "claude",
    model: "m",
    createdAt: "",
    updatedAt: "",
    revision: 0,
    state: { ...emptyState(), position: { ...emptyState().position, location: "Porto di Vel" } },
    history: [],
    messages: [],
    turns: [],
  } as unknown as CockpitSession;
  const thread = { ...table, id: "thread", state: emptyState(), messages: [] } as unknown as CockpitSession;
  const message: ChatMessage = { id: "msg-map", role: "dm", text: "Mappa", at: "", turnId: "t", status: "complete" };
  const digest = buildCombatUserPrompt(table, thread, message);
  expect(digest).toContain("PLACE: Porto di Vel ·");
  expect(digest).not.toContain("not set");
});

test("il prompt di combattimento vieta di chiedere il luogo e descrive il ripiego senza luogo", () => {
  const system = buildCombatSystemPrompt({ language: "it", systemName: null });
  expect(system).toContain("Never ask the master which place to search when the PLACE is unknown or not set");
  expect(system).toContain("call find_battle_map with no place");
  expect(system).toContain("battle_map_set");
});

test("il prompt di sistema del combattimento nomina combat_condition; quello del tavolo no", () => {
  expect(buildCombatSystemPrompt({ language: "it", systemName: null })).toContain("combat_condition");
  expect(buildSystemPrompt({ language: "it", systemName: null })).not.toContain("combat_condition");
});

test("il prompt della scheda tronca il testo oltre 12000 caratteri e lo segnala", () => {
  const long = "a".repeat(12500);
  const prompt = buildCardUserPrompt("Creature/Guardia.md", long);
  expect(prompt.startsWith("SHEET: Creature/Guardia.md\n\nTEXT:\n")).toBe(true);
  expect(prompt.endsWith("\n[…]")).toBe(true);
  expect(prompt.length).toBe("SHEET: Creature/Guardia.md\n\nTEXT:\n".length + 12000 + "\n[…]".length);
  const short = buildCardUserPrompt("Creature/Guardia.md", "Morso.");
  expect(short).toBe("SHEET: Creature/Guardia.md\n\nTEXT:\nMorso.");
});

test("il prompt di sistema della scheda nomina combat_card_set e la lingua della campagna", () => {
  const prompt = buildCardSystemPrompt({ language: "it", systemName: null });
  expect(prompt).toContain("combat_card_set");
  expect(prompt).toContain("Italian");
  expect(prompt).toContain("unspecified");
  expect(buildCardSystemPrompt({ language: "en", systemName: "Prova" })).toContain("Prova");
});
