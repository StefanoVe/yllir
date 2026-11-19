# Atlas assets

Generates the stamp and texture pack used by the atlas skill, from `prompts.json`.

## Generate the raw images (Codex ImageGen)

From the repository root, for each job in `prompts.json`, create the job folder
`.claude/scratchpad/atlas/raw/<id>/job.json` (fields `operation`, `prompt`,
`negative`, `width`, `height`), then run:

    node yllir/skills/library/images/providers/codex/scripts/codex-run.mjs .claude/scratchpad/atlas/raw/<id> --timeout-seconds 600

The result is written to `.claude/scratchpad/atlas/raw/<id>/result.png`.
The raw folder is git-ignored; never commit it.

## Process into the pack

    uv run tools/atlas-assets/process.py

This writes `yllir/skills/library/atlas/assets/` (stamps, textures, `manifest.json`)
and the contact sheet `.claude/scratchpad/atlas/contact-sheet.png`.
It is deterministic. To drop a bad stamp, add its id to `EXCLUDE` in
`process.py` with a reason, then rerun.
