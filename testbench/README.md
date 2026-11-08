# Testbench

The testbench holds synthetic campaigns, each with an answer key, and the runners that grade a framework component against them.

- `fixtures/<name>/campaign/`: a synthetic campaign. It is the only part an agent under test works on.
- `fixtures/<name>/key.yaml`: the answer key: what the component must find and what it must not.
- `runners/`: scripts that run a component or grade its output against a key.

Rule: an agent under test receives only a COPY of `campaign/`. It never sees `key.yaml`, because an agent that can read the key measures copying, not finding. Runners read both files from the repository.

Permissions: the case runners run the agent in strict mode, as a real master's campaign runs it: `claude -p` gets `--permission-mode manual --permission-prompts none` (anything that would prompt is refused, nothing is asked) and `--settings runners/lib/strict-settings.json`, which allows only `Skill(yllir:*)` and `Edit(.campaign/state/**)`. Each skill's own `allowed-tools` adds to these. The runners used to pass a broad `--allowedTools` list (shell, read, write, search), which granted far more than a master has. The explicit `--settings` file stands in for two things a real setup has and a test folder lacks: the project settings, which Claude Code ignores in an untrusted folder, and the rule the installer writes at user level in an empty folder. Each record stores `permission_mode: "strict"`, so results from older runs, which lack the field, can be told apart.

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

Every runner takes the same `--agent claude|codex` option (default `claude`), handled in `parseCommonArgs` and run through `runAgent` in `runners/lib/case-common.mjs`, so Claude and Codex results are comparable. `--agent codex` runs the agent with `codex exec` (workspace-write sandbox) and gives it no model unless `--model` is passed; each record stores `agent` (`claude` or `codex`) and `model` (the model, or `codex-default`). The summary's last line names the agent too. A multi-turn case under Codex resumes the last session in the folder with `codex exec resume`. Codex reads the plugin through `yllir/.codex-plugin/plugin.json`, whose `skills` is the single folder `./skills/` (it holds both `core` and `library`). The runner only grants Codex writes to `.git` (which its workspace-write sandbox blocks by default) and tells Codex in the prompt where the plugin is, standing in for plugin discovery; the skills and generated instructions are expected to handle the rest. A real Codex install needs the same `.git` permission for the saved versions to work.

Run the entry-point cases end to end (each case builds the morvalle fixture with two saved versions in a temporary folder, then runs the entry point on an existing campaign with the case prompt from `cases/entry/<case>/case.yaml`; costs money and takes a few minutes per run):

```sh
node testbench/runners/run-entry-case.mjs testbench/cases/entry/go-back [--runs N] [--model haiku] [--keep]
node testbench/runners/run-entry-case.mjs testbench/cases/entry/where-and-question [--runs N] [--model haiku] [--keep]
node testbench/runners/run-entry-case.mjs testbench/cases/entry/not-available [--runs N] [--model haiku] [--keep]
node testbench/runners/run-entry-case.mjs testbench/cases/entry/go-back --setup-only
node testbench/runners/run-entry-case.mjs testbench/cases/entry/go-back --grade-only <dir> --run-json <dir>.run.json
```

The checks are E1 to E5 (go back: card restored, history kept, nothing else changed, plain words, Italian), W1 to W4 (where we left off and a question: no writes, summary, answer, plain words) and N1 to N4 (not available: no writes, says it is not there yet, offers what exists, plain words). With `--keep` the folder and its final message, cost and setup values are saved beside it as `<dir>.run.json`, which `--grade-only` needs.

Run the prepare-session cases end to end (each builds the morvalle fixture with two saved versions, then runs the entry point with the case prompt; `prepare-proceed` runs one message, `prepare-two-turns` runs a first message that must ask the master before writing and then a reply run in the same folder with `--continue`; the reply is in `case.yaml`; costs money and takes minutes per run):

```sh
node testbench/runners/run-entry-case.mjs testbench/cases/entry/prepare-proceed [--runs N] [--model haiku] [--keep]
node testbench/runners/run-entry-case.mjs testbench/cases/entry/prepare-two-turns [--runs N] [--model haiku] [--keep]
```

The checks are P1 to P9 (the new session file, its format, nothing else created, links, saved as one commit, the prerequisites are said, plain words, one closed topic, the review said APPLY); the two-turn case also checks Q1 and Q2 after the first message (a question is asked and nothing is written; the topic stays active with its question). P10 is informational: capitalised words in the session that no source names are recorded as `possible_invented_names` and never fail a run. With `--grade-only`, a two-turn case grades the final state, and the first-turn checks only when the run was kept with `--keep`.

Run the after-session cases end to end (same setup; costs money and takes minutes per run):

```sh
node testbench/runners/run-entry-case.mjs testbench/cases/entry/after-proceed [--runs N] [--model haiku] [--keep]
node testbench/runners/run-entry-case.mjs testbench/cases/entry/after-too-thin [--runs N] [--model haiku] [--keep]
```

The checks are A1 to A7 (one new chronicle page with its id and the played session, the old page unchanged, nothing else changed, the plot map has no errors and the session is played, an Accaduto section of prose with no master block, every capitalised name is in the prompt or the subjects, saved as one commit, plain Italian words) and T1 to T3 (nothing written, one question asking for the evening in scenes, one open after-session topic with its question).

## Running the suite

`runners/run-suite.mjs` runs every case under `cases/` through its runner, one child process per (case, agent, run), at most `--parallel` at a time (default 8). Each child appends its own record to `results/`. The suite prints a table of `p/n` per case and agent, a TOTAL line and the reasons of the failed jobs. It exits 0 only when every job passes.

```sh
node testbench/runners/run-suite.mjs                                  # quick: claude, 1 run, no audit
node testbench/runners/run-suite.mjs --runs 3 --agent both --with-audit   # release measurement
node testbench/runners/run-suite.mjs --only entry/ --agent codex          # a subset
```

- quick (default): one run per case with claude, audit skipped. Use it while developing.
- release: `--runs 3 --agent both --with-audit`. Includes the audit cases, which take 10+ minutes per run, so expect a long run.
- runs are parallel: jobs share the machine and the agent quota, so lower `--parallel` if the agent rate-limits.
