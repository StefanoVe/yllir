# Post-update steps

The agent that handles the update follows these steps in the current turn, from the Sheet format follow-up in `SKILL.md`, before the master's request. Nobody else reads this file. Only the questions described below reach the master.

Use the campaign language from `campaign.yaml`. Keep unresolved facts pending. Use the established canon and public material only: never reveal or use a master-only block to draft public text.

The identifiers `category-first-geography-v1`, `item-descriptions-v1` and `statistics-tables-v1` have separate state and completion. The `world-graph-v1` migration is not here: `update-campaign.mjs` runs it by itself.

## Commands and writes

Run every script command exactly as written here, as one single command, from the campaign root, with `${CLAUDE_PLUGIN_ROOT}` for the plugin root. Every script prints its result and, as its last line, `exit: <code>`.

Campaign documents are written only through the engine write cycle in `${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/authoring.md`, section 7. In short: write the draft with the Write tool to `.campaign/drafts/<campaign-relative path>`; run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" check . --files "<paths>"`; have one independent review by the `yllir:batch-reviewer` agent, as section 7 says; then run `commit` with the same `--files`, the version message in the campaign language, and no `--note` unless something is still in progress. A staged draft that a script in this folder placed under `.campaign/state/write/draft/<path>` is copied to `.campaign/drafts/<path>` first, with the Read and Write tools, and its text is not changed. Never write a campaign document any other way.

Sub-agents (the Agent tool) may draft text or interpret a table. They never write a campaign document, and their answer is checked by the steps below.

Questions: when a step cannot continue without the master's answer, ask ONE precise question in your message, in plain words, and stop that step. The step stays pending, and the next time the campaign is opened this follow-up runs again.

## 1. Geographic layout

Read `.campaign/state/update.yaml` with the Read tool. If it contains the line `geography_migration: pending`, read `${CLAUDE_PLUGIN_ROOT}/skills/core/update/post-geography.md` and follow it first. If it stops with a question or a failure, stop here: do not run steps 2 and 3 in this turn, because the files they use may still move. Otherwise, or when the line is absent, continue with step 2.

## 2. Existing item descriptions

Run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/update/scripts/item-descriptions.mjs" . --prepare`. If status is `pending`, process each listed item whose status is `pending`. Do not process an item marked `changed`: tell the master that this sheet changed during the migration and leave it pending for a fresh review. If there are no items, this step is complete without writes.

For each pending item, read its full source, `campaign.yaml`, `.campaign/customizations.md` if it exists, and representative item descriptions. Preserve established appearance and function in `## In brief` / `## In breve` (add the missing section for legacy sheets); make `## Description` / `## Descrizione` add established context rather than repeat the brief. Do not invent context, function, effects, provenance or tone. If the public context is insufficient or ambiguous, ask the question and keep the item pending.

Either write a complete draft, or state `REVIEWED_UNCHANGED` with a short evidence-based reason when the existing descriptions already meet both requirements. Save the full text in `.campaign/state/write/draft/<SOURCE_FILE>` and run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/update/scripts/item-descriptions.mjs" . --stage <SOURCE_FILE> <draft-relative-path>`. Stage unchanged text the same way. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/update/scripts/item-descriptions.mjs" . --verify <comma-separated source paths>`. This checks source hashes, unchanged bytes outside the two description sections, the master block and the required nonempty public sections. Any failure stops here: keep the item pending.

If the staged text is byte-identical to the source, the item was reviewed and accepted without a campaign write. Otherwise write the staged text through the write cycle (see Commands and writes) for the changed item paths, with the intent «adapt existing item descriptions», `NEW_SUBJECTS` empty and a version message in the campaign language. Pass the canon context to the reviewer; never give the reviewer master-only notes, because the revised text is public. Then run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/update/scripts/item-descriptions.mjs" . --complete <comma-separated reviewed paths>`. Completion is allowed only when the published bytes match the verified draft hashes. Continue until the inventory reports complete; on a question, a source change, missing context or a verification failure, leave the migration pending.

Do not mark completion from section headings or other structural heuristics alone. An unchanged item is marked complete only through the same verify-and-complete steps.

## 3. Statistics tables

1. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/update/scripts/post-update.mjs" . --prepare`. Read the JSON result and its `exit:` line.
   - `status: complete`: no legacy statistics remain. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/update/scripts/post-update.mjs" . --complete`, and report the migration complete only if its status is `complete`.
   - `status: failed`: stop. Say the fixed sentence of the lexicon for an operation that could not be completed; say that the format update could not be finished, and do not claim that it is complete.
   - `status: pending`: keep the `candidates` list and continue.
2. The script has staged deterministic conversions under `.campaign/state/write/draft/`. For each file in `pending`, keep the deterministic changes already in its draft, then ask a sub-agent (the Agent tool) to interpret the prose table. If the scan reports `unsupported-language`, stop: say that this format update could not be completed for the campaign language, and keep the original sheets and the pending marker. For supported languages give the sub-agent exactly this prompt, replacing the bracketed values:

   ```text
   CAMPAIGN_ROOT: [absolute campaign root]
   SOURCE_FILE: [campaign-relative file]
   LANGUAGE: [it or en]
   ORIGINAL: [full current source document]
   STAGED_DRAFT: [full staged draft, or ORIGINAL when none exists]
   MASTER_ANSWER: [the master's answer to the earlier migration question, or none]
   TARGET FORMAT (Italian): within ## Statistiche, use ### Caratteristiche with columns Caratteristica | Valore, ### Attacchi e capacità with columns Attacco o capacità | Dettagli, and ### Equipaggiamento with columns Oggetto | Dettagli.
   TARGET FORMAT (English): within ## Statistics, use ### Characteristics with columns Characteristic | Value, ### Attacks and abilities with columns Attack or ability | Details, and ### Equipment with columns Item | Details.
   TASK: Convert only the ambiguous prose table in the public Statistics section to the target format for LANGUAGE. Put a row under a subsection only when the text clearly gives that fact. Preserve the original wording, every established fact, statistic, and value; do not calculate, combine, or invent values. Preserve Markdown links and inline code exactly. Keep all bytes outside that Statistics section and every Master block byte-for-byte unchanged. Return only the complete draft document text. If the values cannot be interpreted safely or the prose does not fit these columns, return QUESTION: followed by one precise question for the master, and do not invent values.
   ```

   Save a returned draft exactly to `.campaign/state/write/draft/<SOURCE_FILE>` with the Write tool. If the sub-agent returns QUESTION, keep the current staged draft unchanged and ask that question (see Questions).
3. Read the original and the staged draft of every candidate. The changed list contains only candidates whose staged draft differs from the current source. If it is empty, run `--complete` (as in step 1) and finish if it reports complete. If legacy prose remains, ask one precise question about the first unresolved section. On the next turn, include the master's answer in `MASTER_ANSWER` and do not ask the same question again.
4. Before any write, run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/update/scripts/post-update.mjs" . --verify "<candidate paths comma-separated>"`. It verifies that the sources stayed unchanged while the drafts were prepared, that the numbers were kept, that every byte outside the Statistics sections (including every Master block) is exact, and that no old or ambiguous table remains. If the result is `legacy-statistics-remain`, nothing is written: ask one precise question about the first unresolved section. Any other verification failure: nothing is written; say the fixed sentence of the lexicon for an operation that could not be completed.
5. For every candidate with a changed draft, copy the staged draft to `.campaign/drafts/<path>` and run the write cycle (see Commands and writes) with: the intent «convert old Statistics tables to the current sheet format, preserving their established facts and values»; `NEW_SUBJECTS` empty; the version message «Converted old Statistics tables to the current format.», translated into the campaign language. Follow the write cycle fully, including the review. Write no campaign sheet by any other means.
6. If the commit is saved, run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/update/scripts/post-update.mjs" . --complete`. Report the migration complete only when this result says `status: complete`. If it still says pending, ask one precise question about the first unresolved section. If the review or the commit does not finish, keep the marker pending and say the fixed sentence of the lexicon for an operation that could not be completed.

## 4. Result

When the steps are done, your message to the master says only what the master needs to know, in the campaign language: whether old Statistics tables were converted (say so truthfully: a conversion that was written is a change of the master's document), or whether nothing was needed. Do not mention steps, scripts, drafts, reviews or markers.
