---
name: import
description: Core process. Brings existing material (photos, scans, PDFs, notes, documents) into the campaign: keeps the originals as sources, checks them through the document ingest skill, and integrates what the master can confirm. Asks one question at a time when a reading is in doubt, and resumes when the master answers. Runs inside the process runner.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/new-campaign/scripts/add-category.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/after-session/scripts/today.mjs" *), Read, Write, Edit, Skill
---

# Import

Brings existing material into the campaign. Run every command from the campaign root (the folder that contains `campaign.yaml`). Keep every value you read from a script, and never guess one.

**Commands.** Run each command exactly as written in this file, as one single command: nothing before it and nothing after it, no `;`, `&&`, `|`, `2>&1`, `echo`, `cat`, `mkdir` or `cd`. Anything added makes the command refused. Every script prints its result and, as its last line, `exit: <code>`: read the exit code from that line (the `exit:` line). Read result files with the Read tool. If a command is refused, run it again exactly as written, with nothing added; if it is refused again, end this skill with `status: FAILED`, reason "permission refused".

**Scope of this version.** This process:
- writes only through `yllir:document-ingest` and `add-category`, and, on a resume (Step 2 only), the answer lines of the cards in the sources folder;
- never edits a canon document itself (characters, places, objects, plot, chronicle): the documents are changed only by the ingest skill and its write sequence;
- never decides which of two sources is right. A conflict with the canon waits for the master;
- never asks for the provenance: it is taken from what the master said, or it is `unknown`.

**Questions to the master.** Ask the master in plain words, then stop. Write the question as your message; the process runner turns it into a QUESTION result. Every question ends with a question mark: a statement is not a question. Ask ONE question per message.

**Inputs.** MASTER_MESSAGE is the master's message, as given by the process runner. HANDOFF is the topic handoff content, when the runner gives one (it may be absent). IMAGINATION is `yes` or `no`, given by the process runner; absent or any other value means `no`.

**IMAGINATION.** It never changes the transcription or the claims: they are always faithful to the source, with no invention, whatever IMAGINATION says. It only governs the character sheets made for characters that are created during the import (see Step 6). With `no`, nothing changes.

**Convention for the handoff.** When this process waits for an answer, the runner records the `## Next step` of the topic as exactly:
`answer pending for ingest <id1>,<id2>: <question>`
Here the ids are the ids of the cards that hold the open question (normally one), and `<question>` is written in English and starts with the question id and the locator, for example `Q001 at p1:l2: The name reads "Corvin"; is it Corvin?`. Write this line in your notes for the runner exactly like this.

## Steps

**Step 1 — Settings.** Read `campaign.yaml` with the Read tool. Keep:
- `language.main`: the CAMPAIGN LANGUAGE (for example `it` or `en`);
- the `folder` of the entry of type `sources` in `structure`: SOURCES. If there is no such entry, SOURCES does not exist yet (this is not an error).
- Output: CAMPAIGN LANGUAGE, and SOURCES or "does not exist", kept.

**Step 2 — Resume check.** Look at the HANDOFF. Only if its `## Next step` line starts with `answer pending for ingest `, this is a resume. Otherwise go to Step 3.
- Read the ids (before the colon, comma-separated) and the question (after `: `). Keep them.
- The MASTER_MESSAGE is the answer. Decide if it answers the question clearly: it says yes, no, or gives the reading in words. A silent message, a message about something else, or a message with new files is NOT an answer.
- If it is not an answer: write the same question again in the CAMPAIGN LANGUAGE, in other words, ending with «?», with no other sentence before it. Then stop. Your notes for the runner keep the same `question:` and `next step:` as before.
- If it is an answer, for each id of the ids, in turn:
  1. Read `<SOURCES>/<id>/card.md` with the Read tool.
  2. In `## Open questions`, find the line whose question id and locator are the ones named in the question (for example `Q001` and `p1:l2`). Its status is `open`.
  3. Edit that line with the Edit tool: its second field (the status) becomes `answered`, and the answer is written in the last field, after the last ` | `, in the master's own words.
  4. In `## Review`, add a line `- R<nnn> | <Qid> | <locator> | confirmed` with the next free number (`R001` if there are none; otherwise the highest number plus one, three digits).
  5. If the answer changes the reading of the text (the master gives a different word than the transcription): edit the transcription line at that locator in `<SOURCES>/<id>/transcription.md` to the master's reading; edit the claim lines at that locator in the card to the same words; and change the review line you just added to result `changed`.
  6. In `## Claims`, every claim line at that locator whose status is `open` becomes `verified` (Edit tool: replace `| open |` with `| verified |` on that line only).
- Then go to Step 5 for the date only (SOURCES exists, so skip the category part), and then to Step 6 with FILES empty, PROVENANCE `unknown`, and RESUME_IDS = the ids.
- Output: the ids and the question, kept, and the cards updated.

**Step 3 — Files.** Find in MASTER_MESSAGE the paths of files or folders the master shared: an absolute path, or a path preceded by `@` (remove the `@`). Check each path with the Read tool. For a folder, Read on the folder lists it. Read is used only to check that the path exists: do not read the content now, the ingest skill does that.
- If no path exists, or there are none: ask the master ONE question, in plain words, and stop. In the CAMPAIGN LANGUAGE, the question is:
  - Italian: «Quali file vuoi portare nella campagna? Trascinali qui nella conversazione o dimmi la cartella.»
  - English: «Which files do you want to bring into the campaign? Drag them here into the conversation or tell me the folder.»
  - Any other language: translate the English question, keeping the question mark.
- Otherwise FILES is the list of the paths that exist, comma-separated.
- Output: FILES, kept.

**Step 4 — Provenance.** PROVENANCE is what the master said about where the material comes from, in their words, short. Remove every double quote character and every line break. If the master said nothing about it, PROVENANCE is `unknown`. Never ask for it.
- Output: PROVENANCE, kept.

**Step 5 — Sources category and date.**
- Category: if SOURCES does not exist (Step 1), run this command, with the folder name for the campaign language: `Fonti` for `it`, `Sources` for `en`, otherwise the translation of «Sources»:
  `node "${CLAUDE_PLUGIN_ROOT}/skills/core/new-campaign/scripts/add-category.mjs" . --id sources --folder "<folder name>" --type sources`
  - If the exit code is not 0: say the fixed sentence of the lexicon «could not complete this operation» (the first row of the failure table), in the CAMPAIGN LANGUAGE, and stop.
  - If it succeeds: SOURCES is the folder name you gave. No other command is run after it: the result is only checked for its exit code.
- Date: run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/after-session/scripts/today.mjs"`. Its first line is today's date, `YYYY-MM-DD`: that is DATE. If the exit code is not 0: say the same fixed sentence, and stop.
- Output: SOURCES, DATE, kept.

**Step 6 — Ingest.** Invoke the skill `yllir:document-ingest` (if your tool has no way to invoke a skill, read `${CLAUDE_PLUGIN_ROOT}/skills/library/document-ingest/SKILL.md` with the Read tool and follow it exactly, as if it had been invoked) with these inputs:
- `FILES=<FILES>` (empty on a resume);
- `PROVENANCE=<PROVENANCE>`;
- `DATE=<DATE>`;
- `RESUME_IDS=<the ids>` (only on a resume; leave the input out otherwise);
- `IMAGINATION=<yes or no>`: the value of IMAGINATION. The ingest skill passes it on to every `yllir:npc-manager` and `yllir:complete-sheet` call that it makes for a character created during the import. When it is `yes`, each of those calls also gets `PROPOSE=yes`, and the INTENT of its write sequence ends with the sentence below. When it is `no`, the calls get `IMAGINATION=no` and nothing else changes;
- when IMAGINATION is `yes`, the INTENT that the ingest skill gives to its write sequence ends with this exact sentence, after a space: `The master allowed invented details: new names, places, history, relations and rules that no source gives are allowed; contradictions with the canon are not.`
- `CONTINUE_WITH="import step 7"`.

This step hands the drafts of new sheets and plot events to the ingest skill, so these rules are passed on to it: draft paths of new sheets are provisional, because the write sequence moves each sheet to its canonical category-first geographic path, decided only from explicit `location` and scene `appearances`; after it finishes, use the paths in the `documents:` line of `.campaign/state/write/report.txt` for any further read or check. When an imported plot event explicitly establishes that a subject is present at a place, record it as `appearances: [{subject: ID, location: [PLACE_IDS]}]`; never infer presence from `characters`, `items`, names, links or mentions.

With IMAGINATION `yes`, the invention allowed by this sentence fills only what the sources leave out of a character sheet (its looks, manner, history). It never fills a line of a source that cannot be read, and it never changes a claim taken from a source.

When it has finished, read `.campaign/state/ingest/report.txt` with the Read tool. The report is for you, never for the master: do not show it, quote it or name its status to the master.
- Output: the report, read and kept. If the file does not exist: go to Step 7 with the status FAILED.

**Step 7 — Message.** Read the report (from Step 6). Its `status:` line decides. Keep these values from the report:
- `sources:` line: the number before the bracket (the count of documents copied and saved; it can be 0);
- `linked:` line: N, the number before the bracket, and M, the number in the brackets (`linked: N (external M)`). If there is no `linked:` line, N and M are 0;
- `claims:` line: the number after `integrated` in the brackets (the count of claims that went into the cards);
- `duplicates skipped:` line: the number.
- `open questions for the master:` section: its lines, in order.

Linked documents are the documents that were already complete and were linked directly, without copying them. When N is more than 0, these sentences are used in both statuses, in the place described for each status:
- one sentence: how many documents were linked directly in the campaign, without copying them, because they were already complete (N);
- if M is more than 0: one more sentence: M of them are outside the campaign folder, so the version history does not keep a copy of their content.
Use the singular or the plural correctly. Never show paths.

**If status is `DONE`:** write ONE message in the CAMPAIGN LANGUAGE, in plain words:
- if `sources` is more than 0: one sentence: how many documents were brought in (the `sources` count), and that they are saved with their originals;
- if `sources` is 0: no document was copied, so write no sentence about documents brought in and no sentence about claims;
- if N is more than 0: the linked sentences above;
- if `sources` is more than 0: one sentence: how many claims went into the cards (the `integrated` count);
- if `duplicates skipped` is not 0: one sentence saying that some of the documents were already in the campaign, so they were not added again;
- if none of the sentences above applies: one sentence saying that there was no new document to bring in;
- end the message there. No question.

**If status is `NEEDS_ATTENTION`:** write ONE message in the CAMPAIGN LANGUAGE:
- one sentence: what was done. If `sources` is more than 0: the documents were saved and the rest was checked. If `sources` is 0: no document was saved; say only that the material was checked;
- if N is more than 0: the linked sentences above;
- then take the FIRST line under `open questions for the master:` and put it in plain words, as ONE question ending with «?». Name the document by its original name (read it from the `original_name` field in the front matter of its card, `<SOURCES>/<id>/card.md`), never by its id. Name the place on the page in plain words, never by the locator code: `p1:l2` becomes «the second line of the first page», `p2:l5` becomes «the fifth line of the second page». Put the answer choices in the question when there are some;
- if there are more lines under `open questions for the master:`, say in one sentence before the question that more questions will follow, one at a time;
- the question must be the last sentence of the message, and it must end with «?».

After the message (which ends with the question, or with the last sentence of a DONE message), write these two lines for the process runner only, in English. They are not part of the message and the master never sees them:
- `question: <the question in English, the same as the one you asked>`
- `next step: answer pending for ingest <ids>: <the same question in English, starting with the question id and the locator>`

Here `<ids>` is the id of the card of that first question (the first column of its line). The question id and the locator are the second and third columns of the line.

**If status is `FAILED`, or the report is missing, or any other status:** say the fixed sentence of the lexicon «could not complete this operation» (the first row of the failure table), in the CAMPAIGN LANGUAGE. Do not explain. Stop.

Never show ids, paths, locators, statuses or report lines in the message. No backticks, no file names with codes, no formatting marks.

## Examples

Correct, DONE (the master writes «ecco le foto del mio quaderno», the report says 2 documents, 14 claims integrated, 0 duplicates skipped):
«Ho portato nella campagna 2 documenti e li ho salvati con gli originali. Ho messo 14 affermazioni nelle schede della campagna. Dimmi pure cosa vuoi fare adesso.»

Correct, DONE with linked documents (the report says 0 sources, linked 2 (external 1)):
«Ho collegato direttamente nella campagna 2 documenti, senza copiarli, perché erano già completi. Uno di questi si trova fuori dalla cartella della campagna, quindi la cronologia delle versioni non ne salva il contenuto. Dimmi pure cosa vuoi fare adesso.»

Correct, NEEDS_ATTENTION (the first open question is about the name in the second line of the first page of the document «Note di Varn.jpg»):
«Ho portato nella campagna il documento «Note di Varn.jpg». Ci sono altre domande, e te le farò una alla volta. Alla seconda riga della prima pagina il nome si legge «Corvin»: è così?»

Wrong, listing ids and paths: «Ho salvato src-1a2b3c4d in Fonti/src-1a2b3c4d/card.md. La domanda Q001 su p1:l2 è ancora aperta.» It shows an id, a path, a question id and a locator. The master must only see the plain words of the message.

Wrong, asking for the provenance: «Da dove arrivano queste foto?» The provenance is never asked: it is taken from the master's words, or it is `unknown`.

Wrong (IMAGINATION `yes`, an unreadable part filled with invented text): the photo of the notes has a smudged line where the name of a place should be, and the transcription, or a claim, is written with a plausible invented name, because IMAGINATION is `yes`. This is wrong. The unreadable line stays unreadable in the transcription and goes to the master as an open question, one at a time, as Step 6 and the ingest skill say. IMAGINATION never changes what a source says.
