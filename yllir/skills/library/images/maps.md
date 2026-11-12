# Maps

A battle map is a top-down picture of one place with a square grid. It is made from a LAYOUT that you plan on the grid and that scripts check, then turned into a picture by the image service. The master gets the picture with and without the grid, an interactive preview, a file for virtual tabletops and one for Tiled, all linked in the place sheet. Read this file with the Read tool when the master asks for a map, and follow it instead of the Steps of SKILL.md. Run commands from the campaign root, exactly as written, with nothing added.

**Rules.**
- The LAYOUT and the picture come ONLY from the PUBLIC part of the sheet (above `<!-- master -->`) and from the master's words. A secret passage, trap or hidden room that is only in the master's notes is NEVER drawn, because the map is shown to the players.
- The image service receives only the job built by `image-prompt.mjs` and the plan picture `guide.png`. Never send anything else.
- All the rules of SKILL.md apply: consent, at most 2 corrective attempts, fallback only on technical failure, no service names to the master.
- Never install, download or run Python yourself. Every Python tool runs only through `maps-run.mjs`.
- JOB_DIR is the `folder` line of M4; MAP_JOB is its `job` line (for example `taverna-map-1`).

## Steps

**M1 — Place.** Find the DOCUMENT as SKILL.md Step 1.1. REQUEST as SKILL.md Step 1.4. Read the PUBLIC part of the document with the Read tool (the part above `<!-- master -->`).

**M2 — Tools.** Run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/maps/maps-setup.mjs" --data-dir "${CLAUDE_PLUGIN_DATA}"`
The first time it can take several minutes: wait for it.
- `result: unavailable`: say the fixed sentence [map tools unavailable] and stop. On the master's yes to that sentence, follow SKILL.md Steps 3 to 9 as a normal image of the place, with «top-down view from directly above» added to REQUEST.
- `result: ok`: go to M3.

**M3 — Layout.** Plan the place on a grid: COLS × ROWS between 8 and 60 (a room or a small building about 20×14, a large hall or a street about 30×20, open ground up to 40×30). Write with the Write tool `.campaign/state/maps/layout-draft.json` (the Write tool creates the folder: never run `mkdir`) in exactly this format:
```json
{
  "cols": 24, "rows": 16,
  "walls": [[0, 0, 24, 1], [10, 4, 1, 6]],
  "doors": [{"id": "door-cellar", "cell": [10, 7], "side": "v"}],
  "exits": [{"id": "exit-street", "cell": [23, 8]}],
  "start": [2, 8],
  "points": [{"id": "bar", "cell": [5, 3]}]
}
```
- `cols`, `rows`: the size of the map in cells. Origin top-left, x to the right, y down.
- `walls`: `[x, y, w, h]` rectangles of blocked cells (w and h at least 1).
- `doors`: a passage cell INSIDE a wall line (the wall rectangle covers it; the scripts open it). `side` is `h` when the wall runs left to right, `v` when it runs up and down.
- `exits`: a cell on the outer border of the map where one leaves the map. It may lie on the border wall (the scripts open it too).
- Draw the outer walls along the whole border; put each exit on it.
- `start`: the cell where the party enters.
- `points`: notable spots that must be reachable.
- Every id is lowercase words joined by hyphens, and unique across doors, exits and points.
- Every point, door and exit must be reachable from `start` through open cells. Corridors are at least 1 cell wide. Outer walls lie on the border, except at the exits.

**M4 — Map job.** Run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/maps/map-job.mjs" . create --document "<DOCUMENT>" --layout "<absolute path of .campaign/state/maps/layout-draft.json>"`
Read the lines `job` (MAP_JOB), `folder` (JOB_DIR), `guide` (GUIDE) and `size` (SIZE).
- `error: bad-layout`: read every `problem:` line, fix the layout file, and run this step again. At most 3 rounds; then say the lexicon sentence «Non sono riuscito a completare questa operazione. Non è stato perso nulla: possiamo riprovare.» (English: «I could not complete this operation. Nothing was lost: we can try again.») and stop.
- any other `error:`: say the same lexicon sentence and stop.

**M5 — Picture.** Run SKILL.md Step 3 (once per conversation), then SKILL.md Step 4 with OPERATION `generate`. Then run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/image-prompt.mjs" . --document "<DOCUMENT>" --operation generate --purpose map --cells <COLS>x<ROWS> --reference "<GUIDE>"`
- add `--request "<REQUEST>"` when REQUEST is not none.
- Read the lines `job` (IMAGE_JOB) and `folder` (IMAGE_JOB_DIR).
- `error: no-style`: the campaign has no style for maps yet. Propose ONE map style in the campaign language in one sentence ending with a question mark (technique and palette for a top-down battle map, consistent with the world; read the public part of the world description if needed). Stop. On a yes, or on a corrected version: write with the Write tool `.campaign/styles/map/profile.yaml` with these lines: `id: map`, `negative: "<English: text, labels, grid lines, perspective, characters, frame>"`, `width: 1536`, `height: 1024`. Write `.campaign/styles/map/prompt.md`: one English paragraph with the style, then the exact placeholder `{SUBJECT_DESCRIPTION}`. Save them as SKILL.md Step 5 saves the base style: first `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" check . --sources ".campaign/styles/map/profile.yaml,.campaign/styles/map/prompt.md"`, then, if its exit code is 0, `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" commit . --sources ".campaign/styles/map/profile.yaml,.campaign/styles/map/prompt.md" --message "<campaign language: Map style of the campaign>"`. If either exits 1, say the lexicon sentence and stop. Then run this step again.
- `error: not-public`: say the fixed sentence [reserved document] and stop.
- any other `error:`: say the lexicon sentence of M4 and stop.
- `job` is given: go on to SKILL.md Step 6 with JOB_DIR = IMAGE_JOB_DIR and IMAGE_JOB = `job`, and then to SKILL.md Step 7. In the visual check, the map also requires: seen from directly above; no text or labels; no painted grid; walls and openings roughly where GUIDE has them (read GUIDE with the Read tool).

**M6 — Data and checks.** Run these commands in order, from the campaign root, and stop at the first failure:
1. `node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/maps/map-job.mjs" . art --job <MAP_JOB> --image-job <IMAGE_JOB>`
2. `node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/maps/maps-run.mjs" . --job <MAP_JOB> --data-dir "${CLAUDE_PLUGIN_DATA}" -- conform_background conform --input art/source.png --size <SIZE> --mode cover --output-dir fit`
3. `node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/maps/map-job.mjs" . bundle --job <MAP_JOB>`
4. `node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/maps/maps-run.mjs" . --job <MAP_JOB> --data-dir "${CLAUDE_PLUGIN_DATA}" -- map_bundle validate --bundle map-bundle.json --report qa-bundle-report.json`
5. `node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/maps/maps-run.mjs" . --job <MAP_JOB> --data-dir "${CLAUDE_PLUGIN_DATA}" -- map_nav check --bundle map-bundle.json --output-dir nav`

Step 5 prints one JSON line containing `"status"` and `"unreachable"`. Read those two values from that output line: `status` must be `pass` and `unreachable` must be 0.
- When step 5 fails, or `unreachable` is greater than 0, the layout is wrong. Read `nav/nav-debug.png` with the Read tool (red cells are blocked, green reachable, yellow unreachable), fix the layout file, and restart from M4 with a new layout draft. At most 2 restarts. After that, say the lexicon sentence and stop.
- Any other failure of steps 1 to 4: say the lexicon sentence of M4 and stop.

**M7 — Outputs.** Run these commands from the campaign root, with the same `--job <MAP_JOB>` and `--data-dir "${CLAUDE_PLUGIN_DATA}"` as M6:
1. `node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/maps/maps-run.mjs" . --job <MAP_JOB> --data-dir "${CLAUDE_PLUGIN_DATA}" -- map_grid --input fit/background.png --output grid/map-grid.png --cell 64`
2. `node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/maps/maps-run.mjs" . --job <MAP_JOB> --data-dir "${CLAUDE_PLUGIN_DATA}" -- build_scene_preview --bundle map-bundle.json --output-dir preview`
3. `node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/maps/maps-run.mjs" . --job <MAP_JOB> --data-dir "${CLAUDE_PLUGIN_DATA}" -- export_tiled export --bundle map-bundle.json --output-dir tiled`
4. `node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/maps/map-uvtt.mjs" . --job <MAP_JOB>`

Read `<JOB_DIR>/grid/map-grid.png` with the Read tool: the grid must lie over the picture. If it does not, say the lexicon sentence of M4 and stop. Write REVIEW: one English sentence on what the map shows.

**M8 — Place and save.** Run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/image-place.mjs" . --kind map --document "<DOCUMENT>" --alt "<campaign language: short description, with no ] and no line breaks>" --provider <id> --job <IMAGE_JOB> --map-job <MAP_JOB> --review "<REVIEW>"`
- Exit 1 means refused and nothing was placed: read the `error:` and `message:` lines, say the lexicon sentence of M4, and stop.
- Read the output lines `files` (FILES) and `draft`.
- Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" check . --files "<DOCUMENT>" --sources "<FILES>"`. If it exits 1, say the lexicon sentence of M4 and stop.
- Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" commit . --files "<DOCUMENT>" --sources "<FILES>" --message "<campaign language: Mappa di battaglia di <title of the place>>"`. Exit 1: nothing was written; say the lexicon sentence of M4 and stop.

**M9 — Message.** Send the master one or two sentences in the campaign language: the sheet now has a battle map. If the game system's adapter (`${CLAUDE_PLUGIN_ROOT}/modules/systems/<system id from campaign.yaml>/adapter.yaml`) has `battle_grid`, say what one square is worth (for example «ogni quadretto vale 5 piedi»). Say that the sheet also has an interactive preview and a file for virtual tabletops. No file names, no service names, no technical words.

## Layout checks

The layout is validated by `map-job.mjs create`. Its problem codes mean:
- `bad-size`: cols or rows is not a whole number from 8 to 60.
- `bad-wall`: a wall is not four whole numbers, has a width or height below 1, or lies outside the map.
- `bad-cell`: a door, exit, start or point cell is not two whole numbers inside the map.
- `in-wall`: the start or a point is covered by a wall, or a door is not inside any wall.
- `not-border`: an exit is not on the outer row or column.
- `bad-id`: an id is not valid or is repeated.
- `bad-side`: a door side is not `h` or `v`.
- `missing-start`: there is no start.
- `unknown-key`: the layout has a key that is not in the format above.

## Examples

(a) Wrong: drawing a secret door that appears only in the master's notes.
Correct: the layout uses only the public part of the sheet and the master's words in this conversation; the secret door is not in the layout.

(b) Wrong: sending the sheet text yourself to the image service instead of the job.
Correct: the service receives only the `job` made by `image-prompt.mjs`, with `guide.png` as its plan.

(c) Wrong: running `python` directly on a third-party tool.
Correct: every Python tool runs through `maps-run.mjs`, with the `--job` of the map.

(d) Wrong: telling the master «ho esportato il .uvtt e il .tmj».
Correct: «La scheda della taverna ha ora una mappa di battaglia, con un'anteprima navigabile e un file per i tavoli virtuali. Ogni quadretto vale 5 piedi.»
