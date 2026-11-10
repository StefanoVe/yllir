# Post-update process

This process is read only by `yllir:process-runner`. It converts legacy statistics blocks in campaign sheets after the framework version has been aligned. It never speaks to the master directly.

The resumable migration identifier is `statistics-tables-v1`; it is separate from the session-layout migration recorded by `migrated`.

Resolve the installed plugin root from `PLUGIN_ROOT` in Codex, falling back to `CLAUDE_PLUGIN_ROOT` in Claude Code. If both are unset, stop before running a migration command and finish FAILED using the lexicon’s fixed sentence for an operation that could not be completed. Do not give the master the technical reason or claim the sheets were checked or changed. Use the campaign language from `campaign.yaml`. Keep all campaign document writes inside the existing write sequence. An ambiguous prose table is interpreted by Luna; preserve its meaning and every value, and ask the master through the runner result if the interpretation cannot be made safely.

## Steps

1. Run `node "${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/skills/core/update/scripts/post-update.mjs" . --prepare` from the campaign root. Read the JSON result and its `exit:` line.
   - `status: complete`: no legacy statistics remain. Run `node "${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/skills/core/update/scripts/post-update.mjs" . --complete`, read the result, then finish DONE only if its status is `complete`.
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
4. Before any write sequence, run `node "${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/skills/core/update/scripts/post-update.mjs" . --verify "<candidate paths comma-separated>"`. This verifies that source files stayed unchanged while the draft was prepared, numbers were retained, all bytes outside Statistics sections (including every Master block) are exact, and no old or ambiguous table remains. A `legacy-statistics-remain` result means no campaign content is written: ask one precise question about the first unresolved section and finish QUESTION. Any other verification failure means no campaign content is written; finish FAILED and report the file and reason.
5. For every candidate with a changed draft, invoke `yllir:write-sequence` with:
   - `DOCUMENTS` set to the changed paths;
   - `INTENT` saying that old Statistics tables are being converted to the current sheet format, preserving their established facts and values;
   - `NEW_SUBJECTS` empty;
   - `VERSION_MESSAGE` translated into the campaign language: “Converted old Statistics tables to the current format.”;
   - `ROUND=1`;
   - `CONTINUE_WITH="post-update step 6: verify completion and write the runner result"`.
   Follow the write sequence fully, including continuity checks, independent review, deterministic verification, linking, and saved version. Do not write any campaign sheet yourself.
6. If write-sequence is DONE, run `node "${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/skills/core/update/scripts/post-update.mjs" . --complete`. Only report the migration complete when this result says `status: complete`. If it remains pending, do not claim completion. Ask one precise question about the first unresolved section and finish QUESTION, so the user’s answer resumes this topic. If write-sequence asks a question, return QUESTION and record the exact question and resume step in the runner result. On FIX_NEEDED, VERIFY_FAILED, FAILED or other non-DONE outcomes, report the result without claiming completion.

## Result

Write `.campaign/state/runner/result.txt` using the exact `RUNNER RESULT` format in `yllir/agents/process-runner.md`. For DONE, state whether old Statistics tables were converted or no work was needed. For QUESTION, ask only the unresolved interpretation question. For FAILED, say that the format update could not be completed. Mention format changes truthfully; do not say that nothing of the master's changed when a conversion was written.
