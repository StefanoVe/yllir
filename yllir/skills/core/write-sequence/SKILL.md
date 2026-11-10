---
name: write-sequence
description: Core rule. The only way Yllir writes campaign documents: manual changes saved, independent review, write, links, derived files, deterministic verification, saved version. Invoked by core processes with drafts already prepared.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/write-sequence/scripts/apply-draft.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/write-sequence/scripts/aggregate-reviews.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/build-index.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/write-sequence/scripts/validate-config.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/scripts/generate-instructions.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/write-sequence/scripts/json-check.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/npc-manager/scripts/npc-manager.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/write-sequence/scripts/classify-write.mjs" *), Read, Write, Agent, Skill, Bash(node */scripts/session-start.mjs *), Bash(node */scripts/versions.mjs *), Bash(node */skills/core/write-sequence/scripts/apply-draft.mjs *), Bash(node */skills/core/write-sequence/scripts/aggregate-reviews.mjs *), Bash(node */scripts/build-index.mjs *), Bash(node */skills/core/write-sequence/scripts/validate-config.mjs *), Bash(node */skills/core/yllir/scripts/generate-instructions.mjs *), Bash(node */skills/core/write-sequence/scripts/json-check.mjs *), Bash(node */skills/library/npc-manager/scripts/npc-manager.mjs *), Bash(node */skills/core/write-sequence/scripts/classify-write.mjs *)
---

# Write sequence

You run this skill on behalf of a calling process (for example new-campaign). The WRITE REPORT is a file for that process, not a message for the master: never print it, never show it to the master, and never end your turn with it. Every way of ending this skill, DONE or any stop, first writes the report file (see Report).

Scripts write, verify and save. Sub-agents check and judge. You only run commands, launch sub-agents, save their answers and write the WRITE REPORT file. Never write a campaign document with your own tools. Never review a draft yourself. Never skip a step: if a step is skipped, write the step and the reason in the report.

**Commands.** Run each command exactly as written in this file, as one single command: nothing before it and nothing after it, no `;`, `&&`, `|`, `2>&1`, `echo`, `cat`, `mkdir` or `cd`. Anything added makes the command refused. Every script prints its result and, as its last line, `exit: <code>`: read the exit code from that line (the `exit:` line). Read result files with the Read tool. If a command is refused, run it again exactly as written, with nothing added; if it is refused again, end this skill with `status: FAILED`, reason "permission refused".

**Codex plugin-root fallback.** Keep using the commands as written when `PLUGIN_ROOT` or `CLAUDE_PLUGIN_ROOT` is available. If both are absent, take the absolute path of the active Yllir skill file shown in context, remove everything from `/skills/` onward to get the plugin root, substitute that absolute root directly for `${CLAUDE_PLUGIN_ROOT}` in each command, and run the resulting single command. Never prefix an inline variable assignment. If no reliable absolute path is visible, stop before running a script and report failure; do not claim the operation ran.

## Inputs

The calling process gives:
- `DOCUMENTS`: campaign-relative paths, comma-separated.
- `INTENT`: one sentence.
- `NEW_SUBJECTS`: subject ids, may be empty.
- `CONTEXT_FILES`: optional existing campaign-relative documents read as relevant context, comma-separated; may be empty. The reviewer reads these as read-only context.
- `VERSION_MESSAGE`: one sentence in the campaign language.
- `ROUND`: 1, 2 or 3.
- `CONTINUE_WITH`: the step of the calling process to run after this skill, in one sentence.

The caller has written each draft to `.campaign/state/write/draft/<same path>`. Do not delete `draft/`.

## Working folder

**Step 0.** If `ROUND` is greater than 3, end this skill with `status: FAILED`, reason "three attempts used" (the calling process continues). Otherwise, from the campaign root (the folder containing `campaign.yaml`), keep CAMPAIGN_ROOT: it is the `campaign root:` line of the session check in your context; if that line is not there, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" .` and read that line. Keep the variable `CAMPAIGN_ROOT` for the reviewer prompt.

Every script below is run from the campaign root, as `node "${CLAUDE_PLUGIN_ROOT}/<script path>" . <options>`, with the script path of the list in `allowed-tools` written in full each time.

## Steps

**1. Manual changes.** Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" list . --limit 1`. Exit ≠ 0 → end this skill with `status: FAILED`, reason "versions not readable" (the calling process continues).
- The output is a JSON array. If it is empty (`[]`): this is a new campaign. Record "manual changes: none, no saved version yet" and go to step 1b.
- If it has one entry: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" status .`. If the output says `"clean": true`, go to step 1b. Otherwise run `node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" save-manual . --message "<sentence>"`, where the sentence is "Changes made by hand" in the campaign language. Read `language.main` in `campaign.yaml`: for `it` write `Modifiche fatte a mano`, for `en` write `Changes made by hand`, for any other code translate the English sentence into that language. Then go to step 1b.

**1b. Level.** Run this command from the campaign root, exactly as written, with `--subjects` present only when NEW_SUBJECTS is not empty:
`node "${CLAUDE_PLUGIN_ROOT}/skills/core/write-sequence/scripts/classify-write.mjs" . --files "<DOCUMENTS>" --draft-dir .campaign/state/write/draft [--subjects "<NEW_SUBJECTS>"] --out .campaign/state/write/level.json`

Read the `level:` line of its output, and its `exit:` line.
- Exit code 2, or no `level:` line, or a value other than `low`, `medium` or `high`: LEVEL is `high`. Record `level: high (not computed)`.
- Otherwise LEVEL is the printed value. Record `level: <LEVEL>` and keep the `decided by:` line for the report details.

The level decides review count and the linker path:

- `low` and `medium`: ONE canon-reviewer for the whole batch; the linker runs its light path at `low`, otherwise its normal path.
- `high`: when DOCUMENTS has more than one document, ONE canon-reviewer PER DOCUMENT (step 3); the linker runs its normal path.

Canon review always checks relevant existing canon before any draft is applied. The independent review runs at every level. The level is computed again at each round, because this skill runs again at each round.

**2. Draft.** For each document in DOCUMENTS, Read `.campaign/state/write/draft/<document>`: if Read says it does not exist, or the file is empty, the draft is missing. If any draft is missing: end this skill with `status: FAILED`, reason "draft missing", and list the missing paths (the calling process continues).

**2b. System rules check.** Invoke `yllir:system-adapter` with `OPERATION=check-drafts`, `FILES` set to the comma-separated draft paths `.campaign/state/write/draft/<document>` for every path in DOCUMENTS, and `CONTINUE_WITH="write-sequence step 2b: read the ADAPTER REPORT, then step 3"`. If your tool cannot invoke a named skill, read `${CLAUDE_PLUGIN_ROOT}/skills/library/system-adapter/SKILL.md` with the Read tool or `cat`, and follow it exactly as if invoked, using these inputs. When it finishes, read `.campaign/state/system-adapter/report.txt` with the Read tool; this is the ADAPTER REPORT.
- If the report status is `OK`, record `system rules: passed` and continue.
- If the report status is `NOT_APPLICABLE`, record `system rules: no adapter` and continue.
- If the report status is `NEEDS_ATTENTION`, end this skill with `status: FIX_NEEDED`; in report details, list every `problem:` line with the draft path prefix `.campaign/state/write/draft/` removed. Do not launch the reviewer and do not write documents.
- If the ADAPTER REPORT `status:` line is `FAILED`, end this skill with `status: FAILED`, reason "system rules check not run". Do not launch the reviewer or write documents.
- If the skill returns `status: FAILED`, the report is missing or unreadable, or its `status:` line is absent or unknown, end this skill with `status: FAILED`, reason "system rules check not run". Do not launch the reviewer or write documents.

**3. Independent review.** Unless LEVEL is `high` and DOCUMENTS has more than one document, launch one sub-agent `yllir:canon-reviewer` (the instructions of this sub-agent are in `${CLAUDE_PLUGIN_ROOT}/agents/canon-reviewer.md`; if your tool has no named agents, start a sub-agent, tell it to read that file first and follow it exactly) with the Agent tool. In Codex, always set the model of this sub-agent to GPT-6 Luna in the launch call itself: an omitted model silently becomes the model of the main agent, which is a defect. Its prompt is these lines, with real values:
```
CAMPAIGN_ROOT: <CAMPAIGN_ROOT>
DRAFT_DIR: <CAMPAIGN_ROOT>/.campaign/state/write/draft
DOCUMENTS: <DOCUMENTS>
INTENT: <INTENT>
LEVEL: <LEVEL>
ONLY_CHANGED: <yes or no>
PREVIOUS_ITEMS: <text>
CONTEXT_FILES: <comma-separated paths or empty>
```

`ONLY_CHANGED` is `no` on ROUND 1; on ROUND 2 or 3 it is `yes` when the fixes in the previous review were limited to its reported items, otherwise `no`. `PREVIOUS_ITEMS` is `none` on ROUND 1; on ROUND 2 or 3 it is the `items` of the `review.json` saved in the previous round, copied as text before this round overwrites that file.

Save its answer exactly as received to `.campaign/state/write/review.json` with the Write tool. Then run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/write-sequence/scripts/json-check.mjs" .campaign/state/write/review.json --object`.
- Exit ≠ 0 (not JSON): launch the reviewer once more with the same prompt and save the new answer the same way. If the second answer is also not JSON: end this skill with `status: FAILED`, reason "review not available" (the calling process continues). Nothing is written without a review.
- Valid JSON with `"outcome": "FIX"`: end this skill with `status: FIX_NEEDED` (the calling process continues) and list its items in the report.
- Valid JSON with `"outcome": "ASK"`: end this skill with `status: ASK` (the calling process continues) and put its `question` in the report.
- Valid JSON with `"outcome": "APPLY"`: go to step 4.
- Any other outcome value: end this skill with `status: FAILED`, reason "review not available" (the calling process continues).


**Per-document review (LEVEL `high` and more than one document in DOCUMENTS).** Launch one `yllir:canon-reviewer` for each document in DOCUMENTS, all in the same message, with the Agent tool. Each prompt includes every line above, with the same `ONLY_CHANGED`, `PREVIOUS_ITEMS` and `CONTEXT_FILES` values, except that `DOCUMENTS:` holds only that one document. The same Codex rule applies: set the model of each sub-agent to GPT-6 Luna in its launch call. Number the documents 1, 2, ... in the order of DOCUMENTS. Save each answer exactly as received to `.campaign/state/write/review-<n>.json` with the Write tool. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/write-sequence/scripts/json-check.mjs" .campaign/state/write/review-<n>.json --object` on each. If an answer is not JSON (exit ≠ 0): launch that reviewer once more with the same prompt and save the new answer the same way. If that second answer is also not JSON: end this skill with `status: FAILED`, reason "review not available" (the calling process continues). Once all answers are valid JSON, run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/write-sequence/scripts/aggregate-reviews.mjs" --out .campaign/state/write/review.json .campaign/state/write/review-1.json <...review-n.json in DOCUMENTS order>`. The script validates each reviewer response and builds `review.json`: `ASK` takes precedence over `FIX`, which takes precedence over `APPLY`; the first `ASK` question is retained, and items are concatenated in document order. If aggregation fails (exit ≠ 0), end this skill with `status: FAILED`, reason "review not available". After aggregation, apply the outcome rules above: FIX and ASK stop the write sequence as described there; APPLY goes to step 4. When LEVEL is `high` and DOCUMENTS has only one document, use the single-review path in step 3.

**4. Write.** Run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/write-sequence/scripts/apply-draft.mjs" . --draft-dir .campaign/state/write/draft --files "<DOCUMENTS>" --out .campaign/state/write/applied.json`. The script writes the structured result to `applied.json` and also prints it. Exit ≠ 0 (nothing was written): end this skill with `status: FAILED` (the calling process continues) and list its `errors` from `applied.json` when available.

**5. Links.** Invoke the skill `yllir:linker` (if your tool has no way to invoke a skill, read `${CLAUDE_PLUGIN_ROOT}/skills/library/linker/SKILL.md` with the Read tool or `cat`, and follow it exactly as if it had been invoked, with the same inputs) with `FILES=DOCUMENTS`, `SUBJECTS=NEW_SUBJECTS`, `LEVEL=<LEVEL>` (the current LEVEL), `CONTINUE_WITH="write-sequence step 6 (derived files), then steps 7 and 8"`. At `low` the linker runs its light path, otherwise its normal path. NEW_SUBJECTS must list the id of every NEW character sheet among DOCUMENTS (template npc): if a document in DOCUMENTS is a new sheet and its id is not in NEW_SUBJECTS, add it before invoking the linker. This is what links the documents that mention the new character to its sheet. When it has finished, read `.campaign/state/linker/report.txt` with the Read tool. That file is the LINKER REPORT.
- Its `status:` line is `NEEDS_ATTENTION`: end this skill with `status: VERIFY_FAILED`, list its check errors and other actionable errors in report details, and do not save a version. Ambiguous names under `decisions for the master` do not by themselves block saving.
- Its `status:` line is `FAILED`: end this skill with `status: FAILED`, reason "link verification not run", and do not save a version.
- If its status is `DONE`: record `links: applied <n>` with the number from its `applied:` line. Copy every line under `decisions for the master` into the report details.
- Any other status or a missing report: end this skill with `status: FAILED`, reason "link report unavailable", and do not save a version.

**6. Derived files.** Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/build-index.mjs" . --out .campaign/cache/subjects.json`. Exit ≠ 0: end this skill with `status: FAILED`, reason "index not built", and its printed lines (the calling process continues). The documents already written stay marked "to check".

**7. Deterministic verification.** Run these four commands in this order, and keep the output of each. The linker already checked the full affected scope and its report is authoritative; do not run check-links again here.
- `node "${CLAUDE_PLUGIN_ROOT}/skills/core/write-sequence/scripts/validate-config.mjs" .`
- `node "${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/scripts/generate-instructions.mjs" . --check`
- `node "${CLAUDE_PLUGIN_ROOT}/skills/library/npc-manager/scripts/npc-manager.mjs" . plot-cast --files "<DOCUMENTS>" --out .campaign/state/write/plot-cast.json`
- `node "${CLAUDE_PLUGIN_ROOT}/skills/library/npc-manager/scripts/npc-manager.mjs" . check-sheets --files "<DOCUMENTS>"`

Then decide:
- `validate-config`, `plot-cast` or `check-sheets` exit 1: end this skill with `status: VERIFY_FAILED` (the calling process continues). Put every printed error line in the report details. Do NOT save a version. The caller fixes the draft and calls again with ROUND+1.
  - Do not list `candidate` lines of `plot-cast` as errors. When there is at least one error line, copy every `candidate` line of `plot-cast` into the report details, each prefixed with `candidate (judge before the next round):`. When there is no error line, ignore the `candidate` lines.
- `validate-config`, `plot-cast` or `check-sheets` exit with any code other than 0 or 1: end this skill with `status: FAILED`, reason "verification not run" (the calling process continues).
- `generate-instructions --check` exit 1 (files changed): run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/scripts/generate-instructions.mjs" .`. Exit ≠ 0: end this skill with `status: FAILED`, reason "instructions not regenerated" (the calling process continues). Exit 0: continue.
- `generate-instructions --check` exit ≠ 0 and ≠ 1: end this skill with `status: FAILED`, reason "instructions not checked" (the calling process continues).
- Otherwise record `verification: passed`.

The scripts' result overrides any opinion.

**8. Saved version.** Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" save . --message "<VERSION_MESSAGE>" --kind framework`. Exit ≠ 0, or the JSON has `"saved": false`: end this skill with `status: FAILED`, reason "version not saved" (the calling process continues). Otherwise status `DONE`, and `saved version:` is the `hash` from the JSON.

## Limits

At most three cycles between draft and review, or between write and verification. The caller stops after ROUND 3 (step 0). Never retry a step on your own beyond what is written here.

## Report

Write the report with the Write tool to `.campaign/state/write/report.txt`. Its content is exactly this block, in English. Do not print it, and do not show it to the master.
```
WRITE REPORT
status: DONE | FIX_NEEDED | ASK | VERIFY_FAILED | FAILED
level: <low | medium | high>
documents: <paths, comma-separated>
review: <APPLY | FIX | ASK | not run>
system rules: <passed | no adapter | n problems | not run>
links: <applied n | FAILED | not run>
verification: <passed | n errors | not run>
saved version: <hash | none>
details:
- <one line per conflict, review item, linker decision, verification error or reason for a stop, and, when LEVEL is not `high`, the `decided by:` text of step 1b; "- none" if there are none>
continue with: <CONTINUE_WITH>
```

Your last action in this skill is that Write call. Then, in the same turn, do what the `continue with:` line says. Write nothing else first and print nothing.

Correct example of the content of `report.txt` (a new campaign, documents written, all checks passed):
```
WRITE REPORT
status: DONE
level: low
documents: World/Varn.md, World/Old Mill.md
review: APPLY
system rules: passed
links: applied 2
verification: passed
saved version: 3f2a9c1
details:
- none
continue with: write-sequence step 6 (derived files), then steps 7 and 8
```

When the adapter reports problems, use the count in the `system rules:` field and list every problem in `details:`:
```
WRITE REPORT
status: FIX_NEEDED
level: high
documents: Creatures/Guardiano.md
review: not run
system rules: 1 problem
links: not run
verification: not run
saved version: none
details:
- Creatures/Guardiano.md: missing-field: missing field: con
continue with: <CONTINUE_WITH>
```

Wrong example, do not do this: step 3 is skipped, and the document is written with the Write tool before any review exists. Documents are written only by `apply-draft.mjs`, and only after `review.json` says `APPLY`.

## Rules

- Only `apply-draft.mjs` writes campaign documents. Only `versions.mjs` saves versions.
- Never edit a document with your own tools, not even to fix a verification error. The caller fixes the draft.
- Never put master-block text in the report. Refer to file and line.
- Never change a sub-agent's answer. Save it exactly as received.
- Run every command from the campaign root.
- Never print the WRITE REPORT, never show it to the master, and never end your turn with it.
- The sheet of a character and the plot events that use it are written in the same write sequence, so the reviewer can check them together.
- The level decides review count and which linker path runs. The reviewer is the sole semantic gate before writing.
- On ROUND 2 or 3, set `ONLY_CHANGED: yes` only when the scope of the fixes is limited to items reported in the previous review. The reviewer always reads the whole draft and checks that each previous item is fixed and that the fixes introduced no new problem. Otherwise set `ONLY_CHANGED: no` and run the full relevant-context review. Pass `CONTEXT_FILES` to every reviewer prompt, including per-document prompts; if it is empty, pass an empty value.
