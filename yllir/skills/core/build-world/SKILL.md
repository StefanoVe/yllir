---
name: build-world
description: Core process. Builds or enlarges the world on the master's request, from a few words to a whole region: writes an outline of the subjects with their relations decided, turns the needed ones into full documents and the others into sketches, updates the world seed, and saves the whole batch.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" *), Bash(node */scripts/engine.mjs *), Read, Write, Edit, Agent, Skill, Glob, Grep
---

# Build the world

You run this process yourself, in the main conversation. Follow the write cycle in `${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/authoring.md` for every command, draft, check, review and commit; its section 6 (generation in passes) and section 8 (provenance) apply here. Do not repeat them: follow them.

Run every command from the campaign root, exactly as written, with nothing added. Never ask the master to approve the outline: generate, then tell the master what was created, and let the master correct by talking.

**Single document.** If the master asks for one document (one character, one place, one item), this is not the process for it: follow `${CLAUDE_PLUGIN_ROOT}/skills/core/write-document/SKILL.md` instead.

## Step 1 — Read the request and the campaign

1. Read `campaign.yaml` with the Read tool: `language.main` (the campaign language), `system.adapter`, `campaign.seed` (the seed file name), and the `structure` list. Note the folder of each category: the one of type `places` (places), `subjects` (characters and creatures), `objects` (items), `free` (historical events); factions have their own top-level category (`fazioni` / `factions`, type `subjects`).
2. Read the seed file named by `campaign.seed` with the Read tool. Every later choice must agree with it.
3. Note what the master asked for: the region, the place, the people, how many, and whether a session needs some of them soon. Write it in one sentence in your notes.

## Step 2 — Context

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" context . --subjects "<names or ids the request mentions, comma-separated>"`, adding `--place <id>` when the request is about one place. Omit `--subjects` when no existing subject is named.
2. Read the output. It shows the existing subjects near the new ones: their ids are the only ids you may use in relations to existing subjects.

## Step 3 — Outline

Write `.campaign/drafts/outline.md` with the Write tool. It is not a campaign document and is never listed in `--files`.

1. One line per subject, with seven columns separated by ` | `: `Title | id | kind | location | relations | sentence | when`.
   - `kind`: `place`, `character`, `creature`, `item`, `faction` or `event`.
   - `location`: a flow list with the `id` of an existing or outlined place, `[lago-grigio]`, or `[]` when the subject has no place.
   - `relations`: decide every relation now, here. Use `type:to` pairs, separated by `, `, or `none`. `type` is exactly one of `member-of`, `kin-of`, `ally-of`, `rival-of`, `depends-on`. A `to` is an `id` of an outlined line or of an existing subject from the context pack. Never invent a relation in a later step.
   - `sentence`: one sentence in the campaign language: what the subject is.
   - `when`: for an event, its position in the timeline as a number (the calendar convention is written in the seed); `-` for every other kind.
2. Every line must have a sentence and a kind. A subject with no clear relation writes `none`, not an invented link.
3. After the lines, add a section `## Seed` with one bullet for each fact that holds for the whole world (a new faction, a naming convention, a theme, a calendar fact). Write `## Seed` with `- none` when there is nothing new for the whole world.
4. A region is usually 5 to 30 lines. More than that: split the request into two passes and tell the master in one sentence.

## Step 4 — Split: full documents now, sketches for the rest

Every line becomes a document. Nothing from the outline is dropped.
- **Full document now**: the subjects the master asked about directly, and the places and characters a session will need soon (the master said so, or a session that is being prepared names them).
- **Sketch**: every other line. A sketch is a document with `sketch: true` in its metadata block, a title, one sentence, and the metadata block fields (kind, provenance, relations, location). It is expanded later, when the master names it or a session uses it.

Write the list of full documents and the list of sketches in your notes, before you write any file.

## Step 5 — Write the documents

Choose the folder of each draft from `campaign.yaml` (Step 1):
- place → the `places` folder;
- character or creature → the `subjects` folder;
- item → the `objects` folder;
- faction → the folder of the category with id `fazioni` (Italian) or `factions` (English), a top-level category of type `subjects` at the campaign root: `Fazioni/` or `Factions/`. It is not a sub-folder of the characters folder;
- event → the folder of the `free` category itself (in an Italian campaign it is `Storia`), directly, with no extra sub-folder.

**Factions category.** If the outline has at least one `faction` line and the campaign has no `subjects` entry with folder `Fazioni` (or `Factions`), the batch also changes `campaign.yaml`: read it with the Read tool, add this entry to the `structure` list, and write the whole file to `.campaign/drafts/campaign.yaml`:

```yaml
  - id: fazioni
    folder: Fazioni
    type: subjects
```

(For an English campaign: `id: factions`, `folder: Factions`.) Keep every other line of `campaign.yaml` exactly as it is. Add this entry only together with at least one faction document in the same batch: the folder is created by those documents, never by the entry alone.

**Full documents, up to 3.** Write each one yourself with the Write tool, to `.campaign/drafts/<folder>/<Title>.md`, following section 4 of `authoring.md`. Use the template of the content format for its kind: `npc` or `vendor` for a character, `enemy` or `creature` for a creature (`enemy` if it fights), `item` or `notice` for an item, `faction`, `event`. A place has no template. Keep the `id` and the relations of the outline line exactly; the `location` is the flow list of the outline line.

**Full documents, more than 3.** Launch one `yllir:sheet-expander` per full document, all in the same message, through the Agent tool. Before launching, save its context pack with the engine, never by hand: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" context . --subjects "<id>" --out .campaign/state/context/<short name>.json`, one narrower run per expanded subject (or one run with `--out` for the whole batch). Then give each expander exactly the keys of section 6 of `authoring.md`:
- `CAMPAIGN_ROOT`, `LINE` (the outline line, unchanged), `TARGET` (the draft path), `CONTEXT` (the saved context pack path), `TEMPLATE` (one of the values listed in Step 5), `FORMAT` (`${CLAUDE_PLUGIN_ROOT}/templates/content-format.md`), `LANGUAGE` (`language.main`), `PROVENANCE: generated`.
If an expander does not write its draft, write that document yourself.

**Sketches.** Write every sketch yourself, to the same folder rules. A sketch has only its metadata block, a title, and one sentence under the first section its template requires.

**Seed.** Write `.campaign/drafts/<seed file name>`: the whole current seed, in its own format (metadata block, `# <Seed name>`, then ALL its content inside the master block, with each section as a `###` heading). Add each bullet of `## Seed` under the `###` section it belongs to (for example `### Fazioni` / `### Factions`). Replace a `Da definire.` line only in a section you now fill. Change nothing else in the seed. If `## Seed` says `- none`, do not write the seed.

## Step 6 — Save the batch

Follow section 7 of `authoring.md` with ONE batch:
- `--files`: every draft path written in this step (documents, sketches, `campaign.yaml` if the factions entry was added, the seed if changed), campaign-relative, without `.campaign/drafts/`. Never `outline.md`.
- `--message`: one sentence in the campaign language, for example `Mondo: Borgo Cenere, Teodo Marr e la Gilda del sale.`

## Step 7 — Tell the master

Write a few sentences in the campaign language, in plain words, with no technical terms:
1. what was created, with the main names (for example «Ho creato il Borgo Cenere, con il suo capo Teodo Marr; la Gilda del sale e il Lago Grigio sono per ora appena abbozzati»);
2. that all of it is invented, so the master knows it can be changed («Tutto questo l'ho inventato io: se qualcosa non ti convince, dimmelo e lo cambio»);
3. what is only a sketch and will be filled in when it is needed.

Do not list the files. Do not ask the master to approve anything.

## Worked example (fictional, Italian campaign)

A request: «Crea il borgo di Cenere sul lago Grigio, con il suo capo.» The outline in `.campaign/drafts/outline.md`:

```markdown
Borgo Cenere | borgo-cenere | place | [lago-grigio] | none | Villaggio di minatori sulle rive del lago, governato da Teodo Marr. | -
Teodo Marr | teodo-marr | character | [borgo-cenere] | depends-on:gilda-del-sale | Capo del borgo, indebitato con la gilda del sale. | -
Gilda del sale | gilda-del-sale | faction | [lago-grigio] | rival-of:borgo-cenere | Mercanti che fissano il prezzo del sale sul lago. | -
Lago Grigio | lago-grigio | place | [] | none | Lago freddo ai piedi delle colline, da cui vivono i pescatori del borgo. | -

## Seed
- La gilda del sale controlla il commercio del sale sul lago.
```

Expansion: the borgo and its captain are full documents (the master asked for them). The guild and the lake are sketches: they are kept, and expanded later. The guild is a faction, so its sketch goes into `Fazioni/`, and `campaign.yaml` gets the factions entry in the same batch, together with that faction document. The seed gets the one world-wide bullet under its `### Fazioni` section. One batch saves everything.
