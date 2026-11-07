---
name: linker
description: Library skill. Adds Markdown links to every mention of a campaign subject in the given documents, using deterministic scripts and an independent reviewer. Invoked by Yllir core processes after a document is written, or when asked to link mentions in specific campaign files. Never invoked for anything outside a Yllir campaign.
user-invocable: false
---

# Linker

Scripts find mentions and write links. The reviewer judges. You only run commands, launch the reviewer, save its answer and report. Never search for mentions yourself and never edit campaign files by hand.

## Inputs

The caller gives:
- `FILES`: campaign-relative paths of the documents to link, comma-separated. May be empty.
- `SUBJECTS`: ids of subjects just created or given a new alias. May be empty.

If both are empty, stop and ask the caller which documents to link. Do not guess and do not link the whole campaign.

## Working folder

Step 0. Run `mkdir -p .campaign/state/linker` from the campaign root (the folder containing `campaign.yaml`). Run `pwd` and keep its output as CAMPAIGN_ROOT. All files below go in `.campaign/state/linker/`:
`plan.json`, `outcomes.json`, `result.json`, `check.json`.

## Steps

**Step 1 — Plan.** Run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/plan-links.mjs" . --files "<FILES>" --subjects "<SUBJECTS>" --out .campaign/state/linker/plan.json`
Omit `--files` if FILES is empty. Omit `--subjects` if SUBJECTS is empty.
- If the exit code is 1 or 2: stop. Report with status `FAILED` and the printed error lines.
- If the output contains `proposals: 0` and `review: 0`: go to Step 5.
- Otherwise: go to Step 2.

**Step 2 — Review.** Launch the sub-agent `yllir:linker-reviewer` with the Agent tool. Its prompt is exactly these two lines, with the real absolute paths:
```
CAMPAIGN_ROOT: <CAMPAIGN_ROOT>
PLAN: <CAMPAIGN_ROOT>/.campaign/state/linker/plan.json
```
Do not add your own opinion or review the proposals yourself.
- The reviewer answers with a JSON array. Save its answer exactly as received to `.campaign/state/linker/outcomes.json` with the Write tool.
- If the answer is not a JSON array: launch the reviewer again once with the same prompt. If the second answer is also not a JSON array: stop with status `FAILED`, reason "review not available". Nothing is applied without a review.
- Otherwise: go to Step 3.

**Step 3 — Apply.** Run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/apply-links.mjs" . --plan .campaign/state/linker/plan.json --outcomes .campaign/state/linker/outcomes.json --out .campaign/state/linker/result.json`
Read `.campaign/state/linker/result.json`.
- If `ok` is true: go to Step 4.
- If `rejected` or `missing_outcome` is not empty, and this is round 3 or later: go to Step 4 and report the remaining problems.
- Otherwise: launch `yllir:linker-reviewer` again. Its prompt is the two PLAN lines of Step 2 plus a line `PIDS: <comma-separated pids from rejected and missing_outcome>` and a line `REASONS:` followed by one line per pid, `<pid>: <reason from result.json>`. Merge its new entries into `outcomes.json`: replace each entry with the same `id`, add the rest. Save the merged array with the Write tool. Then run Step 3 again. At most 3 rounds of Step 3 in total.

**Step 4 — Verify.** Build the file list from `scope` in `plan.json` (the array of files), joined with commas. Run:
`node "${CLAUDE_PLUGIN_ROOT}/scripts/check-links.mjs" . --files "<comma-separated scope files>" --out .campaign/state/linker/check.json`
- If the exit code is 0: status `DONE`.
- If the exit code is 1: status `NEEDS_ATTENTION`. Copy each error line into the report.
- Any other exit code: status `FAILED`, reason "check not run".
The script result overrides any opinion. Never report `DONE` when the exit code is not 0.

**Step 5 — Report.** Return exactly this format, plain text, English, nothing else:
```
LINKER REPORT
status: DONE | NEEDS_ATTENTION | FAILED
scope: <n> files
applied: <n>
omitted: <n> (<pid>: <reason>; ...)
decisions for the master:
- <file>:<line> "<text>" could be <candidate ids or subject> — <reviewer reason>
check: <passed | n errors>
```
- `applied`, `omitted` and `scope` come from `result.json` and `plan.json`.
- `decisions for the master` lists every proposal with outcome ASK or FIX, and every item in `plan.review`. Write `- none` if there are none.
- If the run stopped at Step 1 or Step 2, write `scope: 0 files`, `applied: 0`, `omitted: 0`, `check: not run`, and the reason in the status line after the status, for example `status: FAILED (review not available)`.

Correct example (check failed, so status is not DONE):
```
LINKER REPORT
status: NEEDS_ATTENTION
scope: 2 files
applied: 5
omitted: 1 (P004: the word is used as a common noun)
decisions for the master:
- Plot/Arc One/Session 3.md:14 "Ada Rook" could be ada-rook or ada-vell — two sheets match the first name
check: 1 errors
```
Wrong example, do not write this: the status says `DONE` while `check.json` exits 1, and a mention in `plan.review` appears as an applied link. Check the exit code first; `plan.review` items are never applied.

## Rules

- Only `apply-links.mjs` writes links. Never edit campaign files in this skill.
- Never apply a mention listed in `plan.review`. Report it in "decisions for the master" instead.
- Never quote the content of a master-only block in the report. Refer to the file and line, for example `Characters/Ada Rook.md:22`.
- Do not change the outcomes that the reviewer gave. If you disagree, send the case back to the reviewer through the Step 3 loop, do not overwrite it.
- Run commands only from the campaign root.
