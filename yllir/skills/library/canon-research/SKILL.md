---
name: canon-research
description: Library skill. Read-only. Answers a question about what the campaign establishes (who or what something is, how things connect, what the sources say, whether something is true), with evidence and stated limits, using deterministic search and an independent researcher. Invoked by Yllir core processes and by the entry skill for questions about the campaign. Never invoked in autorun. Never modifies campaign documents.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/canon-research/scripts/research-search.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/canon-research/scripts/research-report.mjs" *), Read, Write, Agent
---

# Canon research

This skill is always invoked by another skill (the entry skill, or a core process that needs an answer about the campaign). The result of this skill is the file `.campaign/state/research/report.txt`, not a message for the master. The invoking skill reads that file to know the result.

**Commands.** Run each command exactly as written in this file, as one single command: nothing before it and nothing after it, no `;`, `&&`, `|`, `2>&1`, `echo`, `cat`, `mkdir` or `cd`. Anything added makes the command refused. Every script prints its result and, as its last line, `exit: <code>`: read the exit code from that line (the `exit:` line). If a command is refused, run it again exactly as written, with nothing added; if it is refused again, go to Step 4 with reason "permission refused". Run commands only from the campaign root.

Scripts search and build the report. The researcher judges. You only run commands, launch the researcher and save its answer. Never search for mentions yourself, never read the campaign documents yourself to answer, never judge the evidence, never write or edit the report yourself, and never edit any campaign file. This skill is read-only.

## Inputs

The caller gives:
- `QUESTION`: the master's question, verbatim. May be empty.
- `TERMS`: names, aliases and keywords of the question, separated by `;`. May be empty.
- `CONTINUE_WITH`: text given by the invoking skill naming the exact step to resume (for example "write-sequence step 7"). If absent, use "the step of the invoking skill that called canon-research".

If QUESTION is empty, go to Step 4 with reason "no question". Do not run any command.

## Working folder

Step 0. From the campaign root (the folder containing `campaign.yaml`), keep CAMPAIGN_ROOT: it is the `campaign root:` line of the session check in your context; if that line is not there, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" .` and read that line. All files below go in `.campaign/state/research/`:
`search.json`, `answer.json`, `report.txt`.

## Steps

**Step 1 — Search.** First, if TERMS is empty, build it: take every capitalised name and every quoted phrase of QUESTION, exactly as written, remove the double quote characters, and join them with `;`. If this gives no term, go to Step 4 with reason "no search terms".

Then run this command, with `<TERMS>` replaced by the terms:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/canon-research/scripts/research-search.mjs" . --terms "<TERMS>" --out .campaign/state/research/search.json`
- If the exit code is 1 or 2: go to Step 4 with reason "search failed: <the error lines, joined by ; >".
- If the exit code is 0: go to Step 2. Zero hits is a valid result: the researcher then reports silence.

**Step 2 — Research.** Launch the sub-agent `yllir:canon-researcher` (the instructions of this sub-agent are in `${CLAUDE_PLUGIN_ROOT}/agents/canon-researcher.md`; if your tool has no named agents, start a sub-agent, tell it to read that file first and follow it exactly) with the Agent tool. Its prompt is exactly these three lines, with the real absolute paths and the real question:
```
CAMPAIGN_ROOT: <CAMPAIGN_ROOT>
QUESTION: <QUESTION>
SEARCH: <CAMPAIGN_ROOT>/.campaign/state/research/search.json
```
Do not add your own answer, do not add words to the question, and do not read the documents yourself.
- The researcher answers with one JSON object. Save its answer exactly as received, with no character changed, to `.campaign/state/research/answer.json` with the Write tool. If the Write tool refuses because the file already exists, read it with the Read tool and write it again.
- If the answer is not a single JSON object (it has text before or after the braces, or it is not JSON): launch the researcher again once with the same prompt, and save its answer the same way if it is a single JSON object.
- If the second answer is also not a JSON object: do not write `answer.json`. Go to Step 3 anyway; the report will say FAILED.
- Otherwise go to Step 3.

**Step 3 — Report.** Run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/canon-research/scripts/research-report.mjs" . --search .campaign/state/research/search.json --answer .campaign/state/research/answer.json --continue-with "<CONTINUE_WITH>" --out .campaign/state/research/report.txt`
Read the exit code from the `exit:` line (0 DONE, 1 NEEDS_ATTENTION, 3 FAILED, 2 usage).
- If the exit code is 1 and the output has lines starting with `- ` (the problems), and this is the first run of this command: launch `yllir:canon-researcher` again (same way as in Step 2) with the same three lines of Step 2 plus a line `PROBLEMS:` and, after it, every line of the output that starts with `- `, copied exactly. Save its answer as in Step 2 (if it is not a single JSON object, keep the previous `answer.json` and go on). Then run this Step 3 command again, exactly as written. That is the second and last run.
- Otherwise: this Step 3 command is your last action in this skill. Go to Step 5.

Do not print the report and do not write it by hand.

**Step 4 — Stop without a report.** Use this step when there is no question, no search terms, or the search failed. Do not run any script and do not write any file. Your last message to the invoking skill is two lines: `status: FAILED` and `reason: <the reason>`. The invoking skill treats a missing `report.txt` as FAILED. Then, in the same turn, do what CONTINUE_WITH says.

**Step 5 — Continue.** The report is in `.campaign/state/research/report.txt`. In the same turn, do what CONTINUE_WITH says. Whether and how the answer reaches the master is decided by the invoking skill, using the report and the rules below, not by this skill.

Example of the file content the script writes (the answer has master-only content and needs one more step, a review of the wording, before it is shown):
```
RESEARCH REPORT
status: DONE
question terms: Ada Rook; Ada
covered: 3 files read (2 with hits, 1 sheet of a subject)
not read: none
contains master-only content: yes
homonyms: none
answer: Ada Rook is the harbour master of Varn. The notes say she may have left the post, which is not confirmed.
claims:
- fact: Ada Rook is the harbour master of Varn (Characters/Ada Rook.md:6)
- hypothesis: Ada Rook may have left the post (Notes/Varn rumours.md:4)
unverified leads:
- Notes/Varn rumours.md:9 names "a Rook" without a first name; not decided whether it is her
continue with: write-sequence step 7
```

## Rules

- Read-only. The only file this skill writes is `answer.json`, with the Write tool. Never write or edit `report.txt`, `search.json` or any campaign file.
- External folders (categories of type `external`) are read-only canon of the shared world. Their documents are searched like the campaign's own, and their evidence can support a `fact`. The report line `from the shared world (external, read only): <files>` lists the external files used as evidence (or `none`). When the caller tells the master an answer that uses them, it says that the statement comes from the shared world, read only, and never offers to change those files.
- Never search, never read campaign documents to answer, and never judge the evidence yourself. The researcher judges, the script checks.
- If the report says `contains master-only content: yes`, the caller must not pass the answer to players or to any player-facing output (text for players, images, web searches, publishing). The caller may use it for the master and for the canon.
- If the report says `status: NEEDS_ATTENTION` or `FAILED`, the answer is incomplete or missing: tell the caller that, do not complete it from memory.
- When the question is "is it true that...", the answer the caller uses states the class of the statement (fact, source claim, hypothesis or silence). Never a bare yes.
- Do not resolve homonyms yourself. The report lists them, and the caller asks the master which subject is meant if it matters.
- Do not quote master-only text in your own messages. Refer to the file and line.
- Do not use anything from `answer.json` that the report does not list as a claim or as an unverified lead.
