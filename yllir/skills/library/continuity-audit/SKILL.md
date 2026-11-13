---
name: continuity-audit
description: Library skill. Checks the whole Yllir campaign for contradictions using structured fact extraction, mechanical comparison and an independent judge, and reports what was covered. The same report also lists structural and narrative problems (the doctor part: broken structure, unused characters and sketches, open threads nobody picks up, unreachable plot nodes) with a proposed solution for each, mechanical or narrative. Invoked only when the master asks for a check of the whole campaign (full mode). Never modifies campaign documents.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/build-index.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" query . *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" check . *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" commit . *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/scripts/audit-scope.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/scripts/audit-cache.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/scripts/coverage-review-cache.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/scripts/audit-validate.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/scripts/audit-compare.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/scripts/audit-report.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/scripts/doctor-report.mjs" *), Read, Write, Agent, Bash(node */scripts/session-start.mjs *), Bash(node */scripts/build-index.mjs *), Bash(node */scripts/engine.mjs query . *), Bash(node */scripts/engine.mjs check . *), Bash(node */scripts/engine.mjs commit . *), Bash(node */skills/library/continuity-audit/scripts/audit-scope.mjs *), Bash(node */skills/library/continuity-audit/scripts/audit-cache.mjs *), Bash(node */skills/library/continuity-audit/scripts/coverage-review-cache.mjs *), Bash(node */skills/library/continuity-audit/scripts/audit-validate.mjs *), Bash(node */skills/library/continuity-audit/scripts/audit-compare.mjs *), Bash(node */skills/library/continuity-audit/scripts/audit-report.mjs *), Bash(node */skills/library/continuity-audit/scripts/doctor-report.mjs *)
---

# Continuity audit

The master asks for this check directly, for the whole campaign. The AUDIT REPORT is a file for you: read it and tell the master the result in plain words (see Return). Never paste it.

**Commands.** Run each command exactly as written in this file, as one single command: nothing before it and nothing after it, no `;`, `&&`, `|`, `2>&1`, `echo`, `cat`, `mkdir` or `cd`. Anything added makes the command refused. Every script prints its result and, as its last line, `exit: <code>`: read the exit code from that line (the `exit:` line). Read result files with the Read tool. If a command is refused, run it again exactly as written, with nothing added; if it is refused again, end this skill with `status: FAILED`, reason "permission refused".

Scripts build the subject index, validate facts and compare them. Sub-agents read documents, extract facts and judge candidates. You only run commands, launch sub-agents, save their answers and return the report. Never read campaign documents yourself, never extract facts yourself, never judge candidates yourself, and never edit campaign documents. The one exception is Step 8 (doctor): you read the chronicle pages and later sessions it names, and nothing else.

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
- Exit 0 (COMPLETE) or 1 (INCOMPLETE): go to Step 8.
- Exit 3 (INVALID): if you have already launched the judge again twice, go to "Return". Otherwise launch `yllir:audit-judge` again with the Step 5 prompt plus one line `PROBLEMS:` followed by the printed problem lines, one per line. Save its answer exactly as received to `judgments.json`. Run the Step 7 command again.
- Exit 2 or any other code: end this skill with status `FAILED`, with the printed lines.

**Step 8 — Doctor.** Every full check runs this step, after Step 7 exits 0 or 1. It adds the doctor section to the same report. It never corrects anything.

8a. **Engine queries.** Run each of these five commands exactly as written, one command each, from the campaign root:
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" query . errors`
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" query . sketches`
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" query . unreachable`
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" query . forgotten`
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" query . prices`

Read the JSON each one prints: its `results` list. For `prices`, also read `economy`: when it is `missing`, there is no price check, so the prices state is `missing` and you say nothing about prices. For each query write its state in the coverage: `ran` when it printed its results, `failed` when the command failed, `missing` only for prices as above.

8b. **Structural problems**, kind `structural`. Each result becomes one problem:
- `errors`: each entry. Severity high when it breaks a link, an id or metadata the engine needs; medium otherwise; low for layout only.
- `unreachable`: each entry. Severity high for an event or session that can never be played; the solution is mechanical when a dependency id is misspelled, narrative otherwise.
- `prices`: `out-of-range` and `unknown-currency` entries are medium, one problem each. All `unmatched` entries are minor: put them in ONE problem, severity low, titled with their count, with all their files as documents.

8c. **Narrative problems**, kind `narrative`. You judge them:
- Forgotten characters: each `forgotten` entry is a problem. Severity medium for a character with a sheet that is not a sketch; low when `sketch: true`.
- Sketches never used: a `sketches` entry whose id also appears in `forgotten` is a sketch that nothing uses. Severity low. Do not read sketches to decide this.
- Open threads: read every chronicle page (the documents of the chronicle category, found by its folder in `campaign.yaml`) and, for each one, the sessions and events that come after it in time. In a chronicle page, the threads are the list under `## Fili aperti` or `## Open threads`. For each thread, decide whether a later session or event picks it up. A thread that nothing later picks up is a problem: severity medium, kind narrative. Read nothing else.
- Wanted mystery or gap: a thread or a secret is NOT a problem when the master block of the document that holds it marks it as intentional (for example, the master block says a clue stays hidden until a given session). Example of a gap: a chronicle page leaves open who guards the bridge, and no later session mentions the guard. Example of a wanted mystery: the master block of a lighthouse sheet says its keeper's past stays secret until session 9, on purpose. Never quote master-block text in the report: say only that the document marks it as intentional.
- Every narrative problem has a solution. Mark a solution `mechanical` only when it is a rename, merge, delete or move (continuity-keeper does it after the master's yes). Any solution that adds, changes or chooses a fact is `narrative`: it stays a proposal, and you never state a new fact as canon.

8d. **Exclusions.** Read `campaign.yaml` (it is configuration, not a document). Drop every problem that matches an entry of `audit.exclusions`: same `subject`, `attribute` equal to the problem's `check`, and `values` containing the problem's `value`. Dropped problems are not reported again.

8e. **Coverage.** Record the chronicle pages and sessions you read in `coverage.read`, by title. A problem list may be empty only when every query ran (prices may be missing) and at least one page was read.

8f. **Write the judgments.** Write `.campaign/state/audit/doctor.json` with the Write tool, in exactly this shape (no other keys):
```
{
  "coverage": {
    "queries": { "errors": "ran", "sketches": "ran", "unreachable": "ran", "forgotten": "ran", "prices": "ran" },
    "read": ["<title of each chronicle page or session read>"]
  },
  "problems": [
    {
      "title": "<short statement of the problem>",
      "severity": "high | medium | low",
      "kind": "structural | narrative",
      "documents": ["<title of each document involved>"],
      "evidence": "<what you saw, in one or two sentences>",
      "subject": "<id of the subject concerned>",
      "check": "doctor.error | doctor.unreachable | doctor.price | doctor.forgotten | doctor.sketch | doctor.open-thread",
      "value": "<short key that identifies this problem, same text every run>",
      "solutions": [ { "text": "<one proposed solution>", "type": "mechanical | narrative" } ]
    }
  ]
}
```
The `value` of an open thread is the first words of the thread. The `value` of a structural entry is its code or its message as printed by the query.

8g. **Validate and write.** Run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/continuity-audit/scripts/doctor-report.mjs" --audit .campaign/state/audit/report.txt --input .campaign/state/audit/doctor.json --out .campaign/state/audit/report-full.txt`
- Exit 0: the full report is `.campaign/state/audit/report-full.txt`. Go to "Return".
- Exit 3: it printed the reasons. Fix `doctor.json` with the Write tool, once, and run the command again. If it fails again, go to "Return" with `report.txt` and say that the doctor section could not be validated.
- Any other exit code: go to "Return" with `report.txt` and say that the doctor section did not run.

**Return.** Do not print the report. Read the final report file (`.campaign/state/audit/report-full.txt` when Step 8 wrote it, otherwise `.campaign/state/audit/report.txt`) and tell the master the result in plain words, in the campaign language. Give the contradictions result first, then the problems from the doctor, highest severity first, one line each, with their documents. Say which solutions are mechanical (one yes applies them through continuity-keeper) and which are narrative (the master chooses one for each). When the master says to leave a problem open, record it as follows. Read `campaign.yaml` with the Read tool, add one entry to its `audit.exclusions` list (create the `audit` and `exclusions` keys if missing), with `subject`, `attribute` (the problem's `check`), `values` (its `value` in a list), `reason` (the master's words, short) and `date` (today). Write the whole file, every other line unchanged, to `.campaign/drafts/campaign.yaml` with the Write tool. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" check . --files "campaign.yaml"`, then `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" commit . --files "campaign.yaml" --message "<one sentence in the campaign language, for example «Problema lasciato aperto: <title>.»>"`. Read `ok` in the output: when it is false, say in one sentence the lexicon's fixed sentence for an operation that could not be finished (Italian: «Non sono riuscito a completare questa operazione. Non è stato perso nulla: possiamo riprovare.»; English: «I could not complete this operation. Nothing was lost: we can try again.»). Never paste the report.

## Rules

- Never modify campaign documents. Write only under `.campaign/state/audit/`, and `campaign.yaml` only for a recorded exclusion, saved as a version through the engine (Return).
- Never modify external documents, and never propose changing one: when an external fact contradicts a campaign document, the campaign document is the one to change. The report line `external documents (read only, shared world): N in scope, read R, not read M` must be carried into the result given to the master; a read count below the scope count is a coverage gap, not a clean audit.
- Never state "no problems" yourself. Only the report script decides the status. An empty problem list is valid only with status COMPLETE.
- Facts from notes are hypotheses. Never present them as problems.
- Do not quote master-block text in the reports, judgments or reasons you write. Fact quotes written by the extractors are the exception, because the validation script checks them.
- Do not change the sub-agents' answers. If an answer is wrong, send it back through the retry rounds above.

## Examples

The report stays in `.campaign/state/audit/report.txt`. Never print it and never paste it into a message.

Correct last actions (the report script exits 0, status COMPLETE, one problem):
1. Run the report script, with its full command from Step 7. Its output is not shown to the master.
2. Read `report-full.txt` (or `report.txt` when Step 8 did not write it) with the Read tool and tell the master the result in plain words, in the campaign language.

Wrong last actions, do not do this:
```
CONTINUITY AUDIT
status: COMPLETE
problems: 1
...
```
The report block printed as the answer is wrong: the master gets plain words, not the report. A bare "No contradictions found." is also wrong: only the report script decides the status, and its result is read from `report.txt`.
