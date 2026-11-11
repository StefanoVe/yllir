# Geographic layout

This is step 1 of `post-update.md`, run in the same turn when `geography_migration` is pending. It never speaks to the master except through the question described in `post-update.md`, and it never moves a file outside the engine write cycle.

Use the campaign language from `campaign.yaml`. Keep unresolved facts pending. Never infer a scene appearance from `characters`, `items`, names, links or mentions. The only appearance metadata is `appearances: [{subject: ID, location: [PLACE_IDS]}]`, supported by the explicit scene text. Never move or rename an event: event files stay in their session folders, and the geographic views are links.

Commands are written in `post-update.md` ("Commands and writes"): the plugin root is `${CLAUDE_PLUGIN_ROOT}`, and every command is run exactly as written, as one single command.

## Steps

1. Read `campaign.yaml` (for the language), the complete plot events, and the relevant place and subject sheets.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/geographic-layout.mjs" . plan --out .campaign/state/write/geography-scan.json`. Read its JSON result. If it is blocked or has errors, stop with a failure and write nothing. If `migrationRequired` is false, run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/update-campaign.mjs" . --complete-geography` and report the arrangement complete only when it confirms completion.
3. For each legacy event whose text clearly establishes who is physically present and where, prepare a draft that adds the matching explicit `appearances` metadata and keeps every existing field and all of the text. Do not add or infer a current `location` for a subject from a past scene. If a name or place is ambiguous, a claim conflicts with another source, or the presence is not explicit, leave the event out and record it as pending with its reason.
4. Write the event drafts to `.campaign/drafts/<same event path>` and run the engine write cycle (`authoring.md`, section 7) with `--files` set to those event paths, the intent «Record only text-supported scene appearances for the geographic layout; no other text changes.», `NEW_SUBJECTS` empty, and the version message «Recorded explicit scene appearances for the geographic layout.» in the campaign language. The commit applies the layout and links the canonical paths. If there are no event drafts, run the write cycle with no `--files` (layout only), the intent «Arrange existing sheets by place from their explicit location data; no text changes.», and the version message «Arranged the sheets by place.» in the campaign language.
5. Read the result of the commit:
   - If it was saved: run the plan of step 2 again. If `migrationRequired` is false, run `--complete-geography` and report the arrangement complete only when it confirms it. If the plan still requires the migration because events are pending, leave the marker pending.
   - If the checks or the review asked for fixes: fix only the listed problems in the drafts, never adding an appearance that the scene text does not support, and run the write cycle again. At most three rounds. After the third round without success, stop with a failure and leave the marker pending.
   - A changed source, a failed plan, a failed application or a failed verification leaves the marker pending. Never claim completion from an empty-looking folder or from an inferred appearance.
6. If a decision of the master is needed, ask one clear question about the first unresolved fact, in plain words (see `post-update.md`, Questions). Do not show the plan, the drafts or the errors.
