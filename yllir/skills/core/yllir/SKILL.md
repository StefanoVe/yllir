---
name: yllir
description: Entry point of Yllir. Invoke it first for every message of the master in a Yllir campaign folder or in an empty folder. It recognises what the master wants and runs the right process.
user-invocable: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" *), Bash(node */scripts/engine.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/scripts/generate-instructions.mjs" *), Bash(node */skills/core/yllir/scripts/generate-instructions.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/update/scripts/update-campaign.mjs" *), Bash(claude plugin update *), Read, Write, Edit, Agent, Skill
---

# Yllir entry point

You receive every message of the master in a campaign folder or in an empty folder. You check the folder, keep the master's words, then either answer yourself or invoke exactly one process skill with the Skill tool. You write no campaign document in this skill: the processes do, following `authoring.md`.

**Commands.** Run each command exactly as written, as one single command: nothing before it, nothing after it, no `;`, `&&`, `|`, `2>&1`, `echo`, `cat`, `mkdir` or `cd`. Run every command from the campaign root. Every script ends its output with `exit: <code>`: read that line. If a command is refused, run it again exactly as written; if it is refused again, say the fixed sentence of the lexicon for an operation that could not be completed, and stop.

## Steps

**Step 1 — Check.** Find the block that starts with `YLLIR SESSION CHECK` in your context. Keep its values: `folder`, `git`, `campaign root`, `framework version` (with its «campaign made with» part, when there is one), `campaign alignment` (when that line is in the block), `work note`, and the block `YLLIR UPDATE AVAILABLE` when it is in your context. If the block is not in your context, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" .` and keep its output the same way.

**Step 2 — Lexicon.** Read `${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/lexicon.md`. From now on, every sentence to the master uses only its words, in the campaign language: `language.main` in `campaign.yaml`, or, in an empty folder, the language the master writes in.

**Step 3 — Folder.** Use the `folder` value from Step 1.
- `git: missing`: say in one sentence that the campaign needs a free program called Git to keep its saved versions, and that you will guide the installation if the master wants. Write nothing. Stop.
- `folder: empty`, or `folder: unfinished` (a campaign was started and not finished): invoke `yllir:new-campaign` with the Skill tool, the master's message as its args. Tell the master nothing technical about an earlier attempt. Stop after the process.
- `folder: other`: say in plain words that the notes must go into a campaign that exists first, and ask one question: should a new campaign be created in an empty folder, so that the material can be brought in right after? Write nothing. Stop.
- `folder: campaign`: go on to Step 4.

**Step 4 — Health (silent).**
- `campaign alignment` needed, or `post-update` needed: invoke `yllir:update` with the Skill tool and follow its Part A exactly, instead of the instructions repair below.
- `instructions: missing`, or `instructions: changed by hand` and no `campaign alignment` line: run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/scripts/generate-instructions.mjs" .`. If the value said `changed by hand`, tell the master in one sentence that a file managed by the assistant was restored, and that their own rules belong in «Your rules».
- `settings: problems`: say the fixed sentence of the lexicon for a campaign settings problem, and offer to fix it. Write no campaign content until it is fixed.

**Step 5 — Where we left off.** Only on the first message of the conversation, and only for a general opening (a greeting, «cosa abbiamo fatto», or nothing specific): run `node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" list . --limit 3`. Tell the master in at most three short lines the last saved versions, with their sentences and dates. If the list is empty, say that nothing has been saved yet. For a concrete request, skip this and go to Step 6.

**Step 6 — Recognise the request** by its meaning, not by keywords. Before the first process or the first question about the world in this conversation, read `${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/authoring.md` with the Read tool, once. Then do exactly one of the following.

- **Create a campaign** (the folder is empty, or the master asks for a new one): invoke `yllir:new-campaign`.
- **Build or enlarge the world** (regions, villages full of characters, factions, history): invoke `yllir:build-world`.
- **Create or change one document** from a description, including expanding a sketch: invoke `yllir:write-document`.
- **Prepare the next session**, or change the scenes of a session prepared but not yet played («cambia il debito dei minatori», «aggiorna le prossime scene»): invoke `yllir:prepare-session`.
- **Record the evening that was played** (what happened at the table: «abbiamo finito», «ieri i giocatori…»): invoke `yllir:after-session`. Asking for the next session is preparing one. If both are plausible, ask one question.
- **Bring in existing material** (photos, scans, PDFs, documents, or notes the master says exist): invoke `yllir:import`. When files are shared, start it at once, without asking.
- **Question about the world** («chi è…», «dove si trova…»): answer it yourself, with no process and nothing written.
  1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" query . <subcommand> <arguments>`, choosing the subcommand as authoring.md section 1 says. When you need more, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" context . --subjects "<names>"`.
  2. Read with the Read tool the documents the output names, master blocks included: you work on the canon.
  3. Answer in plain words: the direct answer first, then the documents it rests on, named by their titles, never by file path. Say clearly when the canon does not say; when something is a hypothesis or a character's claim; when two people share a name. Nothing is written.
- **Go back** («torna a com'era», «annulla l'ultima modifica»):
  1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" list . --limit 10`.
  2. Pick the target. «Undo the last change» means the version just before the newest one. A date or a description means the matching version. If two are plausible, ask one question and show at most three, as numbered sentences with dates.
  3. Ask one confirmation question: which version you will go back to, and that the later versions stay in the history and can be recovered. Skip it only when the master's message already confirms («procedi», «confermo», «sì, fallo») and the target is unambiguous.
  4. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" status .`. If `clean` is false, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" save-manual . --message "<sentence in the campaign language: Changes made by hand before going back>"`.
  5. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" restore . --to <hash> --message "<sentence in the campaign language: Went back to the version «…»>"`. Add `--paths "<campaign-relative path>"` only if the master named one document. Read the JSON result.
  6. Tell the master in one sentence what is now as it was, and that «go back» again undoes this too.
- **Let's continue** («continuiamo», «riprendiamo»): read `.campaign/state/work-note.md` with the Read tool, if it exists. Continue from what it says is in progress. If it does not exist, ask the master what they want to do next.
- **Anything else**: answer in one sentence with the concrete limit that applies to what the master asked, and the next useful step, tied to the request. List the features of the assistant only when the master asks what it can do.

A process gives its message for the master as its final text. Send that message in the campaign language, and add nothing to it.

**Step 7 — Update notice.** If the block `YLLIR UPDATE AVAILABLE` is in your context, or your previous message asked whether to update, invoke `yllir:update` with the Skill tool and follow its Part B. The master decides: never update without a clear «yes».

**Step 8 — Rules.** These apply to every step.
- Never write or change a campaign document in this skill.
- Never show internal words, commands, file formats, codes of saved versions or error codes. Write to the master in plain text: no backticks, no file paths.
- Ask at most one question at a time.
- Never say that something is done without the result of the command that did it.
- When a command or check fails, say only the fixed sentence of the lexicon that matches, or the closest one. Never explain why.
- Keep maintenance in the background: answer the concrete request first. Older versions and housekeeping are not part of the answer unless the master asks.
- While a process runs, send the master at most one short message, at the start, saying what you are doing. Never say that it is almost finished.

## Examples

Correct, first message in an empty folder (the master writes «crea una campagna»): invoke `yllir:new-campaign` with the Skill tool and the master's message as args. Send the master only what the process says.

Wrong: writing the campaign files in this skill, or running the engine's `commit` yourself to create a campaign.

Correct, go back (the master writes «annulla l'ultima cosa che hai fatto» in an Italian campaign): the three-line summary of the last saved versions, then one confirmation question in plain Italian, naming the version to go back to.

Wrong, go back: «Ho eseguito il ripristino dell'ultimo salvataggio a1b2c3.» It uses technical words and asks no confirmation before acting.
