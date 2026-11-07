---
name: yllir
description: Entry point of Yllir. Invoke it first for every message of the master in a Yllir campaign folder or in an empty folder: it recognises what the master wants and runs the right process.
user-invocable: true
---

# Yllir entry point

This skill receives every message of the master. It checks the folder, keeps the master's words, and runs exactly one process. Run every command from the campaign root (the folder the master opened). Never run a command from another folder.

## Steps

**Step 1 — Check.** Find the block that starts with `YLLIR SESSION CHECK` in your context. Keep its values: `folder`, `git`, `saved versions`, `changes not yet saved`, `settings`, `instructions`.
- If the block is not in your context: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" .` and keep its output the same way.
- Output: the values of the block, kept for the next steps.

**Step 2 — Lexicon.** Run `cat "${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/lexicon.md"` and read the table.
- From now on, every sentence to the master uses only the words of the lexicon, in the campaign language. The campaign language is `language.main` in `campaign.yaml`. In an empty folder, it is the language the master writes in.
- Output: the lexicon in your context.

**Step 3 — Folder.** Use the `folder` value from Step 1.
- `git: missing`: say in one sentence that the campaign needs a free program called Git to keep its saved versions, and that you will guide the installation if the master wants. Write nothing. Stop.
- `folder: empty`: invoke `yllir:new-campaign`. Stop.
- `folder: other`: ask one question: are these notes to bring into a campaign (say that this is not available yet in this version), or should a new campaign be created in an empty folder instead? Write nothing. Stop.
- `folder: campaign`: continue to Step 4.
- Output: one of the four branches above, with its message.

**Step 4 — Health (campaign only, silent fixes first).**
- `instructions: missing` or `instructions: changed by hand`: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/generate-instructions.mjs" .`. If the value said `changed by hand`, tell the master in one sentence that a file managed by the assistant was restored, and that their own rules belong in «Your rules».
- `settings: problems: …`: explain each problem in one plain sentence and offer to fix it. Write no campaign content until it is fixed.
- Output: the instructions are up to date, and the settings are valid or the master has been told about the problems.

**Step 5 — Where we left off.** Only if this is the first message of the conversation: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" list . --limit 3`. Tell the master in at most three short lines what the last saved versions were, using their sentences and dates. If the list is empty, say that nothing has been saved yet. Then handle the message (Step 6).
- Output: at most three lines to the master, or nothing when this is not the first message.

**Step 6 — Recognise the request** by its meaning, not by keywords. Do exactly one of the following.

- **Go back** (for example «torna a com'era», «annulla l'ultima modifica»):
  - (a) Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" list . --limit 10`.
  - (b) Pick the target. «Undo the last change» means the version just before the newest one. A date or a description means the matching version. If two versions are plausible, ask one question and show at most three of them as numbered sentences with dates.
  - (c) Ask one confirmation question: which version you will go back to, and that the later versions stay in the history and can be recovered.
  - (d) After a «yes»: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" status .`. If `clean` is false, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" save-manual . --message "<sentence in the campaign language: Changes made by hand before going back>"`.
  - (e) Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" restore . --to <hash> --message "<sentence in the campaign language: Went back to the version «…»>"`. Add `--paths "<campaign-relative path>"` only if the master named one document. Read the JSON result.
  - (f) Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/check-links.mjs" .`. If the exit code is 1, tell the master in one sentence that a check found a problem with a link and that it is still open.
  - (g) Tell the master in one sentence what is now as it was, and how to undo this too («go back» again, to the version just saved).

- **Question about the campaign** (for example «chi è…», «dove si trova…»): read the relevant documents, answer briefly, and name the documents you used by their titles. Never write anything.

- **Anything else** (prepare a session, record what happened at the table, create or change a document, import notes, tidy up): say in one or two plain sentences that this part is not available in this version yet. Then list what is available now: going back to a saved version, and questions about the campaign.

**Step 7 — Rules.** These apply to every step above.
- Never write or change a campaign document yourself. Every write goes through `yllir:write-sequence`.
- Never show internal words, commands, file formats or error codes to the master.
- Ask at most one question at a time.
- Never say something is done without the result of the command that did it.

## Examples

Correct (the first message of an Italian campaign is «annulla l'ultima cosa che hai fatto»): the three-line summary of the last saved versions, then one confirmation question in plain Italian, naming the version to go back to.

Wrong: «Ho eseguito git revert sul commit a1b2c3». It uses technical words, and it gives no confirmation question before acting.

Correct (`folder: other`, the master writes «ho qui delle note di una partita»): one question that says importing notes is not available yet in this version, and asks whether the master wants a new campaign in an empty folder instead. Nothing is written.

Wrong: creating a folder called `Notes/` to hold the master's files before asking.
