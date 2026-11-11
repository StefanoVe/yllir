# Item sheets and what the players know (item-knowledge-v1)

Guided part of the migration `item-knowledge-v1`. Follow the rules in `${CLAUDE_PLUGIN_ROOT}/skills/library/update/post-update.md` (commands and writes, questions, result). Run the item commands of this file exactly as written, from the campaign root, with `${CLAUDE_PLUGIN_ROOT}` for the plugin root.

This migration is the one exception to the rule of `post-update.md` on master-only blocks: you read the master block of each item to know what is secret, and you may move public text into it. You never copy text from the master block into the public part.

## The rule

The public sections of an item sheet (`In breve`/`In brief`, `Descrizione`/`Description`, `Effetti`/`Effects`, and the optional `Origine`/`Origin`, `Ritrovamento`/`Finding`, `Testo`/`Text`, `Valore`/`Value`) describe the item only as the players know it: what they see, what was said or identified at the table, what anyone in the world would know. They never state or hint at what the players do not know. The master block holds the full context of the item: what it really is, its true origin, its complete real effects, its secrets, its plot uses.

## Steps

1. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/item-descriptions.mjs" . --migration=item-knowledge-v1 --prepare`. If status is `pending`, process each listed item whose status is `pending`. Do not process an item marked `changed`: tell the master that this sheet changed during the migration and leave it pending for a fresh review. If there are no items, the inventory is complete without writes: go to Completion.
2. For each pending item, read its full source with the Read tool, then find what the players learned about it: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" query . related <item id>` and read the chronicle pages it lists, and search the chronicle folder for the item's title and aliases with Grep.
3. Sort every fact stated in the public sections:
   - **Known**: it is visible (appearance, material, size), a chronicle page shows the players learned it (identified, told, seen in action), or it is common knowledge in the public canon. It stays public.
   - **Not known**: the master block or the seed treats it as secret, or it is a hidden nature, a curse, a true origin or an effect not yet identified, and no chronicle page shows the players learned it. It moves to the master block.
   - **Unsure**: ask the master ONE question in the campaign language, naming the item and the fact (for example «I giocatori sanno che la chiave è maledetta?»), and keep the item pending.
4. Write the new sheet. Move, never delete: each not-known fact goes into the master block, under `### Indicazioni per il master` (English: `### Master notes`), after the text already there; keep every existing line of the master block as it is. Rewrite the public sentence so it no longer states or hints at the fact. Keep `## Effetti`/`## Effects` with the known effects only, in the adapter's format; if no known effect remains, write `Nessun effetto di gioco` (English: `No game effect`) and put the real effects in the master block. If the master block does not yet say what the item really is and its real effects, complete it only with facts already written in the sheet. Do not invent facts. Do not change the metadata block or the `#` title.
5. If the sheet already follows the rule, run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/item-descriptions.mjs" . --migration=item-knowledge-v1 --accept-unchanged <SOURCE_FILE> "<short reason based on the sheet>"` and go to step 8 for that item.
6. Otherwise save the full new text in `.campaign/state/write/draft/<SOURCE_FILE>` and run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/item-descriptions.mjs" . --migration=item-knowledge-v1 --stage <SOURCE_FILE> .campaign/state/write/draft/<SOURCE_FILE>`. Then run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/item-descriptions.mjs" . --migration=item-knowledge-v1 --verify <comma-separated source paths>`. This checks the source hashes, the unchanged metadata and title, the required public sections, a single master block at the end, and that no line of the old master block was lost. Any failure stops here: keep the item pending.
7. Write the verified text through the write cycle (see `post-update.md`) for the changed item paths, with the intent «move what the players do not know into the master notes», `NEW_SUBJECTS` empty and a version message in the campaign language. The `yllir:batch-reviewer` works on the canon and reads the whole sheet, master block included.
8. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/item-descriptions.mjs" . --migration=item-knowledge-v1 --complete <comma-separated reviewed paths>`. Completion is allowed only when the published bytes match the verified draft hashes.
9. Continue until the inventory reports complete. On a question, a source change, missing context or a verification failure, leave the migration pending.

## Completion

When every item is complete, run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/update-campaign.mjs" . --complete item-knowledge-v1`. Report the migration complete only when its status is `complete`.
