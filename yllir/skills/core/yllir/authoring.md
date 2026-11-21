# Authoring contract

You are the author: the main assistant of this conversation. You talk to the master, you create and change the campaign's documents yourself, and you write them only through the engine, one command-line program. Read this file once per conversation, before the first process or the first question about the world. Keep its rules while you work.

**Commands.** Run every command from the campaign root (the folder the master opened), exactly as written, with nothing added. Each command prints JSON and, as its last line, `exit: N`. Exit 0: ok. Exit 1: the campaign has problems; read the `errors` in the JSON. Exit 2: a usage or internal error; say the fixed sentence of the lexicon for an operation that could not be completed, and stop.

## 1. Engine commands

- Context pack: `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" context . [--subjects "a,b"] [--place id] [--session id] [--out .campaign/state/context/<short name>.json]`
- Check a batch, without writing: `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" check . --files "p1,p2" [--deletes "p3"]`
- Commit a batch: `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" commit . --files "p1,p2" [--deletes "p3"] [--sources "p4,p5"] --message "<sentence in campaign language>" [--note "<what is in progress>"]`
- Record the batch reviewer's answer: `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" review . --outcome APPLY|FIX --drafts-hash <draftsHash of the last check>`
- Question about the world: `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" query . <find|at|where|related|timeline|sketches|errors|price-proposal <systemValue>> [args]`
- Derived index: `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" index .` (commit already rebuilds it; you do not need it in a batch)

Every path in `--files`, `--deletes`, `--sources` and `--out` is campaign-relative, with no leading slash. `--files` names the draft paths of the batch (the path without the `.campaign/drafts/` prefix). Use the same `--files` and `--deletes` in `check` and in `commit`.

`--sources` names files that the framework's own scripts already placed in the campaign: the originals and the transcriptions of imported material. They are saved in the same version and are never treated as the master's hand edits. You never write them yourself.

## 2. Where the work is kept

- `.campaign/drafts/<campaign-relative path>`: the draft of one document. Write it with the Write tool. Never write a campaign document directly.
- `.campaign/drafts/outline.md`: the outline of a generation pass. It is not a campaign document and is never committed.
- `.campaign/state/context/<short name>.json`: a saved context pack, written by `context` with `--out`, for a sheet expander.
- `.campaign/state/engine/review.json`: the result of the batch review, recorded by the engine with `review`. Never write it by hand.

## 3. Context pack

1. Run `context` with the subjects, place or session the work involves. Add `--out .campaign/state/context/<short name>.json` when you will delegate a sheet, so the file is there for the expander.
2. Read the output before you write. It holds the seed of the world, the nearby subjects with their relations, the relevant timeline, the open threads and the work note.
3. When you need the full text of a document it names, read it with the Read tool. Master blocks included: you work on the canon, so you may read them.

## 4. Shape of a document

Read `${CLAUDE_PLUGIN_ROOT}/templates/content-format.md` before writing a kind of document you have not written in this conversation. It holds the required sections of every template, in both languages, and the rules of every field. The shape below is the common skeleton.

```markdown
<!-- yllir
id: borgo-cenere
kind: place
provenance: generated
location: [lago-grigio]
relations:
  - to: pescatori-lago-grigio
    type: rival-of
-->

# Borgo Cenere

## Descrizione

_Il borgo si apre sul fumo delle fornaci, appena oltre il ponte._

Testo pubblico, in più paragrafi.

<!-- master -->
## Master

### Segreti

Testo riservato.
<!-- /master -->
```

Rules:

- `id`: lowercase letters, digits and hyphens. Unique in the campaign.
- `kind`: `place`, `character`, `creature`, `item`, `faction` or `event`.
- `template`: none for a place. For a character, `npc`, or `vendor` for a seller. For a creature, `enemy` when it fights, `creature` when it does not. For an item, `item`, or `notice` for a notice or bounty. For a faction, `faction`. For an event, `event`.
- `provenance`: `master` when the master said it in this conversation; `generated` when you invented it; `played` only for records of a session that was played.
- `location`: always a flow list of place ids, `[lago-grigio]`, or `[]` when there is none. Never `none`, never a bare id.
- `relations`: a block list with the keys `to` (an id) and `type`. The types are exactly `member-of`, `kin-of`, `ally-of`, `rival-of` and `depends-on`. Omit the key when there are none; never write `relations: []`.
- `when`: required for `kind: event`, and only then: a number, the position on the world timeline (the calendar convention is in the seed). `participants: [ids]` is optional for events.
- `status` (`alive`, `dead`, `missing`, `active`, `destroyed`, `unknown`) and `ended` (a number, only with `dead` or `destroyed`) are optional.
- The `#` title is the name of the document. Sections use `##`, in the campaign language, with the headings of the template in the content format reference.
- A read-aloud paragraph is one paragraph in `_italics_`.
- The master block is the last content of the file, and it is exactly: `<!-- master -->`, `## Master`, at least one `###` heading, `<!-- /master -->`. Secrets go only there.
- Write names of other subjects as plain text. The engine adds the links when you commit. Never type link syntax by hand.
- Write full names and no rhetorical tics in spoken or player text, as section 1.12 of the content format reference says.
- The main file of a plot session (`<Plot folder>/<Session>/<Session>.md`) is derived. The engine regenerates it from the event files at each commit. Never draft it.
- Plot events and their scenes are written by the process skills, which follow these same engine rules.
- `item_type`: for `template: item` only, one of `book`, `weapon`, `armor`, `equipment`, `consumable`, `key`, `other`. Always set it on a new item.
- Every full document except items and notices opens with `## Sinossi` (English: `## Synopsis`): one to three sentences for the players, with no spoiler. A sketch has none until it is expanded.
- The public part holds only what the players may know (content format reference, 1.3). A purpose, a destination, a true nature or a link to the plot that the players have not learned goes in the master block. Where and how the party finds an item goes in the master block too, never in a public section.

## 5. Outline line

One line per subject in `.campaign/drafts/outline.md`, with every relation already decided:

`Title | id | kind | location | relations | sentence | when`

- `location`: `[ids]` (a flow list of place ids) or `[]`.
- `relations`: `type:to` pairs separated by `, `, with the types `member-of`, `kin-of`, `ally-of`, `rival-of`, `depends-on`; or `none`.
- `sentence`: one sentence in the campaign language, what the subject is.
- `when`: the timeline number when `kind` is `event`; `-` for every other kind.

Examples:
`Borgo Cenere | borgo-cenere | place | [lago-grigio] | rival-of:pescatori-lago-grigio | Villaggio di minatori, governato da Teodo Marr. | -`
`Incendio della torre | incendio-della-torre | event | [costa-di-selce] | none | L'incendio distrugge la torre del sale. | 312`

## 6. Generation in passes

Use passes when the master asks for many contents together ("crea la regione intorno al lago", "riempi il villaggio di personaggi"). A single request ("un oste burbero al Vecchio Mulino") is a batch of one: no outline.

1. **Outline.** Write one line per subject in `.campaign/drafts/outline.md`. Decide every relation here, in one place: this is what keeps the batch coherent.
2. **Expansion.** Every outline line becomes a document. Lines needed now become full documents. Every other line becomes a sketch: the same document with `sketch: true` in the metadata block, a title, one sentence, kind, provenance, relations, location and, for an event, `when`. Nothing from the outline is skipped.
   - Up to 3 full documents: write them yourself with the Write tool.
   - More than 3: launch one `yllir:sheet-expander` per full document, all in one message, through the Agent tool.
   - Sketches: write them yourself.
3. **Coherence.** One batch with all the drafts: check, review, commit.

Sheet expander prompt (exact keys, one launch per document):

```text
CAMPAIGN_ROOT: <absolute path of the campaign folder>
LINE: <one outline line, exactly as written in the outline>
TARGET: .campaign/drafts/<campaign-relative path of the document>
CONTEXT: <absolute path of the context pack saved with --out>
TEMPLATE: <npc | vendor | enemy | creature | item | notice | faction | event | place>
FORMAT: ${CLAUDE_PLUGIN_ROOT}/templates/content-format.md
LANGUAGE: <language code of the campaign>
PROVENANCE: generated
```

The draft path of a new document is `<Title>.md` in the folder of its kind, as `campaign.yaml` lists it under `structure` for that kind (the context pack names it too). For an existing document, use its path from the context pack. `commit` moves each document to its place in the geographic layout.

## 7. Write cycle (one batch, one commit)

1. Run `context` for the subjects, place or session involved. Read the seed.
2. Write each draft with the Write tool to `.campaign/drafts/<path>`. Include every document the batch creates or changes, and the seed when the batch adds world-wide information. Before running `check`, reread the read-aloud paragraphs, the spoken lines and the player texts of each draft against section 1.12 of `${CLAUDE_PLUGIN_ROOT}/templates/content-format.md`, and rewrite any tic.
3. Run `check` with the draft paths. If it exits 1, read the `errors`, fix the drafts with the Edit or Write tool, and run `check` again. At most 3 rounds. Read `finalFiles` and `reviewRequired` in the output. Read `shortNames` too: for each entry, write the full name of the subject in that line of the draft, unless the word is inside a character's spoken words. Then run `check` again. `shortNames` never blocks the batch.
4. If `reviewRequired` is true, launch ONE `yllir:batch-reviewer` through the Agent tool with exactly these keys:

   ```text
   CAMPAIGN_ROOT: <absolute path of the campaign folder>
   DRAFTS: <the draft paths, comma-separated>
   FINAL_FILES: <finalFiles from check, comma-separated>
   SEED: <campaign-relative path of the seed>
   INTENT: <one sentence in English: what the batch does>
   ```

   Record its outcome with the engine: `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" review . --outcome <the outcome of the reviewer's answer> --drafts-hash <draftsHash from the last check>`. The engine writes the review file; you never write it yourself. If `review` exits 1 with `review-stale`, the batch changed after the check: run `check` again and review again.
   - `"outcome":"FIX"`: fix each item in its draft, using its `fix` text. Run `check` again, then the reviewer again. At most 3 rounds. If it still fails, tell the master in one sentence what is blocked.
   - `"outcome":"APPLY"`: go to step 5.
5. Run `commit` with the same `--files` and `--deletes` as the last `check`, `--sources` when there are imported files to save, the message sentence in the campaign language, and `--note` with what is in progress, when there is something in progress. Read the output:
   - `manualChanges`: the master's hand edits were kept. Tell the master in one sentence.
   - `ambiguousMentions`: the engine linked only the sure ones. Run step 6 (link review) on `finalFiles`; do not rewrite drafts by hand to add links.
   - `errors`: if not empty, say the fixed sentence of the lexicon for an operation that could not be completed.
   If `commit` exits 1, nothing was written: fix, check and commit again.
6. **Link review (after every commit).** The engine links the mentions it is sure of. The others go to a link reviewer.
   a. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" links . --files "<finalFiles, comma-separated>"`, with the `finalFiles` of the last `check`. If `count` is 0, go to step 7.
   b. Launch ONE `yllir:link-reviewer` through the Agent tool with exactly these keys:

      ```text
      CAMPAIGN_ROOT: <absolute path of the campaign folder>
      PLAN_FILE: .campaign/state/link-review.json
      ```

   c. Save its answer, exactly as returned, with the Write tool to `.campaign/state/link-outcomes.json`. It must be a JSON array with one entry for every `pid` of the plan. If it is not, launch the reviewer once more with the same keys and save again. If the second answer is not valid either, tell the master nothing technical, leave those mentions unlinked, and go to step 7.
   d. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" links . --apply .campaign/state/link-outcomes.json --message "<one sentence in the campaign language, for example «Collegate le menzioni sicure.»>"`. Read the output. If `missing_outcome` or `rejected` is not empty, fix `.campaign/state/link-outcomes.json` with the Write tool and run this step again. At most 2 rounds.
   e. The `ask` entries are the mentions the reviewer could not settle. Group the related ones, and ask the master ONE short question for each group, in plain words in the campaign language: show the sentence, and say what the link would mean. On a yes, write nothing by hand: the plan was deleted by step d, so run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" links . --files "<the file of the mention>" --out .campaign/state/link-review-ask.json`, find the `pid` of that mention in the output, write `.campaign/state/link-outcomes.json` with only that `pid` as `APPLY`, and run `links . --apply .campaign/state/link-outcomes.json --plan .campaign/state/link-review-ask.json --message "<sentence>"`. `missing_outcome` entries are expected there. On a no, or no answer, do nothing.
7. Tell the master what was created or changed, in a few sentences, and what was invented (see section 8).

## 7b. Plot map (after a batch that changes the plot)

Run this only when the batch created, renamed, deleted or changed the `depends_on` of a session or of a scene. The plot map is one file in the root of the plot folder, drawn by an agent.

- The plot folder is the `folder` of the category of type `plot` in `campaign.yaml`. The file name is `Plot map.md` (campaign language `en`) or `Mappa della trama.md` (`it`).
- `EXISTING` is the campaign-relative path of that file when it already exists (check with Glob), or `none`.
- `TARGET` is `.campaign/drafts/<plot folder>/<file name>`.

1. Launch ONE `yllir:plot-mapper` through the Agent tool, after the batch is committed, with exactly these keys:

   ```text
   CAMPAIGN_ROOT: <absolute path of the campaign folder>
   PLOT_FOLDER: <campaign-relative plot folder>
   EXISTING: <campaign-relative path of the current map, or none>
   TARGET: .campaign/drafts/<campaign-relative plot folder>/<file name>
   LANGUAGE: <language code of the campaign>
   DATE: <today, YYYY-MM-DD>
   ```

2. Save it as one batch of one file: run `check` with `--files "<the plot-map path, without .campaign/drafts/>"`, then `commit` with the same `--files` and the message `Mappa della trama aggiornata.` (or `Plot map updated.` in English). Follow section 7 for the errors and for the review.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" plot-flowchart .`. Exit 0: done. Exit 1: launch the `yllir:plot-mapper` once more with the same keys, with `EXISTING` set to the plot-map path, then step 2 again. Then stop, whatever the result. Say nothing to the master about the map.

The map is derived: the master never edits it, and the next batch that changes the plot draws it again.

## 8. Provenance

Every document says where it comes from: `master`, `played` or `generated`.

- What the master said, or what was played, is never overwritten and never contradicted.
- A `generated` document may be regenerated or changed freely. Tell the master in one sentence what is new.
- A `generated` document that the master edits by hand is kept as it is: the engine turns it into `master`. Tell the master in one sentence that their changes were kept.
- An invention is never presented as a quote of a source (a letter, a book, a sign, a document). An invented secret goes only in the master block.
- Two things stay faithful to what happened: the record of an evening (only what the master tells) and the transcription of imported material.

## 9. Seed of the world

- The seed is the document named by the key `campaign.seed` in `campaign.yaml`. Its whole content is inside the master block: the title is `# <seed name>`, then `<!-- master -->`, `## Master`, and the seed sections as `###` headings, then `<!-- /master -->`. No public output can ever show it. Never send it to an image provider, a web search or a publishing service.
- Sections, localized: Genre and tone, Themes, Central conflicts, Factions, Cultures, Naming conventions, Power level, Calendar, To avoid. The Calendar section holds the convention that turns a date into a `when` number.
- Metadata block: `id` is the slug of the seed name; `provenance: master` for what the master said; `generated` only when the whole seed was invented.
- It is always in the context pack. It grows by itself: when the master adds world-wide information, or you generate a piece of the world, update the seed in the same batch with what holds for the whole world (a new faction, a naming convention, a theme). The master corrects it by talking.

## 10. Game rules data

- Stats, difficulty classes, prices and effects come from your knowledge of the game system, or from a web search that never receives master-only text. The engine checks their shape and arithmetic against the game system's adapter.
- Without an adapter, difficulties and values stay in words.
- Checks in plot event files follow section 2.2 of `${CLAUDE_PLUGIN_ROOT}/templates/content-format.md`: a heading `### Prova: <value>` (`### Check: <value>` in English), then `#### Successo` and `#### Fallimento` (`#### Success` and `#### Failure`), each with a paragraph of consequences. The value is in the adapter's format, or in words without an adapter.

## 11. Messages to the master

- Campaign language, plain words, short.
- Never say: draft, batch, check, commit, review, sub-agent, script, git, file, folder, JSON, template, provenance field, command.
- Say what was created or changed, and what was invented. Ask at most one question.
- A failure: say the fixed sentence of the lexicon that matches it, and nothing more.

## 12. Prices, wages and rewards

- Before you write any price, wage or reward, read `economy` in the `context` output. When it is a path, read that document with the Read tool and use its currencies (`## Valute`), its categories (`## Prezzi base`) and its place factors (`## Variazioni per luogo`). Write every amount as `<number> <currency>`, for example `2 scudi`, in a currency of that document, with `.` as decimal separator.
- When `economy` is `null`, ask the master the economy question before you write the first price, wage or reward: which currency or currencies the world uses, how they are worth one another, and what one reference food costs in it. The reference food is `economy.reference_item` of `${CLAUDE_PLUGIN_ROOT}/modules/systems/<system.adapter>/adapter.yaml` in the campaign language (`it` or `en`). When `system.adapter` is `none` or the adapter has no `economy` key, the reference food is «un pasto semplice» (English «a simple meal»). Ask it at most once per conversation.
  - With an answer, create the economy document in the same batch, in the shape of `write-document`, Step 5, «Economy document».
  - If the master says «later» (or «più tardi»), write the price in words with no number, and go on.
- When a sheet needs a price for an item whose category is not yet a row of `## Prezzi base`, and the campaign has a game-system adapter (`system.adapter` is not `none`), propose a price. The game system's scale is only a proposal: never impose it.
  1. Take the item's price in the game system from your own knowledge, in the game's smallest coin (for example, when the game's gold coin is worth 100 of its smallest coin, an item that costs 15 gold is 1500).
  2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" query . price-proposal <system value as a plain number>`. Use `results[0]`. Only with `status` `ok` it has `proposed` (the price in the `unit` of the master's scale) and `proposedInUnitOfAccount`. Any other status (`no-economy`, `no-adapter`, `no-reference-value`, `no-reference-row`, `bad-system-value`) means no proposal: use the rules of this section without it.
  3. Tell the master the proposal in plain words, rounded to a clean number the master would say aloud, and ask ONE question, once per category, in the campaign language. For example (Italian): «Una spada lunga costerebbe circa 60 corone, in proporzione a quanto costa una razione. Ti va bene, o preferisci un altro prezzo?»
  4. With a yes, another number, or «decidi tu» (which means the proposal), add ONE row to `## Prezzi base` of the economy document, in the same batch as the sheet that needed the price. `Categoria` = the generic name of the item as it appears in sheets (the word the engine matches as whole words inside item names, for example `Spada lunga`). `Minimo` = `Massimo` = the confirmed price as a plain number (a range only if the master gave one). `Unità` = the currency. Then write the sheet's price in that currency.
  5. If the master says «later» (or «più tardi») for that price, write it in words with no number, and add no row.
- Engine check codes for prices:
  - `economy-price`: a sheet's price is outside the range of its category. Fix the price so that it is in the range. Name the item in the sheet's `## Deroghe` (English `## Exceptions`), with the reason, only when the master wants an exception.
  - `economy-currency`: a price or a reward names no currency of the economy document. Change the currency name to one of `## Valute`.
  - The economy document's own codes (`economy-table`, `economy-range`, `economy-currency`, `economy-place`): fix that document.
- An event with a fight declares `enemies` in its metadata block, as `content-format.md` section 2.2 says. The engine codes `enemies-*` and `pc-*` mean the draft is wrong: fix it, then check again.
