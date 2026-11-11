# Statistics tables (statistics-tables-v1)

Guided part of the migration `statistics-tables-v1`. Follow the rules in `${CLAUDE_PLUGIN_ROOT}/skills/library/update/post-update.md` (commands and writes, questions, result). The deterministic conversions are already staged under `.campaign/state/write/draft/`.

## Steps

1. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/post-update.mjs" . --prepare`. Read the JSON result and its `exit:` line.
   - `status: complete`: no legacy statistics remain. Go to Completion.
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

   Save a returned draft exactly to `.campaign/state/write/draft/<SOURCE_FILE>` with the Write tool. If the sub-agent returns QUESTION, keep the current staged draft unchanged and ask that question (see `post-update.md`, Questions).
3. Read the original and the staged draft of every candidate. The changed list contains only candidates whose staged draft differs from the current source. If it is empty, go to Completion. If legacy prose remains, ask one precise question about the first unresolved section. On the next turn, include the master's answer in `MASTER_ANSWER` and do not ask the same question again.
4. Before any write, run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/post-update.mjs" . --verify "<candidate paths comma-separated>"`. It verifies that the sources stayed unchanged while the drafts were prepared, that the numbers were kept, that every byte outside the Statistics sections (including every Master block) is exact, and that no old or ambiguous table remains. If the result is `legacy-statistics-remain`, nothing is written: ask one precise question about the first unresolved section. Any other verification failure: nothing is written; say the fixed sentence of the lexicon for an operation that could not be completed.
5. For every candidate with a changed draft, copy the staged draft to `.campaign/drafts/<path>` and run the write cycle (see `post-update.md`) with: the intent «convert old Statistics tables to the current sheet format, preserving their established facts and values»; `NEW_SUBJECTS` empty; the version message «Converted old Statistics tables to the current format.», translated into the campaign language. Follow the write cycle fully, including the review. Write no campaign sheet by any other means.
6. If the commit is saved, go to Completion. If the review or the commit does not finish, the migration stays pending: say the fixed sentence of the lexicon for an operation that could not be completed.

## Completion

Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/update-campaign.mjs" . --complete statistics-tables-v1`. Report the migration complete only when its status is `complete`. If it is still `pending`, ask one precise question about the first unresolved section (see `post-update.md`, Questions).

## Result

Say to the master, in the campaign language, only whether old Statistics tables were converted (say so truthfully: a conversion that was written is a change of the master's document), or whether nothing was needed. Do not mention steps, scripts, drafts, reviews or markers.
