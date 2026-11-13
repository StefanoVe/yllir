---
name: write-document
description: Core process. Creates or changes one campaign document from a description (a character, a place, an item, a creature with full stats, a faction, a historical event, the seed) or expands a sketch into a full sheet, and saves it through the write cycle as a batch of one.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" *), Bash(node */scripts/engine.mjs *), Read, Write, Edit, Agent, Skill, Glob, Grep
---

# Write one document

You run this process yourself, in the main conversation. Follow the write cycle in `${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/authoring.md` for every command, draft, check, review and commit, and its section 8 (provenance) for every change to an existing document. Do not repeat them: follow them. This process is a batch of one: there is no outline.

Run every command from the campaign root, exactly as written, with nothing added. Write the document in the campaign language. Ask the master a question only when a choice would change who the subject is; otherwise decide, and tell the master what you invented.

## Step 1 — Settings and the request

1. Read `campaign.yaml` with the Read tool: `language.main`, `system.adapter`, `campaign.seed`, and the `structure` list (the folder of each category and its type).
2. Decide the operation from the request:
   - **create**: a new document;
   - **change**: an existing document the master names or describes;
   - **expand**: a sketch that the master names, or a session uses (see Step 6).
3. For **change** or **expand**, find the document: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" query . find "<name>"`, and read the `id` and the path of the match. If there are several matches, ask the master which one, in one sentence, and stop.

## Step 2 — Context

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" context . --subjects "<the id of the subject, or its name>"`, adding `--place <id>` when the document is about a place. Read the output: the seed, the nearby subjects, the timeline and the open threads. Read the seed file named by `campaign.seed` too.

## Step 3 — Kind and template

Choose the `kind`, the `template` and the category folder:

| What | `kind` | `template` | Folder (category type) |
| --- | --- | --- | --- |
| Place | `place` | none (a place has no template) | `places` |
| Non-player character | `character` | `npc` | `subjects` |
| Vendor | `character` | `vendor` | `subjects` |
| Creature that fights | `creature` | `enemy` | `subjects` |
| Creature that does not fight | `creature` | `creature` | `subjects` |
| Item | `item` | `item`, or `notice` for a notice board announcement | `objects` |
| Faction | `faction` | `faction` | the folder of the top-level category `fazioni` (`factions` in English), `Fazioni/` or `Factions/` at the root |
| Historical event | `event` | `event` | the folder of the `free` category itself (`Storia` in Italian), directly |
| Player character | `character` | none (a player character has no template) | the `master-only` category `Giocatori/` (English `Players/`) |
| Economy document | none | none | fixed path `Storia/Economia.md` (English `History/Economy.md`), `id: economia` |
| Sketch | as the subject | as the subject | as the subject |

A faction whose category (`fazioni` / `factions`) is not yet in `campaign.yaml` also needs that entry, of type `subjects` and folder `Fazioni` or `Factions` at the root, in the same batch (as `build-world` Step 5 shows).

Read the template for the sections, their order and their required content in `${CLAUDE_PLUGIN_ROOT}/templates/content-format.md` (the section of the template of that kind). Include every required section, in the order given there. A place has no `template` line in its metadata block.

## Step 4 — Rules values (only when the campaign has an adapter)

Use this step for a character (`npc`, `vendor`), a creature that fights (`enemy`) or an item that has game statistics. Every character and every enemy has at least one combat action, even one who does not seek a fight.
- If `system.adapter` is `none`: write the values in words (for example «difficile da ferire, colpisce forte»). Do not invent numbers.
- Otherwise read the schema: `${CLAUDE_PLUGIN_ROOT}/modules/systems/<system.adapter>/adapter.yaml`, with the Read tool. It lists the fields, required or optional, and the value formats.
- Write the values from your own knowledge of the game system, in the fields the schema names. Keep the arithmetic right: an ability modifier comes from its score, and a derived number (a bonus, a total) comes from its parts. The engine checks the shape and the arithmetic when you check the batch.
- Write an amount that is rolled at the table (damage, healing, temporary hit points) as its dice only, never with a precomputed result: «Colpisce: 1d6 + 1 danni perforanti», not «Colpisce: 4 (1d6 + 1) danni perforanti». Hit points in the Characteristics table keep their number.
- If you are not sure of a rule value, do not guess it: write it in words, and tell the master in the final message which value is not yet exact.
- The statistic block goes in the public part of the document, in the sections of its template.

## Step 5 — Write the draft

**Create.** Write `.campaign/drafts/<folder>/<Title>.md` with the Write tool, in the shape of section 4 of `authoring.md`:
- metadata block: `id`, `kind`, `template` (not for a place), `provenance`, `location` as a flow list (`[borgo-cenere]`, or `[]` when it has no place), `relations` as a block list of entries with `to` (an `id`) and `type` (exactly `member-of`, `kin-of`, `ally-of`, `rival-of` or `depends-on`), with the key omitted when there are none, and `when` for an event (a number), as section 4 shows;
- `provenance`: `master` when the master gave the fact in this conversation; `generated` when you invented it;
- the `#` title, the public sections, and the master block with the secrets and the notes for the master.

**Change.** Read the whole document with the Read tool first. Then write the new version of the whole document to `.campaign/drafts/<its path>`:
- If its `provenance` is `generated`: you may change it freely. Tell the master in one sentence what is new.
- If its `provenance` is `master` or `played`: change only what the master asked. Copy every other line exactly. Never overwrite or contradict what the master or a played session established. If the requested change would contradict it, do not write: ask the master one question in the campaign language, and stop.
- Keep the `id`, the `kind` and the `template`.

**Expand a sketch.** Read the sketch with the Read tool. Write the full document in its template, to the same path: keep the `id`, `kind`, `relations` and `location`; remove the line `sketch: true`; keep the `provenance`. The sentence the sketch has becomes the first sentence of its first required section; fill the other required sections. Do not change the sketch's relations: they were decided when it was outlined.

**Player character.** The file is `Giocatori/<Title>.md` (English `Players/<Title>.md`), with metadata `id`, `kind: character`, no `template`. Sections and the hook format are in `content-format.md`, section 4.13. Then:
1. Originals first. If the player gave files (PDF, photo, text), they must already be in the campaign through the import process: the entry skill routes them to `yllir:import`. This process never copies originals. If they are not yet imported, do not write the sheet: tell the master in one sentence that the files go through import first, and stop.
2. Read the `context` output of Step 2 (the seed, the nearby subjects, the timeline, the open threads). Use them as candidates for the hooks.
3. Classify each claim of the player's background, one claim at a time:
   - **anchorable**: it matches a subject of the canon. Write that subject's name as plain text in a hook; the engine adds the link. Example: the background says «suo padre era il guardiano del faro», and the canon has the place `Faro di Selce`, which is the lighthouse: anchorable.
   - **compatible**: it adds a fact the canon does not contradict. Write it in a hook with `- Stato: da proporre`. Example: «ha giurato fedeltà a un contrabbandiere», and the canon does not mention any such smuggler.
   - **silence**: the canon says nothing and the claim does not matter for the plot. Keep it in `## Background` only. Example: «ama pescare all'alba».
   - **conflict**: it contradicts the canon. Never change the canon, and never change the claim. Write one line in `## Domande aperte` (English `## Open questions`) that names both sides, and tell the master in the final message. Example: the background says the father is alive, the canon says he died in the fire of the tower.
4. A hook that would add a fact to the canon stays `- Stato: da proporre` (English `- Status: to propose`) until the master says yes. With the yes, change it to `- Stato: pronto` (English `- Status: ready`), and write the canon fact in its own sheet in the same batch. That batch goes through the batch reviewer as section 7 of `authoring.md` says.
5. Write `level: <n>` in the metadata block only when the player's sheet states the level. Never invent it.
6. Never rewrite the mechanics of the player's sheet: transcribe them as given (the adapter's `do_not` list says so). They go in `## Scheda`.

**Economy document.** Create or change it when the master asks for prices, currencies, wages or place factors, or when `authoring.md` section 12 asks for it.
- Path: a new one is `.campaign/drafts/Storia/Economia.md` (English `History/Economy.md`). An existing one is at the path that the `economy` field of `context` gives. Find it by `id: economia`.
- Metadata: `id: economia` and `provenance`.
- Shape: exactly as `content-format.md` section 4.11. The title, then `## Valute` (English `## Currencies`), `## Prezzi base` (English `## Base prices`), `## Salari` (English `## Wages`) and `## Variazioni per luogo` (English `## Variations by place`), in this order, then the master block with `### Indicazioni per il master` (English `### Master notes`) and one line that says where the prices come from. A table may keep only its header and separator rows.
- The currency rules are those of 4.11: one currency per row; exactly one `unità di conto` (English `unit of account`) row, the first currency named unless the master says otherwise; the other equivalences as the master gave them.
- A reference food from the answer to the economy question: one `Prezzi base` row with `Minimo` = `Massimo` = the stated number (a plain number, for example `1`, not `1 scudo`), with the currency in `Unità`, unless the master gave a range. Empty `## Salari` and `## Variazioni per luogo` tables are valid.
- When a change is made to an existing economy document, change only what the master asked, as Step 5 "Change" says.
- After the economy document is committed, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" query . prices` and read `results`. Before you change any sheet, show the master the sheets out of range (file, item, price, range), and ask one question: update them? Change them only on a yes, as a change of their own batch.

**Do not put a secret in the public part.** A secret goes only in the master block. An invention is never presented as a quote of a source (a letter, a book, a sign).

## Step 6 — Consequences in other documents

A change can make another document wrong: a character who dies cannot act after the death; an event cannot happen in a place that was destroyed before it. After writing the draft:
1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" query . related "<id>"` and `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" query . timeline`, and read the documents the answer names that come after the change.
2. For each one the change makes inconsistent, write its corrected draft to `.campaign/drafts/<its path>`, changing only the lines that conflict. Its `provenance` rules of Step 5 apply to it too. A `master` or `played` document that conflicts is not changed: tell the master in one sentence what conflicts, and ask what to do.
3. Put all these drafts in the same batch as the main document.

If the request adds a fact for the whole world (a new faction, a convention of names, a theme), also write the updated seed file (`campaign.seed`) to `.campaign/drafts/<seed file>`, keeping its format (all content inside the master block, sections as `###`), with the fact added under its `###` section, and put it in the batch.

## Step 7 — Save

Follow section 7 of `authoring.md` with ONE batch: every draft of this process, campaign-relative, without `.campaign/drafts/`, in `--files`. The `--message` is one sentence in the campaign language, for example `Ilde Varno: scheda creata.` or `Gilda del sale: membro morto, cronologia aggiornata.`

## Step 8 — Tell the master

In a few plain sentences, in the campaign language, with no technical terms:
1. what was created or changed, by name;
2. what is new that the master did not say, as invented («L'ho inventato io: il suo passato e il suo debito»);
3. any rule value that is still in words, and why;
4. any other document that was changed because of this change.

If the master asked something you could not do, say so in one sentence.
