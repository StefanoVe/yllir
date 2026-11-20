# Place symbols after the update (place-kinds-v1)

Guided part of the migration `place-kinds-v1`. Follow the rules in `${CLAUDE_PLUGIN_ROOT}/skills/library/update/post-update.md` (questions, result). Run the commands of this file exactly as written, from the campaign root, with `${CLAUDE_PLUGIN_ROOT}` for the plugin root.

The campaign language is `language.main` in `campaign.yaml`. Use it for every message to the master.

This pass changes only the symbol (the `kind`) of places on the atlas map that still show the generic landmark symbol. It never changes a place the master placed with its own symbol, and it changes nothing else. The symbol is a picture on the map and can be changed later, so the master is not asked.

## Steps

1. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/place-kinds.mjs" . --list`. Read its `status`. If it is `complete`, go to Completion. Otherwise keep the `candidates` list: each item has `id` (the id of its item in the labels file) and `place` (the id of its sheet).
2. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" places .`. It lists every place with its `id`, `title` and `file`. For each candidate, find the entry whose `id` equals the candidate's `place`, and keep its `file`. Read each candidate's sheet with the Read tool. Read only its title and its public sections. Never use the master-only block of a sheet, and never write anything from it.
3. For each candidate, choose the kind that the sheet clearly states, from the list and the meanings in `${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/SKILL.md`, Step 7 (the `places` bullet). When the sheet does not clearly say what the place is, keep `landmark`. Do not ask the master.
4. If no kind changes, go to step 7.
5. Read the labels file of the atlas with the Read tool: `<atlas folder>/labels.json`. The atlas folder is the `folder` of the entry of type `atlas` in `campaign.yaml`. Write `.campaign/state/atlas/labels.json` with the Write tool as the WHOLE content: identical to the labels file, except the `kind` of the changed places (the items whose `id` is a candidate). Then run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" labels-write . .campaign/state/atlas/labels.json`. If it exits 1, read the `error:` lines. A pier refused for being too far from the sea goes back to `landmark`. Fix and run it again once. If it still fails, stop: the migration stays pending.
6. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" render .`. Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" save . --message "<one sentence in the campaign language, e.g. «Atlante: simboli più precisi per i luoghi.»>"`.
7. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/place-kinds.mjs" . --done`. This records every candidate as reviewed, including those that kept `landmark`.

## Completion

Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/update-campaign.mjs" . --complete place-kinds-v1`. Report the migration complete only when its JSON `status` is `complete`.

## Result

Your message to the master, in the campaign language, says only how many places on the map now have a more precise symbol, in one plain sentence. When nothing changed, say nothing about it. When the migration is still pending, say only that the update is not finished yet.

Do not mention steps, scripts, labels, kinds, symbols as data, migrations or commands.
