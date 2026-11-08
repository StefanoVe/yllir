---
name: after-session
description: Core process. Records one evening that was played as a chronicle page: checks the plot map, reads the documents involved, marks the sessions that were played, writes only what the master said through the write sequence, and lists what was not written into the cards. Runs inside the process runner.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/plot-map.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/build-index.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/after-session/scripts/today.mjs" *), Read, Write, Skill
---

# After session

Records the evening that was played as one chronicle page. Run every command from the campaign root (the folder that contains `campaign.yaml`). Keep every value you read from a script, and never guess one.

**Commands.** Run each command exactly as written in this file, as one single command: nothing before it and nothing after it, no `;`, `&&`, `|`, `2>&1`, `echo`, `cat`, `mkdir` or `cd`. Anything added makes the command refused. Every script prints its result and, as its last line, `exit: <code>`: read the exit code from that line (the `exit:` line). Read result files with the Read tool. If a command is refused, run it again exactly as written, with nothing added; if it is refused again, end this skill with `status: FAILED`, reason "permission refused".

**Scope of this version.** This process:
- creates ONE new chronicle page, and marks which plot sessions were played;
- does NOT change character, place, item, creature or plot documents, and creates no document other than the chronicle page;
- does NOT rewrite an existing chronicle page. If the master asks to change a page already written, say in one sentence that this is not available yet, and stop;
- lists the canon changes the master may want as things NOT written into the cards. It never proposes them as already done;
- has no session log yet: the only source is MASTER_MESSAGE.

**Questions to the master.** Ask the master in plain words, then stop. Write the question as your message; the process runner turns it into a QUESTION result. Every question ends with a question mark: a statement is not a question.

**Inputs.** MASTER_MESSAGE is the master's message, as given by the process runner.

## Steps

**Step 1 — Map and campaign settings.** Run these three commands in this order:
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/plot-map.mjs" . --out .campaign/cache/plot-map.json`
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/build-index.mjs" . --out .campaign/cache/subjects.json`
- read `campaign.yaml` with the Read tool.

Exit code 2 from either script: stop and say in one sentence that the campaign map could not be read. Exit code 1 from `plot-map` is allowed (its errors are listed in its output): keep going.
Read `.campaign/cache/plot-map.json` with the Read tool. Keep `sessions` and `errors`. Read `.campaign/cache/subjects.json` with the Read tool. Keep the list of subjects: for each, its `id`, its `sheet` (the document path) and its `forms` (each form has a field `text`).
From `campaign.yaml` keep:
- `language.main`: the CAMPAIGN LANGUAGE (for example `it` or `en`);
- the `folder` of the entry whose `type` is `chronicle` in `structure`: the CHRONICLE FOLDER. If there is no such entry, stop and say the fixed sentence of the lexicon for an operation that could not be completed.
- Output: the map, the subjects, the CAMPAIGN LANGUAGE and the CHRONICLE FOLDER read and kept.

**Step 2 — Account.** Read MASTER_MESSAGE and count the concrete events in it: things that happened at the table, with who did what, where, or what was found. Only a message with at least two concrete events is enough.
- If it has fewer than two (for example only «we finished» or «it went well»): the message to the master is exactly this ONE question, with no greeting and no statement before it, and it must end with a question mark: Italian «Com'è andata la serata? Raccontamela con una frase per ogni scena.»; English «How did the evening go? Tell me in one sentence per scene.»; for any other campaign language, translate it, keeping the question mark. Then stop.
- Never invent an event to reach two.
- Output: the list of the concrete events, in the master's words (kept for steps 4, 5 and 6).

**Step 3 — Date.**
- Run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/after-session/scripts/today.mjs"` in every case. Its first line is today's date, in `YYYY-MM-DD`. Exit code not 0: stop and say the fixed sentence of the lexicon for an operation that could not be completed.
- If MASTER_MESSAGE names a date, use it. Convert it to `YYYY-MM-DD`. A day and month with no year means the year of today, as printed by the command above.
- Otherwise use today's date.
- The new file is `<date>.md` inside the CHRONICLE FOLDER. The id is `cronaca-<date>`.
- If the file `<CHRONICLE FOLDER>/<date>.md` already exists, use the next free suffix instead, with the same name rule for the id: first `<date>-b`, then `<date>-c`, and so on. Check a name with the Read tool on the file path: if it returns the page, the name is taken; if the Read tool reports that the file does not exist, the name is free. Never open or change the old page.
- Output: the date in `YYYY-MM-DD`, the file name (`<date>.md` or with a suffix), and the id, all kept.

**Step 4 — Played sessions.**
- Candidates: the sessions of the map with `played: false`.
- If MASTER_MESSAGE names one or more candidates (compare their `name`, ignoring case and accents), those are the played sessions.
- Otherwise, if the account matches exactly one candidate with `ready: true`, that session is the played one.
- If the account matches no session, or it is unclear which one was played: decide that the evening played no plot session only if the master says so clearly (for example «we only talked»). Otherwise ask the master ONE question, in plain words, in the CAMPAIGN LANGUAGE, written as a question ending with «?»: name the candidates by their `name` (never by id) and ask which one was played. Then stop.
- For each chosen session, check its `depends_on`: each id must be `played: true` in the map. If one is not played and MASTER_MESSAGE does not say to mark it anyway: do not mark that session. Ask the master ONE question, written as a question ending with «?»: name the session and the missing sessions by their `name`, and ask whether to mark it anyway. Then stop. If the master says yes, mark it, and keep a note to say so in the message.
- PLAYED_IDS is the list of the ids of the chosen sessions. If the evening played no plot session, PLAYED_IDS is empty.
- Output: PLAYED_IDS (may be empty), and the list of sessions that were marked although a prerequisite is not played (may be empty).

**Step 5 — Documents involved.**
1. Take the names in MASTER_MESSAGE, and the names of the played sessions (their `name`).
2. For each name, compare it with each form of each subject (the `text` of each form). Compare ignoring case and accents. A match is a subject id.
3. Read the document of each matched subject. Its path is the `sheet` of the subject. Read the whole document, master notes included.
4. Read the file of each played session (its `file` in the map). Read the whole file, master notes included.
5. A name the master uses that matches no subject is MISSING. Do not create a document for it.
- Output: the list of documents read (paths), the list of subject ids, and the MISSING names.

**Step 6 — Read-only check of the documents.** Only for the check of the contradictions. Compare what the master said (MASTER_MESSAGE) with the documents read in step 5. Write down each place where the master's account contradicts a document, in plain words, as CONTRADICTIONS (may be empty). Do not decide which of the two is right.
- Output: the CONTRADICTIONS list (may be empty).

**Step 7 — Draft.** Write the chronicle page to `.campaign/state/write/draft/<CHRONICLE FOLDER>/<file name>`, where `<file name>` is the name from step 3. Use exactly this form, with the headings in the CAMPAIGN LANGUAGE (the Italian headings below are for `it`; for `en` use «## What happened» and «## Open threads»; for any other language translate the two headings):

```markdown
---
id: cronaca-<date>
played: [<PLAYED_IDS, or []>]
---

# <TITLE: 2 to 6 words on what happened, never a date>

## Accaduto

<prose in the past tense, only what the master said; 1 to 4 paragraphs>

## Fili aperti

- <open question or promise from the account>
```

Rules for the draft:
- Use the id from step 3, with the suffix if there is one.
- `played:` lists PLAYED_IDS between the brackets, separated by commas. If PLAYED_IDS is empty, write `played: []`.
- The title is 2 to 6 words naming what happened, taken from the events (for example «Il ponte che cede» or «Il calore del pozzo»). Never a date, never the word Cronaca alone, never a number.
- Past tense only.
- Write only facts from MASTER_MESSAGE. You may read the documents of step 5 only to get names and spellings right.
- No new named character and no new named place. A name that is not in the subjects appears as plain words (for example «a fisherman»), and it goes to MISSING.
- Never define or change who a known subject is. Do not write a new fact about a known subject in the page as if it were established; if the master said it, it is in the list of things not written (step 8), not in the page.
- Hypotheses the master voiced stay hypotheses («the group suspects…»). Never turn a hypothesis into a fact.
- No invented numbers, no invented results of checks, no invented events.
- For a CONTRADICTION: write what the master said as the group's belief («according to X…») only if the master framed it that way. Otherwise leave the conflicting detail out of the page, and report it in the message.
- Never write a master notes block in the page.
- `## Fili aperti` is a list of open questions and promises from the account. If there are none, omit the whole `## Fili aperti` section.
- Also keep the list NOT_WRITTEN: each thing the master said that you did not write into the page, in one short plain sentence. Include new facts about known subjects, new named characters and new named places. This list may be empty.
- Output: the draft file exists at its path; NOT_WRITTEN is kept.

**Step 8 — Write sequence.** Invoke the skill `yllir:write-sequence` with:
- `DOCUMENTS=<CHRONICLE FOLDER>/<file name>`
- `INTENT="Chronicle of the evening <date>: records only what the master said happened; must not define or change the identity of existing subjects; no new named characters or places."`
- `NEW_SUBJECTS=` (empty: chronicle pages are not subjects)
- `VERSION_MESSAGE=` the sentence «Registrata la serata del <date>» for `it`, «Recorded the evening of <date>» for `en`, or the translation into the campaign language
- `ROUND=1`
- `CONTINUE_WITH="after-session step 8: read the write report and act on its status"`

After invoking it, read `.campaign/state/write/report.txt` with the Read tool. The report is for you, never for the master: do not show it or quote it.

Loop, starting with `ROUND=1`. Read `.campaign/state/write/report.txt`. Then:
- If a problem listed under `details` is a link to a document that is not allowed (a link to a master-only file): do not try to fix it in the draft; say the fixed sentence of the lexicon for an operation that could not be completed, and stop.
- If status is `FIX_NEEDED` or `VERIFY_FAILED`: open the draft, fix exactly each problem listed under `details` (if a problem is a fact that the master did not say, remove that fact), save the draft, and invoke `yllir:write-sequence` again with `ROUND` plus one and the same other inputs. Do this up to `ROUND` 3. Do not stop after the first fix: each fix is followed by a new invocation.
- If status is `ASK` or `CONFLICT`: ask the master the question from the report in plain words, and stop.
- If status is `DONE`: go to step 9.
- If status is `FAILED`, or any other status: go to the failure sentence below, and stop.

After a failed `ROUND` 3 (still `FIX_NEEDED` or `VERIFY_FAILED`), or after `FAILED`: say the fixed sentence of the lexicon for an operation that could not be completed, in the campaign language. Do not mention rounds, statuses, problems or paths. Stop.

Output: `status: DONE`.

**Step 9 — Message for the master.** Only after `status: DONE`. Write ONE message in the CAMPAIGN LANGUAGE, in plain words:
- one sentence: the evening is recorded, named by its date in words (for example «la serata del 3 novembre», or «the evening of 3 November»);
- if sessions were marked as played: one sentence naming them by their `name`;
- if a session was marked although its prerequisite is not played: one sentence saying so, and naming the prerequisite;
- if MISSING is not empty: one sentence «these have no document yet: <names>»;
- each CONTRADICTION that was left out of the page: one plain sentence saying which two sources disagree, and that the page was written without that detail. Never choose a version;
- each entry of NOT_WRITTEN: one short plain sentence, saying that this is not written in the cards yet;
- one sentence on what the master can do next (for example «tell me what you want to prepare next»).

No paths, no ids, no codes, no backticks, no formatting marks.

## Examples

Correct: the master writes «ieri abbiamo finito la scena al porto: Varn ha trovato la barca, e il gruppo ha deciso di non parlare con il capitano». The message has two concrete events, the session «Il porto» has `ready: true` and matches the account, so it is marked as played. The page has two paragraphs in the past tense, using only these two events. The message for the master says the evening is recorded, names the session, and says that a detail about Varn (for example a new fact about her past) was not written into the cards yet, then asks what to prepare next.

Wrong (date as title): the page is titled «# 2026-11-05». A date is not a title: the title names what happened, for example «Il ponte che cede».

Wrong (inventing an event): the master writes «abbiamo giocato bene, il gruppo ha vinto lo scontro». The master did not say what happened in the fight, so the page must not write how the fight ended or who won. The right move is to ask the master ONE question: to tell the evening in one sentence per scene.

Wrong (editing a character card): the master writes «Oswin ha confessato di essere il fratello di Brenna». The process must not open the card of Oswin to add this fact. The fact goes to the page only as what the master said, and the message says it is not written into the cards yet.
