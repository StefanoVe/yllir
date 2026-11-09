---
name: plot-map
description: Library skill. Reads the plot documents of a Yllir campaign, derives the status of every session (played, ready, waiting), reports the errors of the plot graph, and generates the derived main file of each session (the concept map of its events). Invoked by Yllir core processes after any change to a plot document (new session, changed events or dependencies), or when asked to check the plot map. Never invoked for anything outside a Yllir campaign.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/plot-map/scripts/plot-map.mjs" *), Read, Edit, Write
---

# Plot map

This skill is always invoked by another skill (for example prepare-session or after-session). The result of this skill is the file `.campaign/state/plot-map/report.txt`, not a message for the master. The invoking skill reads that file to know the result.

**Commands.** Run each command exactly as written in this file, as one single command: nothing before it and nothing after it, no `;`, `&&`, `|`, `2>&1`, `echo`, `cat`, `mkdir` or `cd`. Anything added makes the command refused. Every script prints its result and, as its last line, `exit: <code>`: read the exit code from that line (the `exit:` line). Read result files with the Read tool. If a command is refused, run it again exactly as written, with nothing added; if it is refused again, end this skill with `status: ERRORS`, reason "permission refused".

## What this skill owns

- Reading the plot documents (categories of type `plot`) and the chronicle pages (categories of type `chronicle`).
- The status of each session: played, ready (all its prerequisites are played), or waiting.
- The errors of the plot graph: broken metadata, unknown or circular dependencies, events in the wrong session, played sessions whose prerequisites are not played.
- The derived main file of each session: the concept map of its events, written from the files in its `Eventi/` (or `Events/`) folder.

The script does all the mechanics. You only run the command, read its output, correct the source files when the map shows a source error, and write the report.

## When core calls this skill

After any change to a plot document: a new session, changed events, or changed dependencies (`depends_on`, `session`). Changes inside a scene that do not touch order, inputs, outputs or choices do not need it.

## Inputs

The caller gives:
- `CHANGED`: campaign-relative paths of the plot documents just changed, comma-separated. Information only: the command always checks the whole campaign. May be empty.
- `CONTINUE_WITH`: text given by the invoking skill naming the exact step to resume. If absent, use "the step of the invoking skill that called the plot map".

## Working folder

Run every command from the campaign root (the folder containing `campaign.yaml`). Keep CAMPAIGN_ROOT: it is the `campaign root:` line of the session check in your context; if that line is not there, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" .` and read that line. Files go in `.campaign/cache/` (the map) and `.campaign/state/plot-map/` (the report).

## Steps

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
