---
name: new-campaign
description: Core process. Creates a new Yllir campaign in an empty folder with a short interview (real structured questions, then free-text questions, then one confirmation). In complete mode, applies setup information the master gives to a campaign that already exists (game rules, shared material, world details). Always runs inside the process runner (yllir:process-runner), for the yllir entry skill.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/new-campaign/scripts/init-campaign.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/new-campaign/scripts/add-category.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/new-campaign/scripts/set-system.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" *), Read, Write, Skill
---

# New campaign

Creates the core files of a campaign in an empty folder, and applies setup information to a campaign that already exists. It asks only what the core files need. Run every command from the campaign root (the folder the master opened). Keep every value you read from the session check.

**Commands.** Run each command exactly as written in this file, as one single command: nothing before it and nothing after it, no `;`, `&&`, `|`, `2>&1`, `echo`, `cat`, `mkdir` or `cd`. Anything added makes the command refused. Every script prints its result and, as its last line, `exit: <code>`: read the exit code from that line (the `exit:` line). Read result files with the Read tool. If a command is refused, run it again exactly as written, with nothing added; if it is refused again, end this skill with `status: FAILED`, reason "permission refused".

**Asking the master.** You cannot ask the master anything yourself. To ask, you end with a QUESTION result, and the process runner passes the questions on. There are two kinds:
- **Structured question** (Round 1 of Step 3 only): the QUESTION result has one `ask:` line per question, 1 to 4 lines, written after the `next step:` line and before `message for the master:`. Format: `ask: <header> | <question> | <option 1> ; <option 2> ; <option 3>`. The header is at most 12 characters, the question ends with `?`, there are 2 to 4 options of at most 40 characters each, and everything is in the campaign language. The same questions must also be written in plain words in the `message for the master`, so that the master can answer in a sentence.
- **Free-text question** (Round 2 of Step 3, the confirmation of Step 4, and any question in Mode complete): no `ask:` line. Only the `message for the master`, with a numbered list if there is more than one thing to answer.

The answers come back in the master's next message. The earlier question is in your prompt: match each answer to its question by number or by meaning. A free-text answer (a name, a path, a premise) never has an `ask:` line.

## Mode complete

Use this mode only when the prompt contains the line `MODE: complete`. The campaign already exists, and the master gives setup information that was not applied yet. In this mode skip Steps 1 to 8 and do the steps below.

- **C0 — Check.** Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" .`. The `git` value must be `ok` and the `folder` value must be `campaign`. If either differs, stop with the lexicon sentence «Non sono riuscito a completare questa operazione. Non è stato perso nulla: possiamo riprovare.» (in the campaign language), as the failure of this process.
- **C1 — Read.** Read `campaign.yaml` with the Read tool: the keys `campaign.name`, `campaign.world`, `language.main`, and the list `structure`. Read the world document with the Read tool, at `<Folder>/<World name>.md`, where `<Folder>` is the folder named with the word for «World» in the campaign language, as in Step 4.
- **C2 — Sort and apply.** Sort the master's message into the items below. Apply only what is not already in place (check `campaign.yaml` and the world document first). Handle each item once.
  - **a. Game rules.** Run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/new-campaign/scripts/set-system.mjs" . --list` and match the game as Step 3a says. If it matches, run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/new-campaign/scripts/set-system.mjs" . --adapter <id>` with the adapter id. If the exit code is 0, say in one sentence that the game rules of that game are applied. If the game does not match, say in one sentence that the game rules of that game are not available yet, and that the campaign works anyway. If the exit code is not 0, use the failure sentence of C0.
  - **b. Shared folder.** Resolve the path as Step 4 says. If the folder name or its id is already in the `structure` list of `campaign.yaml`, say in one sentence that the folder is already connected, and do nothing. Otherwise run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/new-campaign/scripts/add-category.mjs" . --id <slug> --folder "<Folder>" --type external --source "<absolute path>"`, with `<Folder>` the last component of the path and `<slug>` its slug (as Step 5 says). If the exit code is not 0, say in one sentence that the shared material could not be connected, and continue with the other items.
  - **c. Tone.** No script changes the tone yet. Say in one sentence that the tone can be changed later, and change nothing.
  - **d. More about the world or the story.** Build the draft from the whole current text of the world document, with the master's new words added as short paragraphs under the description (the same rule as Step 6: only the master's words, no new noun, place, person, number or event). Write it to `.campaign/state/write/draft/<Folder>/<World name>.md`. Then run the write sequence of Step 7 with `INTENT="More about the world, from the master's words only."` and the version sentence of Step 7 for this mode.
  - **e. Anything else.** If the master's message contains something that cannot be done now, say so plainly in one sentence. Never ignore it silently.
  - Anything unclear in the message: ask one free-text question and stop (QUESTION result).
  - Output: the result of each item (applied, already there, or could not be applied).
- **C3 — Settings only.** Only if no document was written in C2 and at least one settings item was applied (game rules or shared folder), run `node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" save-manual . --message "<sentence>"`. The sentence is in the campaign language: it → `Impostazioni della campagna aggiornate`; en → `Campaign settings updated`; any other language → the translation of the English one. If the exit code is not 0, use the failure sentence of C0 and stop.
- **C4 — Close.** Your closing text is the `message for the master`: one or two plain sentences that say exactly what was applied and what could not be. Use plain text: no paths, no codes, no backticks, no status names. Status DONE. Do not add anything after this text.

## Steps

**Step 1 — Preconditions.** This process runs inside the process runner (the instructions of this sub-agent are in `${CLAUDE_PLUGIN_ROOT}/agents/process-runner.md`; if your tool has no named agents, start a sub-agent, tell it to read that file first and follow it exactly), which has no session check in its context. In Codex, always set the model of this sub-agent to GPT-6 Luna in the launch call itself: an omitted model silently becomes the model of the main agent, which is a defect. If the prompt contains `MODE: complete`, do not use this step: go to Mode complete. Otherwise, read the folder state yourself: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" .` and read its `folder` and `git` values. They must say `git: ok` and `folder: empty` or `folder: unfinished`. If either value differs, stop and say the fixed sentence of the lexicon «could not finish an operation», as the failure of this process.
- The prompt may contain `RESUME: yes`; ignore the line, rely on the `folder` value.
- If `folder: empty`: continue with Step 2.
- If `folder: unfinished` (resume): do NOT run `init-campaign.mjs` again. Read `campaign.yaml` with the Read tool to get the campaign name, language, register, world name and description (keys: `campaign.name`, `campaign.world`, `campaign.description`, `language.main`, `prose.register`). The folder is the one named with the word for «World» in that language, as in Step 4; its slug is as in Step 5. Read `campaign.yaml` for an entry of the `structure` list for that folder; if there is none, run `add-category.mjs` with the same arguments as in Step 5. Then continue at Step 6 and Step 7. Skip Steps 2, 3, 3a and 4: the master already gave the answers. In Step 6, the description in `campaign.yaml` is the master's words.
- Output: the values confirmed, and whether this is a new campaign or a resume.

**Step 2 — Welcome.** Write the welcome in the campaign language: the language the master writes in, until the language answer says otherwise. Use two sentences: a few questions follow, and then the campaign is ready to start. The welcome goes in the message of the first QUESTION result of this process (the Round 1 result, or the Round 2 result, or the confirmation if no other question is needed).
- Output: the welcome sentences, sent with the first question.

**Step 3a — Game rules available.** Run this before Round 1 of Step 3:
`node "${CLAUDE_PLUGIN_ROOT}/skills/core/new-campaign/scripts/set-system.mjs" . --list`
It prints JSON like `{"adapters":[{"id":"dnd-2024","name":"D&D 2024"}]}`. Read the `exit:` line: if it is not 0, use an empty list and go on. Keep each `id` and each `name` of the `adapters` list.

Matching a game to an adapter (used in Steps 4, 5 and Mode complete): compare the master's game with the adapter names by meaning.
- Correct: «D&D 5e 2024», «DnD 2024» and «dnd» match the adapter `dnd-2024`, name «D&D 2024».
- Wrong: D&D with an older edition, for example «D&D 5e» without 2024, or «D&D 3.5», is NOT a match. Nor is any other game with no adapter in the list.
- If the master names a game with a match: the adapter `id` is used in Step 5 as `--adapter <id>`.
- If the master names a game with no match: no `--adapter` flag. Tell the master in one sentence that the game rules of that game are not available yet, and that the campaign works anyway.
- Output: the list of ids and names (possibly empty), and, once the game is known, the matched id or none.

**Step 3 — Interview.** The numbers used below: Round 1 items are 1 language, 2 game, 3 tone, 4 shared material; Round 2 items are 1 campaign name, 2 premise, 3 folder path. Use these names in the rest of this file.

*Round 1 (structured).* Ask the four questions below in ONE QUESTION result with four `ask:` lines (see «Asking the master»). Skip any question whose answer the master's message already gave. If all four are given, there is no Round 1 result.
1. **Language** (`ask` header `Lingua` in Italian, `Language` in English). Skip if the master's message already names the language to write in. Options: the language the master writes in, with its name in that language (for example «Italiano»), and one other common language (for example «English»). The master can type another language in the reply.
2. **Game** (header `Gioco` / `Game`). Options: the adapter names from Step 3a, at most three of them, then «Il mio sistema / altro» (in English «My own system / other»). If there are no adapter names, the options are «Nessun gioco» (in English «No game») and «Il mio sistema / altro». Skip if the message already names a game, or says there is none.
3. **Tone** (header `Tono` / `Tone`). Options: «Evocativo», «Semplice», «Colloquiale» (in English «Evocative», «Plain», «Colloquial»). Skip if the message already gives a tone.
4. **Shared world material** (header `Materiale` / `Material`). Options: «No, solo questa campagna» (in English «No, only this campaign») and «Sì, una cartella di un altro mondo» (in English «Yes, a folder from another world»). Skip if the message already says whether there is shared material.

The `message for the master` of Round 1 says the same four questions in plain words, numbered, in the campaign language, and says the master can answer with a number or in their own words.

*Round 2 (free text).* Ask ONE free-text question, with no `ask:` line, numbered, only for what is still missing:
1. The name of the campaign (if missing).
2. In two or three sentences: the world and the story (if no premise was given).
3. The path of the folder of the shared material, if the answer to question 4 of Round 1 was yes and no path is known yet. Say that the path must be the full path of the folder.
If nothing is missing, there is no Round 2. Never ask the same thing twice.

*Defaults for a missing answer.* Name every default you use in the Step 4 summary.
- language: the language the master writes in;
- game: none;
- tone: plain (`plain`);
- world name: the campaign name, or, if the premise names a proper name (for example «Varn»), that name (see the rule below the extras);
- shared material: none.
- campaign name: it has no default in the question. If it is still missing after Round 2, use the world name, or if there is none, «Campagna» (Italian) or «Campaign» (English), and name it in the summary.
- premise: if it is still missing after Round 2, write the draft of Step 6 with the one line «La descrizione sarà scritta più avanti.» (Italian) or «The description will be written later.» (English), and name it in the summary.

*Map the tone to the value of `--register`:*
- evocative, evocativo, aulico → `elevated`;
- plain, semplice, asciutto or sobrio → `plain`;
- colloquial, colloquiale → `colloquial`;
- mixed → `mixed`.

*Extras.* Everything the master says beyond the answers above is an extra. Keep the extras in your Output, in two groups:
- settings extras: a game detail, a shared folder, a tone. They are applied in Step 5 (and Step 4 for the shared folder);
- world extras: more about the world or the story, factions, names, places. They are added to the draft in Step 6.

World name: use the proper name in the premise (Round 2, item 2) if there is one, for example «Varn». Otherwise use the campaign name.

Output: the answers, with the defaults used, the tone mapped to `--register`, the matched game id or none, the shared folder path (as given) or none, and the extras in the two groups.

**Step 4 — Summary and one confirmation.** First, resolve the shared folder path, if the master named one:
- It must be absolute: it starts with `/`. If it is relative (for example `Mondi/Varn`), join it to the parent folder of the campaign root, and say in the summary what you assumed.
- If it starts with `~`, you need the full path of the home folder. If you do not know it, ask one free-text question with the rules of «Asking the master» and stop.
- Its folder name is the last component of the path (for `/Users/x/Mondi/Varn` the folder is `Varn`).

Then show in plain words what will be created, in the campaign language:
- the settings of the campaign: name, language, tone in plain words;
- the game: if matched, one sentence that the game rules of that game are applied; if named with no match, one sentence that the game rules of that game are not available yet, and that the campaign works anyway; if none, nothing;
- the shared material, if there is one: its folder name only, never the path;
- the defaults used, and the extras that will go into the world description;
- the file of «Your rules», empty;
- the first document: the description of the world, in a folder named with the word for «World» in the campaign language (Italian `Mondo`, English `World`, other languages: the translation of «World»).

Nothing else. Ask the master for one confirmation (free text). If the master's message already contained a clear confirmation, go on to Step 5 without asking again. The welcome of Step 2 goes in this message if it was not sent yet.
- Output: the confirmation given, the resolved path and its folder name (if any), and the adapter id or none.

**Step 5 — Create the core files.** Run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/core/new-campaign/scripts/init-campaign.mjs" . --name "<campaign name>" --language <language code> --register <elevated|plain|colloquial|mixed> --world "<world name>" --description "<the premise (Round 2, item 2) condensed to one sentence>"`
- Add ` --adapter <id>` at the end, as one more flag, only when the game matched in Step 3a. If there is no matched game, the command has no `--adapter` flag at all.
- Language code: lowercase ISO 639-1, for example `it` or `en`.
- If the exit code is not 0: say the fixed sentence of the lexicon «could not finish an operation», and stop.
- If it succeeds: run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/new-campaign/scripts/add-category.mjs" . --id <slug of the folder name> --folder "<Folder>" --type places`.
- If the exit code is not 0: say the fixed sentence of the lexicon «could not finish an operation», and stop.
- Slug: lowercase, ASCII letters and digits, words joined by hyphens. For `Mondo`, the slug is `mondo`.
- If the master named a shared folder, run next: `node "${CLAUDE_PLUGIN_ROOT}/skills/core/new-campaign/scripts/add-category.mjs" . --id <slug> --folder "<Folder>" --type external --source "<absolute path>"`. The `<Folder>` is the folder name of the shared material (its last path component, or the translation of «Shared world» if that is unclear), and `<slug>` is its slug (as above). Example: the path `/Users/x/Mondi/Varn` gives `--id varn --folder "Varn"`.
- If this command's exit code is not 0: say in one sentence, in the campaign language, that the shared material could not be connected, that the creation continues without it, and that the master can try again with a message later. Then continue with Step 6. Do not stop.
- Output: the JSON of each command that ran, read and kept, and whether the shared material was connected.

**Step 6 — Draft the world document.** You write this draft yourself. The spec assigns the first draft of the world document to the main assistant. Its path in the campaign is `<Folder>/<World name>.md`. Write the draft to `.campaign/state/write/draft/<Folder>/<World name>.md` in exactly this form:

```markdown
---
id: <slug of the world name>
---

# <World name>

## <the word "Description" in the campaign language, for example Descrizione>

_<one or two sentences: the premise as narration, in the chosen tone>_

<one short paragraph restating the premise plainly>

<one short paragraph for each world extra, in the order the master gave them>
```

Build the two text lines (the italic line and the plain paragraph) from the master's own words in the premise (Round 2, item 2). Build each extra paragraph from the master's words in the world extras. You may only change word order, grammar and punctuation, and split or join sentences. Do not add any noun, adjective, place, person, number or event that is not in the master's words.
- Correct: master says «Varn is a city of bridges where the river sings» → `_Varn is a city of bridges, and the river sings._`
- Wrong: `_Varn rises over a dark sea, its bridges full of merchants._` (sea and merchants are new).
- Output: the draft file exists at the path above.

**Step 7 — Write sequence.** Invoke the skill `yllir:write-sequence` (if your tool has no way to invoke a skill, read `${CLAUDE_PLUGIN_ROOT}/skills/core/write-sequence/SKILL.md` with the Read tool or `cat`, and follow it exactly as if it had been invoked, with the same inputs) with these inputs. This step is used by Step 7 of the new campaign and by C2 item d of Mode complete; the values differ as shown.
- `DOCUMENTS=<Folder>/<World name>.md`
- `INTENT`: in the new campaign, `INTENT="First document of a new campaign: the world description, using only the master's premise."`; in Mode complete, `INTENT="More about the world, from the master's words only."`
- `NEW_SUBJECTS`: in the new campaign, `NEW_SUBJECTS=<world id>`; in Mode complete, `NEW_SUBJECTS` empty
- `VERSION_MESSAGE`: the sentence below, in the campaign language
- `ROUND=1`
- `CONTINUE_WITH`: in the new campaign, `CONTINUE_WITH="new-campaign step 7: read the WRITE REPORT status and act on it"`; in Mode complete, `CONTINUE_WITH="new-campaign mode complete C2: read the WRITE REPORT status and act on it"`

The version sentence is read by the master later, so write it in the campaign language; never in English unless the campaign language is English. Use these exact values:
- New campaign:
  - `it` → `Creata la campagna «<name>»`
  - `en` → `Created the campaign «<name>»`
  - any other language → the translation of `Created the campaign «<name>»` into that language.
- Mode complete:
  - `it` → `Aggiunte informazioni sul mondo`
  - `en` → `Added information about the world`
  - any other language → the translation of `Added information about the world` into that language.

`write-sequence` writes `CONTINUE_WITH` as the last line of its report file and then resumes this step.

After invoking `yllir:write-sequence`, read `.campaign/state/write/report.txt` (Read tool) and act on its `status:` line.

The report in `.campaign/state/write/report.txt` is for you, never for the master. Do not show it, quote it or name its status to the master.

Loop, starting with `ROUND=1`:
1. Read `.campaign/state/write/report.txt` and its `status:` line.
2. If `status` is `FIX_NEEDED` or `VERIFY_FAILED`: rewrite the draft file at the same path `.campaign/state/write/draft/<Folder>/<World name>.md`, removing or fixing exactly each problem listed in `details`. Use only the master's words, as Step 6 requires. Then invoke `yllir:write-sequence` again with the same inputs and `ROUND` plus one. Repeat this loop up to `ROUND` 3.
3. If `status` is `DONE`: in the new campaign, go to Step 8. In Mode complete, go to C4 (C3 is not needed, because the write sequence already saved the version).
4. If `status` is `CONFLICT` or `ASK`: ask the master the question from the report in plain words, as a free-text question (no `ask:` line), and stop.
5. If `status` is `FAILED`: go to the failure sentence below, and stop.

After a failed `ROUND` 3 (still `FIX_NEEDED` or `VERIFY_FAILED`), or after `FAILED`, use the failure sentence of this step, in the campaign language, and stop. Do not mention rounds, statuses or problems.
- New campaign: the lexicon sentence «il primo documento non è stato completato, ma le impostazioni sono pronte» («The first document could not be completed, but the settings are ready»).
- Mode complete: the lexicon sentence «Non sono riuscito a completare questa operazione. Non è stato perso nulla: possiamo riprovare.»

Output: `status: DONE`.

**Step 8 — Close.** Only after `status: DONE`, in the new campaign. Your closing text is the `message for the master` of the runner's result, so write it as that message, in the campaign language, in plain text. It contains:
- one sentence that the campaign is ready and saved. Never show version codes, file paths, backticks or formatting marks like `code`; say only that the campaign is saved;
- one sentence for each shared folder that could not be connected in Step 5, saying that the master can try again with a message later;
- two or three example sentences the master can say next, for example «describe the first place», «let's prepare the first session», «I have notes to bring in»;
- one sentence that some of these will become available step by step.

Offer, without insisting, a short practice session in the future. Do not add anything after this text: the process runner returns it to the entry skill.

## Examples

Correct: the master answers all the questions in one message, for example «Campagna Varn, italiano, tono semplice, D&D 2024, nessun materiale condiviso. Varn è una città di ponti dove il fiume canta. Sì, va bene». Nothing is missing, so there is no Round 1 and no Round 2 question. The message is the confirmation, so skip the confirmation of Step 4 and go to Step 5. Then create the files, write the draft, run the write sequence, and close with the example sentences.

Correct: the Round 1 result of a master who writes in Italian and says nothing else (the language, game, tone and shared material are still open). The question of Round 1 is structured, so the QUESTION result has four `ask:` lines, and the message says the same questions in plain words:

```text
RUNNER RESULT
status: QUESTION
question: Ask the master the four setup questions, with structured answers.
next step: Read the answers, ask the free-text questions still missing in Round 2, then show the summary.
ask: Lingua | In che lingua scriviamo la campagna? | Italiano ; English
ask: Gioco | Quale gioco di ruolo usi? | D&D 2024 ; Il mio sistema / altro
ask: Tono | Che tono vuoi per le descrizioni? | Evocativo ; Semplice ; Colloquiale
ask: Materiale | Usi materiale di un altro mondo? | No, solo questa campagna ; Sì, una cartella di un altro mondo
message for the master:
Tra poco creiamo la tua campagna. Ti faccio quattro domande; puoi rispondere con un numero o con le tue parole.
1. In che lingua scriviamo la campagna?
2. Quale gioco di ruolo usi, o il tuo sistema?
3. Che tono vuoi per le descrizioni: evocativo, semplice o colloquiale?
4. Usi materiale di un altro mondo, per esempio una cartella di un'altra campagna?
```

Wrong: the same question written only as text, with no `ask:` lines:

```text
message for the master:
Ti faccio quattro domande:
1. In che lingua scriviamo la campagna?
2. Quale gioco di ruolo usi?
3. Che tono vuoi per le descrizioni?
4. Usi materiale di un altro mondo?
```

Without the `ask:` lines, the entry skill cannot ask the master with the question tool, so the master gets only a text list. Round 1 needs the `ask:` lines.

Correct: the master says «uso D&D 2024 e il mondo condiviso è in /Users/x/Mondi/Varn», and writes in Italian, with no tone and no name yet. The game matches the adapter `dnd-2024`, so the Round 1 question about the game is skipped and the command gets `--adapter dnd-2024`. The path is absolute, so the shared-material question is skipped too: the folder name is `Varn`, the slug is `varn`. Round 1 has two `ask:` lines (language and tone). Round 2 asks the campaign name and the world and story. The Step 4 summary says that the game rules of D&D 2024 are applied, and lists «Varn» as shared material. Step 5 runs init-campaign with `--adapter dnd-2024`, then the world category, then add-category with `--type external --source "/Users/x/Mondi/Varn"`.

Wrong: the master says «uso D&D 2024 e il mondo condiviso è in /Users/x/Mondi/Varn», and the skill asks the game and the shared material again, creates the campaign with no adapter and no source, and says nothing about the game or the folder. The extras were dropped: the master's settings must be applied in Step 5 and shown in Step 4.

Wrong: asking about categories, players, images or pricing before creating the campaign. The interview has only the questions of Step 3.
