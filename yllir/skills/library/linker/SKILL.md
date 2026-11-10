---
name: linker
description: Library skill. Adds Markdown links to every mention of a campaign subject in the given documents, using deterministic scripts and an independent reviewer. Invoked by Yllir core processes after a document is written, or when asked to link mentions in specific campaign files. Never invoked for anything outside a Yllir campaign.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/plan-links.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/apply-links.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/check-links.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/linker-report.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/auto-outcomes.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/merge-outcomes.mjs" *), Read, Write, Agent
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
- `LEVEL`: `low`, `medium` or `high`, given by the write sequence. Absent or any other value means `high`. Only `low` changes anything here (see Step 1b).

If both FILES and SUBJECTS are empty, stop and ask the caller which documents to link. Do not guess and do not link the whole campaign.

## Working folder

Step 0. From the campaign root (the folder containing `campaign.yaml`), keep CAMPAIGN_ROOT: it is the `campaign root:` line of the session check in your context; if that line is not there, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" .` and read that line. All files below go in `.campaign/state/linker/`:
`plan.json`, `outcomes.json`, `reviewer-response.json`, `result.json`, `check.json`, `report.txt`.

## Steps

**Step 1 — Plan.** Run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/plan-links.mjs" . --files "<FILES>" --subjects "<SUBJECTS>" --out .campaign/state/linker/plan.json`
Omit `--files` if FILES is empty. Omit `--subjects` when SUBJECTS is empty.

External subjects are included automatically as link targets. The script reads the external folders (categories of type `external`) by itself: a mention in FILES of a subject that exists only in an external folder is planned and linked to that external sheet. Do not add external files to FILES, and do not drop or ignore proposals whose target is external. Run the command as written whether or not the master mentioned external sources.

- If the exit code is 1 or 2: go to Step 5 with `--status-reason "<the error lines, joined by ; >"`.
- If the output contains `proposals: 0` and `review: 0`: go to Step 4 directly (no outcomes or apply step is needed).
- Otherwise: go to Step 1b.

**Step 1b — Light path (only when LEVEL is `low`).** When LEVEL is not `low`, skip this step and go to Step 2 as written. When LEVEL is `low`, run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/auto-outcomes.mjs" . --plan .campaign/state/linker/plan.json --out .campaign/state/linker/outcomes.json`
- If the exit code is 2, or the command fails in any other way: ignore its output, delete nothing, and go to Step 2 as written (full review).
- If the exit code is 0: read the `uncertain:` line. If it is `uncertain: 0`, skip Step 2 and go to Step 3. Otherwise go to Step 2, with the changes of the light path written in Step 2.

**Step 2 — Review.** Launch the sub-agent `yllir:linker-reviewer` (the instructions of this sub-agent are in `${CLAUDE_PLUGIN_ROOT}/agents/linker-reviewer.md`; if your tool has no named agents, start a sub-agent, tell it to read that file first and follow it exactly) with the Agent tool. In Codex, always set the model of this sub-agent to GPT-6 Luna in the launch call itself: an omitted model silently becomes the model of the main agent, which is a defect. Its prompt is exactly these two lines, with the real absolute paths:
```
CAMPAIGN_ROOT: <CAMPAIGN_ROOT>
PLAN: <CAMPAIGN_ROOT>/.campaign/state/linker/plan.json
```
Do not add your own opinion or review the proposals yourself.
- First check that the answer is a JSON array. Save it exactly once, without editing, to `.campaign/state/linker/reviewer-response.json` with the Write tool. Then run the merge command below with `--mode all` to validate and write `outcomes.json`. Full review replaces stale outcomes. If the answer is not an array or the merge script rejects it, launch the reviewer again once with the same prompt and follow the same save-and-merge steps. In Codex, set GPT-6 Luna in the launch call. If the second answer is not an array or is rejected by the script, go to Step 5 with `--status-reason "review not available"`. Nothing is applied without a valid review.
- Otherwise: go to Step 3.

**Light path (only when you come from Step 1b with uncertain proposals).** The reviewer judges only the uncertain proposals. Its prompt is the two PLAN lines above plus a third line `PIDS: <the uncertain pids from the output of Step 1b, comma-separated>`. In Codex, set the model to GPT-6 Luna in the launch call. Check that its answer is a JSON array, save it once to `reviewer-response.json`, and run the merge command with scoped mode and the uncertain PIDs. If the answer is not an array or the merge script rejects it, launch the reviewer once more with the same prompt and repeat. If the second answer is not an array or is rejected, go to Step 5 with `--status-reason "review not available"`. The script appends reviewed entries and preserves automatic decisions. Then go to Step 3.

**Step 3 — Apply.** Run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/apply-links.mjs" . --plan .campaign/state/linker/plan.json --outcomes .campaign/state/linker/outcomes.json --out .campaign/state/linker/result.json`
Read `.campaign/state/linker/result.json`.
- If `ok` is true: go to Step 4.
- If `rejected` or `missing_outcome` is not empty, and this is round 3 or later: go to Step 4.
- Otherwise: launch `yllir:linker-reviewer` again. In Codex, set the model to GPT-6 Luna, as in the first launch. Its prompt is the two PLAN lines of Step 2 plus a line `PIDS: <comma-separated pids from rejected and missing_outcome>` and a line `REASONS:` followed by one line per pid, `<pid>: <reason from result.json>`. Save the accepted JSON array exactly once to `reviewer-response.json`, then run the merge command with scoped mode for those PIDs. It replaces only those IDs and preserves all other decisions. Then run Step 3 again. At most 3 rounds of Step 3 in total.

**Merge command.** After each valid reviewer response, run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/merge-outcomes.mjs" . --plan .campaign/state/linker/plan.json --base .campaign/state/linker/outcomes.json --response .campaign/state/linker/reviewer-response.json --out .campaign/state/linker/outcomes.json --mode all`
For the light path or a retry, replace `--mode all` with `--mode scoped --pids "<comma-separated PIDs>"`. The script validates JSON arrays, outcome schema, IDs and scope before writing. If a retry merge fails, keep the existing outcomes and use another reviewer round only when one remains under the three-round limit. The script writes atomically, so invalid input cannot truncate the prior outcomes file.

**Step 4 — Verify.** Build the de-duplicated file list from `FILES` and `scope` in `plan.json` (the array of files), joined with commas. This preserves every caller document and includes every file discovered by the linker, including inbound mentions. Run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/check-links.mjs" . --files "<FILES plus plan scope>" --out .campaign/state/linker/check.json`
Keep the exit code as CHECK_EXIT (0, 1, or any other value). Always run this fresh check, including when there are zero proposals or zero links applied. Then go to Step 5. The report script turns CHECK_EXIT into the check result; never decide the status yourself.

**Step 5 — Report.** Run this command. It writes the report file. Use `--check-exit none` if Step 4 did not run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/linker-report.mjs" . --plan .campaign/state/linker/plan.json --outcomes .campaign/state/linker/outcomes.json --result .campaign/state/linker/result.json --check-exit <CHECK_EXIT> --continue-with "<CONTINUE_WITH>" --out .campaign/state/linker/report.txt`
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
- Auto outcomes only ever come from `auto-outcomes.mjs`. Never write an APPLY entry yourself.
- Never merge outcome arrays yourself. Save reviewer output once in `reviewer-response.json` and use `merge-outcomes.mjs`.
- Never apply a mention listed in `plan.review`. The report script lists it under "decisions for the master".
- Never write or edit `report.txt` yourself. Only `linker-report.mjs` writes it.
- Never quote the content of a master-only block. Refer to the file and line, for example `Characters/Ada Rook.md:22`.
- Do not change the outcomes that the reviewer gave. If you disagree, send the case back to the reviewer through the Step 3 loop, do not overwrite it.
- Run commands only from the campaign root.
- Documents in `external` categories are read-only link targets: they are never in FILES, and the scripts never write into them.
