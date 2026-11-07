---
name: continuity-audit
description: Library skill. Checks Yllir campaign documents for contradictions using structured fact extraction, mechanical comparison and an independent judge, and reports what was covered. Invoked by Yllir core processes before a document is modified (pre mode) or on request for the whole campaign (full mode). Never modifies campaign documents.
user-invocable: false
---

# Continuity audit

Scripts build the subject index, validate facts and compare them. Sub-agents read documents, extract facts and judge candidates. You only run commands, launch sub-agents, save their answers and return the report. Never read campaign documents yourself, never extract facts yourself, never judge candidates yourself, and never edit campaign documents.

## Inputs

The caller gives:
- `MODE`: `pre` or `full`. Default `pre`.
- `FILES` and/or `SUBJECTS`: comma-separated campaign-relative paths and subject ids. Required in `pre` mode. In `full` mode, pass neither.
- `CHANGE`: one sentence describing the planned modification. Pre mode only. Default: "not described".

If `MODE` is `pre` and both `FILES` and `SUBJECTS` are empty, stop and ask the caller which files or subjects to audit. Do not audit the whole campaign.

## Working folder

**Step 0.** Run every command from the campaign root (the folder containing `campaign.yaml`).
Run `rm -rf .campaign/state/audit && mkdir -p .campaign/state/audit/facts`, then run `pwd` and keep its output as CAMPAIGN_ROOT. All files below go in `.campaign/state/audit/`.

## Steps

**Step 1 — Index and scope.** Run:
`node "${CLAUDE_PLUGIN_ROOT}/scripts/build-index.mjs" . --out .campaign/state/audit/subjects.json`
- Exit 1: stop. Report status `FAILED` with the printed errors.
- Exit 0: run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/scripts/audit-scope.mjs" . --mode <MODE> --files "<FILES>" --subjects "<SUBJECTS>" --out .campaign/state/audit/scope.json`. Omit `--files` if FILES is empty. Omit `--subjects` if SUBJECTS is empty. Omit both in `full` mode.
- Exit 1 from audit-scope: stop. Report status `FAILED` with the printed errors.
- Any other exit code: stop. Report status `FAILED`, reason "index not run" or "scope not run".

**Step 2 — Extract.** Read `.campaign/state/audit/scope.json`. Its `files` array holds entries `{ fid, document }`. Keep their order. Split them into batches of at most 4 entries. Launch one `yllir:audit-extractor` sub-agent per batch with the Agent tool, all in the same message. The prompt of each is exactly this, with the real values:
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

**Step 4 — Compare.** Run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/scripts/audit-compare.mjs" . --facts .campaign/state/audit/facts.json --out .campaign/state/audit/candidates.json`
- Exit 0 or 1: keep the printed candidate lines and go to Step 5. Exit 1 means coverage is incomplete: the first printed line is `WARNING: coverage incomplete`. The comparison is still written and valid, so ignore the WARNING line when counting candidates.
- Exit 2 or any other code: stop. Report status `FAILED`, reason "compare not run".

**Step 5 — Judge.** Count the candidate lines printed by Step 4. A candidate line is a printed line that starts with `C` followed by digits (for example `C001 `). The summary line `facts: …` and the `WARNING` line are not candidates.
- Zero candidates: write `[]` to `.campaign/state/audit/judgments.json` with the Write tool. Go to Step 6.
- One or more: launch `yllir:audit-judge` with the Agent tool. The prompt is exactly these lines, with the real values:
  ```
  CAMPAIGN_ROOT: <CAMPAIGN_ROOT>
  CANDIDATES: <CAMPAIGN_ROOT>/.campaign/state/audit/candidates.json
  MODE: <MODE>
  CHANGE: <CHANGE>
  SCOPE_SUBJECTS: <the subjects of scope.json, comma-separated>
  ```
  Save its answer exactly as received to `.campaign/state/audit/judgments.json` with the Write tool. Do not judge the candidates yourself.

**Step 6 — Coverage review.** Run this step only when Step 4 printed zero candidates. Launch `yllir:audit-coverage-reviewer` with the Agent tool. The prompt is exactly these lines:
```
CAMPAIGN_ROOT: <CAMPAIGN_ROOT>
FACTS: <CAMPAIGN_ROOT>/.campaign/state/audit/facts.json
VOCABULARY: ${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/audit-vocabulary.yaml
```
Save its answer exactly as received to `.campaign/state/audit/coverage-review.json` with the Write tool. When Step 4 printed candidates, skip this step.

**Step 7 — Report.** Run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/scripts/audit-report.mjs" --scope .campaign/state/audit/scope.json --facts .campaign/state/audit/facts.json --candidates .campaign/state/audit/candidates.json --judgments .campaign/state/audit/judgments.json --out .campaign/state/audit/report.json --text .campaign/state/audit/report.txt`
Add `--coverage-review .campaign/state/audit/coverage-review.json` only when Step 6 ran.
- Exit 0 (COMPLETE) or 1 (INCOMPLETE): go to "Return".
- Exit 3 (INVALID): if you have already launched the judge again twice, go to "Return". Otherwise launch `yllir:audit-judge` again with the Step 5 prompt plus one line `PROBLEMS:` followed by the printed problem lines, one per line. Save its answer exactly as received to `judgments.json`. Run the Step 7 command again.
- Exit 2 or any other code: stop. Report status `FAILED` with the printed lines.

**Return.** Your whole answer is the printed text of `audit-report.mjs`, verbatim. Add nothing before or after it.

## Rules

- Never modify campaign documents. Write only under `.campaign/state/audit/`.
- Never state "no problems" yourself. Only the report script decides the status. An empty problem list is valid only with status COMPLETE.
- Facts from notes are hypotheses. Never present them as problems.
- Do not quote master-block text in the reports, judgments or reasons you write. Fact quotes written by the extractors are the exception, because the validation script checks them.
- Do not change the sub-agents' answers. If an answer is wrong, send it back through the retry rounds above.

## Examples

Correct return (COMPLETE, one problem, one perspective). The layout is what the script prints; your answer is that text only:
```
CONTINUITY AUDIT
status: COMPLETE
mode: pre
scope: 2 documents, 1 subject (ada-rook)
problems: 1
- perspective, ada-rook, date.born
  Characters/Ada Rook.md:14 (source-claim), Plot/Arc One/Session 2.md:9 (editorial-summary)
not checked: none
```

Wrong return, do not produce this:
```
No contradictions found.
```
The executor wrote this without running `audit-report.mjs`. Only the report script can state the result.
