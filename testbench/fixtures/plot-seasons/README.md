# Plot fixture: seasons

Synthetic campaign «Le stagioni di Brenna» (Italian) for the plot checks of the engine (`yllir/scripts/lib/plot/plot-map.mjs`). It tests a hierarchical plot: chapters inside season folders. All names are invented and no game system is used.

- `campaign/` is the only folder an agent may read. The offline test copies it to a temporary folder; it is never written.
- `key.yaml` sits beside `campaign/`. It has two sections: what the engine reports on the fixture as it is (`engine_hierarchical`), and what the same content must report in the flat shape the engine reads (`intended_flat`).
- The test is `testbench/runners/plot-structures.test.mjs`.

## Shape

- Plot folder `Stagioni`, with `Stagione 1/Capitolo 1/Capitolo 1.md`, `Stagione 1/Capitolo 2/...`, `Stagione 2/Capitolo 3/...`, `Stagione 2/Capitolo 4/...`. The season folders have no main file.
- Scenes of chapter 4 in `Stagione 2/Capitolo 4/Eventi/`.
- Chronicle `Cronaca/2026-11-15.md` with `played: [brenna-capitolo-1, brenna-capitolo-3]`.

## Traps

1. Rejoin across seasons: chapter 3 (season 2) depends on chapter 1 and chapter 2 (season 1).
2. Played before a prerequisite: the chronicle says chapter 3 is played, but chapter 2 is not.
3. Event cycle: scene A of chapter 4 depends on scene B, and scene B depends on scene A.

## Findings

The engine does not read this shape. Its output on the fixture as it is:

- Sessions: none. Arcs: none. `unlinked`: none.
- Errors: six `legacy-session-layout` ("session file is not in its own folder; run the update"), one for each chapter file and each scene file. Two `unknown-played-id` for `brenna-capitolo-1` and `brenna-capitolo-3`, because those ids are not plot documents for the engine.
- Cause: the classifier accepts a session only at `<Folder>/<Folder>.md` and an event only at `<Folder>/<Events folder>/<file>.md`. Anything deeper is `legacy`. The `run the update` message is misleading for this case: the campaign was never in the old layout. The test did not run the update, so what the update would do to this shape is unknown.

The same content, flattened to `Stagioni/Capitolo N/` (the test does this in a temporary copy), is read correctly:

- Errors: `event-cycle` at `Stagioni/Capitolo 4/Eventi/A Il disgelo.md` (both scenes named); `played-before-prerequisite` at `Stagioni/Capitolo 3/Capitolo 3.md`, naming `brenna-capitolo-2` only.
- Statuses: chapters 1 and 3 played, chapter 2 and chapter 4 ready. Chapter 3 keeps both its prerequisites across the seasons.
- Arc order: chapters 1, 2, 3, 4; next number 5.
- FINDING: a cycle between two scenes counts as a link for the `unlinked` rule (the rule only asks that some scene depends on another scene of the same session). So chapter 4 is not reported as unlinked, and the `event-cycle` is the only report.
- FINDING: the `played-before-prerequisite` message names only the unplayed prerequisite, not the chapter that was played too early.

## Main files

The chapter main files are in the derived form the engine writes at every save (`renderSessionMap` in `yllir/scripts/lib/plot/session-map.mjs`). The engine cannot read the hierarchical shape, so the derived text was produced on a flattened copy (`Stagioni/Capitolo N/`) and copied back unchanged: the relative event links are the same in both shapes. The prose they had is gone, except the line that matters for the rejoin trap:

- Chapter 3: «Il consiglio di Brenna decide chi deve partire per il passo, con le prove dei due autunni.» The chapter rejoins the two autumns of season 1.
