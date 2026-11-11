# Post-update process

This process is read only by `yllir:process-runner`. It adapts existing item descriptions and converts legacy statistics blocks after framework alignment. It never speaks to the master directly.

The identifiers `category-first-geography-v1`, `item-descriptions-v1` and `statistics-tables-v1` have separate state and completion. They are separate from the session-layout migration recorded by `migrated`.

Never put `PLUGIN_ROOT=...` or `CLAUDE_PLUGIN_ROOT=...` before a command that references that same variable: the shell expands the argument before applying the assignment. Use the existing fallback command below when either variable is present. In Codex, if both variables are absent, derive the absolute plugin root from the registered `yllir:update` skill path shown in context (remove `/skills/core/update/SKILL.md`) and run the allowed script by its absolute path. If no reliable path is available, stop before running a migration command and finish FAILED using the lexicon’s fixed sentence for an operation that could not be completed. Do not give the master the technical reason or claim the sheets were checked or changed. Use the campaign language from `campaign.yaml`. Keep all campaign document writes inside the existing write sequence. An ambiguous prose table is interpreted by Luna; preserve its meaning and every value, and ask the master through the runner result if the interpretation cannot be made safely.

## Steps

### Geographic layout

Read `.campaign/state/update.yaml` with the Read tool. If it contains the line `geography_migration: pending`, read `"${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/skills/core/update/post-geography.md"` with the Read tool (same plugin-root rules as the rest of this file) and follow its steps first. If that finishes with QUESTION or FAILED, stop here and finish with that same outcome: do not start the other two migrations in this run, because their files may still move. If it finishes DONE, or the line is absent, continue with "Existing item descriptions", then "Statistics tables".

### Existing item descriptions

Run `node "${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/skills/core/update/scripts/item-descriptions.mjs" . --prepare` (or the absolute installed plugin path in Codex). If status is `pending`, process each listed item whose status is `pending`. Do not process an item marked `changed`; tell the master that this sheet changed during the migration and leave it pending for a fresh review. If there are no items, this migration is complete without writes.

For each pending item, read its full source, campaign configuration, `.campaign/customizations.md` if it exists, and representative item descriptions. Use the established canon and public material only. Never reveal or use the master-only block to draft public text. Preserve established appearance/function in `## In brief` / `## In breve` (add the missing section for legacy sheets); make `## Description` / `## Descrizione` add established context rather than repeat the brief. Do not invent context, function, effects, provenance, or tone. If relevant public context is insufficient or ambiguous, return QUESTION and keep the item pending.

Have Luna return either a complete draft or an explicit `REVIEWED_UNCHANGED` with a short evidence-based reason when the existing descriptions already meet both requirements. On the complete-draft path, place the full text in an ignored draft file under `.campaign/state/write/draft/<SOURCE_FILE>` and run `item-descriptions.mjs . --stage <SOURCE_FILE> <draft-relative-path>`. Stage unchanged text the same way for explicit reviewed-unchanged. Run `--verify <comma-separated source paths>`; this checks source hashes, unchanged bytes outside the two description sections, the master block and required nonempty public sections. Any failure stops before write-sequence.

If staged text is byte-identical to source, record that this item was reviewed and accepted without a campaign write. Otherwise invoke `yllir:write-sequence` for the changed item paths with the intent to adapt existing item descriptions, `NEW_SUBJECTS` empty, and a campaign-language version message. Pass canon context to the independent reviewer. Never expose master-only notes to that reviewer; the revised text is public. Follow write-sequence fully. Then run `--complete <comma-separated reviewed paths>`; completion is allowed only when published bytes match the verified draft hashes. Resume from the saved per-item hashes after interruption. Continue until the inventory reports complete; on QUESTION, source change, missing context, or verification failure leave the migration pending.

Do not mark completion from section headings or other structural heuristics alone. The model's explicit review plus verified draft/published hashes is required. An unchanged item is marked complete only through the same verify-and-complete steps.

### Statistics tables

1. From the campaign root, run `node "${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/skills/core/update/scripts/post-update.mjs" . --prepare` when either variable is present. In Codex, if both are absent, run this script by the absolute path derived from this skill's installed location in context. Read the JSON result and its `exit:` line.
   - `status: complete`: no legacy statistics remain. Run the same script path with `. --complete`, read the result, then finish DONE only if its status is `complete`.
   - `status: failed`: finish FAILED. Do not claim the migration is complete.
   - `status: pending`: keep the `candidates` list and continue.
2. The script has staged deterministic conversions under `.campaign/state/write/draft/`. For each file in `pending`, preserve any deterministic changes already in that draft, then delegate the prose interpretation to a sub-agent with model GPT-6 Luna in Codex. If the scan reports `unsupported-language`, stop FAILED and tell the master that this format update could not be completed for their campaign language; keep the original sheets and the pending marker. For supported languages use this exact prompt, replacing the bracketed values:

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

   Save a returned draft exactly to `.campaign/state/write/draft/<SOURCE_FILE>` with the Write tool. Never let Luna write a campaign document. If it returns QUESTION, keep the current staged draft unchanged and return QUESTION with that question.
3. Read the original and staged draft for every candidate. The changed list contains only candidates whose staged draft differs from the current source. If it is empty, run `--complete`; finish DONE if complete. If legacy prose remains, ask one precise question about the first unresolved section and finish QUESTION. Use TOPIC handoff so the answer resumes this process rather than restarting it. On resume, include the master's answer in `MASTER_ANSWER` and preserve their earlier question from the handoff; do not ask it again.
4. Before any write sequence, run `node "${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/skills/core/update/scripts/post-update.mjs" . --verify "<candidate paths comma-separated>"` when either variable is present. Otherwise in Codex, use the absolute script path selected in step 1. This verifies that source files stayed unchanged while the draft was prepared, numbers were retained, all bytes outside Statistics sections (including every Master block) are exact, and no old or ambiguous table remains. A `legacy-statistics-remain` result means no campaign content is written: ask one precise question about the first unresolved section and finish QUESTION. Any other verification failure means no campaign content is written; finish FAILED and report the file and reason.
5. For every candidate with a changed draft, invoke `yllir:write-sequence` with:
   - `DOCUMENTS` set to the changed paths;
   - `INTENT` saying that old Statistics tables are being converted to the current sheet format, preserving their established facts and values;
   - `NEW_SUBJECTS` empty;
   - `VERSION_MESSAGE` translated into the campaign language: “Converted old Statistics tables to the current format.”;
   - `ROUND=1`;
   - `CONTINUE_WITH="post-update step 6: verify completion and write the runner result"`.
   Follow the write sequence fully, including continuity checks, independent review, deterministic verification, linking, and saved version. Do not write any campaign sheet yourself.
6. If write-sequence is DONE, run `node "${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/skills/core/update/scripts/post-update.mjs" . --complete` when either variable is present. Otherwise in Codex, use the absolute script path selected in step 1. Only report the migration complete when this result says `status: complete`. If it remains pending, do not claim completion. Ask one precise question about the first unresolved section and finish QUESTION, so the user’s answer resumes this topic. If write-sequence asks a question, return QUESTION and record the exact question and resume step in the runner result. On FIX_NEEDED, VERIFY_FAILED, FAILED or other non-DONE outcomes, report the result without claiming completion.

## Result

Write `.campaign/state/runner/result.txt` using the exact `RUNNER RESULT` format in `yllir/agents/process-runner.md`. For DONE, state whether old Statistics tables were converted or no work was needed. For QUESTION, ask only the unresolved interpretation question. For FAILED, say that the format update could not be completed. Mention format changes truthfully; do not say that nothing of the master's changed when a conversion was written.

### Result of the whole process

The whole process finishes DONE only when every migration it ran finished DONE, or was not needed. The first QUESTION or FAILED decides the outcome: stop there and report it as described above, without starting the migrations that follow.
