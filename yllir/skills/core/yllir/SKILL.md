---
name: yllir
description: Entry point of Yllir. Invoke it first for every message of the master in a Yllir campaign folder or in an empty folder: it recognises what the master wants and runs the right process.
user-invocable: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/scripts/generate-instructions.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/check-links.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/scripts/topics.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/scripts/runner-result.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/update/scripts/update-campaign.mjs" *), Bash(claude plugin update *), Bash(codex plugin marketplace upgrade *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/canon-research/scripts/research-search.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/canon-research/scripts/research-report.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/plan-links.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/apply-links.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/linker-report.mjs" *), Read, Write, Agent, AskUserQuestion
---

# Yllir entry point

This skill receives every message of the master. It checks the folder, keeps the master's words, and runs exactly one process. Writing processes run in a sub-agent (`yllir:process-runner`) (the instructions of this sub-agent are in `${CLAUDE_PLUGIN_ROOT}/agents/process-runner.md`; if your tool has no named agents, start a sub-agent, tell it to read that file first and follow it exactly; in Codex, always start the sub-agent with the model Luna, because Codex gives a sub-agent the model of the main agent unless you name one), never in this skill. Run every command from the campaign root (the folder the master opened). Never run a command from another folder.

**Commands.** Run each command exactly as written in this file, as one single command: nothing before it and nothing after it, no `;`, `&&`, `|`, `2>&1`, `echo`, `cat`, `mkdir` or `cd`. Anything added makes the command refused. Every script prints its result and, as its last line, `exit: <code>`: read the exit code from that line (the `exit:` line). Read result files with the Read tool. If a command is refused, run it again exactly as written, with nothing added; if it is refused again, end this skill with `status: FAILED`, reason "permission refused".

## Steps

**Step 1 — Check.** Find the block that starts with `YLLIR SESSION CHECK` in your context. Keep its values: `folder`, `git`, `campaign root`, `saved versions`, `changes not yet saved`, `settings`, `instructions`, `framework version` (with its «campaign made with» part, when there is one), `campaign alignment` (when that line is in the block), `update notice` (the block `YLLIR UPDATE AVAILABLE`, when it is in your context).
- If the block is not in your context: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" .` and keep its output the same way.
- Output: the values of the block, kept for the next steps.

**Step 2 — Lexicon.** Read `${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/lexicon.md` and read the table.
- From now on, every sentence to the master uses only the words of the lexicon, in the campaign language. The campaign language is `language.main` in `campaign.yaml`. In an empty folder, it is the language the master writes in.
- Output: the lexicon in your context.

**Step 3 — Folder.** Use the `folder` value from Step 1.
- `git: missing`: say in one sentence that the campaign needs a free program called Git to keep its saved versions, and that you will guide the installation if the master wants. Write nothing. Stop.
- `folder: empty`: run the writing process `yllir:new-campaign` as described in Step 6 (TOPIC `none`, HANDOFF `none`). Stop.
- `folder: unfinished` (a campaign was started before and not finished): run `yllir:new-campaign` the same way as for `folder: empty`, and add the line `RESUME: yes` to the runner prompt, after `LANGUAGE:`. Tell the master nothing technical about the earlier attempt: the process gives the master its message. Stop.
- `folder: other`: say in plain words that to bring notes into the campaign, the campaign must exist first. Then ask the one question: should a new campaign be created in an empty folder, so that the material can be brought in right after? Write nothing. Stop.
- `folder: campaign`: continue to Step 4.
- Output: one of the four branches above, with its message.

**Step 4 — Health (campaign only, silent fixes first).**
- **Campaign alignment** (silent). If the block has a line `campaign alignment: needed`: read `${CLAUDE_PLUGIN_ROOT}/skills/core/update/SKILL.md` and follow its Part A exactly, instead of the `instructions` fix below.
- `instructions: missing` or `instructions: changed by hand`, and the block has no `campaign alignment: needed` line: run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/scripts/generate-instructions.mjs" .`. If the value said `changed by hand`, tell the master in one sentence that a file managed by the assistant was restored, and that their own rules belong in «Your rules».
- `settings: problems: …`: say the fixed sentence of the lexicon for a campaign settings problem, and offer to fix it. Write no campaign content until it is fixed.
- Output: the campaign is aligned (updated, or already up to date), the instructions are up to date, and the settings are valid or the master has been told about the problems.

**Step 5 — Where we left off.** Only if this is the first message of the conversation: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" list . --limit 3`. Tell the master in at most three short lines what the last saved versions were, using their sentences and dates. If the list is empty, say that nothing has been saved yet. Then handle the message (Step 6).
- Output: at most three lines to the master, or nothing when this is not the first message.

**Step 5b — Unlinked mentions (campaign only, every message).** Read the line that starts with `unlinked mentions:` in the block `YLLIR TURN CHECK` in your context. If the block or that line is missing, or the line is `unlinked mentions: none` or `unlinked mentions: unknown`, do nothing here and go to Step 6.

Otherwise, a campaign file was changed outside the write sequence (by hand, by a linked ingest document, or by a migration), and its mentions are not linked yet. Do this:
- (a) Take the file list: the text after `files: ` on that line, without `, and <k> more` at its end if it is there. Keep the names exactly as written and in the same order, joined with commas and no spaces. Call it FILES. SUBJECTS is empty.
- (b) Attempt limit. Read `.campaign/state/linker/attempts.txt` with the Read tool. If the file does not exist, there are no attempts. Each of its lines has the form `<FILES>|<n>`. Find the line whose text before the first `|` is exactly FILES, with the same spelling and order. Its n is the number after the `|`; if there is no such line, n is 0.
  - If n is 3 or more, do nothing in this step: go to Step 6 with the master's message. The master is not told about the linking.
  - Otherwise, before running the linker, write the whole file with the Write tool: keep every other line exactly as it is, and write the line for FILES with n+1 (add it as a new line if it was missing).
- (c) Read `${CLAUDE_PLUGIN_ROOT}/skills/library/linker/SKILL.md` and follow it exactly, with FILES from (a), SUBJECTS empty, and CONTINUE_WITH = "yllir: answer the master". Run it in this skill, not in `yllir:process-runner`. Its result is the file `.campaign/state/linker/report.txt`.
- (d) Read `.campaign/state/linker/report.txt` with the Read tool. If it has lines under `decisions for the master:`, say one plain sentence to the master in the campaign language: some mentions could not be linked on their own and wait for the master's choice. Never name files, never show the report, and say nothing else about the linking, even when it failed.
- (e) If the report's status is `DONE`, write the whole attempts file again with the Write tool, with the line for FILES removed and every other line kept. If the status is anything else, or the report is missing, leave the file as it is.
- (f) If the line ends with `, and <k> more`, the rest is handled at the next message: this step runs again then, because the turn check lists the remaining files again. Do not repeat it in this message.
- Then, in the same turn, go on to Step 6 with the master's message. This is what the report's `continue with` line means here.

**Step 6 — Recognise the request** by its meaning, not by keywords. First check Step 7: if the master's message answers the update question, follow Step 7 and skip this step. Otherwise do exactly one of the following.

- **Writing process** (create a campaign in an empty folder; give more setup information to a campaign, see (b); prepare a session; change scenes of a session already prepared but not yet played; record the evening that was played; bring in existing material). Changing scenes of a prepared session («cambia il debito dei minatori», «aggiorna le prossime scene») is a request for prepare-session in revise mode, see (b) and (a) below. Bringing in material is recognised by meaning: the master shares photos, scans, PDFs or documents, or says they have existing notes, pages or sheets to bring in or digitise. When files are shared, this is the AUTORUN: start `import` without asking. This entry skill never runs these processes itself. Telling what happened at the table («abbiamo finito», «ieri i giocatori…») is recording the evening; asking for the next session is preparing one. If both are plausible, ask one question. It delegates them:
  - (a) Choose the topic (campaign folder only). Read the block `YLLIR TURN CHECK` in your context.
    - Same topic as the active one, including an answer to its pending question: reuse it. For `import`, an answer to the question of an open import topic reuses that topic.
    - A different writing request: run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/scripts/topics.mjs" new . --process <p> --goal "<English one-sentence goal>"`. `<p>` is the process name WITHOUT the `yllir:` prefix: `new-campaign`, `prepare-session`, `after-session` or `import` (never `yllir:prepare-session`). Keep the `id` and `path` of its JSON result. Changing scenes of a session already prepared is a different writing request too: use `prepare-session` and a goal such as "Revise scenes of session 2".
    - A return to an earlier open topic: run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/scripts/topics.mjs" activate . --id <id>`. If the return is ambiguous, ask the master one question that shows at most three open topics by their goal, in plain words.
    - Quick questions do not change the topic.
    - In an empty folder there are no topics yet: use `TOPIC: none` and `HANDOFF: none`.
    - `yllir:new-campaign` in complete mode (see (b)) uses `TOPIC: none` and `HANDOFF: none`: it is never a topic of its own.
  - (b) Before launching the runner, if TOPIC is not `none`, run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/scripts/topics.mjs" check . --id <id>` and use its `changed` list as CHANGED_FILES (`none` when the list is empty). Then launch the sub-agent `yllir:process-runner` in the foreground and wait for its result in the same turn (never with run_in_background). Never tell the master that you will write later or that work continues in the background: your message is the runner's message for the master, after it has finished. Use exactly these keys, filled in:
    ```text
    CAMPAIGN_ROOT: <absolute path of the campaign root>
    PROCESS: <one of yllir:new-campaign, yllir:prepare-session, yllir:after-session or yllir:import>
    TOPIC: <topic id, or none>
    HANDOFF: <absolute path of the handoff file, or none>
    CHANGED_FILES: <comma-separated campaign-relative paths from the topic check, or none>
    LANGUAGE: <ISO code of the language the master writes in>
    MASTER_MESSAGE:
    <the master's message, verbatim; when the master answers a question of the runner, the earlier question followed by the answer>
    ```
    The line `MODE: revise` is optional: add it right after the `LANGUAGE:` line only when the master asks to change scenes of a session already prepared (process `prepare-session`). Otherwise leave it out, which means a new session (`MODE: new` is the same).
    The line `MODE: complete` is also optional, right after the `LANGUAGE:` line, and is used only with PROCESS `yllir:new-campaign`: when the folder is a campaign and the master gives more setup information after the campaign was created, or in a first message after its creation. The setup information is the game system or edition, a folder of shared world material (a source from another campaign), the tone, or more details about the world and the story. Such information is never ignored and never answered with «not available»: launch the runner with `MODE: complete`, `TOPIC: none`, `HANDOFF: none`, `CHANGED_FILES: none`, and the master's message verbatim.
  - (c) Run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/scripts/runner-result.mjs" . --file .campaign/state/runner/result.txt --topic <TOPIC or none>`. The script checks the runner's result file, applies the topic change (question or finish) and prints its output. Its output after `message for the master:` is the message, followed by zero or more `ask:` lines (each `ask: <header> | <question> | <options>`), and ends with the line `exit: 0`, which is never sent.
    - Exit 0, without `ask:` lines: send the master exactly the lines after `message for the master:` in its output, and nothing else. Do not add a summary, a status or a file path.
    - Exit 0, with `ask:` lines: do NOT send the message as text. Call the interactive question tool AskUserQuestion once, with one question per `ask:` line: question = the question text, header = the header, options = the options (label = the option text; description = the same option text again, as a short sentence), multiSelect false. The master can also type an answer of their own. The master's answers come back as the master's next message: treat them as an answer to the runner's pending question, and continue from Step 6 (a), building MASTER_MESSAGE as the earlier question followed by the answers, as described in (b). Add nothing else to the question tool's texts.
    - Exit 0, with `ask:` lines, and the question tool is not available or fails: send the master exactly the lines after `message for the master:`, as text, and nothing else.
    - Exit 1: launch `yllir:process-runner` once more with the same prompt as in (b), plus a line `PROBLEMS:` followed by the `- ` lines the command printed, one per line. Then run the same command again. If it exits 1 a second time, say the fixed sentence of the lexicon for an operation that could not be completed.
  - (d) If the runner's final answer is not `result written`, do not send anything: run the command in (c) anyway. A missing or invalid file is a problem for that command, and (c) handles it.

- **Go back** (for example «torna a com'era», «annulla l'ultima modifica»):
  - (a) Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" list . --limit 10`.
  - (b) Pick the target. «Undo the last change» means the version just before the newest one. A date or a description means the matching version. If two versions are plausible, ask one question and show at most three of them as numbered sentences with dates.
  - (c) Ask one confirmation question: which version you will go back to, and that the later versions stay in the history and can be recovered. If the master's message already contains a clear confirmation (for example «procedi», «confermo», «sì, fallo») and the target from (b) is unambiguous, skip this question and go to (d); in your final message name the version you went back to. Keep the question when the target is ambiguous.
  - (d) After a «yes»: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" status .`. If `clean` is false, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" save-manual . --message "<sentence in the campaign language: Changes made by hand before going back>"`.
  - (e) Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" restore . --to <hash> --message "<sentence in the campaign language: Went back to the version «…»>"`. Add `--paths "<campaign-relative path>"` only if the master named one document. Read the JSON result.
  - (f) Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/check-links.mjs" .`. If the exit code is 1, say the fixed sentence of the lexicon for a problem with a link.
  - (g) Tell the master in one sentence what is now as it was, and how to undo this too («go back» again, to the version just saved).

- **Question about the campaign** (for example «chi è…», «dove si trova…»). The answer itself writes nothing; the only change that can come before it in the same turn is the linking of Step 5b, which has already run and which the master is not told about.
  - (a) Read `${CLAUDE_PLUGIN_ROOT}/skills/library/canon-research/SKILL.md` and follow it exactly, with QUESTION = the master's question verbatim, TERMS empty, CONTINUE_WITH = "step b of the question bullet of the entry skill". Run it in this skill, not in `yllir:process-runner`.
  - (b) Read `.campaign/state/research/report.txt` with the Read tool. If it does not exist or its `status:` is `FAILED`, say the fixed sentence of the lexicon for an operation that could not be finished, as it is written there, in the campaign language, and stop this bullet here.
  - (c) Answer the master in plain words, from the report only: the direct answer first, then what it rests on, named by the document titles (never file paths). Say clearly when something is a hypothesis, something a character says, or something the documents do not say. If the report lists homonyms, say which people have the same name and answer for each. If the report has a `not read` list other than `none`, or lists problems, say that the check may be incomplete. Never state as fact a claim the report marks as hypothesis, interpretation or source-claim. Never show the words of the report layout, file paths or status names.

- **Anything else** (change or create documents other than through these processes, tidy up): say in one or two plain sentences that this part is not available in this version yet. Then list what is available now: create a campaign, give a campaign more setup information (system, tone, shared world material, world and story), prepare the next session, modify a session already prepared but not yet played, record the evening, bring in existing notes, photos or documents, go back to a saved version, and questions about the campaign.

**Step 7 — Update notice.** If your context has a block that starts with `YLLIR UPDATE AVAILABLE`, or your previous message to the master asked whether to update, read `${CLAUDE_PLUGIN_ROOT}/skills/core/update/SKILL.md` and follow its Part B. The master decides: never update without a clear «yes».

**Step 8 — Rules.** These apply to every step above.
- Never write or change a campaign document yourself. Every write goes through `yllir:write-sequence`, run by a process. The one exception is Step 5b: the linker, run by this skill as Step 5b says, adds links to campaign documents, and it is the only script-driven writer of links; nothing else in this skill changes a campaign document. The files this skill writes are `.campaign/state/research/answer.json`, only while following canon-research, and, only in Step 5b, the file `.campaign/state/linker/attempts.txt` and the linker's own files in `.campaign/state/linker/`.
- Never run a writing process (`yllir:new-campaign`, `yllir:prepare-session`, `yllir:after-session`, `yllir:import`) in this skill: launch `yllir:process-runner` instead.
- Never show internal words, commands, file formats or error codes to the master.
- Write to the master in plain text: no backticks, no code formatting, no file paths, no version codes.
- Ask at most one question at a time (the one exception is the single AskUserQuestion call of Step 6 (c), which carries the questions of the `ask:` lines).
- Never say something is done without the result of the command that did it.
- When a command or check fails, say only the matching fixed sentence of the lexicon, or the closest one. Never explain permissions, commands, file formats or why it failed. Never write the words YAML, JSON, Claude, command, permission, script or a file name. The only exception is the sentence of Step 3 for `git: missing`, which names Git.

## Examples

Correct, writing request (the master, in an empty folder, writes «crea una campagna»): no topic is needed. Launch `yllir:process-runner` with `PROCESS: yllir:new-campaign`, `TOPIC: none`, `HANDOFF: none` and the master's message verbatim. The runner's result file passes the runner-result command (exit 0); send the master only the text after its `message for the master:` line, in plain Italian.

Wrong, writing request: running `yllir:new-campaign` (or writing the draft and calling `yllir:write-sequence`) directly in this skill. The entry skill never runs a writing process itself.

Correct, go back (the first message of an Italian campaign is «annulla l'ultima cosa che hai fatto»): the three-line summary of the last saved versions, then one confirmation question in plain Italian, naming the version to go back to.

Wrong, go back: «Ho eseguito git revert sul commit a1b2c3». It uses technical words, and it gives no confirmation question before acting.

Correct, `folder: other` (the master writes «ho qui delle note di una partita»): one message that says the notes must go into a campaign that exists first, and asks whether the master wants a new campaign created in an empty folder, so the notes can be brought in right after. Nothing is written.

Wrong, `folder: other`: creating a folder called `Notes/` to hold the master's files before asking.

Correct, complete mode (the campaign was created in this folder, and the master's next message is «il tono è cupo, la storia parla di una città mineraria»): launch `yllir:process-runner` with `PROCESS: yllir:new-campaign`, `MODE: complete`, `TOPIC: none`, `HANDOFF: none`, `CHANGED_FILES: none` and the master's message verbatim. Then send the master the message of the runner's result, or ask the question of its `ask:` lines with the question tool.

Wrong, complete mode: answering «questa informazione non è disponibile» or ignoring the tone and the story, or opening a topic for them. Setup information is never refused, and it uses no topic.
