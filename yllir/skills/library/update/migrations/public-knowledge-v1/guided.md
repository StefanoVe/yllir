# What the players may know (public-knowledge-v1)

Guided part of the migration `public-knowledge-v1`. Follow the rules in `${CLAUDE_PLUGIN_ROOT}/skills/library/update/post-update.md` (commands and writes, questions, result). Run the commands of this file exactly as written, from the campaign root, with `${CLAUDE_PLUGIN_ROOT}` for the plugin root. Every command below uses `--migration=public-knowledge-v1`.

This migration is the one exception to the rule of `post-update.md` on master-only blocks: you read the master block of each sheet to know what is secret, and you may move public text into it. You never copy text from the master block into the public part.

## The rule

The public part of a sheet is everything before its master block. It holds only what the players may know. A purpose, a destination, a true nature or a link to the plot that the players have not learned goes in the master block. Statistics, stock and the notes on voice and manner stay public.

## Steps

1. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/item-descriptions.mjs" . --migration=public-knowledge-v1 --prepare`. If status is `pending`, process each listed item whose status is `pending`. Do not process an item marked `changed`: tell the master that this sheet changed during the migration and leave it pending for a fresh review. If there are no items, the inventory is complete without writes: go to Completion.
2. For each pending sheet, read its full source with the Read tool, then find what the players learned about it: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" query . related <sheet id>` and read the chronicle pages it lists, and search the chronicle folder for the sheet's title and aliases with Grep.
3. Sort every fact stated in the public part:
   - **Known**: the players have seen it, been told it, or identified it at the table, or it is common knowledge in the public canon. It stays public.
   - **Not known**: it states a purpose, a destination, a true nature or a plot link, and no chronicle page shows the players learned it. It moves to the master block.
   - **Unsure**: ask the master ONE question in the campaign language, naming the sheet and the fact, and keep the sheet pending.
4. Write the new sheet, by kind:
   - **Item sheets** with a `## Ritrovamento` or `## Finding` section: move the whole section text into the master block, under `### Indicazioni per il master` (English: `### Master notes`), after the text already there, and remove the public section. If there is no master block, create one at the end in exactly this form: `<!-- master -->`, `## Master`, `### Indicazioni per il master`, the text, `<!-- /master -->`.
   - **Item type**: for each item sheet without a valid `item_type`, choose one from the sheet: book (also letters, scrolls, maps on paper), weapon, armor (also shields), equipment (tools, clothes, lanterns, containers), consumable (potions, food, ammunition), key, other. Before writing, show the master ONE message in the campaign language that lists every pending item with its proposed type, in plain words with no key names (for example «Lanterna di Morvalle: attrezzatura»). Write after a yes, using the master's corrections. Add the line `item_type: <value>` to the metadata block right after the `template:` line, and change nothing else in the metadata.
   - **Non-item sheets** (place, character, creature, faction, event): write `## Sinossi` (English: `## Synopsis`) as the first section, after the title and its image if any: one to three sentences, only from the public part, with no spoiler. If the sheet has no master block, create an empty one at the end in the form of the item case (`<!-- master -->`, `## Master`, `### Indicazioni per il master`, `<!-- /master -->`), because the check requires exactly one master block at the end.
   - **Any sheet**: move into the master block every public sentence that states a purpose, a destination, a true nature or a plot link the players have not learned. Move, never delete. Do not change the `#` title or the metadata other than the item type above. Do not invent facts.
5. Save the full new text in `.campaign/state/write/draft/<SOURCE_FILE>` and run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/item-descriptions.mjs" . --migration=public-knowledge-v1 --stage <SOURCE_FILE> .campaign/state/write/draft/<SOURCE_FILE>`. Then run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/item-descriptions.mjs" . --migration=public-knowledge-v1 --verify <comma-separated source paths>`. This checks the source hashes, the title and the metadata (except the item type line), that the master block is single and at the end, that no line of the old master block was lost, that no sheet still needs the pass, and that a non-item sheet has text in its Synopsis. Any failure stops here: keep the sheet pending.
6. Write the verified text through the write cycle (see `post-update.md`) for the changed sheet paths, with the intent «only what the players may know stays public», `NEW_SUBJECTS` empty and a version message in the campaign language. The `yllir:batch-reviewer` works on the canon and reads the whole sheet, master block included.
7. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/item-descriptions.mjs" . --migration=public-knowledge-v1 --complete <comma-separated reviewed paths>`. Completion is allowed only when the published bytes match the verified draft hashes.
8. Continue until the inventory reports complete. On a question, a source change, missing context or a verification failure, leave the migration pending.

## Completion

When every sheet is complete, run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/update-campaign.mjs" . --complete public-knowledge-v1`. Report the migration complete only when its status is `complete`.
