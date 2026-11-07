# Testbench

The testbench holds synthetic campaigns, each with an answer key, and the runners that grade a framework component against them.

- `fixtures/<name>/campaign/`: a synthetic campaign. It is the only part an agent under test works on.
- `fixtures/<name>/key.yaml`: the answer key: what the component must find and what it must not.
- `runners/`: scripts that run a component or grade its output against a key.

Rule: an agent under test receives only a COPY of `campaign/`. It never sees `key.yaml`, because an agent that can read the key measures copying, not finding. Runners read both files from the repository.

Layout:

```text
testbench/
  fixtures/morvalle/campaign/   synthetic campaign (Italian)
  fixtures/morvalle/key.yaml    answer key for the mention scanner
  runners/check-scan.mjs        grades the deterministic mention scanner
```

Grade the mention scanner:

```sh
node testbench/runners/check-scan.mjs [fixtureDir] [--json <file>]
```

A mention may set `occurrence: N` (1-based) to pick the N-th scanner occurrence on its line for its subject, leftmost first; without it, the mention takes the leftmost occurrence no other mention has consumed.

The default fixture is `fixtures/morvalle`. The campaign is scanned in memory; nothing is written into the fixture. The runner prints one `FAIL` line per failing mention, one `UNEXPECTED` line per unexplained occurrence, and a summary. `--json` also writes a machine-readable report.

Exit codes: 0 when every mention passes and there are no unexpected occurrences; 1 otherwise; 2 when the key or the campaign cannot be read.

Run a case of the continuity audit end to end (runs `claude -p` with the plugin, so it costs money and takes 10+ minutes per run):

```sh
node testbench/runners/run-audit-case.mjs testbench/cases/audit/full [--runs N] [--model haiku] [--keep]
node testbench/runners/run-audit-case.mjs testbench/cases/audit/full --grade-only <copyPath>
```

The agent works on a temporary git copy of `fixtures/morvalle/campaign/`. The runner grades `.campaign/state/audit/report.json` and the other audit files left in the copy against `key.yaml`: recall of the contradictions, no problem for perspectives, hypotheses or recorded exclusions, no change to the documents, and one judgment per candidate. False alarms are reported and do not fail a run. `--keep` keeps the copy for inspection; `--grade-only` grades a kept copy again without running the agent and prints the record without appending it to the results.

Each run appends one JSON line to `results/<case>.jsonl` with the model, the hash of the audit instructions, the checks, the report text, cost and duration. Shared helpers for the runners are in `runners/lib/case-common.mjs`.

Run the new-campaign case end to end (the agent starts from an empty folder, answers the master's prompt from `cases/new-campaign/<case>/case.yaml`, and the runner grades the settings, the world document, the instructions, the saved version, the links, the plain words of the final message, the absence of extra files and the independent review; costs money and takes 10+ minutes per run):

```sh
node testbench/runners/run-new-campaign-case.mjs testbench/cases/new-campaign/all-answers [--runs N] [--model haiku] [--keep]
node testbench/runners/run-new-campaign-case.mjs testbench/cases/new-campaign/all-answers --grade-only <dir>
```

With `--keep` the empty folder is kept and its final message and cost are saved beside it as `<dir>.run.json`, so `--grade-only` reproduces the record.
