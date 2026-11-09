---
name: prepare-session
description: Core process. Prepares the next session of a Yllir campaign as a new session (a main file and one file per scene): checks what was played, reads the documents involved, runs a read-only continuity check, drafts the scenes and writes them through the write sequence. Runs inside the process runner.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/plot-map/scripts/plot-map.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/build-index.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/new-campaign/scripts/add-category.mjs" *), Read, Write, Skill
---

# Prepare session

Prepares the next session as a new session folder: a main file and one file per scene. Run every command from the campaign root (the folder that contains `campaign.yaml`). Keep every value you read from a script, and never guess one.

**Commands.** Run each command exactly as written in this file, as one single command: nothing before it and nothing after it, no `;`, `&&`, `|`, `2>&1`, `echo`, `cat`, `mkdir` or `cd`. Anything added makes the command refused. Every script prints its result and, as its last line, `exit: <code>`: read the exit code from that line (the `exit:` line). Read result files with the Read tool. If a command is refused, run it again exactly as written, with nothing added; if it is refused again, end this skill with `status: FAILED`, reason "permission refused".

**Scope of this version.** This process has two modes (see Inputs). In MODE `new` (the default) it:
- creates a NEW session (its main file and its scene files);
- does NOT rewrite an existing session. In MODE `new`, if the master asks to change an existing session, say in one sentence that this is not available yet, and stop. Changing an existing session is MODE `revise`, described in «Mode: revise»;
- creates a sheet through `yllir:npc-manager` for each NEW NAMED CHARACTER (person, vendor, enemy or creature) that MASTER_MESSAGE names or explicitly asks for, choosing the kind itself (step 6b);
- never creates place or item documents. A name of a place or item with no document is listed as missing, and nothing is created for it.

**Questions to the master.** Ask the master in plain words, then stop. Write the question as your message; the process runner turns it into a QUESTION result.

**Inputs.** MASTER_MESSAGE is the master's request, as given by the process runner. MODE is `revise` when the process runner's prompt has a line `MODE: revise`. In every other case (no MODE line, or `MODE: new`) MODE is `new`. In MODE `new`, follow the Steps below. In MODE `revise`, follow «Mode: revise» below and do not run the Steps except where «Mode: revise» refers to them.

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
5. A name the master uses that matches no subject is MISSING. Split the MISSING names in two lists:
   - MISSING_CHARACTERS: the names of persons, vendors, enemies or creatures that MASTER_MESSAGE names or asks to create, and that no subject matches. Example: the master writes «Maren is the innkeeper». Maren matches no subject, so she is in MISSING_CHARACTERS. Another example: the master writes «Garron, a named beast, hunts at the ford». Garron matches no subject, so he is in MISSING_CHARACTERS.
   - MISSING_OTHER: every other MISSING name, including places and items. Example: «the Grey Wolf», a creature named only in the text of the previous session, is in MISSING_OTHER. So is a person named only in the previous session, such as «Tomas». So is the place «the Ford».
   Only MISSING_CHARACTERS get a sheet (step 6b). Do not create a document for a MISSING_OTHER name.
- Output: the list of documents read (paths), the list of subject ids, and the MISSING_CHARACTERS and MISSING_OTHER names.

**Step 5 — Read-only check.** Invoke the skill `yllir:continuity-audit` (if your tool has no way to invoke a skill, read `${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/SKILL.md` with the Read tool or `cat`, and follow it exactly as if it had been invoked, with the same inputs) with:
- `MODE=pre`
- `FILES=<the documents read in step 4, plus the previous session's main file and scene files, comma-separated>`
- `SUBJECTS=<the subject ids of step 4, comma-separated>`
- `CHANGE="<one sentence: the session being prepared>"`
- `CONTINUE_WITH="prepare-session step 5: read the audit report, then step 6"`

When it has finished, read `.campaign/state/audit/report.txt` with the Read tool. Keep the problem lines that concern the subjects of step 4, in two lists:
- CONTESTED: each problem where two documents contradict each other about a fact (for example, how two characters are related). Record the fact in plain words, and the two documents involved. These are facts the draft must not state.
- NOTES: every other problem line that concerns these documents, in plain words.
These lists never block the preparation. If the file is missing, record "check not run" and go on.
- Output: the CONTESTED and NOTES lists (may be empty).

**Step 6 — Characters' entry points.** Read every document in the category whose `type` is `master-only` in `structure` of `campaign.yaml` (these are the players' characters). For each such document that names a subject of step 4, write one line: which character, and the hook written there. Keep these as ENTRY_POINTS. If none, ENTRY_POINTS is empty.
- Output: the ENTRY_POINTS list (may be empty).

**Step 6b — Character sheets.** Keep three lists, all empty at first: SHEET_DRAFTS (campaign paths of the sheet drafts), NEW_CHARACTERS (subject ids of the new sheets) and KNOWN_NEW (subject ids of sheets that already exist). If MISSING_CHARACTERS is empty, skip this step and go to step 7. Otherwise do the following for each name in MISSING_CHARACTERS, one name at a time:
0. Decide TEMPLATE for the name. Never ask the master for the kind. Use ONLY MASTER_MESSAGE, the previous session text and the documents read in step 4. Never guess from the name alone. Go through this numbered list and take the FIRST rule that matches:
   1. `vendor`: the context says the character sells or buys goods, or runs a shop, stall, forge or inn with goods and prices.
   2. `enemy`: the context says the character is hostile or will be fought, or is a monster or beast that attacks, hunts or guards (the master wants a fight, a threat, an ambush).
   3. `creature`: an animal or beast that is only described or used (mount, pet, livestock, wildlife) and does not fight.
   4. `npc`: every other person.
   A person who sells AND could fight is `vendor` (the richer model; never two sheets). If two rules fit, the lower number wins. Write the choice and a one-line reason in plain words, from the context, in your notes.
   Pass `TEMPLATE=<the choice>` to `yllir:npc-manager` in step 1.
1. Invoke the skill `yllir:npc-manager` with:
   - `MODE=create`
   - `NAME=<the name>`
   - `TEMPLATE=<the choice of step 0>`
   - `LOCATION=<the main place ids of step 4, comma-separated, or empty; for an enemy or creature, the places where it lives, and empty means errant>`
   - `DETAILS=<only what MASTER_MESSAGE says about this character, copied; empty if nothing>`
   - `REQUESTED_BY=` empty: the scene file names are decided in step 7, which runs after this step, so they are not known yet. Step 8 links the scenes to the new sheet anyway, through NEW_SUBJECTS.
   - `CONTINUE_WITH="prepare-session step 6b: read the npc-manager report, then step 7"`
   If your tool cannot invoke a named skill, read `${CLAUDE_PLUGIN_ROOT}/skills/library/npc-manager/SKILL.md` with the Read tool and follow it exactly as if it had been invoked, with the same inputs.
2. When it has finished, read `.campaign/state/npc-manager/report.txt` with the Read tool. This is the NPC REPORT. It is for you, never for the master: do not show it or quote it. If the file is missing, treat the status as `FAILED`.
3. Act on the `status:` line of the NPC REPORT:
   - `DONE` with a `draft:` path (not none): add the draft path to SHEET_DRAFTS, and add the `new subject:` id to NEW_CHARACTERS.
   - `DONE` with an `exists:` id (not none): the character already has a sheet. Add that id to KNOWN_NEW. Create nothing.
   - `ASK`: ask the master the `question:` line in plain words, in the campaign language, then stop. If the question is about statistics («Which statistics does ... have?»), ask exactly that question, in plain words, and stop. Never answer it yourself and never invent statistics.
   - `FAILED` with reason "no creature category": treat the name as MISSING_OTHER, and add to the final message (step 9) that this creature has no sheet yet.
   - `NOT_AVAILABLE`, any other `FAILED`, or the file is missing: treat the name as MISSING_OTHER. It appears as plain text with a ``` note, as in step 7. Add to the final message (step 9) that this character has no sheet yet.

A character with empty DETAILS still gets a sheet, with its sections marked as still to be defined. Step 9 tells the master what is still open.
- Output: SHEET_DRAFTS, NEW_CHARACTERS and KNOWN_NEW (may be empty), and the names of the characters with no sheet.

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
- The campaign has no game rules. Write the difficulty of a check as «difficoltà da definire» in Italian, «difficulty to be set» in English, or the translation. Do not invent numbers.
- Put master notes in a ``` block (three backticks, the note, three backticks). Do not use `>` for master notes. Use `>` only for a message addressed to the players.
- Use only what MASTER_MESSAGE, the documents of step 4 and the previous session say.
- Never decide which of two contradicting documents is right. Never state a CONTESTED fact in the draft: write the scene without it (for example, do not name how two characters are related). Avoid every CONTESTED fact, including in narration and in master notes.
- You may invent scene events and unnamed extras (for example «a fisherman»).
- You may NOT add a named place. You may add a named character only if it is in NEW_CHARACTERS (new sheet) or KNOWN_NEW (existing sheet). You may NOT define or change who a known subject is.
- Every named character who acts or speaks in a scene is listed in that scene's `characters`, and has a sheet: an existing subject, or one of NEW_CHARACTERS or KNOWN_NEW. The `characters` list may hold ids of sheets of any kind: npc, vendor, enemy or creature.
- A scene text names the character and says what they do. It never states or changes who the character is (role, looks, personality, motives, secrets): such facts live only in the sheet.
- A scene may make a character do things the sheet does not mention, but never against what the sheet says. If the only way to write an event is to contradict the sheet, write the scene without that action, and say so in the final message (step 9).
- A name from MISSING_OTHER appears as plain text, with a note in a ``` block saying that its document does not exist yet.
- Output: the main file and every scene file exist at their draft paths.

**Step 8 — Write sequence.** Invoke the skill `yllir:write-sequence` (if your tool has no way to invoke a skill, read `${CLAUDE_PLUGIN_ROOT}/skills/core/write-sequence/SKILL.md` with the Read tool or `cat`, and follow it exactly as if it had been invoked, with the same inputs) with:
- `DOCUMENTS=<main file>, <scene file 1>, <scene file 2>, ..., <every path of SHEET_DRAFTS>` (campaign paths, comma-separated: the main file first, then the scene files, then every path of SHEET_DRAFTS; if SHEET_DRAFTS is empty, nothing is added)
- `INTENT="Session preparation for <arc>: new scenes; may add scene events and unnamed extras; must not define or change the identity of existing subjects; new named characters only through their own new sheet, listed in characters; no new places; sheets define who a character is and the scenes only what they do."`
- `NEW_SUBJECTS=<NEW_CHARACTERS, comma-separated>` (empty if NEW_CHARACTERS is empty: sessions are not subjects, and only new character sheets are)
- `VERSION_MESSAGE=` the sentence «Preparata la sessione «<session name>»» for `it`, «Prepared the session «<session name>»» for `en`, or the translation into the campaign language
- `ROUND=1`
- `CONTINUE_WITH="prepare-session step 8: read the write report and act on its status"`

After invoking it, read `.campaign/state/write/report.txt` with the Read tool. The report is for you, never for the master: do not show it or quote it.

Loop, starting with `ROUND=1`. Read `.campaign/state/write/report.txt`. Then:
- If status is `FIX_NEEDED` or `VERIFY_FAILED`: open the draft, fix exactly each problem listed under `details` (if a problem is a contested fact, remove that fact), save the draft, and invoke `yllir:write-sequence` again with `ROUND` plus one and the same other inputs. Do this up to `ROUND` 3. Do not stop after the first fix: each fix is followed by a new invocation.
- If status is `ASK` or `CONFLICT`: ask the master the question from the report in plain words, and stop.
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
- for each character in NEW_CHARACTERS: one plain sentence per new sheet, by name, saying what kind of sheet was made, in the master's words: «a character» («un personaggio» in Italian), «a seller» («un venditore»), «an enemy» («un nemico») or «an animal» («un animale»). The master can say to change it. For a character created with no details, add one plain sentence that the sheet exists and what is still to be defined (the `open points:` lines of the NPC REPORT, in plain words). Never write the word template;
- for each character in KNOWN_NEW: one sentence, by name, that the character already has a sheet, using the master-facing words for character sheets in the lexicon («Schede dei personaggi» in Italian, «Character sheets» in English);
- for each character that got no sheet under step 6b: one sentence that this character has no sheet yet;
- for each scene written without an action that would have contradicted a sheet (step 7): one plain sentence saying what was left out;
- each NOTE from step 5, in one plain sentence;
- each CONTESTED fact from step 5, in one plain sentence: which two documents disagree, and that the session was written without that fact. Never choose a version;
- for each ENTRY_POINTS line, one sentence: which character can enter the scene, and how;
- one sentence on what the master can do next (for example «say what happens in the first scene, and I will change it»).

No paths, no ids, no codes, no backticks, no formatting marks. The report of Step 8b is never shown: do not write its NOTE lines, and nothing else from it. The NPC REPORT of step 6b is never shown either, and the words template and sheet-template never appear.

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

**R5 — Read-only check.** Run Step 5 (Read-only check) as written, with these differences:
- FILES = the paths read in R4 (the main file of TARGET, all its scene files, the main files of DEPENDENT sessions, and the documents involved), comma-separated;
- SUBJECTS = the subject ids of R4;
- CHANGE = "<one sentence: the revision of the scenes <titles> of the session <name>, with the master's new decisions in plain words>";
- CONTINUE_WITH = "prepare-session revise R5: read the audit report, then R6".
The new decisions of the master are what this check is about: it must find whether they contradict a document. The lists CONTESTED and NOTES are kept as Step 5 says. Output: CONTESTED and NOTES (may be empty).

**R6 — Character sheets.** If MISSING_CHARACTERS is empty, skip this step. Otherwise run Step 6b (Character sheets) as written, for these names only. Output: SHEET_DRAFTS, NEW_CHARACTERS, KNOWN_NEW, and the names with no sheet (may be empty).

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
- NEW_SUBJECTS, ROUND and CONTINUE_WITH as in Step 8, with CONTINUE_WITH = "prepare-session revise R8: read the write report and act on its status".
The loop and the links check of Step 8 apply unchanged. Output: `status: DONE`, or the failure of Step 8.

**R9 — Links and message.** Only after `status: DONE` of R8.
1. Run Step 8b (Link the scenes) as written, with SESSIONS = the id of TARGET and CONTINUE_WITH = "prepare-session revise R9". Its report is read as Step 8b says. If its report is `FAILED` only with the note «no depends_on changed», the links were already right: treat it as done and say nothing about the linking.
2. Write ONE message for the master, in the campaign language, in plain words, following the rules of Step 9 (no paths, ids, codes or backticks; the reports are never shown). It contains:
   - one sentence: the scenes that changed, by their titles, and in one short sentence each what changed, from the master's own words;
   - one sentence: what stayed as it was (the other scenes of the session, and the other sessions);
   - for each DEPENDENT session: one sentence that it was not changed and may need a look, by its name;
   - the sentences of Step 9 for NEW_CHARACTERS, KNOWN_NEW, the characters with no sheet, the scenes written without an action that would have contradicted a sheet, NOTE and CONTESTED. The prerequisite sentence of Step 9 does not apply;
   - one sentence on what the master can do next.
   In this mode the message never says that a session was prepared or created.

## Examples

Correct: the master writes «prepare the next session of the Old Mill arc». The arc is named, the previous session is played, and the draft uses only the master's words and the previous session. Varn is in the previous session, and it has a document, so it is read and kept as it is. The draft includes an unnamed «fisherman» and no new named character. The message for the master names the session, says that the check found nothing to note, and suggests one next step.

Correct (new named character): the master writes «Brenna is the innkeeper of the Old Mill». Brenna has no document, and the master named her, so she is MISSING_CHARACTERS. Step 6b invokes `yllir:npc-manager`, which makes her sheet as a draft. The scene lists her in `characters` and says what she does, for example «Brenna pours the ale». The scene does not say what kind of person she is: that is in the sheet.

Correct (kind chosen by the process): the master writes «Grigio, a wolf, guards the mill». The wolf has a name, so it needs a sheet. The context says it guards the mill, so step 6b rule 2 applies and TEMPLATE is `enemy`. The process never asks the master what kind it is. The message says «an enemy» in plain words, and the scene lists the wolf in `characters`. If the master wrote only «a wolf guards the mill», the wolf has no name: it gets no sheet and appears in the scene as an unnamed extra.

Wrong (asking the master for the kind): the process asks the master «is it an npc or a creature?». The kind is decided in step 6b from the context. Never ask it.

Wrong (writing the sheet by hand): the process writes `Characters/Brenna.md` with its own tools, or copies a sheet into the campaign. This is forbidden: a sheet is made only through `yllir:npc-manager`, and its draft goes through the write sequence.

Wrong (inventing a named character): the draft says «the innkeeper, Oswin, pours the ale». Oswin is a new named character. Write «the innkeeper» instead, or «a fisherman» for an unnamed extra.
