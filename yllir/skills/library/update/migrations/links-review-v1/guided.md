# Links after the update (links-review-v1)

Guided part of the migration `links-review-v1`. Follow the rules in `${CLAUDE_PLUGIN_ROOT}/skills/library/update/post-update.md` (questions, result). Run the commands of this file exactly as written, from the campaign root, with `${CLAUDE_PLUGIN_ROOT}` for the plugin root.

The campaign language is `language.main` in `campaign.yaml`. Use it for every message to the master, and the words of the lexicon.

This pass only adds links. A mention of a person, a place or an object that has its own sheet gets a link. Nothing else in a document changes. Links are written only by the engine command below, never by hand.

## Steps

1. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/links-review.mjs" . --prepare`. If its `status` is `complete`, go to Completion. If its `status` is `failed`, stop and leave the migration pending. Otherwise go on with step 2 for each chunk of the `chunks` list whose `status` is `pending`, in the order of the list.
2. For each pending chunk, in order:
   a. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" links . --files "<the files of the chunk, comma-separated>"`. Read its `count`. If `count` is 0, go to e. If the command exits with a code other than 0, stop and leave the migration pending.
   b. Launch ONE `yllir:link-reviewer` through the Agent tool with exactly these keys:

      ```text
      CAMPAIGN_ROOT: <absolute path of the campaign folder>
      PLAN_FILE: .campaign/state/link-review.json
      ```

   c. Read the plan file `.campaign/state/link-review.json` with the Read tool. Note the `file` of each `pid` in its `proposals` list: a clean apply removes this file, so you need these notes after step d. Then save the reviewer's answer, exactly as returned, with the Write tool to `.campaign/state/link-outcomes.json`. It must be a JSON array with exactly one entry for every `pid` of the plan, each with an `id` and an `outcome` of `APPLY`, `OMIT` or `ASK`. If it is not, launch the reviewer once more with the same keys and save again. If the second answer is not valid either, leave this chunk pending and stop.
   d. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" links . --apply .campaign/state/link-outcomes.json --message "<one sentence in the campaign language, for example «Collegamenti aggiunti ai documenti.»>"`. Read the output:
      - If `missing_outcome` or `rejected` is not empty, fix `.campaign/state/link-outcomes.json` with the Write tool and run this command again. At most 2 rounds in total. If it still fails, leave this chunk pending and stop.
      - Otherwise note the length of `applied` (the links added in this chunk). Note the `file` of each applied `pid` from your notes of step c: these are the documents changed. Add every entry of `ask` to your notes, with its `pid`, `file`, `line`, `text` and `sheet`.
   e. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/links-review.mjs" . --done <chunkId>`, with the id of the chunk in place of `<chunkId>`. If its `status` is `complete`, the pass is done.

## Questions

After all the chunks are done, if your notes hold any `ask` entry, prepare at most three questions for the master. Group the related entries into one question. For each question, read the line `line` of `file` with the Read tool, and say in plain words the sentence and what the link would mean. Put the questions in the result message (see Result). Never block the migration on them: the migration completes anyway.

If the master's next message answers yes to one of the questions, apply that link right away, without a new migration step:

i. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" links . --files "<the file of the question>" --out .campaign/state/link-review-ask.json`. Read `.campaign/state/link-review-ask.json` with the Read tool, and find in its `proposals` the one with the same `file`, `text` and `subject` as the question (with the same `line` when there are several).
ii. Write `.campaign/state/link-outcomes.json` with the Write tool, as a JSON array with one entry: `[{"id": "<the pid found in i>", "outcome": "APPLY", "reason": "The master confirmed this link."}]`.
iii. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" links . --apply .campaign/state/link-outcomes.json --plan .campaign/state/link-review-ask.json --message "<one sentence in the campaign language>"`. Check that `applied` contains the pid. Entries in `missing_outcome` are expected here, because only one mention is decided: they are not an error.

On a no, or no answer, do nothing.

## Completion

When every chunk of the pass is done, run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/update-campaign.mjs" . --complete links-review-v1`. Report the migration complete only when its JSON `status` is `complete`.

## Result

Your message to the master, in the campaign language, says only:
- how many links were added, and in how many documents: count the `applied` entries of all the chunks, and the distinct documents of those entries. If no link was added, say so;
- that only links were added: nothing else in the documents changed;
- the questions of the Questions section, at most three, in plain words;
- that the migration is still pending when a chunk did not pass.

Do not mention steps, scripts, drafts, reviews, chunks, sub-agents, plans, outcomes or markers.
