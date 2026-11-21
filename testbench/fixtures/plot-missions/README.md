# Plot fixture: missions

Synthetic campaign «La compagnia del Corvo» (mercenaries, Italian) for the plot checks of the engine (`yllir/scripts/lib/plot/plot-map.mjs`). It has a plot made of missions, not of sessions. All names are invented and no game system is used.

- `campaign/` is the only folder an agent may read. The offline test copies it to a temporary folder; it is never written.
- `key.yaml` sits beside `campaign/`: the expected engine errors, statuses, unlinked missions and event edges.
- The test is `testbench/runners/plot-structures.test.mjs`.

## Shape

- Plot folder `Missioni` (type `plot`). Each mission is `Missioni/Missione N/Missione N.md`, with its scenes in `Missioni/Missione N/Eventi/`.
- Chronicle `Cronaca/2026-11-01.md` with `played: [missione-1]`.
- Places and characters in `Mondo/` and `Personaggi/`, four short sheets.

## Traps

1. Cycle: `missione-4` depends on `missione-5`, and `missione-5` depends on `missione-4`.
2. Missing prerequisite: `missione-3` depends on `missione-9`, which does not exist.
3. No field: `missione-2` has no `depends_on` line at all. `missione-1` has `depends_on: []`.
4. Fork and rejoin in `missione-1`: scene B and scene C depend on scene A; scene D depends on B and C.
5. Unlinked: `missione-2` has two scenes with no dependency between them.

## Findings

The engine handles this structure. Its output on the fixture, as the test asserts it:

- Errors: `cycle` at `Missioni/Missione 4/Missione 4.md` ("dependency cycle among missione-4, missione-5"); `missing-depends-on` at `Missioni/Missione 2/Missione 2.md` ("depends_on is missing"); `unknown-dependency` at `Missioni/Missione 3/Missione 3.md` ("depends on missione-9, which is not a plot document").
- Statuses: `missione-1` played, `missione-2` ready, `missione-3`, `missione-4` and `missione-5` waiting.
- `unlinked`: `["missione-2"]`. `missione-1` is not unlinked: its scenes are linked.
- Fork and rejoin are kept as declared; the scenes of `missione-1` come out in the order A, B, C, D.
- The mission with no field is not silent: it is reported as `missing-depends-on`, and in the graph it counts as `[]` and is ready. An explicit `[]` is not reported.
- The arc order places `missione-3` as free, because the graph keeps only known dependencies. Its status is still waiting: the `unknown-dependency` error is the only sign of the gap.
- Terms: the engine does not require the word «Sessione». The `Missioni`/`Missione N` names work, because the rules are the folder shape (`<X>/<X>.md`) and the events folder name (`Eventi` or `Events`). The folder name `Eventi` is hard-coded in the engine (`EVENT_FOLDERS`), so the Italian name works and any other name does not.
- Metadata block: the fixtures use the comment form the framework writes (`<!-- yllir` ... `-->`, read by `frontmatter.mjs`). The Morvalle fixture still uses the older `---` form, which the engine also reads; the fixtures here do not use it.
