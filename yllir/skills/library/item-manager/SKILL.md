---
name: item-manager
description: Library skill. Creates item sheet drafts and checks item sheets and plot event item declarations. Invoked only by Yllir core processes. Never edits campaign files.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/item-manager/scripts/item-manager.mjs" *), Read, Write, Bash(node */scripts/session-start.mjs *), Bash(node */skills/library/item-manager/scripts/item-manager.mjs *)
---

# Item manager

This library skill is called only by a core process. The result is `.campaign/state/item-manager/report.txt`; the caller reads it and continues. It never edits a campaign document. Inputs include `MODE` (`create` or `check`), `NAME`, `LOCATION`, `DETAILS`, `REQUESTED_BY`, `IMAGINATION` (`yes` or `no`), `CONTINUE_WITH`, `FILES`, and optional `BASE`. Unknown MODE is `FAILED`. If CONTINUE_WITH is absent, use the invoking caller's next step.

## Safety and source rules

- Use only facts in `DETAILS` and the campaign documents the caller identifies in `FILES` or `REQUESTED_BY`. Read those documents before drafting. If a required fact is unknown and `IMAGINATION` is `no`, ask the master; do not leave a placeholder in the final draft.
- `IMAGINATION=yes` authorizes inventing missing descriptive facts consistent with campaign canon. It never authorizes changing established facts, inventing mechanics or prices, or putting secrets in public sections. Mark invented sections as invented in `open points` for caller review.
- Read `.campaign/customizations.md`, then `prose.register` in `campaign.yaml`, then existing item sheets and session prose for tone, in that priority order. Apply the resulting tone to both descriptions. The brief gives a concise account of the item's visible appearance and essential established function. The full description adds established context such as provenance, materials, or use when available; it must add context rather than merely repeat the brief. Do not invent facts unless `IMAGINATION=yes` permits descriptive invention under the rules below.
- Separate player-visible facts from master-only facts. Put secrets only in the final master block. Never include master-block text in a report, question, output sent to a player-facing reviewer, adapter, image prompt, or external service. The independent canon reviewer must receive only the relevant canon needed for its review and must judge public/master separation, description consistency, tone, and contradictions.
- Do not write the Effects section yourself from game knowledge. Request/receive the adapter's item effect output and validation through the caller's write-sequence. If no adapter is configured, use the campaign's plain-text convention. Prices are checked against the economy source only; never propose one.
- A contradiction between a plot fact and the sheet is a question for the master. Never silently change the sheet. The sheet records identity and properties, not plot actions. `location` is current location; do not infer it from an event.
- A subject-name match can be an item, place, character, or other subject. Treat any exact match across all subject types as existing/ambiguous. A partial match or multiple exact matches is always a question.
- Existing item sheets are never edited here. A missing brief in a legacy sheet is reported as an upgrade issue; do not repair it.
- Respect `audit.exclusions` only for an item id excluded with `attribute: plot.items`. Do not create other configuration keys or infer exclusions.

## CLI

Run from the campaign root with the installed skill path. Every value is a separate argument; quote values containing spaces. Empty strings are valid for `LOCATION`, `DETAILS`, `REQUESTED_BY`, and `FILES`.

```sh
node "${CLAUDE_PLUGIN_ROOT}/skills/library/item-manager/scripts/item-manager.mjs" . create --name "NAME" --location "LOCATION" --details "DETAILS" --requested-by "REQUESTED_BY" --imagination "yes|no" --files "FILES"
node "${CLAUDE_PLUGIN_ROOT}/skills/library/item-manager/scripts/item-manager.mjs" . find --name "NAME"
node "${CLAUDE_PLUGIN_ROOT}/skills/library/item-manager/scripts/item-manager.mjs" . check --files "FILES"
node "${CLAUDE_PLUGIN_ROOT}/skills/library/item-manager/scripts/item-manager.mjs" . plot-items --files "FILES" --out .campaign/state/item-manager/plot-items.json
```

`FILES` and `REQUESTED_BY` are comma-separated campaign-relative Markdown paths. An empty `FILES` checks the whole campaign. `LOCATION` is an empty string or comma-separated existing place ids. For a draft check, pass the draft-relative path in FILES and `.campaign/state/write/draft` in BASE. `create` prints a JSON result including the exact draft content; scripts do not write campaign files. The skill writes that content only to `.campaign/state/write/draft/<objects folder>/<safe item filename>.md` and writes its report to `.campaign/state/item-manager/report.txt`.

## Create mode

1. Run `create` with all six inputs. If status is `EXISTS`, do not draft; return the existing id in the report. If status is `ASK`, ask the returned question and wait. If `NOT_AVAILABLE` or `FAILED`, report the problem and stop.
2. Read the request documents and relevant canon. Distinguish public observations from facts only the master knows. If the item is only named and no information supports its required descriptions, ask the master for details when `IMAGINATION=no`. When it is `yes`, invent only coherent descriptive facts; do not invent mechanics, prices, or contradictions to canon. Never return a DONE draft with blank required sections or placeholders.
3. Fill the returned draft. Use the campaign language for sheet content. Required order is `## In breve` or `## In brief`, `## Description`, `## Effects`, then optional `## Origin`, `## Finding`, `## Text`, `## Value` in that order. Use localized headings when campaign conventions require it, while preserving the same order. The metadata is public and contains `id`, `template: item`, and `location: [place-id, ...]` (or `[]`); aliases may be added only when supported by canon. The `objects` structure category must already exist; never create it.
4. The final block must be exactly one complete `<!-- master -->` ... `<!-- /master -->` block and the last content in the file. It must contain `## Master` followed by at least one `###` localized notes heading, even when the heading body is empty. Never put placeholders or `To be defined` in a final draft.
5. Before accepting your own draft, read the complete generated sheet back, including the master block. Compare each supplied established fact and effect with the appropriate section: retain every supplied effect faithfully in Effects, without contradiction or omission. Effects retains all mechanical details; do not replace them with a descriptive summary. A claim such as “no game effect” is allowed only when the input or canon explicitly establishes it. Never turn unknown effects into a no-effect claim. Check that the brief gives a concise account of visible appearance and essential established function, and that the full description adds established context when available rather than merely repeating the brief. Check both for factual consistency and make sure neither omits a material established fact appropriate to its scope. Check public text for private facts or explicit secrets, and ensure those appear only in the master block. Apply tone in this order: `.campaign/customizations.md`, then `prose.register`, then campaign examples. Never add plot events or item transfers to the sheet. If an essential fact or effect cannot be stated without invention or contradiction, return `ASK` rather than a draft.
6. Validate the filled draft with `node "${CLAUDE_PLUGIN_ROOT}/skills/library/item-manager/scripts/item-manager.mjs" . check --files "<category>/<id>.md" --base ".campaign/state/write/draft"`. Resolve every structural error before returning the draft, including the required master headings. The adapter validates Effects at the caller's write-sequence step before independent review. For campaign languages other than Italian or English, report that required-section heading validation is unavailable; the independent reviewer still checks localized headings.
7. Write the English report. Include exact status, coverage/command, draft path, existing id, new subject id, questions, problems, and open points. Keep master-only text out of every field. The `draft:` value is the full path `.campaign/state/write/draft/<campaign-relative path>`; callers strip that prefix exactly once. The caller then continues with `CONTINUE_WITH`.

## Check mode

1. Run `check --files "FILES"`. It validates item-template sheets, required section order, unique final master block with `## Master` plus a `###` notes heading, placeholders, image paths, and location ids. Report every error. A legacy missing brief is an upgrade issue, never an automatic edit.
2. Read every checked item sheet in full, including its master block, and the relevant plot context. Check that the brief concisely conveys visible appearance and essential established function, and that the full description adds established context when available rather than merely repeating the brief. Check both sections for factual consistency and omissions of material facts appropriate to their scope. Check Effects and descriptions against established facts; Effects must retain all mechanical details. Treat “no game effect” as established only when an input/canon source says so. Check tone in order: `.campaign/customizations.md`, `prose.register`, campaign examples. Check public text for explicit secrets or other master-only facts; report the location and type of leak without quoting the secret. Compare plot facts with sheet identity, properties, and master-confirmed current state. Accumulate all safe findings across all checked sheets before returning; do not stop at the first issue. Ask the master when a conflict or missing essential fact needs a decision. Never expose master-only text in reports or questions.
3. Run `plot-items --files "FILES" --out .campaign/state/item-manager/plot-items.json`. Keep every script error. For each candidate, read the cited plot line yourself and decide whether it refers to a relevant item needing a sheet. Ignore generic nouns, names that are not objects, and objects already represented by `items: [id]`. Do not decide relevance from capitalization alone. Never copy a master-block line into the report; if a candidate could only be verified there, report only file and line.
4. For a relevant item omitted from an event's `items: [id]`, search `find --name "<candidate name>"` across all subject types. If an existing unique item sheet matches, report `missing-item-declaration` with its id; this is a missing event declaration, not a missing sheet. Report a missing sheet only when no subject matches; ask on any exact match of another type, partial match, or multiple match. Compare plot claims with sheets and ask the master about contradictions. Honor an applicable `plot.items` exclusion.
5. A clean report still states which files and commands were checked and how many events/sheets were covered. Do not claim whole-campaign coverage when `FILES` was nonempty.

## Report contract

Write `.campaign/state/item-manager/report.txt` in English. It is internal state and is not shown directly to the master.

```text
ITEM MANAGER REPORT
status: DONE | ASK | FAILED | NOT_AVAILABLE | ERRORS
mode: create | check
coverage: <files/counts and exact commands>
draft: <path or none>
exists: <id or none>
new subject: <id or none>
question: <question or none>
problems:
- <code file:line: short safe description>
open points:
- <section or none>
continue with: <CONTINUE_WITH>
```

Use `ASK` when master input is needed, `ERRORS` when check finds actionable errors/candidates, `FAILED` on script usage/read errors, and `DONE` only when the requested work is complete. The check CLI prints `checked` lines, `error <code> <file>: <message>` lines, warning lines for unsupported section validation, an error count, then a final `exit: 0|1`; usage/runtime errors exit 2. The CLI never writes the report. Never print or quote this report to the master. Do not put secret details or plot passages in it.
