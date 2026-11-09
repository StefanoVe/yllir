---
name: prepare-session
description: Core process. Prepares the next session of a Yllir campaign as a new session (a main file and one file per scene): checks what was played, reads the documents involved, runs a read-only continuity check, drafts the scenes and writes them through the write sequence. Runs inside the process runner.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/plot-map/scripts/plot-map.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/build-index.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/new-campaign/scripts/add-category.mjs" *), Read, Write, Skill
---

# Prepare session

Prepares the next session as a new session folder: a main file and one file per scene. Run every command from the campaign root (the folder that contains `campaign.yaml`). Keep every value you read from a script, and never guess one.

**Commands.** Run each command exactly as written in this file, as one single command: nothing before it and nothing after it, no `;`, `&&`, `|`, `2>&1`, `echo`, `cat`, `mkdir` or `cd`. Anything added makes the command refused. Every script prints its result and, as its last line, `exit: <code>`: read the exit code from that line (the `exit:` line). Read result files with the Read tool. If a command is refused, run it again exactly as written, with nothing added; if it is refused again, end this skill with `status: FAILED`, reason "permission refused".

**Scope of this version.** This process:
- creates a NEW session (its main file and its scene files);
- does NOT rewrite an existing session. If the master asks to change an existing session, say in one sentence that this is not available yet, and stop;
- never creates character, creature, place or item documents. A name with no document is listed as missing, and nothing is created for it.

**Questions to the master.** Ask the master in plain words, then stop. Write the question as your message; the process runner turns it into a QUESTION result.

**Inputs.** MASTER_MESSAGE is the master's request, as given by the process runner.

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
5. A name the master uses that matches no subject is MISSING. Do not create a document for it.
- Output: the list of documents read (paths), the list of subject ids, and the MISSING names.

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
depends_on: [<id of the previous scene, or nothing>]
location: [<ids of the main places of the scene, or []>]
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
- The `depends_on` of the first scene is `[]`. The `depends_on` of a later scene lists the id of the previous scene ONLY if MASTER_MESSAGE says the scenes happen in that order; otherwise it is `[]`.
- The main file has no scene text. It is generated from the scene files: write only the form above.
- Each scene opens with ONE `_italic_` narration paragraph. Italic is only for read-aloud narration.
- Use `##` for minor actions inside a scene.
- Use at least one `###` check in the whole session (over all the scene files). Each check has a `- **Successo:**` line and a `- **Fallimento:**` line.
- The campaign has no game rules. Write the difficulty of a check as «difficoltà da definire» in Italian, «difficulty to be set» in English, or the translation. Do not invent numbers.
- Put master notes in a ``` block (three backticks, the note, three backticks). Do not use `>` for master notes. Use `>` only for a message addressed to the players.
- Use only what MASTER_MESSAGE, the documents of step 4 and the previous session say.
- Never decide which of two contradicting documents is right. Never state a CONTESTED fact in the draft: write the scene without it (for example, do not name how two characters are related). Avoid every CONTESTED fact, including in narration and in master notes.
- You may invent scene events and unnamed extras (for example «a fisherman»).
- You may NOT add a named character or a named place. You may NOT define or change who a known subject is.
- A name from MISSING appears as plain text, with a note in a ``` block saying that its document does not exist yet.
- Output: the main file and every scene file exist at their draft paths.

**Step 8 — Write sequence.** Invoke the skill `yllir:write-sequence` (if your tool has no way to invoke a skill, read `${CLAUDE_PLUGIN_ROOT}/skills/core/write-sequence/SKILL.md` with the Read tool or `cat`, and follow it exactly as if it had been invoked, with the same inputs) with:
- `DOCUMENTS=<main file>, <scene file 1>, <scene file 2>, ...` (campaign paths, comma-separated, main file first)
- `INTENT="Session preparation for <arc>: new scenes; may add scene events and unnamed extras; must not define or change the identity of existing subjects; no new named characters or places."`
- `NEW_SUBJECTS=` (empty: sessions are not subjects)
- `VERSION_MESSAGE=` the sentence «Preparata la sessione «<session name>»» for `it`, «Prepared the session «<session name>»» for `en`, or the translation into the campaign language
- `ROUND=1`
- `CONTINUE_WITH="prepare-session step 8: read the write report and act on its status"`

After invoking it, read `.campaign/state/write/report.txt` with the Read tool. The report is for you, never for the master: do not show it or quote it.

Loop, starting with `ROUND=1`. Read `.campaign/state/write/report.txt`. Then:
- If status is `FIX_NEEDED` or `VERIFY_FAILED`: open the draft, fix exactly each problem listed under `details` (if a problem is a contested fact, remove that fact), save the draft, and invoke `yllir:write-sequence` again with `ROUND` plus one and the same other inputs. Do this up to `ROUND` 3. Do not stop after the first fix: each fix is followed by a new invocation.
- If status is `ASK` or `CONFLICT`: ask the master the question from the report in plain words, and stop.
- If status is `DONE`: go to step 9.
- If status is `FAILED`, or any other status: go to the failure sentence below, and stop.

After a failed `ROUND` 3 (still `FIX_NEEDED` or `VERIFY_FAILED`), or after `FAILED`: tell the master in one plain sentence, in the campaign language, that the session could not be completed and why, in plain words. Do not mention rounds, statuses, problems or paths. Stop.

Output: `status: DONE`.

**Step 9 — Message for the master.** Only after `status: DONE`. Write ONE message in the campaign language, in plain words:
- one sentence: the session is ready, with its name (the session name, without `.md`);
- the scenes may be mentioned in plain words, only if useful: never their file names or ids;
- if any prerequisite was not played: the message MUST contain one sentence that names those sessions and says they were not played yet, using the word «played» in the campaign language (for Italian: «giocata»). This holds even when the master told you to go on without asking;
- if MISSING is not empty: one sentence «these have no document yet: <names>»;
- each NOTE from step 5, in one plain sentence;
- each CONTESTED fact from step 5, in one plain sentence: which two documents disagree, and that the session was written without that fact. Never choose a version;
- for each ENTRY_POINTS line, one sentence: which character can enter the scene, and how;
- one sentence on what the master can do next (for example «say what happens in the first scene, and I will change it»).

No paths, no ids, no codes, no backticks, no formatting marks.

## Examples

Correct: the master writes «prepare the next session of the Old Mill arc». The arc is named, the previous session is played, and the draft uses only the master's words and the previous session. Varn is in the previous session, and it has a document, so it is read and kept as it is. The draft includes an unnamed «fisherman» and no new named character. The message for the master names the session, says that the check found nothing to note, and suggests one next step.

Wrong (creating a document): the draft mentions «Brenna the innkeeper», and the process creates `Characters/Brenna.md`. This is forbidden. Brenna has no document, so she is MISSING: she appears as plain text with a ``` note, and nothing is created.

Wrong (inventing a named character): the draft says «the innkeeper, Oswin, pours the ale». Oswin is a new named character. Write «the innkeeper» instead, or «a fisherman» for an unnamed extra.
