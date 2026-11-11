---
name: complete-sheet
description: Core process. Completes or corrects a sheet that already exists (character, vendor, enemy, creature or place) when the master says it is empty, too thin or wrong: finds the gaps, recovers what the campaign already says, verifies rules facts in the allowed sources, asks only the creative choices that are needed, and writes through the write sequence. Runs inside the process runner.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/build-index.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/npc-manager/scripts/npc-manager.mjs" *), Read, Write, Skill
---

# Complete or correct a sheet

Completes or corrects ONE existing sheet: a character, a vendor, an enemy, a creature or a place. Run every command from the campaign root (the folder that contains `campaign.yaml`). Keep every value you read from a script, and never guess one.

The path read from the subjects index is only the current path. The write sequence reviews and applies the canonical category-first geographic path from explicit location data; after it finishes, use its returned canonical path for any further read or check.

**Commands.** Run each command exactly as written in this file, as one single command: nothing before it and nothing after it, no `;`, `&&`, `|`, `2>&1`, `echo`, `cat`, `mkdir` or `cd`. Anything added makes the command refused. Every script prints its result and, as its last line, `exit: <code>`: read the exit code from that line (the `exit:` line). Read result files with the Read tool. If a command is refused, run it again exactly as written, with nothing added; if it is refused again, end this skill with `status: FAILED`, reason "permission refused".

**Scope of this version.** This process:
- changes ONE existing sheet per run: the sheet the master names;
- never changes plot documents, chronicle pages or other sheets;
- never creates a sheet. When the name matches no sheet, it asks one question (Step 2);
- completes only sheets of template `npc`, `vendor`, `enemy`, `creature` or `place`. Any other sheet is refused (Step 2);
- writes only through `yllir:write-sequence`;
- never writes a rules fact (statistics, prices, stock, loot) that no source gives.

**Questions to the master.** Ask the master in plain words, then stop. Write the question as your message; the process runner turns it into a QUESTION result. Every question ends with a question mark: a statement is not a question. Ask at most ONE question per message.

**Inputs.** MASTER_MESSAGE is the master's message, as given by the process runner. IMAGINATION is `yes` or `no`, as given by the process runner: `yes` means the master allowed invented details that no source gives (names, places, history, relations, rules), while contradictions with the canon are never allowed. If IMAGINATION is absent or has any other value, it is `no`. HANDOFF, when the runner gives one, is not used by this process: ignore it.

**Words for the master.** Use only the words of the lexicon (`yllir/skills/core/yllir/lexicon.md`): the sheet is «la scheda», the process is never named, the write sequence is never named, the reviewers are «un revisore» or «un assistente».

## Steps

**Step 1 — Settings.** Run these two steps in this order:
- Read `campaign.yaml` with the Read tool. Keep:
  - `language.main`: the CAMPAIGN LANGUAGE (for example `it` or `en`);
  - `system.adapter`: ADAPTER is `set` when the value is present and is not `none`; otherwise ADAPTER is `none`;
  - `prose.register`, `world` and `description`: keep each one as written. If one of them is not in `campaign.yaml`, keep the word `none` for it;
  - the `structure` entries: for each, its `id`, its `folder` and its `type`.
- Run this command:
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/build-index.mjs" . --out .campaign/cache/subjects.json`
  Exit code 2: stop with the fixed sentence of the lexicon for an operation that could not be completed, in the CAMPAIGN LANGUAGE.
- Read `.campaign/cache/subjects.json` with the Read tool. For each subject keep: `id`, `sheet` (the document path), `category` and the `text` of each of its `forms`.
- Output: CAMPAIGN LANGUAGE, ADAPTER, PROSE, WORLD, DESCRIPTION, the structure entries, and the list of subjects.

**Step 2 — Find the sheet.**
1. Normalize MASTER_MESSAGE and every form text: use lowercase, and replace each accented letter with its plain letter (à→a, è→e, é→e, ì→i, ò→o, ù→u).
2. A subject MATCHES when one of its forms, normalized, appears in the normalized MASTER_MESSAGE as whole words, in the same order. For each matching subject, keep the number of words of its longest matching form.
3. Keep only the matching subjects that have the largest number of words among all matches. This is why an exact full name wins over a shorter partial match.
   - If exactly one subject is kept: it is the SUBJECT. Go to point 4.
   - If no subject matches: the message to the master is the question «Non trovo una scheda con questo nome. Intendi un'altra scheda, con un nome diverso?» (English: «I cannot find a sheet with this name. Do you mean another sheet, with a different name?»). Stop.
   - If two or more subjects are kept: read the sheet of each kept subject with the Read tool and take its `#` title line. The message to the master is the question «Intendi <TITLE 1>, <TITLE 2> o <TITLE 3>?», naming at most three titles, in the order of `subjects.json`. Stop.
4. Read the whole SUBJECT sheet with the Read tool, master notes included. Keep:
   - SHEET_PATH: the `sheet` of the SUBJECT;
   - TITLE: the text of its `#` title line, without the `#`;
   - TEMPLATE: the value of `template` in its front matter. If the front matter has no `template` field: TEMPLATE is `place` when the `category` of the SUBJECT is the `id` of a `structure` entry whose `type` is `places`; otherwise TEMPLATE is `other`.
5. If TEMPLATE is not `npc`, `vendor`, `enemy`, `creature` or `place`: the message to the master is this one sentence, in the CAMPAIGN LANGUAGE: «Questo tipo di scheda non si può ancora completare: posso completare personaggi, creature e luoghi.» (English: «This kind of card cannot be completed yet: I can complete characters, creatures and places.»). Stop.
- Output: SHEET_PATH, TITLE, TEMPLATE, and the whole sheet text in your notes.

**Step 3 — Gaps and corrections.**
1. Run this command, with `<SHEET_PATH>` replaced by the value from Step 2:
   `node "${CLAUDE_PLUGIN_ROOT}/skills/library/npc-manager/scripts/npc-manager.mjs" . gaps --files "<SHEET_PATH>"`
   Exit code 2: stop with the fixed sentence of the lexicon for an operation that could not be completed.
   Otherwise keep each line that starts with `gap`: its code, its section key and its message. These are the GAPS.
2. Read MASTER_MESSAGE. A CORRECTION is a sentence in which the master states how the subject IS (for example «è una donna», «is left-handed», «ha un occhio solo»). A request («completa la scheda», «fix the sheet») is not a correction. Keep each correction as MASTER_FACT, copied in the master's own words. Also note in plain words which statement of the sheet it contradicts, if any.
3. If GAPS is empty and there is no MASTER_FACT: the sheet is already usable. The message to the master is two sentences in the CAMPAIGN LANGUAGE: «La scheda di <TITLE> è già utilizzabile.» and then ONE question: «Cosa manca, dal tuo punto di vista, alla scheda di <TITLE>?» (English: «The sheet of <TITLE> is already usable.» then «What is missing, in your view, from the sheet of <TITLE>?»). Stop.
- Output: GAPS (code, section key, message), MASTER_FACT list (may be empty).

Section keys used in this file, with their headings in the heading table of Step 7: `role`, `appearance`, `table`, `stock`, `haggling`, `exceptions`, `nature`, `statistics`, `loot`, `description` (place only).
- NARRATIVE sections: `role`, `appearance`, `table`, `nature`, `description`.
- RULES sections: `statistics` (enemy) and `stock` (vendor).
- OPTIONAL sections: `haggling`, `exceptions`, `loot`. A gap in an optional section is never filled, never written and never listed under To define. If the section exists with no text, leave it as it is.

**Step 4 — Narrative facts from the campaign.** Run this step only when GAPS has at least one NARRATIVE section. Otherwise output "no narrative gaps" and go to Step 5.
1. Invoke the skill `yllir:canon-research` with:
   - `QUESTION="What does the campaign establish about <TITLE>?"`
   - `TERMS=` the text of every form of the SUBJECT, separated by `;`
   - `CONTINUE_WITH="complete-sheet step 4: read the report, then step 5"`
   If your tool has no way to invoke a skill, read `${CLAUDE_PLUGIN_ROOT}/skills/library/canon-research/SKILL.md` with the Read tool and follow it exactly as if it had been invoked, with the same inputs.
2. Read `.campaign/state/research/report.txt` with the Read tool. If the file does not exist, treat the report as FAILED.
3. If the report `status:` is FAILED, or its `not read:` line lists any file, set RESEARCH_INCOMPLETE = yes. Continue. Do not say this to the master.
4. Use ONLY the lines under `claims:` that start with `- fact:`. Each of them is an ESTABLISHED fact. Never use: a line that starts with `- hypothesis:`; a line under `unverified leads`; any interpretation; any claim of a character (a sentence that says what a character says, thinks or believes); anything the report lists as unknown.
5. If the report says `contains master-only content: yes`: for each ESTABLISHED fact whose evidence (the text in brackets, with the file and the line) is in a file other than SHEET_PATH, read that file with the Read tool at that line (offset and limit). If that line lies between `<!-- master -->` and `<!-- /master -->`, drop the fact. Never use text of master-only notes of another document in a public section.
6. Assign each remaining ESTABLISHED fact to the one NARRATIVE gap section it describes. A fact that fits no gap section is not written.
- Output: ESTABLISHED facts per section (may be empty for each), RESEARCH_INCOMPLETE (yes or no).

**Step 5 — Rules facts (statistics and stock).** Run this step only when TEMPLATE is `enemy` and the `statistics` section is a gap, or when TEMPLATE is `vendor` and the `stock` section is a gap. Otherwise output "no rules gap" and go to Step 6. Rules are never written from memory and never invented, except as follows.
0. If MASTER_MESSAGE explicitly authorizes you to invent or choose the statistics or stock yourself (for example «inventale tu», «scegli tu le statistiche», «puoi inventarle», «make them up»), this is a master-given authorization, and it overrides the rule above: do not search the sources and do not ask any question. Draft a complete, plausible RULES_BLOCK yourself using the campaign's statistics tables below; retain the system's field labels where ADAPTER is `set`. Write it in the sheet, and mention in the message to the master that the statistics (or the stock and prices) are invented and can be changed. This RULES_BLOCK is treated as any other RULES_BLOCK in Step 7 and Step 9. Then go to the Output of this step.
0b. If IMAGINATION is `yes` (and the message of point 0 does not apply): sources and the master's own block come first. Follow points 1 to 4 below. Wherever they would leave the section `Da definire.` or set QUESTION_RULES (no block in the message, ADAPTER `none`, research not DONE, or no block in the sources), do not leave it and do not ask: draft the RULES_BLOCK yourself as point 0 says, and mention in the message to the master that it is invented. A block that a source or the message gives always wins over an invented one.
1. If MASTER_MESSAGE contains a block of statistics (enemy) or of stock items with prices (vendor): keep its values and punctuation exactly in RULES_BLOCK; Step 7 formats statistics into the required tables. Then go to the Output of this step. Do not search the sources.
2. Otherwise, if ADAPTER is `none`: the section stays `Da definire.` (English `To be defined.`). Add the section to TO_DEFINE. No question is asked. Go to the Output of this step.
3. Otherwise (ADAPTER is `set`): invoke the skill `yllir:canon-research` with:
   - `QUESTION="What are the statistics of <TITLE> in the rules sources?"` for an enemy, or `QUESTION="What are the stock and prices of <TITLE> in the rules sources?"` for a vendor;
   - `TERMS=` the text of every form of the SUBJECT, separated by `;`;
   - `CONTINUE_WITH="complete-sheet step 5: read the report, then step 6"`
   If your tool has no way to invoke a skill, read `${CLAUDE_PLUGIN_ROOT}/skills/library/canon-research/SKILL.md` with the Read tool and follow it exactly as if it had been invoked, with the same inputs.
4. Read `.campaign/state/research/report.txt` with the Read tool.
   - If the report `status:` is not DONE (or the file is missing): the section stays `Da definire.`, is added to TO_DEFINE, and no question is asked. Go to the Output of this step.
   - If the report `status:` is DONE: accept ONLY a block that the report quotes from a source document in the external folders or the sources folder (the web is never a source). Copy that block exactly as the report gives it, into RULES_BLOCK. If the report gives no such block: the section stays `Da definire.`, is added to TO_DEFINE, and QUESTION_RULES is set to exactly one of these, in the CAMPAIGN LANGUAGE:
     - enemy, Italian: «<TITLE> non ha statistiche nelle fonti: me le dai tu, o le lasciamo da definire?»
     - vendor, Italian: «<TITLE> non ha assortimento e prezzi nelle fonti: me li dai tu, o li lasciamo da definire?»
     - enemy, English: «<TITLE> has no statistics in the sources: do you give them to me, or do we leave them to be defined?»
     - vendor, English: «<TITLE> has no stock and prices in the sources: do you give them to me, or do we leave them to be defined?»
- Output: RULES_BLOCK (or none), QUESTION_RULES (or none), TO_DEFINE additions (may be empty).

**Step 6 — Creative choices.**
1. If IMAGINATION is `no`: do not write any proposal. For each NARRATIVE gap still EMPTY after Step 4 (no established fact fills it), the section keeps `Da definire.` (English `To be defined.`) and its section key is added to TO_DEFINE. PROPOSALS is empty and PROPOSED is empty. The question rule at the end of this step still applies.
2. If IMAGINATION is `yes`: for each NARRATIVE gap still EMPTY after Step 4 (no established fact fills it), write a PROPOSAL. The master asked for the sheet to be completed, so a short proposal is allowed. The rules below apply to these proposals.
- Each proposal is 1 to 3 short sentences, in the register of PROSE, coherent with WORLD, DESCRIPTION and the ESTABLISHED facts of Step 4. If PROSE is `none`, write plain and neutral sentences.
- `appearance` is ONE italic paragraph, written as `_..._`.
- `description` of a place is an italic opening paragraph of 1 or 2 sentences; plain sentences may follow, at most 2.
- STILL FORBIDDEN, always: secrets; a past event; a relative or any relation to another named character; what the character does in a session or event; any master-only content; any invented statistic, price, stock item or loot entry; a new named character or a new named place.
- With IMAGINATION `yes`, the STILL FORBIDDEN line above does not apply. These limits still apply instead:
  - no contradiction with the ESTABLISHED facts of Step 4, nor with the rest of the campaign;
  - a secret goes ONLY into the master-only block (`<!-- master -->` ... `<!-- /master -->`), never into a public section;
  - anything invented is never written as a quote of a source, and never gets a source reference.
  With IMAGINATION `yes` the proposals may also name new characters or places, past events and relations between characters. A proposal may be longer than 3 sentences when the template section needs it, but at most 5 short sentences per section.
- With IMAGINATION `yes`, every NARRATIVE gap that is still empty after Step 4 gets a proposal. A section keeps `Da definire.` only when it cannot be filled at all.
- PROPOSED is the list of the sections filled by a proposal (`role`, `appearance`, `table`, `nature`, `description`).
- Ask the master a question ONLY when a gap cannot be filled without a creative decision that changes who the subject is. Example: two ESTABLISHED facts contradict each other, and the master asked to fix the sheet. Then QUESTION_CREATIVE is the question «Quale delle due è giusta: <FACT 1> o <FACT 2>?», written in the CAMPAIGN LANGUAGE, with the two facts in plain words. Never choose between them. Then go to Step 9 and send only that question.
- Never ask about something that a source or a proposal can fill.
- Output: PROPOSALS (section and text), PROPOSED, QUESTION_CREATIVE (or none).

**Step 7 — Draft.**
If QUESTION_CREATIVE is set: do not write any draft. Go to Step 9 and send only that question.

1. Read the SHEET_PATH sheet again with the Read tool, so that every kept text is copied exactly.
2. Write the WHOLE sheet to `.campaign/state/write/draft/<SHEET_PATH>` with the Write tool. If that draft file already exists (a second round), Read it with the Read tool before writing it. The rules are:
   - The front matter is kept byte for byte: every line, in the same order, with the same values (id, template, location, aliases and every other field).
   - The `# title` line and the image line (if any) are kept exactly.
   - Every section that already has real text is kept exactly as it is. The only exception: a MASTER_FACT changes ONLY the statement it corrects, and it is written in the master's own words.
   - A GAP section (empty, or with only `Da definire.` or `To be defined.`, or missing) gets, in this order of preference:
     1. the ESTABLISHED facts of Step 4 that describe it;
     2. the PROPOSAL of Step 6, only if one exists (with IMAGINATION `no` none exists) and the section still has no text;
     3. for `statistics` and `stock`: the values from RULES_BLOCK of Step 5, with statistics rendered in the required tables, or the sentence `Da definire.` (English `To be defined.`) when there is no RULES_BLOCK;
     4. any other gap section that still has no text: the sentence `Da definire.` (English `To be defined.`), and its section key is added to TO_DEFINE.
   - A missing section is added in the order of the heading table below.
   - The master block (`<!-- master -->` ... `<!-- /master -->`) is kept byte for byte, stays the LAST part of the sheet, and is never added to and never moved.
   - `## Da definire` (`## To define` in English): remove the list items of every section that is now filled; add the items of TO_DEFINE; remove the whole section if nothing remains; if something remains, keep it as the LAST section before the master block, with one list item per missing section, for example `- statistics`.
   - A PROPOSAL is never listed under `## Da definire`.
   - The words proposal, suggested and proposta (and their translations) never appear in the sheet.
   - A place keeps its `## Descrizione` section with an italic opening paragraph.
   - With IMAGINATION `yes`, for an enemy or vendor the rules block must be PLAYABLE, not only contain required fields: an enemy needs at least armor class, hit points, speed, ability scores, one attack or action with its bonus and damage, and equipment if the system has that notion; a vendor needs plausible stock with prices. Check arithmetic where applicable. With IMAGINATION `no`, preserve every value exactly as the source or master gives it: add no statistic, item or price, and check only the arithmetic of what it states.
   - Render statistics using localized `###` subsections and two-column tables. Italian headings and headers: `### Caratteristiche` with `| Caratteristica | Valore |`; `### Attacchi e capacità` with `| Attacco o capacità | Dettagli |`; `### Equipaggiamento` with `| Oggetto | Dettagli |`. English: `### Characteristics` with `| Characteristic | Value |`; `### Attacks and abilities` with `| Attack or ability | Details |`; `### Equipment` with `| Item | Details |`. Use only groups supported by facts, preserving each value and its punctuation exactly; escape literal pipes as `\\|`. A non-empty block uses at least one of these tables. After writing the draft, read it back and verify every table header, row and value.

   Heading table, with the sections of each template (the `it` heading for an Italian campaign, the `en` heading for an English one, and the translation for any other language):

   | Key | it | en | Used by |
   |---|---|---|---|
   | role | `## Ruolo` | `## Role` | npc, vendor |
   | appearance | `## Aspetto e modi` | `## Appearance and manner` | npc, vendor |
   | table | `## Al tavolo` | `## At the table` | npc, vendor |
   | stock | `## Assortimento` | `## Stock` | vendor |
   | haggling | `## Trattare` | `## Haggling` | vendor, optional |
   | exceptions | `## Deroghe` | `## Exceptions` | vendor, optional |
   | nature | `## Natura` | `## Nature` | enemy, creature |
   | statistics | `## Statistiche` | `## Statistics` | enemy, creature; optional for npc and vendor |
   | loot | `## Bottino` | `## Loot` | enemy, creature, optional |
   | description | `## Descrizione` | `## Description` | place |
   | todefine | `## Da definire` | `## To define` | all, last before the master block |

   Order of the sections for each template: npc: role, appearance, table, optional statistics. vendor: role, appearance, table, optional statistics, stock, haggling, exceptions. enemy: nature, statistics, loot. creature: nature, statistics, loot. place: description. Then `## Da definire` (if any), then the master block.

3. Read the draft back with the Read tool and check each point. Every point must be true:
   - the front matter is identical to the front matter of the sheet;
   - the `# title` line and the image line are identical to the sheet;
   - the sections are in the order of the list above, with no section left empty unless it holds `Da definire.` (or `To be defined.`) and is listed under `## Da definire`;
   - the master block is identical to the sheet's master block and is the last part of the file;
   - the words proposal, suggested and proposta do not appear;
   - a place's `## Descrizione` opens with an italic paragraph;
   - statistics use localized `###` subsections and the specified two-column tables, with values preserved exactly; a statistic block of an enemy has right arithmetic (point 2) and, with IMAGINATION `yes` only, is playable. A creature's statistics section is exactly `Nessuna statistica: non combatte.` (`en`: `No statistics: it does not fight.`).
   If a point fails: fix the draft with the Write tool (Read it first), and read it back again.
4. Run this command, with `<SHEET_PATH>` replaced by the value from Step 2:
   `node "${CLAUDE_PLUGIN_ROOT}/skills/library/npc-manager/scripts/npc-manager.mjs" . gaps --files "<SHEET_PATH>" --base .campaign/state/write/draft`
   Exit code 2: stop with the fixed sentence of the lexicon for an operation that could not be completed.
   Keep each `gap` line as STILL_OPEN. A STILL_OPEN gap whose section holds `Da definire.` and is listed under `## Da definire` is expected: it stays STILL_OPEN and is not a failure. Any other STILL_OPEN gap is a failure: fix the draft as in point 3 and run this command again.
5. The draft may be fixed at most TWO times in this step, in total (points 3 and 4 together). After the second fix, keep what remains as STILL_OPEN and continue.
- Output: the draft exists at its path; STILL_OPEN (may be empty).

**Step 8 — Write sequence.** Invoke the skill `yllir:write-sequence` with:
- `DOCUMENTS=<SHEET_PATH>`
- `INTENT="Completes or corrects the sheet of <TITLE>: adds only facts the campaign establishes, the master's own words, or short creative proposals (with IMAGINATION `no`, leave out the words «or short creative proposals»); changes no existing identity fact except where the master corrects it; no secrets; no statistics, prices or stock that no source gives."`
- When IMAGINATION is `yes`: add to the end of INTENT, after one space, exactly this sentence: `The master allowed invented details: new names, places, history, relations and rules that no source gives are allowed; contradictions with the canon are not.`
- `NEW_SUBJECTS=` (empty)
- `VERSION_MESSAGE=` «Scheda di <TITLE> completata» for `it`, «Sheet of <TITLE> completed» for `en`, or the translation for another language. Use «Scheda di <TITLE> corretta» (`it`), «Sheet of <TITLE> corrected» (`en`), or the translation, only when no gap section was filled and the only change is a MASTER_FACT correction.
- `ROUND=1`
- `CONTINUE_WITH="complete-sheet step 8: read the write report and act on its status"`

If your tool has no way to invoke a skill, read `${CLAUDE_PLUGIN_ROOT}/skills/core/write-sequence/SKILL.md` with the Read tool and follow it exactly as if it had been invoked, with the same inputs.

After it finishes, read `.campaign/state/write/report.txt` with the Read tool. The report is for you: never show it and never quote it.

Then decide, with the `status:` line of the report:
- If a line under `details:` is a link to a document that is not allowed (a link to a master-only file): do not try to fix it. Say the fixed sentence of the lexicon for an operation that could not be completed, and stop.
- `FIX_NEEDED` or `VERIFY_FAILED`: if ROUND is 3, say the fixed sentence of the lexicon for an operation that could not be completed, and stop. Otherwise, for each line under `details:`, fix exactly that problem in the draft (Read the draft first, then Write it). If a problem is a fact that the master did not say, remove that fact. Then invoke `yllir:write-sequence` again with the same inputs and `ROUND` plus one. Do not stop after the first fix: each fix is followed by a new invocation.
- `ASK` or `CONFLICT`: the question is in the `details:` lines. Ask the master that question in plain words, in the CAMPAIGN LANGUAGE, and stop.
- `DONE`: go to Step 9.
- `FAILED`, or any other status: say the fixed sentence of the lexicon for an operation that could not be completed, and stop.

A small change to one sheet is one write-sequence round. Do not invoke write-sequence again to add something you forgot: complete the draft fully at Step 7 first.

Do not mention rounds, statuses, problems, paths or reports to the master.

**Step 9 — Message for the master.** Write ONE message in the CAMPAIGN LANGUAGE, in plain words. Use the section names of the lexicon, in plain words: `role` is «il ruolo» (`en` «the role»), `appearance` is «aspetto e modi» (`en` «appearance and manner»), `table` is «il modo di parlare e cosa vuole» (`en` «how they speak and what they want»), `nature` is «la natura» (`en` «the nature»), `description` is «la descrizione» (`en` «the description»), `statistics` is «le statistiche» (`en` «the statistics»), `stock` is «l'assortimento e i prezzi» (`en` «the stock and prices»), `loot` is «il bottino» (`en` «the loot»).

If QUESTION_CREATIVE is set: the message is only that question. Stop.

Otherwise the message is, in this order:
- (a) one sentence saying what is now in the sheet, naming the sections in plain words, for example «Ho completato la scheda di <TITLE>: ora ha <sections>.» (or «Ho corretto la scheda di <TITLE>: ...» when the change is a correction only);
- (b) one sentence naming what comes from the campaign and what is a creative proposal the master can change. Only when PROPOSED is not empty. When PROPOSED is empty, omit this sentence. With IMAGINATION `yes`, when a proposal invents a name (a character, a place, a relation or a past event), this same sentence also says in plain words, by name, what was invented, so the master can change it; when nothing was invented, it is written as before;
- (b2) only when the statistics (or the stock and prices) were invented under the master's authorization of Step 5, point 0: one sentence saying that they were invented at the master's request and can be changed. When that does not apply, omit this sentence;
- (c) only when STILL_OPEN has a gap that is a rules or other section: one sentence saying clearly that the sheet is still «da completare» (`en`: «still to be completed») and naming what is missing in plain words. If the gap is a narrative section left as `Da definire.` (always the case with IMAGINATION `no`), the sentence also says that the master can ask the assistant to invent it, and no question is added. Then:
  - if QUESTION_RULES is set: that question is the LAST sentence of the message, exactly as set in Step 5;
  - otherwise: one sentence with the one next step the master can take, for example «Dammi le statistiche, se le hai.». For a narrative section left as `Da definire.` with IMAGINATION `no`, the next step is «Se vuoi, chiedimi di inventarne il contenuto.»;
- (d) nothing else.

Never mention older saved versions, ambiguous links, consistency checks that found nothing, other documents, maintenance, research that was incomplete, or a list of what the assistant can do. Never quote master notes. No paths, no ids, no section keys, no backticks, no formatting marks.

If the whole process took a long time (the master waited many minutes), the closing message includes no apology, but never claims it was quick.

## Examples

Correct (IMAGINATION `yes`): the master writes «La guardia comune ha una scheda praticamente vuota». The process finds the sheet of «La guardia comune» (the longest match), finds gaps in role, appearance and table, and `yllir:canon-research` gives one fact: the guard stands at the gate of the harbour. The sheet is completed with that fact, plus two short proposals for appearance and manner. The message says what was added, that appearance and manner are proposals the master can change, and nothing more. The message is: «Ho completato la scheda della guardia comune: ora ha il ruolo, con il suo posto al cancello del porto, e l'aspetto e il modo di parlare. Il ruolo viene dalla campagna; aspetto e modo di parlare sono proposte che puoi cambiare.»

Correct: an enemy with `system.adapter` set (ADAPTER is `set`), and no statistics found in the sources. The narrative part (nature) is completed from the campaign and one proposal. The `statistics` section stays `Da definire.`, is listed under To define, and QUESTION_RULES is set. The message is: «Ho completato la parte di racconto della scheda del Guardiano di sale. La scheda è ancora da completare: mancano le statistiche. Me le dai tu, o le lasciamo da definire?»

Correct: a master message «Ilde è una donna, sistema la sua scheda». The MASTER_FACT is «è una donna», kept in the master's words. The sentence in the sheet that says otherwise is changed to the master's statement. Nothing else in the sheet changes.

Correct (IMAGINATION `no`): the master writes «completa la scheda della guardia comune». The campaign gives the role (the guard stands at the gate of the harbour), so the role is written from that fact. No source gives the appearance or the manner, and no proposal is written: those sections keep «Da definire.» and are listed under To define. The message says what was added, names in plain words what is still missing, and says that the master can ask the assistant to invent it. The message is: «Ho completato la scheda della guardia comune: ora ha il ruolo, con il suo posto al cancello del porto. Mancano l'aspetto e il modo di parlare: se vuoi, chiedimi di inventarli.»

Correct (IMAGINATION `yes`): the master writes «completa la scheda della guardia comune». No source gives the role, the appearance or the manner, and no ESTABLISHED fact fills them. The process writes short proposals in the register of the campaign. The role proposal names a new character, the sergeant Orso Dalla, who gives the guard orders, and no secret appears in any public section. The message says, in one plain sentence, that the sergeant's name is invented and can be changed, next to the sentence about the proposals.

Wrong: answering with a list of the assistant's features.

Wrong: answering that the operation is not available, when the sheet is a character, a creature or a place.

Wrong: changing the sheet without the write sequence (no Write to the campaign file, only to the draft).

Wrong: writing statistics from memory for a known game, or a price for a vendor item that no source gives.

Wrong: turning a character's hypothesis into a fact. A line that says «X dice che il capitano è suo padre» is a claim of a character, not an ESTABLISHED fact.

Wrong: adding a secret as a proposal, for example «in realtà lavora per il barone». Secrets are never proposed when IMAGINATION is `no`.

Wrong (IMAGINATION `no`): the process writes a short proposal for appearance or manner, or names a sergeant to fill the role. Forbidden: with IMAGINATION `no` there are no proposals at all, and every empty narrative section keeps «Da definire.».

Wrong: IMAGINATION is `yes`, and the proposal for `## Aspetto e modi` writes the invented secret «in realtà lavora per il barone» in that public section. An invented secret goes ONLY into the master-only block, never into a public section, even with IMAGINATION `yes`.

Wrong: mentioning older versions, ambiguous links or consistency checks in the message to the master.

Wrong: creating a sheet for a name that has none. This process never creates a sheet: it asks one question.

## Exit

Your last message to the process runner states the result in one line: `status: DONE`, `status: ASK` (with the question), `status: STOP` (with the reason in one plain line) or `status: FAILED`. Then, in the same turn, do nothing else.
