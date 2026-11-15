# Plot map after the update (plot-flowchart-v1)

Guided part of the migration `plot-flowchart-v1`. Follow the rules in `${CLAUDE_PLUGIN_ROOT}/skills/library/update/post-update.md` (questions, result). Run the commands of this file exactly as written, from the campaign root, with `${CLAUDE_PLUGIN_ROOT}` for the plugin root.

The campaign language is `language.main` in `campaign.yaml`. Use it for every message to the master.

This pass writes only the plot map: one file at the root of the plot folder, drawn by the `yllir:plot-mapper` agent from the sessions and scenes. Nothing else changes. The map is derived: the master never edits it.

## Steps

1. Read `campaign.yaml` with the Read tool. Keep `language.main` (LANGUAGE), and the `folder` of the entry of type `plot` (PLOT_FOLDER). The file name is `Plot map.md` when LANGUAGE is `en`, and `Mappa della trama.md` when it is `it`. Keep PLOT_PATH: PLOT_FOLDER, then `/`, then the file name.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" plot-flowchart .`. Read its `exit:` line. If it is 0, go to Completion.
3. Read the date: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/today.mjs"`. Its first line is today's date (DATE).
4. Check whether PLOT_PATH exists with Glob. If it exists, EXISTING is PLOT_PATH; otherwise EXISTING is `none`.
5. Launch ONE `yllir:plot-mapper` through the Agent tool with exactly these keys:

   ```text
   CAMPAIGN_ROOT: <absolute path of the campaign folder>
   PLOT_FOLDER: <PLOT_FOLDER>
   EXISTING: <EXISTING>
   TARGET: .campaign/drafts/<PLOT_PATH>
   LANGUAGE: <LANGUAGE>
   DATE: <DATE>
   ```

6. Save the draft through the write cycle, as one batch of one file:
   a. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" check . --files "<PLOT_PATH>"`. If it exits 1, go to step 8.
   b. If its output says `reviewRequired` is true, follow step 4 of section 7 of `${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/authoring.md`: the reviewer answers about the map, and `review` records it. A `FIX` answer means step 8.
   c. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" commit . --files "<PLOT_PATH>" --message "<one sentence in the campaign language, for example «Mappa della trama creata.»>"`. If it exits 1, go to step 8.
7. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" plot-flowchart .` again. If its exit is 0, go to Completion.
8. A failure in step 6 or step 7 is retried once. Launch the `yllir:plot-mapper` a second time with the same keys as step 5, except EXISTING, which is now PLOT_PATH. Then run step 6 and step 7 again. If they still fail, stop: the migration stays pending. Do not retry more than once.

## Completion

Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/update-campaign.mjs" . --complete plot-flowchart-v1`. Report the migration complete only when its JSON `status` is `complete`.

## Result

Your message to the master, in the campaign language, says only:
- when the map was written: one plain sentence that the plot map of the sessions is ready, and that it shows the order of the scenes;
- that the migration is still pending, when it did not pass.

Do not mention steps, scripts, drafts, reviews, agents, markers or commands.
