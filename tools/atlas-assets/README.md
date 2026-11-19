# Atlas assets

Generates the stamp and texture pack of one atlas style. Each style has its own prompts in
`styles/<style>/prompts.json`; the packs are written to `yllir/skills/library/atlas/assets/styles/<style>/`.
Styles: `fantasy-color` (the default), `antique-parchment` and `dark-fantasy`.

## Generate the raw images (Codex ImageGen)

From the repository root, for each job in `styles/<style>/prompts.json`, create the job folder
`.claude/scratchpad/atlas/raw/<style>/<job>/job.json` (fields `operation`, `prompt`,
`negative`, `width`, `height`), then run:

    node yllir/skills/library/images/providers/codex/scripts/codex-run.mjs .claude/scratchpad/atlas/raw/<style>/<job> --timeout-seconds 600

The result is written to `.claude/scratchpad/atlas/raw/<style>/<job>/result.png`.
The raw folder is git-ignored; never commit it.

## Process into the pack

One command per style:

    uv run tools/atlas-assets/process.py --style fantasy-color
    uv run tools/atlas-assets/process.py --style antique-parchment
    uv run tools/atlas-assets/process.py --style dark-fantasy

This writes `yllir/skills/library/atlas/assets/styles/<style>/` (stamps, textures, `manifest.json`)
and the contact sheet `.claude/scratchpad/atlas/contact-sheet-<style>.png`.
It is deterministic. To drop a bad stamp, add its id to `EXCLUDE` in
`process.py` with a reason, then rerun. A style is installed in the framework only when its
`manifest.json` exists; until then it is declared but not installed (see `styles.mjs`).
