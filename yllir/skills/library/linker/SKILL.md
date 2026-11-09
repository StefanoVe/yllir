---
name: linker
description: Library skill. Adds Markdown links to every mention of a campaign subject in the given documents, using deterministic scripts and an independent reviewer. Invoked by Yllir core processes after a document is written, or when asked to link mentions in specific campaign files. Never invoked for anything outside a Yllir campaign.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/plan-links.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/apply-links.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/check-links.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/linker-report.mjs" *), Read, Write, Agent
---

# Linker

This skill is always invoked by another skill (for example write-sequence). The result of this skill is the file `.campaign/state/linker/report.txt`, not a message for the master. The invoking skill reads that file to know the result.

**Commands.** Run each command exactly as written in this file, as one single command: nothing before it and nothing after it, no `;`, `&&`, `|`, `2>&1`, `echo`, `cat`, `mkdir` or `cd`. Anything added makes the command refused. Every script prints its result and, as its last line, `exit: <code>`: read the exit code from that line (the `exit:` line). Read result files with the Read tool. If a command is refused, run it again exactly as written, with nothing added; if it is refused again, end this skill with `status: FAILED`, reason "permission refused".

Scripts find mentions, write links and build the report. The reviewer judges. You only run commands, launch the reviewer and save its answer. Never search for mentions yourself, never edit campaign files by hand, and never write or edit the report yourself.

## Inputs

The caller gives:
- `FILES`: campaign-relative paths of the documents to link, comma-separated. May be empty.
- `SUBJECTS`: ids of subjects just created or given a new alias. May be empty.
  The plan script also adds, by itself, every document that mentions a subject whose sheet is in FILES (two-way: the touched file is linked towards the sheets, and the other documents are linked towards the touched sheet), so the caller does not need to list those subjects.
- `CONTINUE_WITH`: text given by the invoking skill naming the exact step to resume (e.g. "write-sequence step 7"). If absent, use "the step of the invoking skill that called the linker".

If both FILES and SUBJECTS are empty, stop and ask the caller which documents to link. Do not guess and do not link the whole campaign.

## Working folder

Step 0. From the campaign root (the folder containing `campaign.yaml`), keep CAMPAIGN_ROOT: it is the `campaign root:` line of the session check in your context; if that line is not there, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" .` and read that line. All files below go in `.campaign/state/linker/`:
`plan.json`, `outcomes.json`, `result.json`, `check.json`, `report.txt`.

## Steps

**Step 1 — Plan.** Run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/plan-links.mjs" . --files "<FILES>" --subjects "<SUBJECTS>" --out .campaign/state/linker/plan.json`
Omit `--files` if FILES is empty. Omit `--subjects` if SUBJECTS is empty.

External subjects are included automatically as link targets. The script reads the external folders (categories of type `external`) by itself: a mention in FILES of a subject that exists only in an external folder is planned and linked to that external sheet. Do not add external files to FILES, and do not drop or ignore proposals whose target is external. Run the command as written whether or not the master mentioned external sources.

- If the exit code is 1 or 2: go to Step 5 with `--status-reason "<the error lines, joined by ; >"`.
- If the output contains `proposals: 0` and `review: 0`: go to Step 5 with no status reason.
- Otherwise: go to Step 2.

**Step 2 — Review.** Launch the sub-agent `yllir:linker-reviewer` (the instructions of this sub-agent are in `${CLAUDE_PLUGIN_ROOT}/agents/linker-reviewer.md`; if your tool has no named agents, start a sub-agent, tell it to read that file first and follow it exactly; in Codex, always start the sub-agent with the model Luna, because Codex gives a sub-agent the model of the main agent unless you name one) with the Agent tool. Its prompt is exactly these two lines, with the real absolute paths:
```
CAMPAIGN_ROOT: <CAMPAIGN_ROOT>
PLAN: <CAMPAIGN_ROOT>/.campaign/state/linker/plan.json
```
Do not add your own opinion or review the proposals yourself.
- The reviewer answers with a JSON array. Save its answer exactly as received to `.campaign/state/linker/outcomes.json` with the Write tool.
- If the answer is not a JSON array: launch the reviewer again once with the same prompt. If the second answer is also not a JSON array: go to Step 5 with `--status-reason "review not available"`. Nothing is applied without a review.
- Otherwise: go to Step 3.

**Step 3 — Apply.** Run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/apply-links.mjs" . --plan .campaign/state/linker/plan.json --outcomes .campaign/state/linker/outcomes.json --out .campaign/state/linker/result.json`
Read `.campaign/state/linker/result.json`.
- If `ok` is true: go to Step 4.
- If `rejected` or `missing_outcome` is not empty, and this is round 3 or later: go to Step 4.
- Otherwise: launch `yllir:linker-reviewer` again. Its prompt is the two PLAN lines of Step 2 plus a line `PIDS: <comma-separated pids from rejected and missing_outcome>` and a line `REASONS:` followed by one line per pid, `<pid>: <reason from result.json>`. Merge its new entries into `outcomes.json`: replace each entry with the same `id`, add the rest. Save the merged array with the Write tool. Then run Step 3 again. At most 3 rounds of Step 3 in total.

**Step 4 — Verify.** Build the file list from `scope` in `plan.json` (the array of files), joined with commas. Run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/check-links.mjs" . --files "<comma-separated scope files>" --out .campaign/state/linker/check.json`
Keep the exit code as CHECK_EXIT (0, 1, or any other value). Then go to Step 5. The report script turns CHECK_EXIT into the check result; never decide the status yourself.

**Step 5 — Report.** Run this command. It writes the report file. Use `--check-exit none` if Step 4 did not run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/linker-report.mjs" . --plan .campaign/state/linker/plan.json --outcomes .campaign/state/linker/outcomes.json --result .campaign/state/linker/result.json --check-exit <CHECK_EXIT or none> --continue-with "<CONTINUE_WITH>" --out .campaign/state/linker/report.txt`
Add `--status-reason "<reason>"` when an earlier step sent you here with a failure reason.

Your last action in this skill is that command. Do not print the report and do not write it by hand. Then, in the same turn, do what CONTINUE_WITH says.

Example of the file content the script writes (check failed, so status is not DONE):
```
LINKER REPORT
status: NEEDS_ATTENTION
scope: 2 files
applied: 5
omitted: 1 (P004: the word is used as a common noun)
decisions for the master:
- Plot/Arc One/Session 3.md:14 "Ada Rook" could be ada-rook or ada-vell — two sheets match the first name
check: 1 errors
continue with: write-sequence step 7
```

## Rules

- Only `apply-links.mjs` writes links. Never edit campaign files in this skill.
- Never apply a mention listed in `plan.review`. The report script lists it under "decisions for the master".
- Never write or edit `report.txt` yourself. Only `linker-report.mjs` writes it.
- Never quote the content of a master-only block. Refer to the file and line, for example `Characters/Ada Rook.md:22`.
- Do not change the outcomes that the reviewer gave. If you disagree, send the case back to the reviewer through the Step 3 loop, do not overwrite it.
- Run commands only from the campaign root.
- Documents in `external` categories are read-only link targets: they are never in FILES, and the scripts never write into them.
