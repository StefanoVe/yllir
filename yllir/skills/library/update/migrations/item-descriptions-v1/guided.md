# Existing item descriptions (item-descriptions-v1)

Guided part of the migration `item-descriptions-v1`. Follow the rules in `${CLAUDE_PLUGIN_ROOT}/skills/library/update/post-update.md` (commands and writes, questions, result). Run the item commands of this file exactly as written, from the campaign root, with `${CLAUDE_PLUGIN_ROOT}` for the plugin root.

## Steps

1. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/item-descriptions.mjs" . --prepare`. If status is `pending`, process each listed item whose status is `pending`. Do not process an item marked `changed`: tell the master that this sheet changed during the migration and leave it pending for a fresh review. If there are no items, the inventory is complete without writes: go to Completion.
2. For each pending item, read its full source, `campaign.yaml`, `.campaign/customizations.md` if it exists, and representative item descriptions. Preserve established appearance and function in `## In brief` / `## In breve` (add the missing section for legacy sheets); make `## Description` / `## Descrizione` add established context rather than repeat the brief. Do not invent context, function, effects, provenance or tone. If the public context is insufficient or ambiguous, ask the question and keep the item pending.
3. Either write a complete draft, or state `REVIEWED_UNCHANGED` with a short evidence-based reason when the existing descriptions already meet both requirements. Save the full text in `.campaign/state/write/draft/<SOURCE_FILE>` and run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/item-descriptions.mjs" . --stage <SOURCE_FILE> <draft-relative-path>`. Stage unchanged text the same way.
4. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/item-descriptions.mjs" . --verify <comma-separated source paths>`. This checks source hashes, unchanged bytes outside the two description sections, the master block and the required nonempty public sections. Any failure stops here: keep the item pending.
5. If the staged text is byte-identical to the source, the item was reviewed and accepted without a campaign write. Otherwise write the staged text through the write cycle (see `post-update.md`) for the changed item paths, with the intent «adapt existing item descriptions», `NEW_SUBJECTS` empty and a version message in the campaign language. Pass the canon context to the reviewer; never give the reviewer master-only notes, because the revised text is public. Then run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/item-descriptions.mjs" . --complete <comma-separated reviewed paths>`. Completion is allowed only when the published bytes match the verified draft hashes.
6. Continue until the inventory reports complete. On a question, a source change, missing context or a verification failure, leave the migration pending.

Do not mark completion from section headings or other structural heuristics alone. An unchanged item is marked complete only through the same verify-and-complete steps.

## Completion

When every item is complete, run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/update-campaign.mjs" . --complete item-descriptions-v1`. Report the migration complete only when its status is `complete`.
