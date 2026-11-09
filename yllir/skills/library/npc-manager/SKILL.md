---
name: npc-manager
description: Library skill. Creates the draft of a character sheet (non-player character, vendor, enemy or creature) and checks that every character defined in the plot documents has a sheet. The sheet is the source of truth for who the character is, never for what the character does in the plot. Invoked by Yllir core processes (prepare-session, after-session, import) when a plot document names a character, or when asked to check character sheets. Never invoked for anything outside a Yllir campaign.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/npc-manager/scripts/npc-manager.mjs" *), Read, Write
---

# NPC manager

This skill is always invoked by another skill. The result of this skill is the file `.campaign/state/npc-manager/report.txt`, not a message for the master. The invoking skill reads that file to know the result.

**Commands.** Run each command exactly as written in this file, as one single command: nothing before it and nothing after it, no `;`, `&&`, `|`, `2>&1`, `echo`, `cat`, `mkdir` or `cd`. Anything added makes the command refused. Every script prints its result and, as its last line, `exit: <code>`: read the exit code from that line (the `exit:` line). Read result files with the Read tool. If a command is refused, run it again exactly as written, with nothing added; if it is refused again, end this skill with `status: FAILED`, reason "permission refused".

Run every command from the campaign root (the folder containing `campaign.yaml`): the `campaign root:` line of the session check in your context, or, if absent, the output of `node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" .`. Drafts go to `.campaign/state/write/draft/` followed by the campaign-relative path.

## What this skill owns

- The DRAFT of a new character sheet, template `npc`, `vendor`, `enemy` or `creature`, from the facts the caller gives. It never writes a campaign document: the caller sends the draft through `yllir:write-sequence`.
- The check that every character named in the plot documents has a valid sheet.

## Who owns what

The sheet is the source of truth for WHO the character is: name, role, appearance, manner, voice, what they want, secrets. It is NOT the source of truth for WHAT the character does during the plot: actions, events, scenes. Those belong to the plot documents.

- A plot event declares the characters it uses in its metadata field `characters: [id, ...]` (ids of sheets, like `location`). Absent means none. Every named character that acts or speaks in the event is listed there and has a sheet.
- The plot text names the character and says what they do. It never states or changes who the character is (role, looks, personality, motives, secrets). If an event needs a fact about the character's identity, that fact goes into the sheet first.
- The sheet never records what the character does in a given session or event ("in session 2 he betrays..."). That stays in the plot and, once played, in the chronicle.
- If a plot event makes a character act against the sheet, that is not an error of the plot and not an error of the sheet. Report it as a question for the master (`status: ASK`). Never choose silently, never edit the sheet to match the plot.
- Identity facts: the sheet wins. Actions in the plot: the plot wins.
- A character with no sheet is MISSING.
- Master-only content of a sheet never goes into a plot text, a report or a message.

## When core calls this skill

- Prepare-session calls `create` for every named character a new scene needs, before it drafts the scenes.
- After-session and import call `create` for new characters.
- Encounter-balancer (apply) and document-ingest call `create` for enemies and creatures; vendors are created when a scene needs a shop.
- Any process may call `check` on the documents it changed.

## Inputs

- `MODE`: `create` or `check`. Any other value: write the report with `status: FAILED` and `reason: unknown MODE <value>`.
- `CONTINUE_WITH`: text naming the caller's next step. If absent, use "the step of the invoking skill that called npc-manager".

Mode `create` also takes `NAME` (the name as written by the master or the plot; a double quote in it means `status: FAILED`, reason "name not usable"), `LOCATION` (comma-separated place ids, may be empty; for an enemy or creature, every place where it lives, and empty means errant), `DETAILS` (facts about the character as plain text, may be empty), `REQUESTED_BY` (comma-separated campaign-relative paths of the documents that asked for this character: the scene files, a sheet, an ingested page; may be empty) and `TEMPLATE` (`npc`, `vendor`, `enemy` or `creature`; default `npc`). The caller gives TEMPLATE: never guess it. Mode `check` also takes `FILES` (comma-separated campaign-relative paths; empty means the whole campaign).

## Mode `create`

**Step 1 — Category.** Read `campaign.yaml` with the Read tool. Keep `language.main` and `system.adapter` (`none` or absent means no adapter). Keep the entries of `structure` whose `type` is `subjects`. If TEMPLATE is not `npc`, `vendor`, `enemy` or `creature`, go to Step 2.
- TEMPLATE `npc` or `vendor`: if there is no `subjects` entry, write the report with `status: FAILED`, reason "no character category", and go to the Continue step. Otherwise the category is the first `subjects` entry that holds a sheet with `template: npc`. To find it, Read `.campaign/cache/subjects.json` if it exists: take the first subject whose `category` is that entry's id, Read its `sheet`, and check its front matter. If no entry has one, or the file does not exist, use the first `subjects` entry.
- TEMPLATE `enemy` or `creature`: the first rule that matches wins. (1) A `subjects` entry that already holds a sheet with `template: enemy` or `template: creature`, checked as for npc above. (2) A `subjects` entry whose `folder` is named `Creature` or `Creatures`, or the translation of "creatures" in `language.main`, ignoring case. (3) Otherwise write the report with `status: FAILED`, reason "no creature category", and go to the Continue step. This skill never creates categories. Keep the chosen entry's folder as FOLDER.

**Step 2 — Template.** If TEMPLATE is not `npc`, `vendor`, `enemy` or `creature`: write the report with `status: NOT_AVAILABLE` and `reason: template <value> is not available`. Go to the Continue step.

**Step 3 — Duplicates.** Run this command, with NAME replaced by the caller's value:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/npc-manager/scripts/npc-manager.mjs" . find --name "<NAME>"`
- Exit code 2: write the report with `status: FAILED`, `reason: find not run`. Go to the Continue step.
- Each `match` line gives `<subject id>`, `<sheet path>`, the form text, the title or alias, and `exact` or `partial`.
- If any match is `exact`: write the report with `status: DONE`, `exists: <that subject id>`, `draft: none`, and `requested by:` copied from REQUESTED_BY. Go to the Continue step. Write no draft.
- If there is a `partial` match and no `exact` match: write the report with `status: ASK`, and `question:` set to exactly "Is <NAME> the same character as <title>?", where `<title>` is the title of that match. Write no draft. Go to the Continue step.

**Step 4 — Id and path.**
- ID: the slug of NAME. Lowercase ASCII letters and digits, words joined by hyphens, accents removed. Example: `Ilde Varnò` gives `ilde-varno`.
- If `.campaign/cache/subjects.json` exists and any subject has `id` equal to ID: write the report with `status: ASK`, `question:` "Is <NAME> a new character, or does the id <id> already belong to another one?". No draft. Go to the Continue step.
- SHEET_PATH: `<FOLDER>/<file name>.md`, where the file name is NAME without the characters `/ \ : * ? " < > |`. The `# title` keeps the full NAME.

**Step 5 — Draft.**
- Statistics check, only when TEMPLATE is `enemy` and `system.adapter` is set (not `none`, not absent). Statistics are game rules: never write them from memory or invent them. If DETAILS contains no statistics block: do NOT write a draft. Write the report with `status: ASK`, `draft: none`, and `question:` "Which statistics does <NAME> have?". Go to the Continue step. Otherwise write the draft with the Write tool at `.campaign/state/write/draft/<SHEET_PATH>`, in the model of TEMPLATE below. Headings: the `it` column for `it`, the `en` column for `en`, translated for any other language.

| Key | it | en | Used by |
|---|---|---|---|
| role | `## Ruolo` | `## Role` | npc, vendor |
| appearance | `## Aspetto e modi` | `## Appearance and manner` | npc, vendor |
| table | `## Al tavolo` | `## At the table` | npc, vendor |
| stock | `## Assortimento` | `## Stock` | vendor |
| haggling | `## Trattare` | `## Haggling` | vendor, optional |
| exceptions | `## Deroghe` | `## Exceptions` | vendor, optional |
| nature | `## Natura` | `## Nature` | enemy, creature |
| statistics | `## Statistiche` | `## Statistics` | enemy, creature |
| loot | `## Bottino` | `## Loot` | enemy, creature, optional |
| todefine | `## Da definire` | `## To define` | all, optional |

Model `npc` (`location` lists the LOCATION ids, separated by commas, or nothing):

```
---
id: <ID>
template: npc
location: [<LOCATION ids, separated by commas, or nothing>]
---

# <NAME>

## Ruolo

<text>

## Aspetto e modi

<text>

## Al tavolo

<text>
```

Model `vendor`: the npc model with `template: vendor`, then, after `## Al tavolo`, in this order:
- `## Assortimento`, then the header line `| Oggetto | Prezzo | Nota |` (`en`: `| Item | Price | Note |`), then the separator `| --- | --- | --- |`, then one row per item.
- `## Trattare`, only if DETAILS says how they bargain. `## Deroghe`, only if DETAILS gives a price outside the usual range, with its reason.
- Rows: only the items and prices DETAILS states, copied as written. Never invent an item or a price. If DETAILS lists no items: write the header and the separator and NO rows, and add "stock" to the To define list.

Model `enemy` and `creature` (`template` is the value the caller gave):

```
---
id: <ID>
template: <enemy or creature>
location: [<LOCATION ids, separated by commas, or nothing>]
---

# <NAME>
![<short description>](<image path>)
## Natura
<text>
## Statistiche
<statistics>
## Bottino
<loot>
```

- The image line is OPTIONAL for all four templates (npc, vendor, enemy, creature). It is written only if DETAILS gives an image path, in the form `![<short description>](<image path>)`, right under the `# <NAME>` title. It is never invented, never required, and a sheet without it is complete and valid. Its absence is never listed in `open points:`. Otherwise omit it.
- `location` is REQUIRED: with an empty LOCATION write `location: []`. `## Natura`: public lore only, what the creature is and what the characters can know, from DETAILS.
- `## Statistiche`, enemy, adapter `none` or absent: the text DETAILS gives, copied as written; if DETAILS gives none, `Da definire.` (`en`: `To be defined.`) and add "statistics" to the To define list. Enemy with adapter set: the statistics block from DETAILS, copied exactly. Creature: exactly this one sentence and nothing else: `Nessuna statistica: non combatte.` (`en`: `No statistics: it does not fight.`). `## Bottino`: optional, only if DETAILS gives loot. Copy the values as written. Invent none.

Content rules, for every template:
- The image line under the title is optional for every template, as stated in Step 5: never invent it, never require it.
- Use ONLY what DETAILS says. Never invent a trait, a looks detail, a motive, a relative, a secret or a past event. Never write what the character does in a session or event: if DETAILS describes an action in the plot, leave it out. Every heading and sentence is in `language.main`.
- `## Ruolo` (npc, vendor): what the character is for the story or the place, from DETAILS. If DETAILS gives nothing, one sentence that says only where the character appears, in the caller's own words. Appearance (npc, vendor): one italic paragraph (`_..._`) in `## Aspetto e modi`, only when DETAILS describes it. Manner of speaking and what the character wants go in `## Al tavolo`.
- A required section with nothing known contains exactly one sentence: `Da definire.` (Italian), `To be defined.` (English), or the translation. Then add `## Da definire` (or `## To define`) as the LAST section before any master block, with one list item per missing section, for example `- aspect and manner`.
- Anything marked as secret or "for the master only", and any conduct, tactics, flight or secret of a creature, goes ONLY in the master block at the end: `<!-- master -->`, `## Master`, `### Indicazioni per il master` (`en`: `### Notes for the master`), the text, `<!-- /master -->`. If there is no such content, omit the block. No public section ever holds that text.

**Step 6 — Check the draft by reading it back.** Do NOT run `check-sheets` on a draft: that script checks campaign files only. Read the draft with the Read tool and check the points for its TEMPLATE. An image line under the title, if present, is not a section: it is never counted as one, and its absence is never a failure.
- npc: front matter has `id`, `template: npc`, `location`; one `#` title equal to NAME; `## Ruolo`, `## Aspetto e modi`, `## Al tavolo` present in this order, each with text; the only other `##` section is `## Da definire`, last; the master block, if any, is last.
- vendor: as npc with `template: vendor`; `## Assortimento` after `## Al tavolo`, with the header `| Oggetto | Prezzo | Nota |` (`en`: `| Item | Price | Note |`) and a separator row; `## Trattare` and `## Deroghe` optional, in that order, before `## Da definire`.
- enemy: front matter has `id`, `template: enemy`, `location` (a list, `[]` allowed); one `#` title equal to NAME; `## Natura` and `## Statistiche` present in order, each with text; `## Bottino` optional, after `## Statistiche`; no conduct text in a public section; the master block, if any, is last. creature: as enemy with `template: creature`, and `## Statistiche` contains exactly the creature sentence.

If a point fails, fix the draft with Write and read it back, at most 2 times. If it still fails, write the report with `status: FAILED`, `reason: draft check failed`, and go to the Continue step.

**Step 7 — Report.** Write the report with `status: DONE`, `draft: <draft path relative to the campaign root>`, `new subject: <ID>`, `requested by:` copied from REQUESTED_BY, and `open points:` listing each section written as "to be defined". Also list "statistics" or "stock" when `## Statistiche` or `## Assortimento` is written as "to be defined". Go to the Continue step.

## Mode `check`

**Step 1 — Root.** Locate the root (see Working folder).

**Step 2 — Sheets.** Run one of these commands: without `--files` when FILES is empty, with it otherwise.
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/npc-manager/scripts/npc-manager.mjs" . check-sheets`
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/npc-manager/scripts/npc-manager.mjs" . check-sheets --files "<FILES>"`
- Exit code 2: write the report with `status: FAILED`, `reason: usage error from check-sheets: <message>`. Go to the Continue step.
- Keep every `error <code> <file>: <message>` line as a problem.

**Step 3 — Plot cast.** Run one of these commands, the same way as Step 2 (with `--files` only when FILES is not empty):
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/npc-manager/scripts/npc-manager.mjs" . plot-cast --out .campaign/state/npc-manager/cast.json`
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/npc-manager/scripts/npc-manager.mjs" . plot-cast --files "<FILES>" --out .campaign/state/npc-manager/cast.json`
- Exit code 2: write the report with `status: FAILED`, `reason: usage error from plot-cast: <message>`. Go to the Continue step.
- Keep every `error` line as a problem, and every `candidate <file>:<line> <text>` line as a CANDIDATE.

**Step 4 — Judge the candidates.** This is the only judgment step. For each CANDIDATE, Read line `<line>` of `<file>`. Keep it only if the text names a PERSON or CREATURE that acts, speaks or is described in that event, AND no id in that event's `characters` list has that name. Drop places, objects, titles, organisations, months, and words capitalised only by style. If the line is inside a `<!-- master -->` block, write only the file and the line, never its text. Never invent a candidate. If a plot line gives a character an identity fact or an action that the sheet contradicts, do not decide: keep it as a question for the master, and look for nothing beyond the lines you read.

**Step 5 — Report.** `status: DONE` when there are no errors and no kept candidate. `status: ASK` when there are no errors and a question was kept (put it in `question:`). `status: ERRORS` otherwise. One problem line per error, and one per kept candidate: `- missing-sheet: <file>:<line> <text>`.

Go to the Continue step.

## Error table

| Situation | Action |
|---|---|
| A script exits 2 | `status: FAILED` with the reason. Do not try other options. |
| Refused twice, or no `subjects` category | `status: FAILED`, with the reason named in the step. |

## Report format

The report is written with the Write tool to `.campaign/state/npc-manager/report.txt`. It is never printed in the chat and never shown to the master. The `requested by:` line is always written: in mode `create` it is REQUESTED_BY (or `none` when REQUESTED_BY is empty); in mode `check` it is `none`.

```
NPC MANAGER REPORT
status: DONE | ASK | ERRORS | NOT_AVAILABLE | FAILED
mode: create | check
draft: <path or none>
exists: <subject id or none>
new subject: <id or none>
requested by: <REQUESTED_BY, comma-separated, or none>
question: <one sentence or none>
reason: <text or none>
problems:
- <code> <file>: <message>      (or "- none")
open points:
- <text>                          (or "- none")
continue with: <CONTINUE_WITH>
```

Complete example, create, DONE:
```
NPC MANAGER REPORT
status: DONE
mode: create
draft: .campaign/state/write/draft/Personaggi/Ilde Varno.md
exists: none
new subject: ilde-varno
requested by: Trama/Sessione 2/Eventi/Il ponte.md
question: none
reason: none
problems:
- none
open points:
- ## Aspetto e modi: to be defined (no appearance in the details)
continue with: after-session step 6: send the draft through write-sequence with the session documents
```

Complete example, create, ASK (partial match):
```
NPC MANAGER REPORT
status: ASK
mode: create
draft: none
exists: none
new subject: none
requested by: none
question: Is Ilde the same character as Ilde Varno?
reason: none
problems:
- none
open points:
- none
continue with: prepare-session step 4: ask the master the question, then wait for the answer
```

Complete example, create, ASK (enemy, adapter set, no statistics in DETAILS):
```
NPC MANAGER REPORT
status: ASK
mode: create
draft: none
exists: none
new subject: none
requested by: Trama/Sessione 3/Eventi/Le saline.md
question: Which statistics does Guardiano di sale have?
reason: none
problems:
- none
open points:
- none
continue with: the caller's step that asks the master the question, then waits for the answer
```

Complete example, check, ERRORS:
```
NPC MANAGER REPORT
status: ERRORS
mode: check
draft: none
exists: none
new subject: none
requested by: none
question: none
reason: none
problems:
- invalid-frontmatter Personaggi/Bera.md: line 3 is not valid YAML
- missing-sheet: Trama/Sessione 2/Eventi/Il ponte.md:14 Brann the ferryman waits at the rope
open points:
- none
continue with: after-session step 7: read the check result and show the open items to the master
```

## Linking

The sheet is not linked here. The caller links it, through `yllir:write-sequence`:
- The caller puts the draft in its write sequence together with the documents of REQUESTED_BY that it writes.
- The caller passes the `new subject:` id in `NEW_SUBJECTS`, so that `yllir:linker` links every requesting document to the new sheet.
- When `exists:` is set, there is no new subject. The caller's own documents are linked outward by the linker, because they are in the DOCUMENTS of its write sequence.
- A requesting document that is NOT written in the same sequence (an existing document that mentions the name in plain text) is linked by the same call through `NEW_SUBJECTS`. The caller must not edit it by hand.

## Rules

- Never write a link into a document, and never link a sheet here: the linker does it, through the caller's write sequence.
- Never edit a sheet that exists. This skill writes only drafts under `.campaign/state/write/draft/` (mode `create`) and the report.
- Never write to the plot folder (`Trama/` in an Italian campaign, `Plot/` in an English one, or the category of type `plot` in `campaign.yaml`).
- Never print the report, never show it to the master, and never invent facts: the draft uses only DETAILS.
- Master-block text never goes into a plot text, a draft outside its block, a report or a message.
- Run commands only from the campaign root, one per Bash call, exactly as written here.
- Your last action is the Write of the report; then, in the same turn, do what `continue with:` says.

## Correct and wrong

Correct: `create` for «Ilde Varno» finds no match, DETAILS gives only her role, and the two sections with nothing known say `Da definire.` and are listed under `## Da definire`. The report says `status: DONE`.

Correct: `create` with TEMPLATE `enemy` for «Guardiano di sale», with `system.adapter` set and no statistics in DETAILS: no draft, and the report says `status: ASK` with `question: Which statistics does Guardiano di sale have?`.

Wrong: the same enemy, with `system.adapter` set and no statistics in DETAILS, gets a `## Statistiche` block written "from memory" for a known game. Forbidden: statistics are never invented.

Wrong: a plot event says Ilde Varno "betrays the group at the harbour", and the sheet is edited to add "a traitor". Forbidden: the report says `status: ASK` and nothing is edited.
