---
name: new-campaign
description: Core process. Creates a new Yllir campaign in an empty folder with a short interview (four questions, one confirmation). Always runs inside the process runner (yllir:process-runner), for the yllir entry skill.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/init-campaign.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/add-category.mjs" *), Read, Write, Skill
---

# New campaign

Creates the core files of a campaign in an empty folder. It asks only what the core files need. Run every command from the campaign root (the folder the master opened). Keep every value you read from the session check.

**Commands.** Run each command exactly as written in this file, as one single command: nothing before it and nothing after it, no `;`, `&&`, `|`, `2>&1`, `echo`, `cat`, `mkdir` or `cd`. Anything added makes the command refused. Every script prints its result and, as its last line, `exit: <code>`: read the exit code from that line (the `exit:` line). Read result files with the Read tool. If a command is refused, run it again exactly as written, with nothing added; if it is refused again, end this skill with `status: FAILED`, reason "permission refused".

## Steps

**Step 1 — Preconditions.** This process runs inside the process runner, which has no session check in its context. Read the folder state yourself: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" .` and read its `folder` and `git` values. They must say `git: ok` and `folder: empty` or `folder: unfinished`. If either value differs, stop and say the fixed sentence of the lexicon «could not finish an operation», as the failure of this process.
- The prompt may contain `RESUME: yes`; ignore the line, rely on the `folder` value.
- If `folder: empty`: continue with Step 2.
- If `folder: unfinished` (resume): do NOT run `init-campaign.mjs` again. Read `campaign.yaml` with the Read tool to get the campaign name, language, register, world name and description (keys: `campaign.name`, `campaign.world`, `campaign.description`, `language.main`, `prose.register`). The folder is the one named with the word for «World» in that language, as in Step 4; its slug is as in Step 5. Read `campaign.yaml` for a categories entry for that folder; if there is none, run `add-category.mjs` with the same arguments as in Step 5. Then continue at Step 6 and Step 7. Skip Steps 2, 3 and 4 (the welcome, the interview and the confirmation): the master already gave them. In Step 6, the description in `campaign.yaml` is the master's words.
- Output: the values confirmed, and whether this is a new campaign or a resume.

**Step 2 — Welcome.** Write the welcome in the campaign language. The campaign language is the language the master writes in. Use two sentences: a few questions follow, and then the campaign is ready to start. Put the welcome in the same message as the questions of Step 3.
- Output: the welcome sentences, sent with Step 3.

**Step 3 — Interview.** Ask the master (the process runner turns this into a QUESTION result) these four questions in ONE message, numbered, and accept partial answers.
1. The name of the campaign, and the language to write in.
2. The role-playing game (and its edition), or their own system.
3. The tone of the descriptions: evocative, plain, or other.
4. In two or three sentences: what world and what story.

If the master's message already contains answers, use them and do not ask again. This includes a message with all four answers and the confirmation.

Defaults for a missing answer, which you must name to the master:
- language: the language the master writes in;
- game: none;
- tone: plain;
- world name: the campaign name.

Map the tone to the value of `--register`:
- evocative or aulico → `elevated`;
- plain, asciutto or sobrio → `plain`;
- colloquial or colloquiale → `colloquial`;
- mixed → `mixed`.

If a game is named, say in one sentence that its rules cannot be used automatically yet, that the campaign works anyway, and continue with no game rules.

World name: use the proper name in answer 4 if there is one (for example «Varn»). Otherwise use the campaign name.

Output: the four answers, with the defaults used and the tone mapped to `--register`.

**Step 4 — Summary and one confirmation.** Show in plain words what will be created:
- the settings of the campaign;
- the file of «Your rules», empty;
- the first document: the description of the world, in a folder named with the word for «World» in the campaign language (Italian `Mondo`, English `World`, other languages: the translation of «World»).

Nothing else. Ask the master for one confirmation (the process runner turns this into a QUESTION result). If the master's message already contained a clear confirmation, go on to Step 5 without asking again.
- Output: the confirmation given.

**Step 5 — Create the core files.** Run:
`node "${CLAUDE_PLUGIN_ROOT}/scripts/init-campaign.mjs" . --name "<campaign name>" --language <language code> --register <elevated|plain|colloquial|mixed> --world "<world name>" --description "<answer 4 condensed to one sentence>"`
- Language code: lowercase ISO 639-1, for example `it` or `en`.
- If the exit code is not 0: say the fixed sentence of the lexicon «could not finish an operation», and stop.
- If it succeeds: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/add-category.mjs" . --id <slug of the folder name> --folder "<Folder>" --type places`.
- If the exit code is not 0: say the fixed sentence of the lexicon «could not finish an operation», and stop.
- Slug: lowercase, ASCII letters and digits, words joined by hyphens. For `Mondo`, the slug is `mondo`.
- Output: the JSON of both commands, read and kept.

**Step 6 — Draft the world document.** You write this draft yourself. The spec assigns the first draft of the world document to the main assistant. Its path in the campaign is `<Folder>/<World name>.md`. Write the draft to `.campaign/state/write/draft/<Folder>/<World name>.md` in exactly this form:

```markdown
---
id: <slug of the world name>
---

# <World name>

## <the word "Description" in the campaign language, for example Descrizione>

_<one or two sentences: the premise as narration, in the chosen tone>_

<one short paragraph restating the premise plainly>
```

Build the two text lines (the italic line and the plain paragraph) from the master's own words in answer 4. You may only change word order, grammar and punctuation, and split or join sentences. Do not add any noun, adjective, place, person, number or event that is not in the master's words.
- Correct: master says «Varn is a city of bridges where the river sings» → `_Varn is a city of bridges, and the river sings._`
- Wrong: `_Varn rises over a dark sea, its bridges full of merchants._` (sea and merchants are new).
- Output: the draft file exists at the path above.

**Step 7 — Write sequence.** Invoke the skill `yllir:write-sequence` with these inputs:
- `DOCUMENTS=<Folder>/<World name>.md`
- `INTENT="First document of a new campaign: the world description, using only the master's premise."`
- `NEW_SUBJECTS=<world id>`
- `VERSION_MESSAGE=<the sentence for the campaign language, as set below>`

The version sentence is read by the master later, so write it in the campaign language; never in English unless the campaign language is English. Use these exact values:
- `it` → `Creata la campagna «<name>»`
- `en` → `Created the campaign «<name>»`
- any other language → the translation of `Created the campaign «<name>»` into that language.
- `ROUND=1`
- `CONTINUE_WITH="new-campaign step 7: read the WRITE REPORT status and act on it"`

`write-sequence` writes `CONTINUE_WITH` as the last line of its report file and then resumes this step.

After invoking `yllir:write-sequence`, read `.campaign/state/write/report.txt` (Read tool) and act on its `status:` line.

The report in `.campaign/state/write/report.txt` is for you, never for the master. Do not show it, quote it or name its status to the master.

Loop, starting with `ROUND=1`:
1. Read `.campaign/state/write/report.txt` and its `status:` line.
2. If `status` is `FIX_NEEDED` or `VERIFY_FAILED`: rewrite the draft file at the same path `.campaign/state/write/draft/<Folder>/<World name>.md`, removing or fixing exactly each problem listed in `details`. Use only the master's words, as Step 6 requires. Then invoke `yllir:write-sequence` again with the same inputs and `ROUND` plus one. Repeat this loop up to `ROUND` 3.
3. If `status` is `DONE`: go to Step 8.
4. If `status` is `CONFLICT` or `ASK`: ask the master the question from the report in plain words (the process runner turns this into a QUESTION result), and stop.
5. If `status` is `FAILED`: go to the failure sentence below, and stop.

After a failed `ROUND` 3 (still `FIX_NEEDED` or `VERIFY_FAILED`), say the fixed sentence of the lexicon «the first document could not be completed, but the settings are ready», in the campaign language. Stop. Do not mention rounds, statuses or problems.

For `FAILED`, say the same fixed sentence: the first document could not be completed, but the settings are ready. Stop.

Output: `status: DONE`.

**Step 8 — Close.** Only after `status: DONE`. Your closing text is the `message for the master` of the runner's result, so write it as that message, in the campaign language, in plain text. It contains:
- one sentence that the campaign is ready and saved. Never show version codes, file paths, backticks or formatting marks like `code`; say only that the campaign is saved;
- two or three example sentences the master can say next, for example «describe the first place», «let's prepare the first session», «I have notes to bring in»;
- one sentence that some of these will become available step by step.

Offer, without insisting, a short practice session in the future. Do not add anything after this text: the process runner returns it to the entry skill.

## Examples

Correct: the master answers all four questions and writes «yes, go ahead» in one message. The message is the confirmation, so skip the question of Step 4 and go to Step 5. Then create the files, write the draft, run the write sequence, and close with the example sentences. No question about categories, players or images.

Wrong: asking about categories, players, images or pricing before creating the campaign. The interview has only the four questions of Step 3.
