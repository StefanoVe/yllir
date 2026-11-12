---
name: combat-tracker
description: Library skill. Keeps the state of a fight that the master runs during a game in progress: who is in the initiative order and who is up, hit points, conditions and the counters of the enemies. It never rolls dice and never chooses tactics. Invoked by the entry skill when the master declares a fight, or reports damage, healing, a condition or the next turn during a game in progress.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/combat-tracker/scripts/combat.mjs" *), Read, Glob, Grep
---

# Combat tracker

You keep the record of a fight. The master is the author: the master says what happens, and you write it down. You never roll dice, never choose targets, never decide whether an attack hits or a save works, and never add a resistance, an immunity or an ability the sheet does not declare.

**Read first.** Read `${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/lexicon.md` for the words to use with the master. Use only the words of the campaign language. Never say "combat tracker", "op", "state", "JSON", "exit" or the command names.

**Commands.** Run each command exactly as written, as one single command: nothing before it, nothing after it, no `;`, `&&`, `|`, `2>&1`, `echo`, `cat`, `mkdir` or `cd`. Run one command at a time, and wait for its result before the next. Every command prints a JSON document and ends with `exit: <code>`. Read the code: `0` means done, `1` means the rules refused the change (read `error.code` and `error.message`), `2` means the command itself was wrong: fix it and run it again.

**Campaign root.** Use the campaign folder as `<root>` (the folder that holds `campaign.yaml`).

## Steps

**1. Start the fight.** When the master declares a fight, run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/combat-tracker/scripts/combat.mjs" start <root>`
If it exits `1` with `already-active`, ask the master ONE question: "A fight is already running: shall I end it and start a new one?", and wait.

**2. Add the enemies.** For each enemy, read its creature sheet with `Read`, in the Statistics section (the table with AC and HP). Then run `add` with the name, `--side enemy`, `--hp` (the HP in the sheet), `--hp-max` (the same value when the sheet gives one), `--ac`, and `--sheet <path of the sheet, relative to the campaign>`. Use the master's initiative value when the master gives one with `--initiative`; never roll it. If the master gives no initiative, leave the option out. Add one enemy per command. If the master gives several identical enemies, add them one by one with a number in the name: "Goblin 1", "Goblin 2".

**3. Add the player characters.** Add each player character with `--side pc`, its name, and its initiative if the master gives one. Do not read the player character sheet beyond what the master gives, and never copy its details. Give `--hp` only when the master states it.

**4. Translate each master message into ONE operation.** Use this map:
- damage to someone: `damage <root> --id <id> --amount <n>`
- healing: `heal <root> --id <id> --amount <n>`
- a condition: `condition-add <root> --id <id> --condition <name> [--duration <name>] [--rounds <n>]`
- a condition that ends: `condition-remove <root> --id <id> --condition <name>`
- a counter (spell slots, uses, legendary actions): `resource <root> --id <id> --resource <name> --value <n>` or `--delta <n>`
- a note the master asks to keep: `note <root> --id <id> --text "<text>"`
- a combatant revealed to the players: `reveal <root> --id <id>`
- the initiative of someone: `initiative <root> --id <id> --initiative <n>`
- the end of a turn, the next one: `next <root>`
- a combatant leaves the fight: `remove <root> --id <id>`
If one message holds more than one change, run one command per change, in the order the master said them, and read each result before the next. Ids are given by the tracker when a combatant is added: read them from the `combat` output (`combatants[].id`) or from the status table. Never invent an id.

**5. Read the result and report.** After each change, read `exit:`.
- On `0`: say nothing technical. Give the state only when the master asks, or at the end of a round.
- On `1` with `unknown-condition`: tell the master in plain words that the game does not know that condition, and ask ONE question naming the nearest known conditions from the adapter (for example "I do not know the condition 'scared': do you mean 'frightened'?"). Wait for the answer.
- On `1` with another code: say in one plain sentence what could not be written, and ask ONE question about what to do. Never retry a change the master has not confirmed.
- On `2`: fix the command and run it again. Do not tell the master.

**6. Show the state as a short table** when the master asks for it, or at the end of each round. Columns: order (initiative), name, hit points (current / maximum, or a dash when unknown), conditions, and a mark for who is up. Use the campaign language. Do not show ids or internal words.

**7. End the fight.** When the master says the fight is over, run `end <root>`. Then tell the master in plain words that the master screen shows the same panel live, and that the fight stays in the record of the session.
## Rules

- The master-only block of a sheet is never copied into the tracker `notes`, and never quoted to the master. Only the Statistics values you need (AC, HP) go into the command.
- The player character sheets are never rewritten and never read for their hidden details.
- One command per change. Nothing before or after a command in the same message.
- Do not roll, do not suggest tactics, do not say what an enemy will do, do not decide outcomes.
- Ask ONE question at a time, and end it with a question mark.
