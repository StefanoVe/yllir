---
name: continuity-audit
description: Library skill. Checks the whole Yllir campaign for contradictions using structured fact extraction, mechanical comparison and an independent judge, and reports what was covered. Invoked only when the master asks for a check of the whole campaign (full mode). Never modifies campaign documents.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/build-index.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/scripts/audit-scope.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/scripts/audit-cache.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/scripts/coverage-review-cache.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/scripts/audit-validate.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/scripts/audit-compare.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/scripts/audit-report.mjs" *), Read, Write, Agent, Bash(node */scripts/session-start.mjs *), Bash(node */scripts/build-index.mjs *), Bash(node */skills/library/continuity-audit/scripts/audit-scope.mjs *), Bash(node */skills/library/continuity-audit/scripts/audit-cache.mjs *), Bash(node */skills/library/continuity-audit/scripts/coverage-review-cache.mjs *), Bash(node */skills/library/continuity-audit/scripts/audit-validate.mjs *), Bash(node */skills/library/continuity-audit/scripts/audit-compare.mjs *), Bash(node */skills/library/continuity-audit/scripts/audit-report.mjs *)
---

# Continuity audit

The master asks for this check directly, for the whole campaign. The AUDIT REPORT is a file for you: read it and tell the master the result in plain words (see Return). Never paste it.

**Commands.** Run each command exactly as written in this file, as one single command: nothing before it and nothing after it, no `;`, `&&`, `|`, `2>&1`, `echo`, `cat`, `mkdir` or `cd`. Anything added makes the command refused. Every script prints its result and, as its last line, `exit: <code>`: read the exit code from that line (the `exit:` line). Read result files with the Read tool. If a command is refused, run it again exactly as written, with nothing added; if it is refused again, end this skill with `status: FAILED`, reason "permission refused".

Scripts build the subject index, validate facts and compare them. Sub-agents read documents, extract facts and judge candidates. You only run commands, launch sub-agents, save their answers and return the report. Never read campaign documents yourself, never extract facts yourself, never judge candidates yourself, and never edit campaign documents.

## Inputs

There is no input. The master asks for the check of the whole campaign, and the skill always runs in full mode (`--mode full`), with no files, no subjects and no change description. A request about one part of the campaign is not served by this skill: tell the master in plain words that the check covers the whole campaign.

**External documents.** Categories of type `external` (read-only folders of another campaign or shared world) are canon for the comparison: their documents are read and their facts are checked against the campaign. They are never modified. Their facts carry `external: true`; the report counts them on their own line.

## Working folder

**Step 0.** Run every command from the campaign root (the folder containing `campaign.yaml`).
Keep CAMPAIGN_ROOT: it is the `campaign root:` line of the session check in your context; if that line is not there, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" .` and read that line. All files below go in `.campaign/state/audit/`. This step does not delete the fact cache in `.campaign/cache/facts`; Step 1 resets the audit folder.

## Steps

**Step 1 — Scope and index.** Run the scope first. It resets the audit folder (`--reset`), so the index is written only after it.
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/scripts/audit-scope.mjs" . --reset --mode full --out .campaign/state/audit/scope.json`.
- Exit 1 from audit-scope: end this skill with status `FAILED`, with the printed errors.
- Exit 0: the printed line gives the number of documents and of external documents (read only) in scope. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/build-index.mjs" . --out .campaign/state/audit/subjects.json`. Exit 1: end this skill with status `FAILED`, with the printed errors. Exit 0: go to Step 1b.
- Any other exit code: end this skill with status `FAILED`, reason "scope not run" or "index not run".

**Step 1b — Cache.** Run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/scripts/audit-cache.mjs" fill . --scope .campaign/state/audit/scope.json --facts-dir .campaign/state/audit/facts --cache-dir .campaign/cache/facts`
The script copies cached facts into `.campaign/state/audit/facts/` for every document whose content hash is unchanged. It prints `cache: H hits, M to extract`, then one line `<fid> <document>` per document still to extract. Keep those lines as the extraction list.
- Exit 0: go to Step 2 if M is not 0; if M is 0, skip Step 2 and go to Step 3.
- Any other exit code: end this skill with status `FAILED`, reason "cache not run".

**Step 2 — Extract.** Take the `<fid> <document>` lines listed by Step 1b, in their order. Split them into batches of at most 4 entries. Launch one `yllir:audit-extractor` sub-agent (the instructions of this sub-agent are in `${CLAUDE_PLUGIN_ROOT}/agents/audit-extractor.md`; if your tool has no named agents, start a sub-agent, tell it to read that file first and follow it exactly) per batch with the Agent tool, all in the same message. The prompt of each is exactly this, with the real values:
```
CAMPAIGN_ROOT: <CAMPAIGN_ROOT>
SUBJECTS_INDEX: <CAMPAIGN_ROOT>/.campaign/state/audit/subjects.json
VOCABULARY: ${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/audit-vocabulary.yaml
OUT_DIR: <CAMPAIGN_ROOT>/.campaign/state/audit/facts
DOCUMENTS:
<fid> <document>
...
```
Wait until every extractor has finished. Do not extract facts yourself.

**Step 3 — Validate.** Run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/scripts/audit-validate.mjs" . --scope .campaign/state/audit/scope.json --facts-dir .campaign/state/audit/facts --out .campaign/state/audit/facts.json`
Keep the printed output. Each printed line `<fid>#<n> <reason>` is a discarded fact.
- Exit 0 and no discarded-fact lines: go to Step 4.
- Otherwise, if you have already run 2 retry rounds: go to Step 4. The report will say what was not checked.
- Otherwise, start a retry round. Take the fids whose `status` is `to-read` in the `coverage` list of `facts.json`, plus every fid with a discarded-fact line. Launch `yllir:audit-extractor` for them, one batch of at most 4 per sub-agent, all in the same message. Use the Step 2 prompt, with `DOCUMENTS` listing only those fids. Add a `FIX:` block at the end, with one line per discarded fact of that fid, `<fid>#<n> <reason>`. Fids that are only `to-read` get no `FIX:` block. Then run the Step 3 command again.

**Store cache.** Every route out of Step 3 (validated, or retry limit reached) comes here, after the last audit-validate run and before anything else. Run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/scripts/audit-cache.mjs" store . --facts .campaign/state/audit/facts.json --cache-dir .campaign/cache/facts`
Then go to Step 4. Exit code not 0: end this skill with status `FAILED`, reason "cache store not run".

**Step 4 — Compare.** Run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/scripts/audit-compare.mjs" . --facts .campaign/state/audit/facts.json --out .campaign/state/audit/candidates.json`
- Exit 0 or 1: keep the printed candidate lines and go to Step 5. Exit 1 means coverage is incomplete: the first printed line is `WARNING: coverage incomplete`. The comparison is still written and valid, so ignore the WARNING line when counting candidates.
- Exit 2 or any other code: end this skill with status `FAILED`, reason "compare not run".

**Step 5 — Judge.** Count the candidate lines printed by Step 4. A candidate line is a printed line that starts with `C` followed by digits (for example `C001 `). The summary line `facts: …` and the `WARNING` line are not candidates.
- Zero candidates: write `[]` to `.campaign/state/audit/judgments.json` with the Write tool. Go to Step 6.
- One or more: launch `yllir:audit-judge` (the instructions of this sub-agent are in `${CLAUDE_PLUGIN_ROOT}/agents/audit-judge.md`; if your tool has no named agents, start a sub-agent, tell it to read that file first and follow it exactly) with the Agent tool. The prompt is exactly these lines, with the real values:
  ```
  CAMPAIGN_ROOT: <CAMPAIGN_ROOT>
  CANDIDATES: <CAMPAIGN_ROOT>/.campaign/state/audit/candidates.json
  MODE: full
  CHANGE: not described
  SCOPE_SUBJECTS: <the subjects of scope.json, comma-separated>
  ```
  Save its answer exactly as received to `.campaign/state/audit/judgments.json` with the Write tool. Do not judge the candidates yourself.

**Step 6 — Coverage review.** Run this step only when Step 4 printed zero candidates. First run the deterministic cache lookup:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/scripts/coverage-review-cache.mjs" lookup . --facts .campaign/state/audit/facts.json --scope .campaign/state/audit/scope.json --review .campaign/state/audit/coverage-review.json --key-out .campaign/state/audit/coverage-review-key.txt --out .campaign/cache/audit-coverage --vocab "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/audit-vocabulary.yaml" --instructions "${CLAUDE_PLUGIN_ROOT}/agents/audit-coverage-reviewer.md"`
If the command exits nonzero for any reason, treat it as a cache miss and run the reviewer. If it prints `coverage review: reused`, skip the reviewer and go to Step 7 with the cached report. If it prints `coverage review: run reviewer`, launch `yllir:audit-coverage-reviewer` (the instructions of this sub-agent are in `${CLAUDE_PLUGIN_ROOT}/agents/audit-coverage-reviewer.md`; if your tool has no named agents, start a sub-agent, tell it to read that file first and follow it exactly) with the Agent tool. The prompt is exactly these lines:
```
CAMPAIGN_ROOT: <CAMPAIGN_ROOT>
FACTS: <CAMPAIGN_ROOT>/.campaign/state/audit/facts.json
VOCABULARY: ${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/audit-vocabulary.yaml
```
Save its answer exactly as received to `.campaign/state/audit/coverage-review.json` with the Write tool. When Step 4 printed candidates, skip this step.
After saving the answer, run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/scripts/coverage-review-cache.mjs" store . --facts .campaign/state/audit/facts.json --scope .campaign/state/audit/scope.json --review .campaign/state/audit/coverage-review.json --key-file .campaign/state/audit/coverage-review-key.txt --out .campaign/cache/audit-coverage --vocab "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/audit-vocabulary.yaml" --instructions "${CLAUDE_PLUGIN_ROOT}/agents/audit-coverage-reviewer.md"`
The cache stores only `CONFIRMED` reviews with no missed files, complete validated facts, and no unread or discarded facts. Its key covers the facts, vocabulary, all scoped document contents, and reviewer instructions. The store step must match the key captured before the reviewer ran; if dependencies changed, it prints `not cached`. If lookup exits nonzero, run the reviewer. If store exits nonzero, continue to the report without caching. Never reuse an incomplete, missed, malformed, or invalid review.

**Step 7 — Report.** Run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/scripts/audit-report.mjs" --scope .campaign/state/audit/scope.json --facts .campaign/state/audit/facts.json --candidates .campaign/state/audit/candidates.json --judgments .campaign/state/audit/judgments.json --out .campaign/state/audit/report.json --text .campaign/state/audit/report.txt`
Add `--coverage-review .campaign/state/audit/coverage-review.json` only when Step 6 ran.
- Exit 0 (COMPLETE) or 1 (INCOMPLETE): go to "Return".
- Exit 3 (INVALID): if you have already launched the judge again twice, go to "Return". Otherwise launch `yllir:audit-judge` again with the Step 5 prompt plus one line `PROBLEMS:` followed by the printed problem lines, one per line. Save its answer exactly as received to `judgments.json`. Run the Step 7 command again.
- Exit 2 or any other code: end this skill with status `FAILED`, with the printed lines.

**Return.** Do not print the report. Read `.campaign/state/audit/report.txt` and tell the master the result in plain words, in the campaign language. Never paste the report.

## Rules

- Never modify campaign documents. Write only under `.campaign/state/audit/`.
- Never modify external documents, and never propose changing one: when an external fact contradicts a campaign document, the campaign document is the one to change. The report line `external documents (read only, shared world): N in scope, read R, not read M` must be carried into the result given to the master; a read count below the scope count is a coverage gap, not a clean audit.
- Never state "no problems" yourself. Only the report script decides the status. An empty problem list is valid only with status COMPLETE.
- Facts from notes are hypotheses. Never present them as problems.
- Do not quote master-block text in the reports, judgments or reasons you write. Fact quotes written by the extractors are the exception, because the validation script checks them.
- Do not change the sub-agents' answers. If an answer is wrong, send it back through the retry rounds above.

## Examples

The report stays in `.campaign/state/audit/report.txt`. Never print it and never paste it into a message.

Correct last actions (the report script exits 0, status COMPLETE, one problem):
1. Run the report script, with its full command from Step 7. Its output is not shown to the master.
2. Read `report.txt` with the Read tool and tell the master the result in plain words, in the campaign language.

Wrong last actions, do not do this:
```
CONTINUITY AUDIT
status: COMPLETE
problems: 1
...
```
The report block printed as the answer is wrong: the master gets plain words, not the report. A bare "No contradictions found." is also wrong: only the report script decides the status, and its result is read from `report.txt`.
