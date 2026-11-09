---
name: write-sequence
description: Core rule. The only way Yllir writes campaign documents: manual changes saved, continuity check, independent review, write, links, derived files, deterministic verification, saved version. Invoked by core processes with drafts already prepared.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/scripts/audit-scope.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/write-sequence/scripts/apply-draft.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/build-index.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/check-links.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/write-sequence/scripts/validate-config.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/scripts/generate-instructions.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/write-sequence/scripts/json-check.mjs" *), Read, Write, Agent, Skill
---

# Write sequence

You run this skill on behalf of a calling process (for example new-campaign). The WRITE REPORT is a file for that process, not a message for the master: never print it, never show it to the master, and never end your turn with it. Every way of ending this skill, DONE or any stop, first writes the report file (see Report).

Scripts write, verify and save. Sub-agents check and judge. You only run commands, launch sub-agents, save their answers and write the WRITE REPORT file. Never write a campaign document with your own tools. Never review a draft yourself. Never skip a step: if a step is skipped, write the step and the reason in the report.

**Commands.** Run each command exactly as written in this file, as one single command: nothing before it and nothing after it, no `;`, `&&`, `|`, `2>&1`, `echo`, `cat`, `mkdir` or `cd`. Anything added makes the command refused. Every script prints its result and, as its last line, `exit: <code>`: read the exit code from that line (the `exit:` line). Read result files with the Read tool. If a command is refused, run it again exactly as written, with nothing added; if it is refused again, end this skill with `status: FAILED`, reason "permission refused".

## Inputs

The calling process gives:
- `DOCUMENTS`: campaign-relative paths, comma-separated.
- `INTENT`: one sentence.
- `NEW_SUBJECTS`: subject ids, may be empty.
- `VERSION_MESSAGE`: one sentence in the campaign language.
- `ROUND`: 1, 2 or 3.
- `CONTINUE_WITH`: the step of the calling process to run after this skill, in one sentence.

The caller has written each draft to `.campaign/state/write/draft/<same path>`. Do not delete `draft/`.

## Working folder

**Step 0.** If `ROUND` is greater than 3, end this skill with `status: FAILED`, reason "three attempts used" (the calling process continues). Otherwise, from the campaign root (the folder containing `campaign.yaml`), keep CAMPAIGN_ROOT: it is the `campaign root:` line of the session check in your context; if that line is not there, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" .` and read that line. Keep the variable `CAMPAIGN_ROOT` for the reviewer prompt.

Every script below is run from the campaign root, as `node "${CLAUDE_PLUGIN_ROOT}/<script path>" . <options>`, with the script path of the list in `allowed-tools` written in full each time.

## Steps

**1. Manual changes.** Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" list . --limit 1`. Exit ≠ 0 → end this skill with `status: FAILED`, reason "versions not readable" (the calling process continues).
- The output is a JSON array. If it is empty (`[]`): this is a new campaign. Record "manual changes: none, no saved version yet" and go to step 2.
- If it has one entry: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" status .`. If the output says `"clean": true`, go to step 2. Otherwise run `node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" save-manual . --message "<sentence>"`, where the sentence is "Changes made by hand" in the campaign language. Read `language.main` in `campaign.yaml`: for `it` write `Modifiche fatte a mano`, for `en` write `Changes made by hand`, for any other code translate the English sentence into that language. Then go to step 2.

**2. Continuity check.** EXISTING is the list of DOCUMENTS that already exist: for each document, Read `<document>`: if Read says it does not exist, the document is not in EXISTING; otherwise it is.
- If EXISTING and NEW_SUBJECTS are both empty: skip. Record "continuity: nothing to compare yet".
- Otherwise run a scope probe, omitting each option whose list is empty: `node "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/scripts/audit-scope.mjs" . --mode pre [--files "<EXISTING>"] [--subjects "<NEW_SUBJECTS>"] --out .campaign/state/write/scope-probe.json`.
  - If it prints `documents: 0`: skip the audit. Record "continuity: nothing to compare yet".
  - If its exit code is 2: end this skill with `status: FAILED`, reason "continuity check not run" (the calling process continues).
  - Otherwise invoke the skill `yllir:continuity-audit` (if your tool has no way to invoke a skill, read `${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/SKILL.md` with the Read tool or `cat`, and follow it exactly as if it had been invoked, with the same inputs) with `MODE=pre`, `FILES=EXISTING` (comma-separated), `SUBJECTS=NEW_SUBJECTS`, `CHANGE=INTENT`, `CONTINUE_WITH="write-sequence step 2: read the AUDIT REPORT, then step 3"`. When it has finished, read `.campaign/state/audit/report.txt` with the Read tool. That file is the AUDIT REPORT.
    - If any line starts with `- [RELATED]`: end this skill with `status: CONFLICT` (the calling process continues), and list those lines in the report.
    - If its `status:` line is `INCOMPLETE`: continue and record `continuity: INCOMPLETE`.
    - If its `status:` line is `COMPLETE`: continue and record `continuity: COMPLETE`.
    - Any other status (for example `FAILED`), or the file is missing: end this skill with `status: FAILED`, reason "continuity check not run" (the calling process continues).

**3. Draft.** For each document in DOCUMENTS, Read `.campaign/state/write/draft/<document>`: if Read says it does not exist, or the file is empty, the draft is missing. If any draft is missing: end this skill with `status: FAILED`, reason "draft missing", and list the missing paths (the calling process continues).

**3b. System rules check.** Invoke `yllir:system-adapter` with `OPERATION=check-drafts`, `FILES` set to the comma-separated draft paths `.campaign/state/write/draft/<document>` for every path in DOCUMENTS, and `CONTINUE_WITH="write-sequence step 3b: read the ADAPTER REPORT, then step 4"`. If your tool cannot invoke a named skill, read `${CLAUDE_PLUGIN_ROOT}/skills/library/system-adapter/SKILL.md` with the Read tool or `cat`, and follow it exactly as if invoked, using these inputs. When it finishes, read `.campaign/state/system-adapter/report.txt` with the Read tool; this is the ADAPTER REPORT.
- If the report status is `OK`, record `system rules: passed` and continue.
- If the report status is `NOT_APPLICABLE`, record `system rules: no adapter` and continue.
- If the report status is `NEEDS_ATTENTION`, end this skill with `status: FIX_NEEDED`; in report details, list every `problem:` line with the draft path prefix `.campaign/state/write/draft/` removed. Do not launch the reviewer and do not write documents.
- If the ADAPTER REPORT `status:` line is `FAILED`, end this skill with `status: FAILED`, reason "system rules check not run". Do not launch the reviewer or write documents.
- If the skill returns `status: FAILED`, the report is missing or unreadable, or its `status:` line is absent or unknown, end this skill with `status: FAILED`, reason "system rules check not run". Do not launch the reviewer or write documents.

**4. Independent review.** Launch the sub-agent `yllir:canon-reviewer` (the instructions of this sub-agent are in `${CLAUDE_PLUGIN_ROOT}/agents/canon-reviewer.md`; if your tool has no named agents, start a sub-agent, tell it to read that file first and follow it exactly) with the Agent tool. Its prompt is exactly these four lines, with real values:
```
CAMPAIGN_ROOT: <CAMPAIGN_ROOT>
DRAFT_DIR: <CAMPAIGN_ROOT>/.campaign/state/write/draft
DOCUMENTS: <DOCUMENTS>
INTENT: <INTENT>
```
Save its answer exactly as received to `.campaign/state/write/review.json` with the Write tool. Then run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/write-sequence/scripts/json-check.mjs" .campaign/state/write/review.json --object`.
- Exit ≠ 0 (not JSON): launch the reviewer once more with the same prompt and save the new answer the same way. If the second answer is also not JSON: end this skill with `status: FAILED`, reason "review not available" (the calling process continues). Nothing is written without a review.
- Valid JSON with `"outcome": "FIX"`: end this skill with `status: FIX_NEEDED` (the calling process continues) and list its items in the report.
- Valid JSON with `"outcome": "ASK"`: end this skill with `status: ASK` (the calling process continues) and put its `question` in the report.
- Valid JSON with `"outcome": "APPLY"`: go to step 5.
- Any other outcome value: end this skill with `status: FAILED`, reason "review not available" (the calling process continues).

**5. Write.** Run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/write-sequence/scripts/apply-draft.mjs" . --draft-dir .campaign/state/write/draft --files "<DOCUMENTS>"`. Save its printed JSON to `.campaign/state/write/applied.json` with the Write tool. Exit ≠ 0 (nothing was written): end this skill with `status: FAILED` (the calling process continues) and list its `errors`.

**6. Links.** Invoke the skill `yllir:linker` (if your tool has no way to invoke a skill, read `${CLAUDE_PLUGIN_ROOT}/skills/library/linker/SKILL.md` with the Read tool or `cat`, and follow it exactly as if it had been invoked, with the same inputs) with `FILES=DOCUMENTS`, `SUBJECTS=NEW_SUBJECTS`, `CONTINUE_WITH="write-sequence step 7 (derived files), then steps 8 and 9"`. When it has finished, read `.campaign/state/linker/report.txt` with the Read tool. That file is the LINKER REPORT.
- Its `status:` line is `FAILED`: continue, record `links: FAILED`, and mark every document "to check" in the report.
- Otherwise record `links: applied <n>` with the number from its `applied:` line. Copy every line under `decisions for the master` into the report details.
- The file is missing: record `links: FAILED` and continue as above.

**7. Derived files.** Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/build-index.mjs" . --out .campaign/cache/subjects.json`. Exit ≠ 0: end this skill with `status: FAILED`, reason "index not built", and its printed lines (the calling process continues). The documents already written stay marked "to check".

**8. Deterministic verification.** Run these three commands in this order, and keep the output of each:
- `node "${CLAUDE_PLUGIN_ROOT}/skills/library/linker/scripts/check-links.mjs" . --files "<DOCUMENTS>"`
- `node "${CLAUDE_PLUGIN_ROOT}/skills/core/write-sequence/scripts/validate-config.mjs" .`
- `node "${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/scripts/generate-instructions.mjs" . --check`

Then decide:
- `check-links` or `validate-config` exit 1: end this skill with `status: VERIFY_FAILED` (the calling process continues). Put every printed error line in the report details. Do NOT save a version. The caller fixes the draft and calls again with ROUND+1.
- `check-links` or `validate-config` exit with any code other than 0 or 1: end this skill with `status: FAILED`, reason "verification not run" (the calling process continues).
- `generate-instructions --check` exit 1 (files changed): run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/scripts/generate-instructions.mjs" .`. Exit ≠ 0: end this skill with `status: FAILED`, reason "instructions not regenerated" (the calling process continues). Exit 0: continue.
- `generate-instructions --check` exit ≠ 0 and ≠ 1: end this skill with `status: FAILED`, reason "instructions not checked" (the calling process continues).
- Otherwise record `verification: passed`.

The scripts' result overrides any opinion.

**9. Saved version.** Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" save . --message "<VERSION_MESSAGE>" --kind framework`. Exit ≠ 0, or the JSON has `"saved": false`: end this skill with `status: FAILED`, reason "version not saved" (the calling process continues). Otherwise status `DONE`, and `saved version:` is the `hash` from the JSON.

## Limits

At most three cycles between draft and review, or between write and verification. The caller stops after ROUND 3 (step 0). Never retry a step on your own beyond what is written here.

## Report

Write the report with the Write tool to `.campaign/state/write/report.txt`. Its content is exactly this block, in English. Do not print it, and do not show it to the master.
```
WRITE REPORT
status: DONE | CONFLICT | FIX_NEEDED | ASK | VERIFY_FAILED | FAILED
documents: <paths, comma-separated>
continuity: <COMPLETE | INCOMPLETE | nothing to compare yet | conflict>
review: <APPLY | FIX | ASK | not run>
system rules: <passed | no adapter | n problems | not run>
links: <applied n | FAILED | not run>
verification: <passed | n errors | not run>
saved version: <hash | none>
details:
- <one line per conflict, review item, linker decision, verification error or reason for a stop; "- none" if there are none>
continue with: <CONTINUE_WITH>
```

Your last action in this skill is that Write call. Then, in the same turn, do what the `continue with:` line says. Write nothing else first and print nothing.

Correct example of the content of `report.txt` (a new campaign, documents written, all checks passed):
```
WRITE REPORT
status: DONE
documents: World/Varn.md, World/Old Mill.md
continuity: nothing to compare yet
review: APPLY
system rules: passed
links: applied 2
verification: passed
saved version: 3f2a9c1
details:
- none
continue with: write-sequence step 7 (derived files), then steps 8 and 9
```

When the adapter reports problems, use the count in the `system rules:` field and list every problem in `details:`:
```
WRITE REPORT
status: FIX_NEEDED
documents: Creatures/Guardiano.md
continuity: nothing to compare yet
review: not run
system rules: 1 problem
links: not run
verification: not run
saved version: none
details:
- Creatures/Guardiano.md: missing-field: missing field: con
continue with: <CONTINUE_WITH>
```

Wrong example, do not do this: step 4 is skipped, and the document is written with the Write tool before any review exists. Documents are written only by `apply-draft.mjs`, and only after `review.json` says `APPLY`.

## Rules

- Only `apply-draft.mjs` writes campaign documents. Only `versions.mjs` saves versions.
- Never edit a document with your own tools, not even to fix a verification error. The caller fixes the draft.
- Never put master-block text in the report. Refer to file and line.
- Never change a sub-agent's answer. Save it exactly as received.
- Run every command from the campaign root.
- Never print the WRITE REPORT, never show it to the master, and never end your turn with it.
