---
name: new-campaign
description: Library skill. Creates a new Yllir campaign in an empty folder with a short interview (four questions, then a name and premise if missing, then one confirmation), and writes its first documents: the world seed and the world description.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/new-campaign/scripts/init-campaign.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/add-category.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/new-campaign/scripts/set-system.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" *), Bash(node */scripts/engine.mjs *), Read, Write, Edit, Agent, Skill, Glob, Grep
---

# New campaign

You run this process yourself, in the main conversation: you ask the master directly and wait for the answer. The interview creates only the core files and the first two documents. It does not generate a world (the world is built later, on request). Run every command from the campaign root, the folder the master opened, exactly as written, as one single command: nothing before it, nothing after it, no `;`, `&&`, `|`, `2>&1`, `echo`, `cat`, `mkdir` or `cd`. Every script prints JSON and, as its last line, `exit: <code>`. Read that exit code.

Messages to the master: in the campaign language once known (before that, the language the master writes in), in plain words. Never say: script, git, commit, draft, batch, sub-agent, review, seed file path, or any command.

## Step 1 — Check the folder

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs" .` and read its `folder` value.
- `empty`: go to Step 2.
- `unfinished`: the core files were interrupted. Do not run `init-campaign.mjs` again. Read `campaign.yaml` with the Read tool (`campaign.name`, `campaign.world`, `campaign.seed`, `language.main`, `prose.register`) and go to Step 5.
- `campaign`: the folder already holds a campaign. Tell the master in one sentence and stop.

## Step 2 — Interview, round 1

Skip any question the master's message already answers. Ask the rest in ONE numbered message, in plain words, saying the master can answer with numbers or in their own words:
1. **Language**: the language to write the campaign in. Offer the language the master writes in (with its name in that language) and one other common language. Default: the language the master writes in.
2. **Game**: the game the campaign is played with. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/new-campaign/scripts/set-system.mjs" . --list`. It prints `{"adapters":[{"id","name"}]}`. Offer those names and «my own system / other». Default: none. A game matches only when it is the same edition (for example «D&D 2024» or «DnD 2024» match `dnd-2024`; «D&D 5e» without 2024 does not). Keep the matched `id`, or none.
3. **Tone**: evocative, plain or colloquial. Default: plain. Map to `--register`: evocative → `elevated`; plain → `plain`; colloquial → `colloquial`; mixed → `mixed`.
4. **Shared material**: is there a folder of another world to connect? Default: no. If yes, the full path of the folder is needed (ask for it in Step 3).

## Step 3 — Interview, round 2

Ask in ONE free-text message, numbered, only what is still missing:
1. The name of the campaign. If still missing after the answer, use the world name, or «Campagna» (Italian) / «Campaign» (English).
2. The premise: two or three sentences on the world and the story. If still missing, the premise is «La descrizione sarà scritta più avanti.» (Italian) / «The description will be written later.» (English).
3. The full path of the shared folder, only if question 4 was yes and no path is known. A relative path is joined to the parent of the campaign folder.

World name: the proper name in the premise if there is one (for example «Varn»), otherwise the campaign name. Its folder is the word «World» in the campaign language (`Mondo` in Italian, `World` in English, otherwise the translation); its slug is the lowercase ASCII form (`mondo`).

The seed file name is `Seme del mondo.md` in Italian, `World seed.md` in English, otherwise «World seed» translated.

## Step 4 — Summary and one confirmation

Show in plain words, in the campaign language: the name, the language, the tone, the game (matched: the game rules of that game are applied; named but not matched: they are not available yet, and the campaign works anyway; none: nothing), the shared material (its folder name only), the defaults used, and the first two documents: the world seed (the premise, the tone and the game in one place, which will grow as the world does) and the description of the world in the world folder.

Ask for one confirmation. If the master's message already confirms, go on without asking.

## Step 5 — Create the core files

Run, after the confirmation (skip this step on `unfinished`, where the files exist):

`node "${CLAUDE_PLUGIN_ROOT}/skills/library/new-campaign/scripts/init-campaign.mjs" . --name "<campaign name>" --language <language code> --register <elevated|plain|colloquial|mixed> --world "<world name>" --seed "<seed file name>"`

- Add ` --adapter <id>` only when the game matched. Language code: lowercase ISO 639-1 (`it`, `en`).
- Do not pass `--description`: the seed replaces the one-sentence description.
- Exit code not 0: tell the master «Non sono riuscito a completare questa operazione. Non è stato perso nulla: possiamo riprovare.» and stop.

Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/add-category.mjs" . --id <slug> --folder "<Folder>" --type places`. Exit code not 0: the same sentence as above, and stop.

If the master named a shared folder, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/add-category.mjs" . --id <slug of the folder name> --folder "<folder name>" --type external --source "<absolute path>"`. If it fails, tell the master in one sentence that the shared material could not be connected, and go on: do not stop.

## Step 6 — Draft the two documents

Write both drafts with the Write tool, under `.campaign/drafts/`, at the campaign-relative path.

**Seed**, at `.campaign/drafts/<Seed file name>` (campaign root, not in a folder). The whole seed is master-only, so ALL its content goes inside the master block. Structure, with `id` `seme-del-mondo` (Italian) or `world-seed` (English):

```markdown
---
id: seme-del-mondo
provenance: master
---

# Seme del mondo

<!-- master -->
## Master

### Genere e tono

<the premise and the tone, in the master's words>

...
<!-- /master -->
```

Replace the example headings with the sections below, one `###` heading each, in this order. Italian: `### Genere e tono`, `### Temi`, `### Conflitti centrali`, `### Fazioni`, `### Culture`, `### Convenzioni dei nomi`, `### Livello di potere`, `### Calendario`, `### Da evitare`. English: `### Genre and tone`, `### Themes`, `### Central conflicts`, `### Factions`, `### Cultures`, `### Naming conventions`, `### Power level`, `### Calendar`, `### To avoid`. Other languages: translate the English headings. The title line is `# Seme del mondo` or `# World seed`.
- Fill only what the master said: the premise (its genre and tone), the tone chosen, and the game. Any other section gets the single line `Da definire.` (English `To be defined.`).
- Use the master's words. Do not add a faction, a name, a place, a date or a rule that the master did not give.

**World description**, at `.campaign/drafts/<Folder>/<World name>.md`:

```markdown
---
id: <slug of the world name>
kind: place
provenance: master
---

# <World name>

## <"Descrizione" or "Description">

_<one or two sentences: the premise as narration, in the chosen tone>_

<one short paragraph restating the premise plainly>
```

Use only the master's words in the premise: change word order, grammar and punctuation at most, and add no noun, adjective, place, person, number or event.
- Correct: master says «Varn is a city of bridges where the river sings» → `_Varn is a city of bridges, and the river sings._`
- Wrong: `_Varn rises over a dark sea, its bridges full of merchants._` (sea and merchants are new).

## Step 7 — Save the first version

Follow the write cycle in `${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/authoring.md`, with ONE batch containing both files:
- files: `<Seed file name>,<Folder>/<World name>.md`
- intent: «First documents of a new campaign: the world seed and the world description, from the master's words only.»
- Both documents are saved as written in Step 6, with no further generation.

If the write cycle reports errors that the author cannot fix in two rounds, tell the master in one sentence what is blocked, and stop.

## Step 8 — Close

Tell the master in a few plain sentences, in the campaign language: the campaign is ready; its name; what was set (language, tone, game or the fact that the game rules are not available yet); that a world seed was started with the premise and the tone, and will grow as the world does; and that the world can be built now or later, on request. If the shared material was not connected, say so again in one sentence. Do not list the files.
