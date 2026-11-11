# Content format: reference for the author and the sheet expander

Framework-side reference of the format of campaign documents. Read the section of a template before writing a document of that kind. Distilled from `docs/Formato dei contenuti.md` (Italian); where they differ, the scripts decide. Section headings are campaign content: the Italian column is the spec's wording, the English column is the one the scripts use. A heading or rule marked **not yet validated** has no script check yet; use the English form given here.

## 1. Rules common to every document

### 1.1 Title

- One level-1 title `#` after the metadata block: the public name of the subject.
- Sections are `##`, subsections `###`.
- For `npc`, `vendor`, `enemy` and `creature` the title must equal the file name without `.md` (checked). Keep this for every other kind too.
- Plot event files have no title (section 2). Chronicle pages have a free title (section 3).

### 1.2 Metadata block

A YAML-like block, first in the file, written as an HTML comment so that Markdown previews hide it. Only these fields are allowed.

Delimiters: line 1 of the file is exactly `<!-- yllir`; the block ends at the first line that is exactly `-->`. The lines in between use the same keys and the same syntax as before (flow lists `[a, b]`, a block list for `relations` and `appearances`). No line inside the block may contain `-->`. A block written in the old `---` form is still read, and the engine converts it to the form above when it saves the document.

| Field | Required for | Form | Meaning |
|---|---|---|---|
| `id` | every document | slug (lowercase letters, digits, hyphens), unique in the campaign | stable identity; never changes, even when the title changes |
| `kind` | `places`, `subjects`, `objects`, `free` categories | `place`, `character`, `creature`, `item`, `faction` or `event` | type of the subject; `kind: place` only in a places category, and a places category holds only places |
| `template` | every subject except places | `npc`, `vendor`, `enemy`, `creature`, `item`, `notice`, `faction`, `event` | sheet model; places have no `template` |
| `provenance` | `places`, `subjects`, `objects`, `free`, `plot`, `chronicle` | `master`, `played` or `generated` | where the content comes from (1.9) |
| `location` | subjects with a position; places use it for their containing place | **always a flow list of place ids**: `[porto-di-selce]`, or `[]` when none | where it is now; a creature living in several places lists them all. Never `none`, never a bare id |
| `relations` | optional | block list (1.2.1) | links to other subjects, with a type |
| `status` | optional | `alive`, `dead`, `missing`, `active`, `destroyed` or `unknown` | state in the timeline |
| `ended` | only with `status: dead` or `status: destroyed` | a number | timeline position of the end |
| `when` | **required for `kind: event`**, forbidden otherwise | a number, integer or decimal, may be negative | position on the world timeline; the calendar convention is in the seed |
| `participants` | only for `kind: event` | flow list of subject ids | subjects taking part in the event |
| `aliases` | optional | flow list of names | other names of the subject |
| `sketch` | optional | only `true` | marks a sketch (4.12) |
| `print` | objects with a card | `to-print`, `printed` or `reprint` | print state of the card |
| `depends_on` | plot sessions and events | flow list of ids; `[]` when none | prerequisites (section 2) |
| `session`, `characters`, `items`, `appearances` | plot event files | see section 2 | |
| `played` | chronicle pages | flow list of session ids; `[]` when none | what was played that evening (section 3) |
| `merged_ids` | after a merge | flow list of ids | absorbed identities |
| `generated` | derived main file of a session only | `true` | never written by hand |

Rules of form: keys are lowercase; lists are flow lists `[a, b]`, except `relations`, a block list. A reference (`location`, `depends_on`, `characters`, `items`, `participants`, `appearances`) always points to an `id`, never to a file name or a link. The name and the category are not repeated in the metadata block. The metadata block holds no secret.

#### 1.2.1 Relations

A block list; each entry has exactly the keys `to` (an id) and `type`:

```yaml
relations:
  - to: gilda-del-sale
    type: depends-on
  - to: borgo-cenere
    type: member-of
```

The five types are `member-of` (membership), `kin-of` (kinship), `ally-of` (alliance), `rival-of` (rivalry) and `depends-on` (dependence: debt, service, need). Any other key or type is an error. Omit the key when there are none; never write `relations: []`.

### 1.3 Public part and master block

Everything above the master block is public. Exports, encyclopedia and cards read only the public part. The master block is the last content of the file, in this exact form:

```markdown
<!-- master -->
## Master

### Indicazioni per il master

Testo riservato al master.
<!-- /master -->
```

- At most one block per file. Each marker stands alone on its line.
- The first line of the block is `## Master`; only `###` or lower headings follow.
- Nothing follows `<!-- /master -->`.
- Never put a marker, a fenced block or a master-only heading in the public part.
- Master-only headings (`Indicazioni per il master`, `Segreti`, `Agganci`, `Motivazioni`) appear only inside the block.
- An invention never appears as a quote of a source; an invented secret goes only in the block.

### 1.4 Image under the title

Optional, before the first section: `![Lanterna di ottone con vetro annerito](img/lanterna-da-bordo.png)`. The alt text describes the image and does not repeat the file name. Image names are lowercase with hyphens, live in the `img/` folder of the owning category or place, and must exist.

### 1.5 File names

- The file name is the title without `#`. Spaces, apostrophes and accented letters are allowed; `/ \ : * ? " < > |` are not.
- Two files in one folder never share a name, not even in another case.
- A place with sub-places is a folder holding the file of the same name: `Mondo/Costa di Selce/Costa di Selce.md`.
- A chronicle page is named with its date: `AAAA-MM-GG.md`.

### 1.6 Links

- Only relative Markdown links, spaces written `%20`, pointing to existing files inside the campaign.
- A section anchor is the lowercase slug of the heading: `scheda.md#indicazioni-per-il-master`.
- Authors write the names of other subjects as plain text. The engine adds the links when a batch is committed.

### 1.7 Narrative italics

Text the master reads aloud, or what characters perceive, is one paragraph in italics: `_La nebbia sale dal molo prima dell'alba._` Italics mark the function, not emphasis. A full text of an object or a notice (a letter, a book) is ordinary prose: no italics, no quote marker.

### 1.8 Fenced blocks

Three-backtick blocks are allowed inside the master block, and in plot documents for the master's notes. Outside the block, in any other document, they are an error: they would leave a note in the part the exports read.

### 1.9 Provenance

`master` is what the master said; `played` is what happened at the table; `generated` is what the framework invented. What the master said or what was played is never overwritten or contradicted. A `generated` document can be regenerated or changed. When the master edits a `generated` document by hand, the engine keeps the edit and sets the provenance to `master`.

### 1.10 Register and language

The prose register is `prose.register` in `campaign.yaml` (`elevated`, `plain`, `colloquial` or `mixed`) and applies to narrative descriptions only. Statistics, prices, metadata and tables are neutral. Text is in `language.main`. Field names and type words stay in English.

### 1.11 Geographic layout

A document sits in its category folder, at the nearest common ancestor of its `location` and of every place in its explicit `appearances`. A subject with no known location goes to the category's `Da collocare` folder (`Unplaced` in English). The author writes a new draft in the folder of its kind named by the context pack; the engine moves it to its place at commit.

## 2. Plot texts (sessions and activities)

Plot texts live in the `plot` category (for example `Trama/`): one folder per session, with a derived main file and an `Eventi/` folder.

```text
Trama/
  <Sessione>/
    <Sessione>.md        main file: derived, regenerated by the engine
    Eventi/
      <Evento>.md        one file per main event
```

### 2.1 Main file of a session (derived, never drafted)

The engine regenerates the main file from the event files at every commit. It holds a Mermaid concept map (one node per event, one edge per `depends_on`) and the event list, each linked to its file. It has `generated: true`. Never draft it and never edit it: a draft of this file is an error.

### 2.2 Event files

- The file name is the event's name. There is no `#` title; the text starts at once.
- Metadata block: `id`, `session` (the id of its session), `depends_on` (required; `[]` when none), and optionally `location`, `characters`, `items`, `appearances`.
- `characters`: the characters the event names and makes act or speak; each must have a sheet. `items`: relevant items used in the event, when they have value, effects, secrets or a plot role; each id must have an item sheet.
- `appearances`: a list of `subject` and `location` pairs (`subject: <id>`, `location: [<place ids>]`), only for presences the text states. Presence is never inferred from `characters`, `items`, names or mentions.
- `##` is a minor action inside the event; `###` is a check or single attempt, followed by a result list with `Successo` and `Fallimento` (English: `Success`, `Failure`).
- Dependencies come only from `depends_on`, never from the text.
- A scene never states who a character is; that belongs to the sheet. A scene that makes a character act against its sheet is a question for the master.

A direct address to the players is a quote block (`>`). It defines no identity.

**Not yet validated:** plot event checks are in the spec; the scripts do not check the event body yet.

## 3. Chronicle page

A chronicle page records what happened at the table; it is written after a session from the game log. It lives in the `chronicle` category (for example `Cronaca/`), one file per evening.

```markdown
<!-- yllir
id: cronaca-2026-11-14
played: [il-faro-spento-01]
-->

# Il faro si spegne

## Accaduto

Il gruppo scende al porto all'alba e trova la lanterna spenta.

## Fili aperti

- Il registro del faro è sparito.
```

- `id` is `cronaca-` followed by the file name without `.md`. `played` is required (`[]` when empty). Provenance is `played`.
- One free `#` title: a short name of what happened.
- `## Accaduto` (English: `## What happened`) is required, prose in the past tense. `## Fili aperti` (English: `## Open threads`) is optional, as a list.
- A master block is optional. A chronicle never anticipates what has not happened.

**Not yet validated:** the chronicle checks are in the spec only.

## 4. Templates

Sections are listed in their required order. Optional sections keep the order given here. A required section must exist and have text.

### 4.1 Place (`kind: place`)

- Category: nested folders under the places category.
- Metadata block: `id`, `kind: place`, `provenance`, `location` (the containing place, `[]` for a top place). **No `template` field.**
- Required: the title and `## Descrizione` (English: `## Description`), opening with an italic paragraph.
- Optional, after the description: `## Abitanti` (English: `## Inhabitants`), `## Punti d'interesse` (English: `## Points of interest`); `## Da definire` (English: `## To define`), required when gaps remain.
- Master block: `### Indicazioni per il master` (English: `### Master notes`), optionally `### Agganci` (English: `### Hooks`).

**Not yet validated:** no script checks place sections yet.

### 4.2 Character (`template: npc`)

- Category: `Personaggi/`. Metadata block: `id`, `kind: character`, `template: npc`, `provenance`, `location` (where it normally is).
- Required: the title, `## Ruolo` (English: `## Role`), `## Aspetto e modi` (English: `## Appearance and manner`), `## Al tavolo` (English: `## At the table`) with voice, manner of speech and what the character wants.
- Optional, in order: an image (portrait); `## Statistiche` (English: `## Statistics`), required when the character can fight (4.3); `## Da definire` (English: `## To define`).
- Master block: `### Indicazioni per il master` (English: `### Master notes`), then any of `### Motivazioni` (English: `### Motives`), `### Segreti` (English: `### Secrets`), `### Agganci` (English: `### Hooks`).
- Links to other subjects go in `relations`; the prose of `Ruolo` may describe them.

Validated: the sections, their order, `location` as a list of place ids, the statistics tables.

### 4.3 Statistics tables (`npc`, `vendor`, `enemy`)

`## Statistiche` (English: `## Statistics`) holds up to three tables, each under its `###` heading, in this order. Values come from the game system's adapter; the framework checks the shape.

| Heading (it / en) | Columns (it / en) |
|---|---|
| `### Caratteristiche` / `### Characteristics` | `Caratteristica`, `Valore` / `Characteristic`, `Value` |
| `### Attacchi e capacità` / `### Attacks and abilities` | `Attacco o capacità`, `Dettagli` / `Attack or ability`, `Details` |
| `### Equipaggiamento` / `### Equipment` | `Oggetto`, `Dettagli` / `Item`, `Details` |

### 4.4 Vendor (`template: vendor`)

- The character sheet (4.2) with `template: vendor` and the sections below.
- Required in addition: `## Assortimento` (English: `## Stock`), whose first table has the columns `Oggetto`, `Prezzo`, `Nota` (English: `Item`, `Price`, `Note`), in this order.
- Optional, in order after the stock: `## Trattare` (English: `## Haggling`); `## Deroghe` (English: `## Exceptions`), required when a price leaves the economy ranges, with the reason.
- Prices use the unit of the economy document (4.11).

Validated: the stock columns and order, and the required sections.

```markdown
## Assortimento

| Oggetto | Prezzo | Nota |
| --- | --- | --- |
| Corda di canapa | 2 scudi | prezzo di base |
```

### 4.5 Enemy and creature (`template: enemy` or `creature`)

- Category: `Creature/`. Metadata block: `id`, `kind: creature`, `template`, `provenance`, `location` (every place where it lives; `[]` when it wanders).
- `enemy` fights; `creature` does not (animals, mounts).
- Required: the title, `## Natura` (English: `## Nature`), public lore, and `## Statistiche` (English: `## Statistics`). An `enemy` has the tables (4.3). A `creature` writes in that section the sentence `Nessuna statistica: non combatte` (English: `No statistics: it does not fight`).
- Optional, in order: an image; `## Bottino` (English: `## Loot`); `## Da definire` (English: `## To define`).
- Master block: `### Indicazioni per il master` (English: `### Master notes`): conduct, tactics, when it flees.

Validated: the sections and their order, the no-statistics sentence for `creature`, the statistics tables for `enemy`.

### 4.6 Item (`template: item`)

- Category: `Oggetti/`; produces cards when its `structure` entry sets `cards: true`. Metadata block: `id`, `kind: item`, `template: item`, `provenance`, `location` (where it is now), `print` for objects with a card.
- Required, in order: the title; `## In breve` (English: `## In brief`), a public summary of the item as the players know it; `## Descrizione` (English: `## Description`); `## Effetti` (English: `## Effects`), with only the effects known to the players, in the adapter's format, or the sentence `Nessun effetto di gioco` (English: `No game effect`) when no effect is known to the players.
- Optional, in order after Effects: `## Origine` (English: `## Origin`); `## Ritrovamento` (English: `## Finding`); `## Testo` (English: `## Text`), full text of a letter or book, ordinary prose; `## Valore` (English: `## Value`).
- Master block: `### Indicazioni per il master` (English: `### Master notes`), with the full context of the item: what it really is, its true origin, its complete real effects, its secrets, its plot uses, and what the players do not know yet. Public sections never state or hint at these.
- Card image, if planned, follows the title: `img/<base-name>.png` with the `.psd` source beside it. A printed card keeps its file name (QR codes point to the `id`).

Validated: exactly one public level-1 title; `In breve`, `Descrizione`, `Effetti` in this order and non-empty; optional sections in order without duplicates; master block.

### 4.7 Notice (`template: notice`)

- Category: `Oggetti/`: a notice is an item, the sheet of the paper pinned to a board. Metadata block: `id`, `kind: item`, `template: notice`, `provenance`, `location` (the board's place only).
- Required, in order: the title; `## Testo` (English: `## Text`), the text as posted; `## Premio` (English: `## Reward`), in economy units, or `Nessun premio` (English: `No reward`).
- Optional: `## Indizi` (English: `## Clues`) after the title's image.
- Master block: `### Indicazioni per il master` (English: `### Master notes`), with the real client and hidden conditions.

**Not yet validated:** the item check skips notices.

### 4.8 Faction (`template: faction`)

- Category: `Fazioni/`. Metadata block: `id`, `kind: faction`, `template: faction`, `provenance`, `location` (its seat; `[]` when none).
- Required: the title and `## Chi sono` (English: `## Who they are`), what characters can know.
- Optional, in order: an image; `## Obiettivi` (English: `## Goals`); `## Membri` (English: `## Members`).
- Master block: `### Indicazioni per il master` (English: `### Master notes`), `### Segreti` (English: `### Secrets`), `### Agganci` (English: `### Hooks`).
- A member points to the faction with a `member-of` entry in its own `relations`.

**Not yet validated:** no script checks faction sections yet.

### 4.9 Historical event (`kind: event`, `template: event`)

- Category: `Storia/`. Not a plot event: no `depends_on`, not in `Trama/`. Metadata block: `id`, `kind: event`, `template: event`, `provenance`, `when` (required), optional `participants` and `location` (lists).
- Required: the title and `## Accaduto` (English: `## What happened`), prose in the past tense. Optional: `## Conseguenze` (English: `## Consequences`).
- Master block: `### Indicazioni per il master` (English: `### Master notes`).

Validated by the world graph: `when` is a number, `participants` and `location` are lists, the timeline rules. **Not yet validated:** the sections.

### 4.10 Concept of history (`free`)

- Category: `Storia/`. Metadata block: `id`, `kind`, `provenance`. Required: the title and `## Definizione` (English: `## Definition`). Optional: `## Come appare` (English: `## How it appears`), `## Da definire`. Master block: `### Indicazioni per il master`.

### 4.11 Economy document

- File `Storia/Economia.md`, one per campaign. Metadata block: `id: economia`.
- Required, in order: the title; `## Valute` (English: `## Currencies`): `Valuta`, `Equivalenza`, `Nota`; `## Prezzi base` (English: `## Base prices`): `Categoria`, `Minimo`, `Massimo`, `Unità`; `## Salari` (English: `## Wages`): `Mestiere`, `Paga`, `Periodo`; `## Variazioni per luogo` (English: `## Variations by place`): `Luogo` (an id), `Fattore`, `Motivo`.
- Optional: `## Deroghe in vigore` (English: `## Exceptions in force`); `## Da definire`. Numbers use a dot as decimal separator.

### 4.12 Sketch (`sketch: true`)

- Any kind and template. Metadata block: `sketch: true`, `kind`, `provenance`, `location` and `relations` if any, `template`, and `when` for an event.
- Content: the title and one sentence under the first required section of its template. The other sections are not written yet.
- When the master names a sketch, or a session uses it, it is expanded into a full document.

### 4.13 Player character (`master-only`)

- Category: `Giocatori/`, one file per character; the whole file is master-only. Metadata block: `id`. Required: the title, `## Scheda` (English: `## Sheet`), `## Integrazione con la trama` (English: `## Plot integration`). Optional: `## Background`, `## Domande aperte` (English: `## Open questions`), `## Originali` (English: `## Originals`). No master block: the whole file is private.

## 5. Seed of the world

The seed is the document named by `campaign.seed` in `campaign.yaml`. Its whole content is inside the master block, so no public output can show it.

- Title `# <seed name>`, then the master block with `## Master` and one `###` heading per seed section, in the campaign language: Genre and tone, Themes, Central conflicts, Factions, Cultures, Naming conventions, Power level, Calendar, To avoid (the sections may be a subset when the master has said little).
- Metadata block: `id` is the slug of the seed name; `provenance: master` for what the master said; `generated` only when the whole seed was invented.
- The Calendar section holds the convention that turns a date into a `when` number.

## 6. What the framework checks

Without a model: metadata block fields and forms; `id` unique; `location` a flow list; `relations` well formed; `when` only for events; `status` and `ended` consistent; references to missing subjects; a `location` that is not a place; an event involving a subject or place after its `ended`; the same participant in two places at the same `when`; sheet sections, order and names; stock and statistics tables; title equal to the file name; master block form; item section order; relative links and anchors that resolve.
