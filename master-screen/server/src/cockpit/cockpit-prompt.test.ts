import { test } from "node:test";
import { expect } from "./test-helpers/expect.js";
import type { CockpitSession, ChatMessage } from "../../../shared/src/cockpit-types.js";
import {
  SYSTEM_PROMPT,
  buildSystemPrompt,
  buildUserPrompt,
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
