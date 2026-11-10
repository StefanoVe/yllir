---
name: prepare-session
description: Core process. Prepares the next session of a Yllir campaign as a new session (a main file and one file per scene): checks what was played, reads the documents involved, drafts the scenes and writes them through the write sequence. Runs inside the process runner.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/plot-map/scripts/plot-map.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/build-index.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/new-campaign/scripts/add-category.mjs" *), Read, Write, Skill
---

# Prepare session

Prepares the next session as a new session folder: a main file and one file per scene. Run every command from the campaign root (the folder that contains `campaign.yaml`). Keep every value you read from a script, and never guess one.

**Commands.** Run each command exactly as written in this file, as one single command: nothing before it and nothing after it, no `;`, `&&`, `|`, `2>&1`, `echo`, `cat`, `mkdir` or `cd`. Anything added makes the command refused. Every script prints its result and, as its last line, `exit: <code>`: read the exit code from that line (the `exit:` line). Read result files with the Read tool. If a command is refused, run it again exactly as written, with nothing added; if it is refused again, end this skill with `status: FAILED`, reason "permission refused".

**Scope of this version.** This process has two modes (see Inputs). In MODE `new` (the default) it:
- creates a NEW session (its main file and its scene files);
- does NOT rewrite an existing session. In MODE `new`, if the master asks to change an existing session, say in one sentence that this is not available yet, and stop. Changing an existing session is MODE `revise`, described in «Mode: revise»;
- creates a sheet through `yllir:npc-manager` for each NEW NAMED CHARACTER (person, vendor, enemy or creature) that MASTER_MESSAGE names or explicitly asks for, choosing the kind itself (step 6b), and, ONLY with IMAGINATION `yes`, also creates a sheet for a character that the master's request NEEDS even when no name is given (see step 4, REQUIRED_CHARACTERS), choosing a name itself. With IMAGINATION `no`, such a character gets no sheet and no name;
- creates an item sheet through `yllir:item-manager` when the master requests the item or it has significant value, effects, secrets, or a plot role; ordinary scenery and incidental props do not get sheets;
- does not create place documents.

**Questions to the master.** Ask the master in plain words, then stop. Write the question as your message; the process runner turns it into a QUESTION result.

**Inputs.** MASTER_MESSAGE is the master's request, as given by the process runner. MODE is `revise` when the process runner's prompt has a line `MODE: revise`. In every other case (no MODE line, or `MODE: new`) MODE is `new`. In MODE `new`, follow the Steps below. In MODE `revise`, follow «Mode: revise» below and do not run the Steps except where «Mode: revise» refers to them.

**IMAGINATION** is `yes` or `no`, given by the process runner. `yes` lets the assistant invent details that no source states, as described in step 7 and step 6b. Absent or any other value means `no`. With `no`, every rule of this file applies exactly as written, with no invention beyond the existing rules.

## Steps

**Step 1 — Map.** Run these two commands in this order:
- `node "${CLAUDE_PLUGIN_ROOT}/skills/library/plot-map/scripts/plot-map.mjs" . --out .campaign/cache/plot-map.json`
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/build-index.mjs" . --out .campaign/cache/subjects.json`

Exit code 2 from either: stop and say in one sentence that the campaign map could not be read. Exit code 1 from `plot-map` is allowed (errors are listed in its output): keep going.
Read `.campaign/cache/plot-map.json` with the Read tool. Keep `sessions`, `arcs` and `errors`.
- Output: the map read and kept.

**Step 2 — Target.** Decide the arc and the new session.
- The arc is: the arc named in MASTER_MESSAGE; or the only arc in `arcs`; or the arc of the most recent session in `sessions` (last in map order). If two arcs are plausible, ask the master ONE question: which arc (name both). Then stop.
- The plot folder is the `folder` of the entry with `type: plot` in `structure` of `campaign.yaml`. If no such entry exists, run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/new-campaign/scripts/add-category.mjs" . --id plot --folder "<Folder>" --type plot`, with `<Folder>` the word «Plot» in the campaign language: `Trama` for `it`, `Plot` for `en`, the translation for any other language. Exit code 1: explain the problem in one sentence and stop. Exit code 0: keep the folder name it reports.
- The campaign language is `language.main` in `campaign.yaml`.
- The session name is `<word> <next_number>`, where `<next_number>` is `next_number` of the arc in `arcs`, and `<word>` is «Sessione» for `it`, «Session» for `en`, or the translation. Example: `Session 2`.
- The session folder is `<plot folder>/<session name>/`. The main file is `<plot folder>/<session name>/<session name>.md`. The scene files go in `<plot folder>/<session name>/<events folder>/`, where `<events folder>` is «Eventi» for `it`, «Events» for `en`, or the translation. Example: `Plot/Session 2/Session 2.md`, and scenes in `Plot/Session 2/Events/`.
- The arc is not a folder. Whenever the arc has a name, the main file gets the arc in its metadata (`arc`), whether the master named it or the arc was inferred in this step (the only arc, or the arc of the most recent session). If the arc has no name (empty), the main file has no `arc` line.
- The new id is `<slug of the arc>-<next_number with two digits>`. Example: `the-long-night-02`. If the arc has no name (empty), the id is `<slug of the session name>`. Example: `session-2`.
- `depends_on`: the id of the last session of that arc in map order, as a one-item list. If the master says the new session depends on something else, use what the master says. For the first session of a new arc, use `depends_on: []` and say so in the message for the master.
- Slug: lowercase, ASCII letters and digits, words joined by hyphens.
- Output: arc, file path, id, depends_on, all written in your notes.

**Step 3 — Prerequisites.** For each id in `depends_on`, find the session with that id in `sessions` and read its `played` value.
- If every prerequisite is played, or there are none: go to step 4.
- If any is not played: unless MASTER_MESSAGE already says to prepare anyway, ask the master whether to prepare anyway. Name the sessions in plain words (their names, not their ids). Then stop. When the master answers, record the answer as a decision, and go on.
- If MASTER_MESSAGE already says to prepare anyway: go on to step 4 without asking. Remember the names of the sessions that were not played: the final message must say that they were not played (step 9, the message for the master).
- Output: the prerequisites checked, and the decision if one was asked.

**Step 4 — Documents involved.**
1. Take the names in MASTER_MESSAGE and the names in the text of the previous session (the last session of the arc in map order).
2. For each name, compare it with each form in `subjects.json` (the `forms` list of each subject, field `text`). Compare ignoring case and accents. A match is a subject id.
3. Read the document of each matched subject. Its path is the `sheet` of the subject. Read the whole document, master notes included.
4. Also read the previous session: its main file, and every scene file listed under `events` for it in the map.
5. A name the master uses that matches no subject is MISSING. Split the MISSING names into three lists, and make a fourth list, REQUIRED_CHARACTERS, from the request:
   - MISSING_CHARACTERS: the names of persons, vendors, enemies or creatures that MASTER_MESSAGE names or asks to create, and that no subject matches. Example: the master writes «Maren is the innkeeper». Maren matches no subject, so she is in MISSING_CHARACTERS. Another example: the master writes «Garron, a named beast, hunts at the ford». Garron matches no subject, so he is in MISSING_CHARACTERS.
   - MISSING_ITEMS: named items without a matching subject that the master requests or that have significant value, effects, secrets, or a plot role. With IMAGINATION `yes`, this also includes a significant item the planned scenes require and explicitly introduce. Ordinary scenery and incidental props are excluded.
   - MISSING_OTHER: every other MISSING name, including places, incidental items, and characters named only in the previous session. Example: «the Grey Wolf», a creature named only in the text of the previous session, is in MISSING_OTHER. So is the place «the Ford».
   - REQUIRED_CHARACTERS: characters with NO name in MASTER_MESSAGE that the master's request needs, in these cases ONLY (they are described by role; with IMAGINATION `no` they get no name and no sheet, see step 6b):
     - (a) the opponent or opponents of a fight, ambush or hunt the master asked for: the main opposing figure, or each distinct kind of opposing creature. A crowd of identical extras counts as ONE entry.
     - (b) the person who runs a place or a service the master asked for (an inn, a shop, a ferry), when that place or its document names nobody.
     Not required: background people, bystanders, a person the master did not ask for, and anything the master did not ask for. Example: «a fight against the bandit chief» gives one REQUIRED_CHARACTERS entry, for the chief. «a scene in a crowded market» gives none.
     If a subject of the documents read already fits the role clearly (for example, the existing sheet of the bandit chief), skip the entry and use that subject instead: add its id to KNOWN_NEW (step 6b keeps this list), and create no sheet for it.
   Only MISSING_CHARACTERS, MISSING_ITEMS and applicable REQUIRED_CHARACTERS get sheets. Do not create a document for a MISSING_OTHER name.
6. With IMAGINATION `yes` only: each named character that you decide to invent for the scenes (step 7) is added to REQUIRED_CHARACTERS now, by its role, so that step 6b gives it a sheet before the draft is written. Its name is chosen in step 6b, as for the other REQUIRED_CHARACTERS entries.
- Output: the list of documents read (paths), subject ids, MISSING_CHARACTERS, MISSING_ITEMS and MISSING_OTHER, REQUIRED_CHARACTERS entries (described by role, not by name), and KNOWN_NEW ids of any skipped entry.

**Step 5 — Source notes.** Using only the documents already read in Step 4, note any explicit incompatible statements about the same fact in CONTESTED, with the fact and both document paths. These facts must not appear in the draft. Put other relevant unresolved or uncertain details in NOTES. Do not run continuity-audit or launch another reviewer here; the write sequence reviewer checks relevant canon before saving. Output: CONTESTED and NOTES (either may be empty).

**Step 6 — Characters' entry points.** Read every document in the category whose `type` is `master-only` in `structure` of `campaign.yaml` (these are the players' characters). For each such document that names a subject of step 4, write one line: which character, and the hook written there. Keep these as ENTRY_POINTS. If none, ENTRY_POINTS is empty.
- Output: the ENTRY_POINTS list (may be empty).

**Step 6b — Character sheets.** Keep four lists, all empty at first: SHEET_DRAFTS (campaign paths of the sheet drafts), NEW_CHARACTERS (subject ids of new sheets), KNOWN_NEW (subject ids of sheets that already exist; keep ids added in Step 4), and PROPOSED_NOTES (for each character created with PROPOSE `yes`: name and proposed sections). With IMAGINATION `no`, skip REQUIRED_CHARACTERS entries. If there are no MISSING_CHARACTERS and no applicable REQUIRED_CHARACTERS, skip this step and go to Step 7.

Otherwise prepare the ordered CHARACTERS list: first each name in MISSING_CHARACTERS, then each REQUIRED_CHARACTERS entry when IMAGINATION is `yes`. For each item choose NAME (the master's name, or a 1–3 word name fitting the campaign language and the places and documents read for a required role). A chosen name must not equal any form in `subjects.json` and must not be a famous name from a book, film or game. Choose TEMPLATE using the numbered rules below, LOCATION from the main place ids of Step 4 (for enemy or creature, where it lives; empty means errant), DETAILS copied only from MASTER_MESSAGE, PROPOSE (`yes` whenever IMAGINATION is `yes`, otherwise `no`), IMAGINATION as given, and REQUESTED_BY empty. Do not invent DETAILS. For TEMPLATE, use the first matching rule: vendor (sells/buys goods or runs a shop, stall, forge or inn with goods and prices); enemy (hostile, fought, monster/beast that attacks, hunts or guards); creature (animal/beast only described or used, not fighting); npc (every other person). If multiple match, the earlier rule wins.

Invoke `yllir:npc-manager` once with `MODE=create-batch`, the ordered `CHARACTERS` list, and `CONTINUE_WITH="prepare-session step 6b: read the npc-manager batch report, then step 7"`. If your tool cannot invoke a named skill, read `${CLAUDE_PLUGIN_ROOT}/skills/library/npc-manager/SKILL.md` and follow it with these inputs. Read `.campaign/state/npc-manager/batch-report.txt`. Require its declared overall status and exactly one ordered block per input item; every block must contain all fields defined by the batch report format, use a recognized item status, and have valid status-dependent values (a `DONE` result must be exactly one of a draft plus new subject id, or an existing subject id; other statuses must not supply either). If the report is missing or fails this schema, end with `status: FAILED` and the normal plain-language failure sentence; consume no item result. For each valid draft, require a safe campaign-relative path beginning exactly `.campaign/state/write/draft/`, reject absolute paths and any `..` component, strip that prefix, and store the remainder in SHEET_DRAFTS. Add the paired new subject id to NEW_CHARACTERS and keep `proposed:` sections; add an existing id to KNOWN_NEW. If any item is `ASK`, ask its `question:` in plain words and stop before drafting. For other non-DONE items, note the name for the final message. An overall `INCOMPLETE` report is valid: continue with successful drafts and record failed items. Output SHEET_DRAFTS, NEW_CHARACTERS, KNOWN_NEW, PROPOSED_NOTES, names assigned to REQUIRED_CHARACTERS, and names without a sheet.

A character whose details are empty still gets a sheet with open sections marked to be defined. If PROPOSE is `yes`, report those proposals in PROPOSED_NOTES for the final message.

**Step 6c — Item sheets.** Keep ITEM_DRAFTS, NEW_ITEMS and KNOWN_ITEMS empty at first. Include master-named items and significant items needed by planned scenes; significance means the master requested it or it has notable value, effects, secrets, or a plot role. Do not create sheets for scenery or incidental props. If MISSING_ITEMS is not empty, invoke `yllir:item-manager` once per item, in that order, with `MODE=create`, `NAME=<item name>`, `LOCATION=<known current place id or empty>`, `DETAILS=<only details stated by the master or canon>`, `REQUESTED_BY=<campaign-relative paths that need the item>`, `IMAGINATION=<yes or no>`, `FILES=<relevant sheets and plot documents already read>`, and `CONTINUE_WITH="prepare-session step 6c: read the item-manager report, then step 7"`. If your tool cannot invoke the named skill, read `${CLAUDE_PLUGIN_ROOT}/skills/library/item-manager/SKILL.md` and follow it with those inputs. Record the invocation under the local feedback protocol. Read `.campaign/state/item-manager/report.txt` after each call. Accept only a valid report: `DONE` with `draft:` must begin exactly `.campaign/state/write/draft/`, be relative and contain no `..` component; strip that prefix once to get the campaign-relative path for ITEM_DRAFTS. Add `new subject:` to NEW_ITEMS. `DONE` with `exists:` adds the id to KNOWN_ITEMS; `ASK` asks its question and stops; other statuses record the item as unavailable for the final message and continue. A missing or malformed report is a process failure. Never invent effects or current location. Unknown effects stay out of public claims and are reserved only when the master explicitly stated a secret; unknown location is empty. Keep plot actions and chronology in scene files, never item sheets. Output ITEM_DRAFTS, NEW_ITEMS and KNOWN_ITEMS.
**Step 7 — Draft.** Write the session as drafts under `.campaign/state/write/draft/`, each at `.campaign/state/write/draft/` followed by its campaign path from step 2. There are two kinds of file.

1. The main file, `<session name>/<session name>.md`. Use exactly this form:

```markdown
---
id: <new id>
depends_on: [<ids of depends_on, or nothing>]
location: [<ids of the main places from step 4, or []>]
arc: <arc name, always when the arc has a name, whether the master named it or it was inferred in step 2; if the arc has no name, delete this line>
generated: true
---

Generated file. Do not edit by hand.
```

2. ONE scene file per scene, `<events folder>/<scene title>.md`. Use exactly this form:

```markdown
---
id: <scene id, see the rules below>
session: <new id>
depends_on: []
location: [<ids of the main places of the scene, or []>]
characters: [<ids of the characters of the scene, or []>]
items: [<ids of the significant items used in this scene, or []>]
---

_<one narration paragraph that opens the scene>_

## <minor action>

<text>

### <check title>

- **Successo:** <what happens on success>
- **Fallimento:** <what happens on failure>
```

Rules for the draft:
- Write 2 to 4 scenes, one scene file each. The scene file name is the scene title, without the characters `/ \ : * ? " < > |`. The text of a scene file has no `#` title line: the file name is the title, and the text starts with the narration paragraph.
- The scene id is `<new id>-e<NN>`, where `<NN>` is the scene number with two digits, from `01`, in the order of the scenes. Example: `the-long-night-02-e01`.
- The `depends_on` of EVERY scene is `[]` in the draft, the first one and the later ones alike. Do not put the id of another scene there, even if MASTER_MESSAGE says the scenes happen in order. The links between the scenes are decided later, in Step 8b, by the plot-map skill, which reads the scene files. The draft does not decide them, and you do not guess them.
- The main file has no scene text. It is generated from the scene files: write only the form above.
- Each scene opens with ONE `_italic_` narration paragraph. Italic is only for read-aloud narration.
- Use `##` for minor actions inside a scene.
- Use at least one `###` check in the whole session (over all the scene files). Each check has a `- **Successo:**` line and a `- **Fallimento:**` line.
- The campaign has no game rules. Write the difficulty of a check as «difficoltà da definire» in Italian, «difficulty to be set» in English, or the translation. Do not invent numbers. This is the rule with IMAGINATION `no`. With IMAGINATION `yes`, the difficulty rule is:
  1. Read `system.adapter` in `campaign.yaml`.
  2. If `system.adapter` is set to a system, write the difficulty as that system's rules give it, through the adapter as the rules of the system allow. If the rules give no value, write a plain-text difficulty (step 3).
  3. If `system.adapter` is `none` or absent, write a plain-text difficulty in the campaign language, for example «difficile» or «facile» in Italian, «hard» or «easy» in English. Never a number.
- Put master notes in a ``` block (three backticks, the note, three backticks). Do not use `>` for master notes. Use `>` only for a message addressed to the players.
- Use only what MASTER_MESSAGE, the documents of step 4 and the previous session say.
- Never decide which of two contradicting documents is right. Never state a CONTESTED fact in the draft: write the scene without it (for example, do not name how two characters are related). Avoid every CONTESTED fact, including in narration and in master notes.
- You may invent scene events and unnamed extras (for example «a fisherman»).
- You may NOT add a named place. You may use a named character only if it is in NEW_CHARACTERS (new sheet) or KNOWN_NEW (existing sheet); with IMAGINATION `yes`, this includes the characters created for REQUIRED_CHARACTERS. You may NOT add a named character that is neither required by the master's request nor named by the master. With IMAGINATION `no`, a REQUIRED_CHARACTERS entry has no name and no sheet: if the scene needs it, write it as its role in plain words (for example «the bandit chief»), with no proper name, like an unnamed extra, and do not list it in `characters`. You may NOT define or change who a known subject is.
- With IMAGINATION `yes`, the limits above are widened as follows, and only as follows:
  1. You may invent named characters: each one is planned in step 4 (item 6) and gets a sheet in step 6b. You may use it in the scene only after that, and it is listed in `characters` as any other character.
  2. You may invent named places. No document is created for a place (the scope rule above still holds): the place appears as a plain name in the text and is listed in the final message as having no document yet, as for MISSING_OTHER.
  3. You may invent game-rule details: the difficulty, as the rule above says for `yes`.
  4. You may invent background: history, relations between characters, past events. Use it only in the scene text, never as a fact about a known subject. A known subject's identity is still fixed by its sheet and the canon, and a CONTESTED fact stays out.
  5. Invented content is never written as a quote of a source and never gets a source reference.
  6. Never contradict the canon, the documents read in step 4, or the previous session. An invented detail that contradicts one of them is not written.
  7. A secret, and anything the master must not see, goes ONLY in a ``` master-only note in the scene file. Never in public text, and never in a `>` line.
  8. Whatever the master or a document states still wins and is copied as is. Invention only fills what is missing.
- Every named character who acts or speaks in a scene is listed in that scene's `characters`, and has a sheet: an existing subject, or one of NEW_CHARACTERS or KNOWN_NEW. The `characters` list may hold ids of sheets of any kind: npc, vendor, enemy or creature.
- List an item id in optional `items: [id]` metadata when the scene uses a significant item with a sheet. This is derived metadata, not a chronology or item state record.
- A scene text names the character and says what they do. It never states or changes who the character is (role, looks, personality, motives, secrets): such facts live only in the sheet.
- A scene may make a character do things the sheet does not mention, but never against what the sheet says. If the only way to write an event is to contradict the sheet, write the scene without that action, and say so in the final message (step 9).
- A name from MISSING_OTHER appears as plain text, with a note in a ``` block saying that its document does not exist yet.
- Output: the main file and every scene file exist at their draft paths.

**Step 8 — Write sequence.** Invoke the skill `yllir:write-sequence` (if your tool has no way to invoke a skill, read `${CLAUDE_PLUGIN_ROOT}/skills/core/write-sequence/SKILL.md` with the Read tool or `cat`, and follow it exactly as if it had been invoked, with the same inputs) with:
- `DOCUMENTS=<main file>, <scene file 1>, <scene file 2>, ..., <every path of SHEET_DRAFTS>, <every path of ITEM_DRAFTS>` (campaign paths, comma-separated: main file first, then scene files, then character and item sheets)
- `INTENT="Session preparation for <arc>: new scenes; may add scene events and unnamed extras; must not define or change the identity of existing subjects; new named characters only through their own new sheet, listed in characters; significant new items only through their own item sheet, listed in items metadata; no new places; sheets define what a subject is and scenes only what happens."`
- `NEW_SUBJECTS=<NEW_CHARACTERS and NEW_ITEMS, comma-separated>` (empty if both are empty: sessions are not subjects)
- `CONTEXT_FILES=<existing document paths read in step 4 plus the previous session's main and scene files, comma-separated>` (read-only context for the write-sequence canon reviewer)
- `VERSION_MESSAGE=` the sentence «Preparata la sessione «<session name>»» for `it`, «Prepared the session «<session name>»» for `en`, or the translation into the campaign language
- `ROUND=1`
- `CONTINUE_WITH="prepare-session step 8: read the write report and act on its status"`
- when IMAGINATION is `yes`, the INTENT ends with this exact sentence, after a space: `The master allowed invented details: new names, places, history, relations and rules that no source gives are allowed; contradictions with the canon are not.` When IMAGINATION is `no`, the INTENT has no such sentence.

After invoking it, read `.campaign/state/write/report.txt` with the Read tool. The report is for you, never for the master: do not show it or quote it.

Loop, starting with `ROUND=1`. Read `.campaign/state/write/report.txt`. Then:
- If status is `FIX_NEEDED` or `VERIFY_FAILED`: open the draft, fix exactly each problem listed under `details` (if a problem is a contested fact, remove that fact), save the draft, and invoke `yllir:write-sequence` again with `ROUND` plus one and the same other inputs. Do this up to `ROUND` 3. Do not stop after the first fix: each fix is followed by a new invocation.
- If status is `ASK`: ask the master the question from the report in plain words, and stop.
- If status is `DONE`: do the links check below, then go to step 8b.
- If status is `FAILED`, or any other status: go to the failure sentence below, and stop.

After a failed `ROUND` 3 (still `FIX_NEEDED` or `VERIFY_FAILED`), or after `FAILED`: tell the master in one plain sentence, in the campaign language, that the session could not be completed and why, in plain words. Do not mention rounds, statuses, problems or paths. Stop.

**Links check.** Run after the loop reaches `DONE`, in this order:
1. Read the `links:` line of `.campaign/state/write/report.txt`. If NEW_CHARACTERS or KNOWN_NEW is not empty and that line says `links: FAILED` or `links: applied 0`, do not tell the master that the links were made: the final message (step 9) must contain one plain sentence that the character names in the scenes are not linked yet. Never show the report.
2. NEW_SUBJECTS must contain every id of NEW_CHARACTERS (it does, from the inputs above). That is what makes the linker link the new sheets to the scenes.

Output: `status: DONE`.

**Step 8b — Link the scenes.** Run after `status: DONE` of Step 8, and before Step 9. Invoke the skill `yllir:plot-map` (if your tool has no way to invoke a skill, read `${CLAUDE_PLUGIN_ROOT}/skills/library/plot-map/SKILL.md` with the Read tool, and follow it exactly as if it had been invoked) with:
- `MODE=link-events`
- `SESSIONS=<the id of the new session>`
- `CONTINUE_WITH="prepare-session step 9"`

When it has finished, read `.campaign/state/plot-map/report.txt` with the Read tool. The report is for you, never for the master: do not show it or quote it. If the file is missing, treat the status as `FAILED`.
- Whatever the `status` of the report, go to Step 9.
- If the `status` is `FAILED`: add nothing about the linking to the message for the master.
- Output: the scenes linked, or the linking attempted and failed. Either way, the report has been read.

**Step 9 — Message for the master.** Only after `status: DONE`. Write ONE message in the campaign language, in plain words:
- one sentence: the session is ready, with its name (the session name, without `.md`);
- the scenes may be mentioned in plain words, only if useful: never their file names or ids;
- if any prerequisite was not played: the message MUST contain one sentence that names those sessions and says they were not played yet, using the word «played» in the campaign language (for Italian: «giocata»). This holds even when the master told you to go on without asking;
- if MISSING_OTHER is not empty: one sentence «these have no document yet: <names>»;
- for each item in NEW_ITEMS: one sentence naming the item and saying its item sheet was created; for each in KNOWN_ITEMS, say that its sheet already exists; for each item not created, say that its document is still missing;
- for each character in NEW_CHARACTERS: one plain sentence per new sheet, by name, saying what kind of sheet was made, in the master's words: «a character» («un personaggio» in Italian), «a seller» («un venditore»), «an enemy» («un nemico») or «an animal» («un animale»). The master can say to change it. For a character created with no details, add one plain sentence that the sheet exists and what is still to be defined (the `open points:` lines of the NPC REPORT, in plain words). Never write the word template;
- for each character created for REQUIRED_CHARACTERS (IMAGINATION `yes` only), or with PROPOSE `yes`: one plain sentence, by name, saying that the name (if the assistant chose it) and the sections listed in PROPOSED_NOTES (such as appearance, manner or nature, in plain words, never section ids) are the assistant's own proposal, and that the master can ask to change them. Example in English, to be written in the campaign language: «I created Garrick, the bandit chief, and I chose his looks and manner myself: tell me if you want them different.» For such a character whose statistics are still to be defined (the report says so), say in plain words that the statistics are still to be defined;
- with IMAGINATION `no`, and an entry of REQUIRED_CHARACTERS got no name and no sheet: one plain sentence that these characters have no sheet and no name yet, and that the master can ask the assistant to invent them. Give them no name. If there is no such entry, write no sentence.
- for each character in KNOWN_NEW: one sentence, by name, that the character already has a sheet, using the master-facing words for character sheets in the lexicon («Schede dei personaggi» in Italian, «Character sheets» in English);
- for each character that got no sheet under step 6b: one sentence that this character has no sheet yet;
- for each scene written without an action that would have contradicted a sheet (step 7): one plain sentence saying what was left out;
- with IMAGINATION `yes`, and only if something was invented beyond the sheets: one plain sentence that names what was invented by character and scene name, and any invented place, in the form «I invented X and Y, and the scenes Z and W: tell me if you want them different». If nothing was invented, no sentence. An invented character is named here too, even if its sheet sentence is already given above;
- each NOTE from step 5, in one plain sentence;
- each CONTESTED fact from step 5, in one plain sentence: which two documents disagree, and that the session was written without that fact. Never choose a version;
- for each ENTRY_POINTS line, one sentence: which character can enter the scene, and how;
- one sentence on what the master can do next (for example «say what happens in the first scene, and I will change it»).

No paths, no ids, no codes, no backticks, no formatting marks. The report of Step 8b is never shown: do not write its NOTE lines, and nothing else from it. The NPC batch report of step 6b is never shown either, and the words template and sheet-template never appear.

## Mode: revise

**When this mode runs.** The process runner's prompt has `MODE: revise`. The master asked to change some scenes of a session that is already prepared and NOT yet played (for example «change the debt of the workers, the delivery of the documents: update these scenes»). In this mode the process rewrites only the named scenes, and the session main file only if its own text depends on them. It never creates a session, a folder or a sheet that is not needed for a new character, and it never touches a file of another session.

Do the steps R1 to R9 in order. Each one says which of the Steps of MODE `new` it reuses: follow those Steps exactly as they are written, with the inputs named there. The commands rule and the questions rule of the top of this file apply here too.

**R1 — Map.** Run Step 1 (Map) as written: the map is written and read, and its exit code rules apply as there. Keep `sessions`, `arcs` and `errors`.

**R2 — Target and scenes.**
- The target session is the session that MASTER_MESSAGE names (by its name, for example «Session 2»). If it names no session, the target is the session whose scene titles MASTER_MESSAGE names. Only the sessions in `sessions` can be the target.
- If the target is still not clear, or two sessions are plausible: ask the master ONE question, in plain words, naming the candidate sessions by their names, and stop.
- Read the `played` value of the target in `sessions`. If it is `true`: write nothing. Your message for the master is exactly the fixed sentence of the lexicon for a session already played, in the campaign language, and stop.
- The scenes of the target are the items of its `events` list in `sessions`. Each item has a `file`. The title of a scene is its file name without the ending `.md`. Match each scene name in MASTER_MESSAGE with these titles, ignoring case and accents.
- If a scene name matches no scene of the target, or MASTER_MESSAGE does not say which scene to change: ask the master ONE question in plain words, naming the scenes of that session by their titles, and stop.
- If MASTER_MESSAGE asks to add a scene, remove a scene, or move a scene to another session: say in one sentence that this version changes the text of existing scenes only, and stop. Write nothing.
- Output: TARGET (id and name), CHANGED_SCENES (titles and campaign paths), and the master's new decisions for each scene, in plain words.

**R3 — Dependent sessions (read only).** The sessions whose `depends_on` list contains the id of TARGET are DEPENDENT. Keep their names and their main file paths. They are read in R4 and NEVER written in this mode. Output: DEPENDENT (may be empty).

**R4 — Documents involved.** Read, with the Read tool, the whole text (master-only notes included) of:
- the main file of TARGET;
- every scene file of TARGET, the changed ones and the unchanged ones (the unchanged ones give the context);
- the main file of each DEPENDENT session;
- the documents involved: run Step 4 (Documents involved) as written, with MASTER_MESSAGE as the source of names. A name MISSING from the subjects is treated as in Step 4: only a new named character gets a sheet, in R6.
Output: the paths read, the subject ids, MISSING_CHARACTERS and MISSING_OTHER.

**R5 — Source notes.** Using only the documents already read in R4, note explicit incompatible statements about the same fact in CONTESTED, with the fact and both document paths. Put other relevant unresolved or uncertain details in NOTES. The master's new decisions in R2 are not yet campaign facts; the write-sequence reviewer checks the existing canon and drafts before the write. Do not invoke continuity-audit here. Output: CONTESTED and NOTES (either may be empty).

**R6 — Character sheets.** If MISSING_CHARACTERS is empty and no REQUIRED_CHARACTERS entry applies, skip this step. Otherwise run Step 6b (Character sheets) as written, for these names and entries only. REQUIRED_CHARACTERS applies in this mode only with IMAGINATION `yes`, and only to the characters that the NEW request text needs (the master's new decisions of R2, read from MASTER_MESSAGE), computed as in Step 4: no name given, and the opponent of a fight or the person running a place or service the master asked for. A required character that an existing subject already fits is skipped, as in Step 4. Output: SHEET_DRAFTS, NEW_CHARACTERS, KNOWN_NEW, PROPOSED_NOTES, the names given to the REQUIRED_CHARACTERS entries, and the names with no sheet (may be empty).

**R7 — Draft.** Only the changed scenes (and the main file, if it changes) are drafted. For each one, write the draft at `.campaign/state/write/draft/` followed by its campaign path, as in Step 7.
- Start from the text you read in R4. Copy the whole current text exactly, then change only the parts that the master's new decisions require. For example, a scene that now has a new named character lists her id in `characters`.
- Keep byte for byte: the file name, the `id`, `session` and `depends_on` lines of a scene, and every paragraph the change does not touch. Do not reformat the rest, do not reword it, and do not add or remove a scene.
- The `depends_on` line of a scene is NOT set to `[]` in this mode: keep its current value. Step 8b (run in R9) decides the links again when the events changed.
- The text you write follows the rules of Step 7 (one `_italic_` narration paragraph opens a scene; `##` for minor actions; difficulties as «difficoltà da definire»; master notes in a ``` block; no named place; no CONTESTED fact; a named character only as in Step 7). The rule of Step 7 that asks for `###` checks in the whole session does not apply here.
- The main file is changed only if its own text (outside the generated line «Generated file. Do not edit by hand.») depends on the change. It normally does not. Never change its `id`, `depends_on` or `arc`.
- Output: one draft per changed file, at its draft path.

**R8 — Write sequence.** Run Step 8 (Write sequence) as written, with these differences:
- DOCUMENTS = the draft paths of the changed scene files, then the main file of TARGET only if it changed, then every path of SHEET_DRAFTS (campaign paths, comma-separated; nothing else is added);
- INTENT = "Session revision for <session name>: only the text of the named scenes changes; ids and file names stay; no other session changes; new named characters only through their own new sheet, listed in characters; sheets define who a character is and the scenes only what they do."
- VERSION_MESSAGE = the sentence «Rivista la sessione «<session name>»» for `it`, «Revised the session «<session name>»» for `en`, or the translation into the campaign language;
- when IMAGINATION is `yes`, the INTENT ends with the same sentence as in Step 8, after a space; when `no`, it does not;
- NEW_SUBJECTS, ROUND and CONTINUE_WITH as in Step 8, with CONTINUE_WITH = "prepare-session revise R8: read the write report and act on its status".
- CONTEXT_FILES = the existing paths read in R4, comma-separated (target and dependent session files and existing subject documents; read-only context for the canon reviewer).
The loop and the links check of Step 8 apply unchanged. Output: `status: DONE`, or the failure of Step 8.

**R9 — Links and message.** Only after `status: DONE` of R8.
1. Run Step 8b (Link the scenes) as written, with SESSIONS = the id of TARGET and CONTINUE_WITH = "prepare-session revise R9". Its report is read as Step 8b says. If its report is `FAILED` only with the note «no depends_on changed», the links were already right: treat it as done and say nothing about the linking.
2. Write ONE message for the master, in the campaign language, in plain words, following the rules of Step 9 (no paths, ids, codes or backticks; the reports are never shown). It contains:
   - one sentence: the scenes that changed, by their titles, and in one short sentence each what changed, from the master's own words;
   - one sentence: what stayed as it was (the other scenes of the session, and the other sessions);
   - for each DEPENDENT session: one sentence that it was not changed and may need a look, by its name;
   - the sentences of Step 9 for NEW_CHARACTERS, KNOWN_NEW, the no-name sentence for REQUIRED_CHARACTERS (IMAGINATION `no`), the characters with no sheet, the scenes written without an action that would have contradicted a sheet, NOTE and CONTESTED. The prerequisite sentence of Step 9 does not apply;
   - one sentence on what the master can do next.
   In this mode the message never says that a session was prepared or created.

## Examples

Correct: the master writes «prepare the next session of the Old Mill arc». The arc is named, the previous session is played, and the draft uses only the master's words and the previous session. Varn is in the previous session, and it has a document, so it is read and kept as it is. The draft includes an unnamed «fisherman» and no new named character. The message for the master names the session, says that the check found nothing to note, and suggests one next step.

Correct (new named character): the master writes «Brenna is the innkeeper of the Old Mill». Brenna has no document, and the master named her, so she is MISSING_CHARACTERS. Step 6b invokes `yllir:npc-manager`, which makes her sheet as a draft. The scene lists her in `characters` and says what she does, for example «Brenna pours the ale». The scene does not say what kind of person she is: that is in the sheet.

Correct (kind chosen by the process): the master writes «Grigio, a wolf, guards the mill». The wolf has a name, so it needs a sheet. The context says it guards the mill, so step 6b rule 2 applies and TEMPLATE is `enemy`. The process never asks the master what kind it is. The message says «an enemy» in plain words, and the scene lists the wolf in `characters`. If the master wrote only «a wolf guards the mill», the wolf has no name: it gets no sheet and appears in the scene as an unnamed extra.

Wrong (asking the master for the kind): the process asks the master «is it an npc or a creature?». The kind is decided in step 6b from the context. Never ask it.

Wrong (writing the sheet by hand): the process writes `Characters/Brenna.md` with its own tools, or copies a sheet into the campaign. This is forbidden: a sheet is made only through `yllir:npc-manager`, and its draft goes through the write sequence.

Correct (IMAGINATION `yes`): the master writes «prepare a session at the mill, you can invent the people and the scenes» and the message has no named character. The process plans a named miller in step 4 (item 6), so step 6b makes his sheet, with `IMAGINATION=yes` and `PROPOSE=yes`. The scene «The Wheel» lists him in `characters` and says what he does, and the difficulty of the check is written in plain text. The final message says in one sentence that the miller and the scene «The Wheel» were invented, and that the master can change them.

Wrong (IMAGINATION `yes`, an invented fact that contradicts the canon): the previous session says the ford is held by the bandits, and the draft, with the freedom of IMAGINATION `yes`, says that the ford is now a free village market. That contradicts the documents read in step 4, so it is not written. The scene must follow the canon: the bandits hold the ford. Invention is allowed only where the canon is silent.

Wrong (inventing a named character the request does not need): the master asks for a scene in a field, with no inn requested, and the draft says «the innkeeper, Oswin, pours the ale». Oswin is named by no one and the request does not need him, so he may not be added. Write «the innkeeper» instead, or «a fisherman» for an unnamed extra.

Correct (required character, no name, IMAGINATION `yes`): the master writes «prepare a fight against the bandit chief at the ford». No name is given and the fight needs an opponent, so the chief is in REQUIRED_CHARACTERS. The process chooses the name «Garrick», TEMPLATE `enemy` (rule 2 of step 6b, since the master wants a fight), and PROPOSE `yes`. The scene lists him in `characters`, and the message says that his name and looks are the assistant's proposal.

Correct (required character, no name, IMAGINATION `no`): the master writes «prepare a fight against the bandit chief at the ford» and nothing more. No name is given and IMAGINATION is `no`, so the chief gets no name and no sheet. The scene says «the bandit chief» in plain words, with no proper name. The final message says in one plain sentence that these characters have no sheet and no name yet, and that the master can ask the assistant to invent them.

Wrong (IMAGINATION `no`, required character named anyway): the process chooses the name «Garrick» and writes his sheet. Forbidden: without IMAGINATION `yes`, a required character gets no name and no sheet.
