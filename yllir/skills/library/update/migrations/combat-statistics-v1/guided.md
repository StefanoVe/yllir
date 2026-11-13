# Combat statistics of characters and enemies (combat-statistics-v1)

Guided part of the migration `combat-statistics-v1`. Follow the rules in `${CLAUDE_PLUGIN_ROOT}/skills/library/update/post-update.md` (commands and writes, questions, result). Run the commands of this file exactly as written, from the campaign root, with `${CLAUDE_PLUGIN_ROOT}` for the plugin root.

A sheet is a character or enemy file of the campaign: a Markdown file whose `template` is `npc`, `vendor` or `enemy`, and which is not a sketch (`sketch: true`).

## The rule

1. Every `npc`, `vendor` and `enemy` sheet that is not a sketch has a `## Statistiche` section (English campaigns: `## Statistics`). The section holds the tables of `${CLAUDE_PLUGIN_ROOT}/templates/content-format.md`, section 4.3, and at least one row in `### Attacchi e capacità` (English: `### Attacks and abilities`), even for a character who does not seek a fight (a minimal profile, for example an unarmed strike). The section goes after `## Al tavolo` (English: `## At the table`) for a character, and after `## Natura` (English: `## Nature`) for an enemy.
2. A rolled amount is written as dice only. Wrong: `Colpisce: 4 (1d6 + 1) danni perforanti`. Right: `Colpisce: 1d6 + 1 danni perforanti`. The hit points in the Characteristics table keep their number: `| PF | 11 (2d8 + 2) |`.

## Steps

1. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/combat-statistics.mjs" . --prepare`. If status is `complete`, go to Completion. If status is `failed`, stop and leave the migration pending. Otherwise process each sheet of the `sheets` list whose status is not `complete`, one at a time, in the order of the list.
2. For a sheet with status `changed`: the sheet changed while the update was running. Tell the master in one sentence, in the campaign language, that this sheet changed and will be checked again. Read the sheet with the Read tool, then run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/combat-statistics.mjs" . --refresh <SOURCE_FILE>`. Its status becomes `pending`; process it as in step 4.
3. For a sheet with status `pending`, `needs_actions` false and `auto_draft: true`: its rolls were already fixed in the staged draft. Go straight to step 4f.
4. For any other sheet with status `pending`:
   a. Read the full sheet with the Read tool. If the record has `auto_draft: true`, also Read `.campaign/state/write/draft/<SOURCE_FILE>` and start from that text (its rolls are already fixed).
   b. If `needs_actions` is true, write the Statistics section yourself, from the sheet (role, appearance, what the character does, its equipment, its master-only notes), the canon and the game system. If `system.adapter` in `campaign.yaml` is not `none`, read `${CLAUDE_PLUGIN_ROOT}/modules/systems/<system.adapter>/adapter.yaml` and use the fields and formats it names, keeping the arithmetic right (a modifier comes from its score). If it is `none`, write the values in words, never as numbers. Pick a power that fits the character: an innkeeper is an ordinary person, a captain of the guard is trained. Keep every line the section already has; add only what is missing (a missing table, the action rows). If the master's text already states a weapon or a fighting style, use it. Write each rolled amount as dice only. Record what you invented for the result.
   c. Fix any remaining precomputed roll in the section: write the dice only.
   d. Never change any text outside the Statistics section, the metadata block or the master-only block. Never add facts outside the Statistics section.
   e. Save the full text of the sheet with the Write tool to `.campaign/state/write/draft/<SOURCE_FILE>`, creating the folders if needed, then run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/combat-statistics.mjs" . --stage <SOURCE_FILE> .campaign/state/write/draft/<SOURCE_FILE>`. If it fails, keep the sheet pending and leave it out of the batch.
   f. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/combat-statistics.mjs" . --verify <SOURCE_FILE>`. Explain each error code in one line: `rolls-remain` (a rolled amount is still written with its result), `actions-missing` (the attacks table has no row), `statistics-table` (a table has the wrong heading or columns, `detail` gives the reason), `outside-changed` (you changed text outside the section), `statistics-lost` (a line of the section is missing from the draft; `detail` gives it), `head-changed` and `master-block-changed` (you changed a protected block). You may correct the draft once, save it again, and run `--stage` and `--verify` again. If it still fails, keep the sheet pending and leave it out of the batch. If it passes, the sheet is verified and goes into the batch of step 5.
5. After every pending sheet of the pass has been processed, write the verified sheets in one batch. If no sheet is verified, skip this step. Otherwise:
   a. For each verified sheet, copy its draft text unchanged to `.campaign/drafts/<SOURCE_FILE>` with the Read and Write tools.
   b. Write all the verified sheet paths through one write cycle of `post-update.md`: pass every path as `--files`, with the intent «add the combat statistics the characters and enemies were missing, and write rolled amounts as dice only», `NEW_SUBJECTS` empty, and one version message in the campaign language. The write cycle includes the independent review, because new statistics add facts to the canon.
   c. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/combat-statistics.mjs" . --complete <comma-separated verified paths>`. If its status is `complete`, every sheet of the batch is done. If it is `pending`, nothing of that batch is completed: run `--complete` once for each path alone, so each sheet is completed or left pending on its own.
6. A sheet that has a question, a changed source or a failed verification stays pending and is left out of the batch. The other sheets go on.
7. When the pass is done, run step 1 again. Repeat until the status is `complete`. If a pass completes no sheet, stop and leave the migration pending.

## Completion

When every sheet is complete, run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/update-campaign.mjs" . --complete combat-statistics-v1`. Report the migration complete only when its status is `complete`.

## Result

Your message to the master, in the campaign language, says only:
- how many sheets had their rolled amounts written as dice, and how many sheets received combat statistics (if none needed a change, say so);
- for each sheet that received statistics, one line «Inventato dall'assistente: <title>, statistiche di combattimento» (English campaigns: «Invented by the assistant: <title>, combat statistics»), so the master can change them;
- any question you asked, and any sheet that is still pending.

Do not mention steps, scripts, drafts, reviews or markers.
