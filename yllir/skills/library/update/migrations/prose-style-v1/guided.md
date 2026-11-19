# Names and spoken text after the update (prose-style-v1)

Guided part of the migration `prose-style-v1`. Follow the rules in `${CLAUDE_PLUGIN_ROOT}/skills/library/update/post-update.md` (questions, result). Run the commands of this file exactly as written, from the campaign root, with `${CLAUDE_PLUGIN_ROOT}` for the plugin root.

The campaign language is `language.main` in `campaign.yaml`. Use it for every message to the master, for the commit message, and for the words of the lexicon.

This pass changes only the documents that the assistant wrote (provenance `generated`), and only three things in them: the abbreviated names of subjects that have their own sheet, the read-aloud paragraphs, the spoken lines of the characters and the texts handed to the players. Nothing else in a document changes. Documents written by the master or by the played evenings are never touched.

## Steps

1. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/prose-style.mjs" . --prepare`. If its `status` is `complete`, go to Completion. If its `status` is `failed`, stop and leave the migration pending. Otherwise go on with step 2 for each chunk of the `chunks` list whose `status` is `pending`, in the order of the list.
2. For each pending chunk, in order, for each file of its `files` list:
   a. Read the file with the Read tool. Read its entry in the chunk's `items` too: `shortNames` (each with `line`, `text`, `word` and `subjects`) and `spoken` (the line numbers).
   b. Write a draft of the whole file, with the Write tool, to `.campaign/drafts/<the file>`, with the same text as the file except these changes:
      - every `shortNames` entry whose `word` is outside a character's spoken words is replaced by the full title of its subject, in that line only. When `subjects` has more than one entry, pick the subject that the surrounding text and the sheet's relations make certain. When no subject is certain, leave the word as it is and note the entry for a question;
      - every line listed in `spoken` is reread against section 1.12 of `${CLAUDE_PLUGIN_ROOT}/templates/content-format.md`: when it uses a rhetorical tic (the patterns of section 1.12), rewrite the line so that it says the same facts directly, with concrete subjects and verbs. A line with no tic stays as it is. Read-aloud paragraphs and spoken lines are the only lines that change this way;
      - the texts handed to the players (a letter, a notice, a book the characters find) are reread the same way, when the file holds one, even if its lines are not in `spoken`.
   c. Change nothing else: no new fact, no other line, the metadata block and the master block identical, headings identical, links identical.
   d. A file with nothing to change gets no draft. Keep a note of the files that have a draft.
3. If no file of the chunk has a draft, go to step 4. Otherwise run the write cycle of `${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/authoring.md` section 7, steps 3 to 6, on the drafts of the chunk, with the campaign-relative paths of the files that have a draft:
   a. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" check . --files "<the files with a draft, comma-separated>"`. If it exits 1, read its `errors`, fix the drafts with the Edit or Write tool, and run `check` again. At most 3 rounds. If it still fails, leave the chunk pending and stop.
   b. Read `finalFiles` and `reviewRequired` in the output. If `reviewRequired` is true, launch ONE `yllir:batch-reviewer` through the Agent tool with exactly these keys, and record its outcome as section 7 step 4 says. On `FIX`, fix the drafts and run `check` and the review again, at most 3 rounds, then leave the chunk pending and stop if it still fails. On `APPLY`, go on.
   c. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" commit . --files "<the same files as check>" --message "Nomi completati e testo letto ai giocatori ripulito."`, with the message in the campaign language, as section 7 step 5 says. If `commit` exits 1, nothing was written: fix, check and commit again, at most 2 rounds. If it still fails, leave the chunk pending and stop.
   d. Run the link review of section 7 step 6, in full (its a to e), on `finalFiles` of the last `check`. Its links come from the framework's own engine: this step does not second-guess the names.
   e. Add every `ask` entry of the link review and every note of step 2b that has no certain subject to your notes of questions.
4. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/prose-style.mjs" . --done <chunkId>`, with the id of the chunk in place of `<chunkId>`. Read its `status`. When it is `complete`, the pass is done.

## Questions

After all the chunks are done, if your notes hold any entry without a certain subject, prepare at most three questions for the master. Group the entries of the same word into one question. For each question, read the line of the file with the Read tool, and say in plain words the sentence, the short name and the two or more subjects it could mean. Put the questions in the result message (see Result). Never block the migration on them: the migration completes anyway.

If the master's next message answers yes to one of the questions, edit that one line through the same write cycle: write a draft of the file with only that line changed to the full title, run `check`, `commit` with the message «Nome completato.» in the campaign language (or its equivalent), and the link review on its `finalFiles`. On a no, or no answer, do nothing.

## Completion

When every chunk of the pass is done, run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/update-campaign.mjs" . --complete prose-style-v1`. Report the migration complete only when its JSON `status` is `complete`.

## Result

Your message to the master, in the campaign language, says only:

- how many documents were changed: count the distinct files that were committed in all the chunks. If none was changed, say so;
- that only documents written by the assistant were changed, and that in them only the names of subjects and the read-aloud, spoken and player parts changed; nothing else;
- the questions of the Questions section, at most three, in plain words;
- that the migration is still pending when a chunk did not pass.

Do not mention steps, scripts, drafts, chunks, reviews, sub-agents, plans, outcomes, markers or the state of the migration.
