# Geographic layout (category-first-geography-v1)

Guided part of the migration `category-first-geography-v1`. The update runs it before the item and Statistics steps, because it moves sheets and those steps read the sheet paths. Follow the rules in `${CLAUDE_PLUGIN_ROOT}/skills/library/update/post-update.md` (commands and writes, questions, result).

The arrangement is decided only by explicit text and explicit location data. Use the campaign language from `campaign.yaml`. Keep unresolved facts pending. Never infer a scene appearance from `characters`, `items`, names, links or mentions. The only appearance metadata is `appearances`, written as a block list, one item per subject (`- subject: ID` with `location: [PLACE_ID]` indented under it; the flow form `[{...}]` is rejected), supported by the explicit scene text. Never move or rename an event: event files stay in their session folders, and the geographic views are links.

## Steps

1. Read `campaign.yaml` (for the language), the complete plot events, and the relevant place and subject sheets.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/geographic-layout.mjs" . plan --out .campaign/state/write/geography-scan.json`. Read its JSON result. If it is blocked or has errors, stop with a failure and write nothing. If `migrationRequired` is false, go to Completion below.
3. For each legacy event whose text clearly establishes who is physically present and where, prepare a draft that adds the matching explicit `appearances` metadata and keeps every existing field and all of the text. Do not add or infer a current `location` for a subject from a past scene. If a name or place is ambiguous, a claim conflicts with another source, or the presence is not explicit, leave the event out and record it as pending with its reason.
4. Write the event drafts to `.campaign/drafts/<same event path>` and run the engine write cycle (`authoring.md`, section 7) with `--files` set to those event paths, the intent «Record only text-supported scene appearances for the geographic layout; no other text changes.», `NEW_SUBJECTS` empty, and the version message «Recorded explicit scene appearances for the geographic layout.» in the campaign language. The commit applies the layout and links the canonical paths. If there are no event drafts, run the write cycle with no `--files` (layout only), the intent «Arrange existing sheets by place from their explicit location data; no text changes.», and the version message «Arranged the sheets by place.» in the campaign language.
5. Read the result of the commit:
   - If it was saved: run the plan of step 2 again. If `migrationRequired` is false, go to Completion below. If the plan still requires the migration because events are pending, the migration stays pending.
   - If the checks or the review asked for fixes: fix only the listed problems in the drafts, never adding an appearance that the scene text does not support, and run the write cycle again. At most three rounds. After the third round without success, stop with a failure and leave the migration pending.
   - A changed source, a failed plan, a failed application or a failed verification leaves the migration pending. Never claim completion from an empty-looking folder or from an inferred appearance.
6. If a decision of the master is needed, ask one clear question about the first unresolved fact, in plain words (see `post-update.md`, Questions). Do not show the plan, the drafts or the errors.

## Completion

Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/update-campaign.mjs" . --complete category-first-geography-v1`. Report the arrangement complete only when its status is `complete`.
