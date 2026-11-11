# Guided steps of a framework update

The agent that handles the update follows these steps in the current turn, from the «Sheet format follow-up» of `SKILL.md`, before the master's request. Nobody else reads this file. Only the questions described below reach the master.

Use the campaign language from `campaign.yaml`. Keep unresolved facts pending. Use the established canon and public material only: never reveal or use a master-only block to draft public text.

## Which steps

The pending migrations are named in the block `YLLIR SESSION CHECK` (line `post-update needed: <ids>`) or in the update result (`pending_migrations`). Take them in the order written there. For each id:

1. Read `${CLAUDE_PLUGIN_ROOT}/skills/library/update/migrations/<id>/guided.md` with the Read tool, and follow it.
2. When the guided file says the work is finished, run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/update-campaign.mjs" . --complete <id>`, with the id written in place of `<id>`, and read its JSON `status`:
   - `complete`: go on to the next id.
   - `pending`, or the guided file stopped with a question: stop here. The migration stays pending; the next time the campaign is opened, this follow-up runs again.
   - `failed`: say the fixed sentence of the lexicon for an operation that could not be completed, and stop.

Stop at the first id that is not complete. The later ones read sheets that an earlier one may still move.

## Commands and writes

Run every script command exactly as written in the guided file, as one single command, from the campaign root, with `${CLAUDE_PLUGIN_ROOT}` for the plugin root. Every script prints its result and, as its last line, `exit: <code>`.

Campaign documents are written only through the engine write cycle in `${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/authoring.md`, section 7. In short: write the draft with the Write tool to `.campaign/drafts/<campaign-relative path>`; run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" check . --files "<paths>"`; have one independent review by the `yllir:batch-reviewer` agent, as section 7 says; then run `commit` with the same `--files`, the version message in the campaign language, and no `--note` unless something is still in progress. A staged draft that a script in this folder placed under `.campaign/state/write/draft/<path>` is copied to `.campaign/drafts/<path>` first, with the Read and Write tools, and its text is not changed. Never write a campaign document any other way.

Sub-agents (the Agent tool) may draft text or interpret a table. They never write a campaign document, and their answer is checked by the steps of the guided file.

## Questions

When a step cannot continue without the master's answer, ask ONE precise question in your message, in plain words, and stop that step. The step stays pending, and the next time the campaign is opened this follow-up runs again. If the master's next message answers the question, use the answer and continue. Do not repeat a question the master has already answered.

## Result

When the steps are done, or stopped, your message to the master says only what the master needs to know, in the campaign language. Do not mention steps, scripts, drafts, reviews or markers.
