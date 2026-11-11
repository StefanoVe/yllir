---
name: after-session
description: Core process. Records one evening that was played as a chronicle page, faithful only to what the master says, then applies the consequences the master stated on the sheets, statuses and timeline and proposes the rest, all in one batch.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" *), Bash(node */scripts/engine.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/today.mjs" *), Bash(node */scripts/today.mjs *), Read, Write, Edit, Agent, Skill, Glob, Grep
---

# After session

You are the AUTHOR. Record the evening in two phases, and write both in one batch through the write cycle in `${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/authoring.md`. Run commands from the campaign root (the folder that contains `campaign.yaml`), exactly as written.

**Failures.** When something cannot be done, say the fixed sentence «Non sono riuscito a completare questa operazione. Non è stato perso nulla: possiamo riprovare.» (English «I could not complete this operation. Nothing was lost: we can try again.»), from `${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/lexicon.md`, and stop. Use the language column for the campaign language.

**The chronicle is faithful.** The chronicle page holds only what the master said happened. Never add a name, a place, an event, a result, a number or a background that the master did not say. A hypothesis the master voiced stays a hypothesis.

**Messages to the master.** Campaign language, plain words, no technical words. Ask at most one question per message, and end every question with a question mark.

## Steps

**Step 1 — Settings and date.**
1. Read `campaign.yaml` with the Read tool. Keep `language.main` (the CAMPAIGN LANGUAGE), the `folder` of the entry of type `chronicle` (the CHRONICLE FOLDER) and the `folder` of the entry of type `plot` (the PLOT FOLDER).
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/today.mjs"`. Its first line is today's date, `YYYY-MM-DD` (TODAY). If the exit code is not 0, use the Failures sentence above, and stop.
3. If the master named a date, use it, converted to `YYYY-MM-DD`. A day and month without a year means the year of TODAY. Otherwise DATE is TODAY.
4. The page is `<CHRONICLE FOLDER>/<DATE>.md`. If that file already exists (check with Read), use `<DATE>-b`, then `<DATE>-c`, and so on. Never open or change an old page: if the master asks to change an earlier page, use the Failures sentence and stop. The id is `cronaca-<DATE>` with the same suffix.

**Step 2 — Is the account enough?** Count the concrete events in MASTER_MESSAGE: things that happened at the table, with who did what, where, or what was found. Two are needed.
- If there are fewer (for example only «we finished» or «it went well»), ask ONE question and stop. Italian: «Com'è andata la serata? Raccontamela con una frase per ogni scena.» English: «How did the evening go? Tell me in one sentence per scene.» Any other language: translate it, keeping the question mark.
- Never invent an event to reach two.

**Step 3 — Which sessions were played.**
1. Glob `<PLOT FOLDER>/*/*.md`. A session main file is the file whose name equals its folder name. Read each one and keep its `id`, its `name` and its `depends_on`.
2. A session is PLAYED here when the master names it, compared by name ignoring case and accents. If the master says the evening played no plot session («we only talked»), PLAYED is empty.
3. If it is unclear which session was played, ask ONE question that names the candidate sessions by their names, and stop.
4. For each played session, every id in its `depends_on` must appear in the `played` list of an earlier chronicle page. If one does not, and the master did not say to record it anyway, ask ONE question: name the session and the missing prerequisite, and ask whether to record it anyway. Stop. If the master says yes, record it and say so in the message.

**Step 4 — Phase 1: the chronicle page.** Write `<CHRONICLE FOLDER>/<DATE>.md` in the campaign language. Use Italian headings `## Accaduto` and `## Fili aperti` for `it`; `## What happened` and `## Open threads` for `en`; translate them for any other language.

```markdown
---
id: cronaca-<DATE>
played: [<ids of PLAYED, or []>]
provenance: played
---

# <Title: 2 to 6 words naming what happened>

## Accaduto

<past tense; every event the master said, in the order told; at least one full sentence per event; 1 to 4 paragraphs>

## Fili aperti

- <an open question or a promise the master stated>
```

Rules:
- The title names what happened, taken from the events. Never a date, never a number, never the word for «chronicle» alone.
- Cover every event the master told. Add nothing. A page that covers only one of several events is wrong.
- Read the documents of the subjects and sessions only to get names and spellings right. Never copy their content into the page.
- A name that is not in any document appears as plain words («a fisherman») and does not become a new named subject here.
- If the master's account contradicts a document, do not choose. Leave the conflicting detail out of the page and report it in Step 7.
- A milestone is written only when the master explicitly declares one («siamo saliti di livello», «they level up»): then add one sentence quoting the master's own words. Never infer a milestone from events.
- Omit `## Fili aperti` when there are no open threads.

**Step 5 — Phase 2: consequences.** For each name the master used, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" query . find "<name>"`, then Read the documents found, master blocks included. Decide, in your reasoning, two lists:
- STATED: changes the master explicitly said happened. Examples: a new fact about a sheet (a relation, a possession, a location, a name), a faction's relation changed, a death (`status: dead` with `ended` set to the point in the timeline), a destruction (`status: destroyed`), an end (`status: ended`), a timeline event (`kind: event`, `when`, `participants`).
- PROPOSED: anything the evening seems to imply but the master did not state, and any invention.

Write the fields in these forms: `status: dead`, `ended: 312` (a number), `participants: [id1, id2]` and `location: [place-id]` as flow lists. Write the STATED changes into the batch: a draft of each changed document, with only those changes, all other text kept. Keep each document's provenance. Never infer possession, location, status or effects from the events. PROPOSED changes are not written.

**Step 6 — Write the batch.** One batch through the write cycle, containing the chronicle page of Step 4 and the changed documents of Step 5. The commit message is one sentence in the campaign language, for example «Registrata la serata del <DATE>». If the write cycle asks a question, ask that question, and stop.

**Step 7 — Message to the master.** After the commit succeeds, write a few sentences in the campaign language:
- the evening is recorded, named by its date in words («la serata del 3 novembre»);
- the sessions recorded as played, by their names, and any recorded before a prerequisite;
- one sentence for each change applied to a sheet or a status, saying what changed, in the master's terms;
- one sentence for each contradiction left out of the page, saying which two sources disagree, without choosing;
- the PROPOSED changes, in one sentence, asking whether to apply them. This is the only question of the message, and it is the last sentence.

No paths, ids, codes, backticks or formatting marks.

## Examples

Correct: the master writes «ieri al porto Varn ha trovato la barca, e il gruppo ha deciso di non parlare con il capitano». Two events, one played session that matches by name. The page has two paragraphs in the past tense, using only these two events. The message says the evening is recorded and the session is marked as played. Varn's past is not in the page; if the master had stated it, it would be a STATED change.

Correct: the master writes «Oswin è morto nello scontro al ponte». The sheet of Oswin gets `status: dead` and `ended` at the point of the evening, because the master stated it. The message says so.

Wrong: the master writes «abbiamo giocato bene, il gruppo ha vinto lo scontro». The page must not say how the fight ended or who won beyond what the master said. Ask ONE question instead, asking for one sentence per scene.

Wrong: the master writes «forse Brenna è la sorella di Oswin». This stays a hypothesis in the page («il gruppo sospetta…»). It is not a relation written in Brenna's sheet.
