# Fabula Ultima fixture

Synthetic English campaign for the game-system adapter `fabula-ultima`. Every name, class, spell and creature is invented; the only borrowed material is the schema (attribute dice d6 to d12, levels, ranks, HP, MP, Defense, Magic Defense) and the check form (`DEX + INS DL 10`). No rule text is copied.

- `campaign/` is the only folder an agent under test may read. The runner reads it read-only.
- `key.yaml` is the answer key, outside `campaign/`.
- `campaign/` is written in the same form the framework writes: metadata in `<!-- yllir` blocks, public text above `<!-- master -->`.

## Seeded problems (exactly two, both must be flagged)

| # | File | Trap | Adapter result |
|---|---|---|---|
| 1 | `Creature/Harbor Thug.md` | Level 5 soldier, MIG d6: HP minimum is 2 x 5 + 5 x 6 = 40, the sheet says 25 | `bad-hp` |
| 2 | `Plot/Session 1/Events/Sluice Lift.md` | Scene check `MIG + WLP DL 12`: DL 12 is not 7, 10, 13 or 16 | `bad-check` |

## Traps that must not be flagged

- Homonym spell: `Veil` belongs to two classes with different effects. Kael Morrow (Lantern-Warden, PC) "ignore the next ranged attack"; Ysolde Varn (Tidecaller, NPC) "cannot see beyond 5 metres". Same name, different effect, both valid.
- Valid champion HP: `The Brine Warden` is a champion 2, level 10, MIG d10: HP minimum (2 x 10 + 5 x 10) x 2 = 140, sheet says 150. DEX base d8 (tracker trap: slow and enraged lower it to d6).
- Valid soldiers: `Gull Swarm` (level 3, MIG d6: HP minimum 36, sheet 40).
- Valid NPC with a full statistics block: `Ysolde Varn` (level 4, soldier, MIG d6: HP minimum 38, sheet 42; MP minimum 4 + 5 x 10 = 54, sheet 60; Magic Defense 12 at least INS d10).
- Valid scene checks: `Dusk on the Quay` (`DEX + INS DL 10`), `Lantern Ward` (`INS + WLP opposed`).
- PC sheet without a `template`: `Kael Morrow` has no statistics table, so no adapter check applies.

## Known tool notes (not traps)

- `Creature/` and `Characters/` hold the sheets flat. The engine's geographic layout proposes `Creature/Salt Harbor/` and `Characters/Salt Harbor/` for subjects located in `salt-harbor`. The layout is not an error; the fixture keeps the flat paths.
- The linker's `shortNames` lists `Warden` inside `Lantern-Warden` (Kael's class). It is a false positive and never blocks a batch.
