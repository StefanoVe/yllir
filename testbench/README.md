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
