# Checks of the scenes in the new form (scene-checks-v1)

Guided part of the migration `scene-checks-v1`. Follow the rules in `${CLAUDE_PLUGIN_ROOT}/skills/library/update/post-update.md` (commands and writes, questions, result). Run the scene commands of this file exactly as written, from the campaign root, with `${CLAUDE_PLUGIN_ROOT}` for the plugin root.

A scene is a plot event file: a Markdown file in `<plot folder>/<Session>/Eventi/` (English campaigns: `Events/`). The session main file `<Session>/<Session>.md` is not a scene.

## The rule

Every check of a scene is written in this form, in the campaign language:

```markdown
### Prova: Carisma (Persuasione) CD 13

Chi parla con Sibilla tira.

#### Successo

Il gruppo ottiene un consiglio sulla strada per il bosco.

#### Fallimento

Il gruppo riceve soltanto un invito a tornare il giorno dopo.
```

English campaigns use `### Check:`, `#### Success` and `#### Failure`.

- The heading is `### Prova: <check>` (English `### Check: <check>`). The check is written in the adapter's format. When `system.adapter` is `none`, write the check in words, keeping the old words, for example `### Prova: cortesia (difficoltà da definire)`.
- For D&D 2024 the check is one of: `<Caratteristica> (<Abilità>) CD <n>`, `<Caratteristica> CD <n>`, `Tiro salvezza su <Caratteristica> CD <n>`. English: `<Ability> (<Skill>) DC <n>`, `<Ability> DC <n>`, `<Ability> saving throw DC <n>`.
- Each check has exactly one `#### Successo` heading and one `#### Fallimento` heading after it (English: `#### Success`, `#### Failure`), each followed by its text as a paragraph.
- Only checks use `###`. A `###` heading that is an action, not a check, becomes `##`.
- Scenes with `provenance: played` are converted too. This changes the form of the text, not what happened: never change an outcome or a fact.

## Steps

1. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/scene-checks.mjs" . --prepare`. If status is `complete`, go to Completion. If status is `failed`, stop and leave the migration pending. Otherwise process each scene of the `scenes` list whose status is not `complete`, one at a time, in the order of the list.
2. For a scene with status `changed`: the scene changed while the update was running. Tell the master in one sentence, in the campaign language, that this scene changed and will be checked again. Read the scene with the Read tool, then run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/scene-checks.mjs" . --refresh <SOURCE_FILE>`. Its status becomes `pending`; process it as in step 3.
3. For a scene with status `pending`:
   a. Read the full scene with the Read tool. Read its `errors` list from step 1: each entry is `line N <code>: <message>` and names the line to fix.
   b. Rewrite only what those lines point to, following the rule above:
      - An old check heading (for example `### Controllo di cortesia (difficoltà da definire)`) becomes `### Prova: <check>`, keeping the old words.
      - An old outcome list item (`- **Successo:** text` or `- **Fallimento:** text`, English `Success` and `Failure`) becomes a `#### Successo` (or `#### Fallimento`) heading, a blank line, and the same text as a paragraph. Keep the same words; capitalise the first letter only.
      - A `###` heading that is an action (not a check) becomes `##` with the same text.
      - A check asked in prose (for example "Chiedete ai giocatori una prova di Saggezza") becomes a check block at that point: a `### Prova: <check>` heading, then the sentence that asks for the check as its paragraph, then the two outcome headings. Keep every sentence that sets the scene. Take the outcomes only from what the text already says.
      - If the text gives no outcome for one side of a check, do not invent one. Ask the master ONE question in the campaign language, naming the scene and the check, and keep the scene pending.
      - When the old check has no value (for example `difficoltà da definire`) or no skill, and `system.adapter` is not `none`, choose the value from the game system for that action, in the adapter's format. Record each chosen value for the result.
   c. Never add facts. Never change the metadata block (the `<!-- yllir` block at the top) or the master-only block (from `<!-- master -->` to the end). Never change any other text.
   d. Save the full new text of the scene with the Write tool to `.campaign/state/write/draft/<SOURCE_FILE>`, creating the folders if needed.
   e. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/scene-checks.mjs" . --stage <SOURCE_FILE> .campaign/state/write/draft/<SOURCE_FILE>`. If it fails, keep the scene pending and leave it out of the batch.
   f. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/scene-checks.mjs" . --verify <SOURCE_FILE>`. If it fails, read each error: `scene-checks-remain` lists the remaining problems in `detail`, `outcome-text-lost` names the missing outcome text, `head-changed` and `master-block-changed` mean you changed a protected block. You may correct the draft once, save it again, and run `--stage` and `--verify` again. If it still fails, keep the scene pending and leave it out of the batch. If it passes, the scene is verified and goes into the batch of step 4.
4. After every pending scene of the pass has been processed, write the verified scenes in one batch. If no scene is verified, skip this step. Otherwise:
   a. For each verified scene, copy its draft text unchanged to `.campaign/drafts/<SOURCE_FILE>` with the Read and Write tools.
   b. Write all the verified scene paths through one write cycle of `post-update.md`: pass every path as `--files`, with the intent «write the checks of the scenes in the new form, with the same outcomes», `NEW_SUBJECTS` empty, and one version message in the campaign language.
   c. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/scene-checks.mjs" . --complete <comma-separated verified paths>`. If its status is `complete`, every scene of the batch is done. If it is `pending`, nothing of that batch is completed: run `--complete` once for each path alone, so each scene is completed or left pending on its own.
5. A scene that has a question, a changed source or a failed verification stays pending and is left out of the batch. The other scenes go on.
6. When the pass is done, run step 1 again. Repeat until the status is `complete`. If a pass completes no scene, stop and leave the migration pending.

## Completion

When every scene is complete, run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/update-campaign.mjs" . --complete scene-checks-v1`. Report the migration complete only when its status is `complete`.

## Result

Your message to the master, in the campaign language, says only:
- that the checks of the scenes were written in the new form, and how many scenes were changed (if none needed a change, say so);
- for each value you chose yourself, one line in the form «Inventato dall'assistente: <scene>, <value>» (English campaigns: «Invented by the assistant: <scene>, <value>»), so the master can change it;
- any question you asked, and any scene that is still pending.

Do not mention steps, scripts, drafts, reviews or markers.
