---
name: system-adapter
description: Library skill. Runs a system adapter operation for a campaign sheet, item card, progression event, or adapter information. Invoked by Yllir core processes; never invoked by the master.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/system-adapter/scripts/adapter-run.mjs" *), Read
---

# System adapter

This skill is invoked by another skill. Its result is `.campaign/state/system-adapter/report.txt`; the caller reads it and resumes its process. Do not send the report to the master.

## Inputs

The caller supplies:
- `OPERATION`: exactly `validate-sheet`, `card-fields`, `check-drafts`, `progression-event`, or `info`.
- `KIND`: required for `validate-sheet`; exactly `creature` or `item`.
- `FILE`: campaign-relative path for `validate-sheet` or `card-fields`.
- `FILES`: comma-separated campaign-relative paths for `check-drafts`.
- `EVENT_KIND`: required for `progression-event`.
- `DECLARED_BY_MASTER`: required for `progression-event`; exactly `yes` or `no`.
- `CONTINUE_WITH`: exact caller step to resume. If absent, use `the step of the invoking skill that called system-adapter`.

`info` takes no extra input. Ignore inputs that do not apply to the operation. If OPERATION or a required input is missing or invalid, stop and ask the caller; do not infer values.

## Steps

**Step 1 — Locate campaign root.** Run from the folder containing `campaign.yaml`. Use the `campaign root:` line from session-check context. If unavailable, run this command exactly and use its campaign-root line:
`node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" .`

**Step 2 — Select and run one command.** Use exactly one matching command below, from the campaign root. Do not add anything before or after the command. The command forms are shown as supplied; substitute the caller's values. When a substituted FILE path needs shell quoting, quote that value safely. Never pass the adapter manifest or language; the script reads both.

- For `validate-sheet` with `KIND=creature` or `KIND=item`:
  `node "${CLAUDE_PLUGIN_ROOT}/skills/library/system-adapter/scripts/adapter-run.mjs" . validate-sheet <KIND> <FILE> --out .campaign/state/system-adapter/report.txt`
- For `card-fields`:
  `node "${CLAUDE_PLUGIN_ROOT}/skills/library/system-adapter/scripts/adapter-run.mjs" . card-fields <FILE> --out .campaign/state/system-adapter/report.txt`
- For `check-drafts`:
  `node "${CLAUDE_PLUGIN_ROOT}/skills/library/system-adapter/scripts/adapter-run.mjs" . check-drafts "<FILES>" --out .campaign/state/system-adapter/report.txt`
- For `progression-event` when `DECLARED_BY_MASTER=yes`:
  `node "${CLAUDE_PLUGIN_ROOT}/skills/library/system-adapter/scripts/adapter-run.mjs" . progression-event <EVENT_KIND> --declared-by-master --out .campaign/state/system-adapter/report.txt`
- For `progression-event` when `DECLARED_BY_MASTER=no`:
  `node "${CLAUDE_PLUGIN_ROOT}/skills/library/system-adapter/scripts/adapter-run.mjs" . progression-event <EVENT_KIND> --out .campaign/state/system-adapter/report.txt`
- For `info`:
  `node "${CLAUDE_PLUGIN_ROOT}/skills/library/system-adapter/scripts/adapter-run.mjs" . info --out .campaign/state/system-adapter/report.txt`

Commands must be single commands: no `;`, `&&`, `|`, `2>&1`, `echo`, `cat`, `mkdir`, or `cd`. Read the final `exit: <code>` line printed by the script. Code `0` means the report was written. Code `2` means wrong command: check operation and inputs, then retry the corrected command once. Do not switch operations as fallback.

**Step 3 — Read and handle the report.** After exit `0`, read `.campaign/state/system-adapter/report.txt` with Read. Never print it via shell, write it, or edit it. If a command exits `2` again, exits with another nonzero code, is refused twice, or otherwise fails to produce a readable fresh report, treat any existing report as stale. Return exactly these two lines to the caller, using the specific cause:

```
status: FAILED
reason: <reason>
```

Do not claim a report was written when it was not. Then follow `CONTINUE_WITH` in the same turn.

## Report contract

The fresh report is plain text, with no continuation field:

```
ADAPTER REPORT
status: <status>
adapter: <adapter id or none>
operation: <operation>
language: <campaign language>
result: <one-line JSON>
problem: <zero or more lines>
```

Statuses are `OK`, `NEEDS_ATTENTION`, `NOT_APPLICABLE`, and `FAILED`. Never decide or change the status; use the script's report.
- `OK`: use the reported result.
- `NEEDS_ATTENTION`: the caller arranges sheet correction through its own process, then reruns this operation. Do not fix it here.
- `NOT_APPLICABLE`: no adapter is configured; the caller proceeds without adapter-specific behavior.
- `FAILED`: tell the caller the operation could not run; do not invent a result.

Possible report examples:

```
ADAPTER REPORT
status: OK
adapter: dnd-2024
operation: card-fields
language: it
result: {"ok":true,"errors":[],"fields":{"title":"Lanterna da bordo","description":"Una lanterna annerita dal fumo."}}
```

```
ADAPTER REPORT
status: NEEDS_ATTENTION
adapter: dnd-2024
operation: validate-sheet
language: it
result: {"ok":false,"errors":[{"code":"missing-field","message":"missing field: con"}]}
problem: missing-field: missing field: con
```

```
ADAPTER REPORT
status: NEEDS_ATTENTION
adapter: dnd-2024
operation: check-drafts
language: it
result: {"checked":[{"file":"characters/Bera.md","kind":"creature","ok":false}],"skipped":["characters/Arin.md"]}
problem: characters/Bera.md: missing-field: missing field: con
```

```
ADAPTER REPORT
status: NOT_APPLICABLE
adapter: none
operation: info
language: it
result: {}
```

The `result:` JSON is the answer to the caller's question; the `problem:` lines say what is wrong.
For `check-drafts`, a `skipped` file means it is not a creature or item sheet. Under `NEEDS_ATTENTION`, `problem:` lines identify the problem for each affected file.

**Step 4 — Continue.** After handling the report or returning the failure lines, do what `CONTINUE_WITH` directs. The report does not supply this instruction; it comes from the caller.

## Rules

- Pass through results; never judge, reinterpret, or invent game rules or outcomes.
- Do not edit campaign sheets, other campaign files, or the report.
- Do not roll dice, choose targets, or decide outcomes for the master.
- Master-only content must never leave the report. The script excludes it; do not reproduce or add it elsewhere.
