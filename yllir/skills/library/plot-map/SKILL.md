---
name: plot-map
description: Library skill. Reads the plot documents of a Yllir campaign, derives the status of every session (played, ready, waiting), reports the errors of the plot graph and generates the derived main file of each session (the concept map of its events). In mode link-events, declares how the events of a session depend on each other, from their text, and writes it through write-sequence. Invoked by Yllir core processes after any change to a plot document, after the update migrated old sessions, after new events of a session are created, or when asked to check the plot map. Never invoked for anything outside a Yllir campaign.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/plot-map/scripts/plot-map.mjs" *), Read, Edit, Write, Skill, Bash(node */skills/library/plot-map/scripts/plot-map.mjs *)
---

# Plot map

This skill is always invoked by another skill (for example prepare-session or after-session). The result of this skill is the file `.campaign/state/plot-map/report.txt`, not a message for the master. The invoking skill reads that file to know the result.

**Commands.** Run each command exactly as written in this file, as one single command: nothing before it and nothing after it, no `;`, `&&`, `|`, `2>&1`, `echo`, `cat`, `mkdir` or `cd`. Anything added makes the command refused. Every script prints its result and, as its last line, `exit: <code>`: read the exit code from that line (the `exit:` line). Read result files with the Read tool. If a command is refused, run it again exactly as written, with nothing added; if it is refused again, end this skill with `status: ERRORS`, reason "permission refused".

**Codex plugin-root fallback.** Keep using the commands as written when `PLUGIN_ROOT` or `CLAUDE_PLUGIN_ROOT` is available. If both are absent, take the absolute path of the active Yllir skill file shown in context, remove everything from `/skills/` onward to get the plugin root, substitute that absolute root directly for `${CLAUDE_PLUGIN_ROOT}` in each command, and run the resulting single command. Never prefix an inline variable assignment. If no reliable absolute path is visible, stop before running a script and report failure; do not claim the operation ran.

## What this skill owns

- Reading the plot documents (categories of type `plot`) and the chronicle pages (categories of type `chronicle`).
- The status of each session: played, ready (all its prerequisites are played), or waiting.
- The errors of the plot graph: broken metadata, unknown or circular dependencies, events in the wrong session, played sessions whose prerequisites are not played.
- The derived main file of each session: the concept map of its events, written from the files in its `Eventi/` (or `Events/`) folder.
- In mode `link-events`: the `depends_on` line of the events of a session, decided from the text of those events and written through `yllir:write-sequence`.

The script does all the mechanics. You only run the command, read its output, correct the source files when the map shows a source error, and write the report. In mode `link-events` you also read the events and decide their links, as described in that mode.

## When core calls this skill

- Mode `map`: after any change to a plot document: a new session, changed events, or changed dependencies (`depends_on`, `session`). Changes inside a scene that do not touch order, inputs, outputs or choices do not need it.
- Mode `link-events`: after the update migrated old sessions, and after new events of a session are created.

## Modes

- `map` (the default, used when `MODE` is absent or empty): the steps of "Mode `map`" below.
- `link-events`: the steps of "Mode `link-events`" below.
- Any other value of `MODE`: write the report with `status: ERRORS` and the single line `usage-error: unknown MODE <value>`, then do what CONTINUE_WITH says.

## Inputs

The caller gives:
- `MODE`: `map` (default) or `link-events`.
- `CHANGED`: mode `map` only. Campaign-relative paths of the plot documents just changed, comma-separated. Information only: the command always checks the whole campaign. May be empty.
- `SESSIONS`: mode `link-events` only. Comma-separated session ids, or `UNLINKED`, which means every session listed in `unlinked` of the map.
- `CONTINUE_WITH`: text given by the invoking skill naming the exact step to resume. If absent, use "the step of the invoking skill that called the plot map".

## Working folder

Run every command from the campaign root (the folder containing `campaign.yaml`). Keep CAMPAIGN_ROOT: it is the `campaign root:` line of the session check in your context; if that line is not there, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" .` and read that line. Files go in `.campaign/cache/` (the map) and `.campaign/state/plot-map/` (the report).

## Mode `map`

**Step 1 — Generate.** Run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/plot-map/scripts/plot-map.mjs" . --out .campaign/cache/plot-map.json --write-session-maps`
- Exit code 2: stop. Write the report (Step 4) with `status: ERRORS` and the single line `usage-error: <the message in the output>`.
- Exit code 0 or 1: go to Step 2. Exit code 1 means errors are listed in the output (lines starting with `error`). Keep going: the errors are handled in Step 3.

**Step 2 — Read.** Read `.campaign/cache/plot-map.json` with the Read tool. Keep `sessions`, `arcs` and `errors`. The output also prints `session maps written: <n>, unchanged: <m>`: keep it.

**Step 3 — Correct the sources (only if there are errors).** For each error in `errors`, check whether it is fixable from the table below. Then fix the SOURCE file named in the error (an event file or a session main file, never a generated main file), and run Step 1 again. Repeat at most 3 times in total. Stop as soon as the exit code is 0.

Rules for this step:
- A generated main file (the one with `generated: true` in its metadata) is NEVER edited by hand. Its text is rebuilt by the command from the event files. If the concept map looks wrong, the cause is in the event files: fix those.
- Change only the metadata lines named in the table. Do not change the text of the events or the scenes.
- Never invent an id. Use only ids that appear in `sessions` or in the events of `plot-map.json`.
- Never edit chronicle pages (play records are the master's). Errors that come from them are reported, not fixed.
- Keep a list of every source file you corrected, with the field you changed. You will write it in Step 4.
- If an error is not fixable from the table, or you are not sure of the right value, do not guess: leave it and report it.

**Step 4 — Report.** Write `.campaign/state/plot-map/report.txt` with the Write tool, in this format:
```
PLOT MAP REPORT
status: DONE
sessions: <number of sessions>, played: <n>, ready: <n>, errors: <n>
sources corrected:
- <file>: <field> <old value> -> <new value>
errors:
- <code> <file>: <message>
continue with: <CONTINUE_WITH>
```
- `status: DONE` only if the last run of Step 1 had exit code 0.
- `status: ERRORS` otherwise. Then one line per error still open, copied from the output as `<code> <file>: <message>`.
- Write `sources corrected:` with `- none` when you changed nothing, and `errors:` with `- none` when there are no open errors.
- Write the file only from the values you read from the command output. Do not print the report in the chat.

Your last action in this skill is writing the report. Then, in the same turn, do what CONTINUE_WITH says.

## Mode `link-events`

The events of a session are linked by their `depends_on` line. A session is "unlinked" when it has two or more events and no event of it depends on another event of the same session. Your job is to read the events of the target sessions and declare which event must happen before which, using only what their texts say. The events are never changed in any other way.

Keep a list of NOTE lines while you work. Each NOTE is one plain sentence in English, starting with the session id. You will write them in Link step 6.

**Link step 1 — Map and targets.** Run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/plot-map/scripts/plot-map.mjs" . --out .campaign/cache/plot-map.json`
- Exit code 2: stop. Go to Link step 6 with `status: FAILED`, and the NOTE `usage-error: <the message in the output>`.
- Exit code 0 or 1: continue. Errors listed in the output are not this mode's job, except the ones named in the next paragraph.

Read `.campaign/cache/plot-map.json` with the Read tool. Keep `sessions`, `unlinked` and `errors`.

Choose the TARGET sessions:
- If `SESSIONS` is `UNLINKED`: the targets are the ids listed in `unlinked`.
- Otherwise: split `SESSIONS` on commas and trim every id. For each id:
  - If it is not the `id` of a session in `sessions`: add the NOTE "<id>: not a session, skipped". Not a target.
  - If its `events` list has fewer than 2 items: add the NOTE "<id>: fewer than two events, nothing to link". Not a target.
  - Otherwise it is a target.
- For each target, look at `errors`. If an error has a `file` inside the folder of that session (the folder of the session `file`, followed by `/`), add the NOTE "<id>: not linked, error <code> in <file>" and remove the session from the targets. Never fix the errors of the events in this mode.

If the target list is empty: go to Link step 6 with `status: DONE` and `linked: none`.

**Link step 2 — Read the events.** For each target session, Read every event file listed in its `events`: the `file` of each item, the whole text, master-only notes included. Read them in the order of `events`. Read only; write nothing yet.

**Link step 3 — Decide.** Do this for each target session, one at a time. Use ONLY what the texts of its events say. Never use what you think a game usually does.

3a. Write a short list, in order, of the events of the session. For each one write: the id, what happens there in your own short words, and what the text says must have happened before it.

3b. For each event, find its predecessors: the events that must happen before it. Typical cases:
- the scene where the group arrives at the place where this event happens;
- the clue, item or information found in an event that this event uses;
- the choice taken in an event that leads to this event.

3c. Apply these rules:
1. A choice or a fork: when an event lets the group go one way or another, each event of each way depends on that same event. Several events depending on the same event is a branch. Do not add a branch that the text does not describe.
2. A rejoin: an event that can be reached from several branches depends on all of them. List all their ids.
3. The first event of the session, or the first events, have `depends_on: []`. Usually there is one. There are several only if the text says the session starts in several places at once.
4. Do NOT link two events only because they are next to each other in the list. The order of the list is not a flow.
5. If the text does not say how an event relates to the others, its predecessor is the event just before it in the list, and you add one NOTE: "<session id>: <event id> depends on <event id>: the text does not say, linked by list order." An event that is first in the list, with no predecessor in the text, stays `depends_on: []`.
6. An independent side scene (an event that can happen at any time and does not need the others) still must not be left alone. It depends on the scene where the group could meet it. If the text does not say where, use rule 5.
7. Never add, rename, merge or delete events. Use only ids of events of the SAME session, copied exactly.
8. No cycles. Follow the predecessors of every event: you must never come back to the event you started from. If a link would close a loop, drop that link and add a NOTE saying which link you dropped.
9. Every event that is not a first event has at least one predecessor. No event is left with `depends_on: []` by accident.

Example of the method (invented names, for the method only): the events in order are `Arrival`, `Merchant`, `Crossroads`, `North road`, `South road`, `Refuge`. The text says: the group arrives at the village; in the village they meet the merchant; at the crossroads they choose the north road or the south road; the refuge is reached by both roads. The result is: `Arrival` is `[]`; `Merchant` is `[Arrival]`; `Crossroads` is `[Merchant]`; `North road` is `[Crossroads]`; `South road` is `[Crossroads]`; `Refuge` is `[North road, South road]`.

3d. Check the result before you write anything:
- every id you wrote is an id of an event of this session;
- no event depends on itself;
- no loop (rule 8);
- every event that is not a first event has at least one predecessor (rule 9);
- at least one event of the session depends on another event of the session. If not, the session is still unlinked: go back to 3b.

**Link step 4 — Write the changed event files.** Only event files whose `depends_on` changes are written. The current value is in `events` (the `depends_on` of each item).
- For each changed event file: take the text you read in Link step 2 and make a new text that is identical except for one line: the `depends_on:` line of its metadata, written as `depends_on: [id1, id2]` or `depends_on: []`. If the metadata has no `depends_on:` line, add one as the last line before the closing `---`. Change no other character.
- Save the new text with the Write tool as a draft at `.campaign/state/write/draft/` followed by the campaign-relative path of the event file. Example: the event `Trama/Sessione 1/Eventi/La strada verso la valle.md` is saved as `.campaign/state/write/draft/Trama/Sessione 1/Eventi/La strada verso la valle.md`.
- If no event file changed: add the NOTE "no depends_on changed" and go to Link step 6 with `status: FAILED`.

Then invoke the skill `yllir:write-sequence` (if your tool has no way to invoke a skill, read `${CLAUDE_PLUGIN_ROOT}/skills/core/write-sequence/SKILL.md` with the Read tool or `cat`, and follow it exactly as if it had been invoked, with the same inputs) with:
- `DOCUMENTS=` the campaign-relative paths of the changed event files, comma-separated
- `INTENT="Link the events of the sessions: only the depends_on line of event files changes; no new events; no text change."`
- `NEW_SUBJECTS=` (empty)
- `VERSION_MESSAGE=` the sentence «Collegati gli eventi della sessione «<session name>»» for `it`, «Linked the events of the session «<session name>»» for `en`, or the translation into the campaign language. Read `language.main` in `campaign.yaml`. For several target sessions use «Collegati gli eventi delle sessioni» for `it` and «Linked the events of the sessions» for `en`. The session name is the `name` of the session in `sessions`.
- `ROUND=1`
- `CONTINUE_WITH="plot-map step 5: read the write report"`

After invoking it, read `.campaign/state/write/report.txt` with the Read tool. The report is for you, never for the master: do not show it or quote it.

Loop, starting with `ROUND=1`. Read `.campaign/state/write/report.txt`. Then:
- If status is `FIX_NEEDED` or `VERIFY_FAILED`: open the draft of the event named in each `details` line, fix exactly the problem listed (only in its `depends_on` line; if the problem asks for any other change, do not make it and stop the loop with `FAILED` and a NOTE saying so), save the draft, and invoke `yllir:write-sequence` again with `ROUND` plus one and the same other inputs. Do this up to `ROUND` 3. Do not stop after the first fix: each fix is followed by a new invocation.
- If status is `ASK` or `CONFLICT`: the event links were not written. Stop the loop, go to Link step 6 with `status: FAILED`, and add a NOTE with the question or the conflict from the report, in plain words.
- If status is `DONE`: go to Link step 5.
- If status is `FAILED`, or any other status: go to Link step 6 with `status: FAILED`, and add a NOTE with the reason from the report.

After a failed `ROUND` 3 (still `FIX_NEEDED` or `VERIFY_FAILED`): go to Link step 6 with `status: FAILED`, and add a NOTE saying the events could not be linked, with the reason from the last report.

**Link step 5 — Check.** Only after the write-sequence status `DONE`. Run the command of Link step 1 again, exactly as written there. Exit code 2: go to Link step 6 with `status: FAILED`. Read `.campaign/cache/plot-map.json` again and take its `unlinked` list. For each target session:
- if it is not in `unlinked`: it is linked. Add its id to the list of linked sessions;
- if it is still in `unlinked` and a NOTE of Link step 3 explains why: it stays, with that NOTE;
- if it is still in `unlinked` and no NOTE explains why: add the NOTE "<session id>: still unlinked after the write, cause unknown." and set the status to `FAILED`.

Then go to Link step 6.

**Link step 6 — Report.** Write `.campaign/state/plot-map/report.txt` with the Write tool, in this format:
```
PLOT MAP REPORT
status: DONE
linked: <ids of the linked sessions, comma-separated, or none>
note: <one NOTE>
continue with: <CONTINUE_WITH>
```
- `status: DONE` when the events were written (or there was nothing to do) and Link step 5 found no unexplained unlinked session. `status: FAILED` otherwise.
- `linked:` lists only the target sessions that Link step 5 found linked. `none` when there are none.
- Write one `note:` line for each NOTE you kept, in the order you kept them. Write none when there are no notes.
- Write the file only from what you did and read. Do not quote the body of any event in it. Do not print the report in the chat.

Your last action in this skill is writing the report. Then, in the same turn, do what CONTINUE_WITH says.

## Error codes

The script can output these codes. The fix is always in the source file named in the error.

| Code | Meaning | Mechanical fix |
|---|---|---|
| `campaign-config` | `campaign.yaml` does not describe the structure | Report it. Do not edit `campaign.yaml` in this skill. |
| `legacy-session-layout` | A plot file is not in its own session folder | Report it. Moving files belongs to the update process. |
| `invalid-frontmatter` | The metadata block of a file is not valid YAML | Fix the line named in the message (`line <n>`) so it is valid YAML. |
| `missing-id` | A session main file has no `id` | Add `id:` only if the id is stated in the file or in the request. Otherwise report it. |
| `duplicate-id` | Two session files have the same `id` | Report it. Changing an id changes every reference to it. |
| `missing-depends-on` | A session has no `depends_on` line | Add `depends_on: []` only if the text of the session says it has no prerequisites. Otherwise report it. |
| `invalid-depends-on` | `depends_on` is not a list | Write it as a list, for example `depends_on: [a, b]`. |
| `invalid-arc` | `arc` is not a text value | Write it as text in quotes. |
| `unknown-dependency` | A session depends on an id that is not a session | Replace the id with the session id of the same name if exactly one exists in `sessions`. Otherwise report it. |
| `event-missing-id` | An event has no `id` | Report it (the id is a reference used elsewhere). |
| `event-duplicate-id` | Two events have the same `id` | Report it. |
| `event-missing-depends-on` | An event has no `depends_on` line | Add `depends_on: []` only if the event text says it has no prerequisite event. Otherwise report it. |
| `event-invalid-depends-on` | `depends_on` of an event is not a list | Write it as a list. |
| `event-missing-session` | An event has no `session` | Set `session:` to the `id` of the session whose folder contains the event (the session main file in the parent folder of `Eventi/`). |
| `event-session-mismatch` | `session` of an event is not the session of its folder | Set `session:` to the id of the session of its folder, if that session is valid. Otherwise report it. |
| `event-unknown-dependency` | An event depends on an id that is not an event | Replace the id with the event id of the same name if exactly one exists. Otherwise report it. |
| `cycle` | Sessions depend on each other in a loop | Report it. Choosing which link to remove is a decision for the master. |
| `event-cycle` | Events depend on each other in a loop | Remove the one `depends_on` entry that the event text shows is not real, and only if it is clear. Otherwise report it. |
| `missing-played` | A chronicle page has no `played` list | Report it. Never fix chronicle pages. |
| `invalid-played` | `played` of a chronicle page is not a list | Report it. Never fix chronicle pages. |
| `unknown-played-id` | A chronicle page lists an id that is not a session | Report it. Never fix chronicle pages. |
| `played-before-prerequisite` | A played session has a prerequisite that is not played | Report it. Whether the play record or the prerequisite is wrong is a decision for the master. |

## Rules

- The generated main file is never edited by hand: only the source files named in the table.
- Never invent ids, and never change an id that other documents refer to.
- Never quote the body of an event or a scene in the report. Refer to the file and the field.
- Run commands only from the campaign root.
- Do not change the output of the script. If you disagree with the map, fix the source and run Step 1 again.
- Mode `link-events` changes campaign files only through `yllir:write-sequence`, and only the `depends_on` line of event files. It never adds, renames, merges or deletes an event, and never changes any other line.
