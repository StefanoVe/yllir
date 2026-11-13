# Fights of the scenes (encounters-v1)

Guided part of the migration `encounters-v1`. Follow the rules in `${CLAUDE_PLUGIN_ROOT}/skills/library/update/post-update.md` (commands and writes, questions, result). Run the commands of this file exactly as written, from the campaign root, with `${CLAUDE_PLUGIN_ROOT}` for the plugin root.

A scene is a plot event file: a Markdown file in `<plot folder>/<Session>/Eventi/` (English campaigns: `Events/`). Its metadata block (the `<!-- yllir` block at the top) may now declare the fights of the scene with an `enemies` key. Only the metadata block changes in this migration.

## The rule

A fight is written in the metadata block, in this form, with the ids and counts of the scene:

```
enemies:
  - id: guardiano-di-sale
    count: 3
  - id: capo-dei-predoni
    count: 1
```

- Each `id` is a creature of the campaign, and each entry has exactly the two keys `id` and `count`.
- `count` is a positive whole number, written as the text states it.
- Each `id` appears once.
- A scene with no fight has no `enemies` key at all.

## Steps

1. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/encounters.mjs" . --prepare`. If `status` is `complete`, go to Completion. If `status` is `failed`, stop and leave the migration pending. Otherwise the `events` list holds the pending scenes; process each one, in the order of the list, one at a time.
2. For each pending event, with its `candidates` (the creatures that the scene lists among its characters):
   a. Read the whole event file with the Read tool.
   b. If the event already has a valid `enemies` block (it was written by hand, or in an earlier pass): skip to step 2f.
   c. Decide from the text of the scene whether a fight happens there (a battle, an ambush, a creature that attacks or must be fought). Use the text of the scene and its metadata only.
      - No fight: run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/encounters.mjs" . --no-fight <SOURCE_FILE>` with the campaign-relative path of the event. It is never proposed again. Go on with the next event.
   d. A fight happens. For each enemy the text names:
      - Its `id` must be one of the `candidates`. If the text names a creature that is not among the `candidates`, ask the master ONE question naming the scene and that creature, and keep the event pending (step 3).
      - Its `count` is the number the text states for it. If the text gives no number for an enemy, ask the master ONE question naming the scene and the enemy, and keep the event pending (step 3). Never guess a number.
   e. When every enemy has an id and a count, write the block:
      - Save the whole file to `.campaign/drafts/<SOURCE_FILE>` with the Write tool. Copy the file text exactly, and add the `enemies` lines at the END of the metadata block, just before its closing `-->` line. Use the form of «The rule», with two spaces before each `-` and four before each `count`.
      - Change nothing else: no other line of the metadata block, no line of the text, no line of the master-only block (from `<!-- master -->` to the end). Compare the draft with the source before going on: the text after the closing `-->` line must be the same.
      - Put the event in the batch of step 4.
   f. For an event whose `enemies` block is already valid, put it in the batch with `--complete`, without writing a draft (see step 4c).
3. A question stops only its own event: that event stays pending and is left out of the batch. The other events go on. Do not repeat a question the master has already answered.
4. After every pending event has been processed, write the batch:
   a. If there are drafts, write them as one batch through the write cycle of `post-update.md`: pass every draft path as `--files` (campaign-relative, without `.campaign/drafts/`), with the message «Scene: combattimenti dichiarati» (English campaigns: «Scenes: fights declared»), and no `--note`. Do not run `--complete` before the commit succeeded. If there are no drafts, go on to step 4b.
   b. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/encounters.mjs" . --complete <comma-separated campaign-relative paths>` with every event of the batch and every event of step 2f. Its `completed` list names the events that are done. The others stay pending; their `errors` say why.
5. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/encounters.mjs" . --prepare` again. If `status` is `complete`, go to Completion. Otherwise, the migration stays pending: its remaining events are picked up the next time the campaign is opened.

## Completion

When `--prepare` reports `status` `complete`, run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/update-campaign.mjs" . --complete encounters-v1`. Report the migration complete only when its JSON `status` is `complete`.

## Result

Your message to the master says only, in the campaign language:
- how many scenes got their fights declared (the scenes with a fight written), and how many were found to have no fight;
- each question you asked, one per line, and which scene it is about;
- that the scenes that are still pending will be asked again the next time the campaign is opened, if any.

Do not mention steps, scripts, drafts, reviews or markers.
