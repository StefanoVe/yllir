---
name: prepare-session
description: Core process. Prepares the next session of a Yllir campaign as a new session: a main file, one file per scene, the characters, places and items the scenes need, and the dependencies between the scenes, written in one batch.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" *), Bash(node */scripts/engine.mjs *), Read, Write, Edit, Agent, Skill, Glob, Grep
---

# Prepare session

You are the AUTHOR: you write the session yourself. Run commands from the campaign root (the folder that contains `campaign.yaml`). Every write goes through the write cycle in `${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/authoring.md`: follow it, do not repeat it here.

**Commands.** Run the engine exactly as written below, as one single command, with nothing added before or after. Read every value from its output. Never guess a value.

**Messages to the master.** Campaign language, plain words. Never mention files, scripts, git, drafts, sub-agents or reviews. Ask at most one question per message, and end every question with a question mark. Words for the master come from `${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/lexicon.md`. When something cannot be done, say its fixed sentence from that file (the operation that could not be finished, or the session already played), in the campaign language column, and stop.

## Steps

**Step 1 — Where the story stands.**
1. Read `campaign.yaml` with the Read tool. Keep:
   - `language.main`: the CAMPAIGN LANGUAGE;
   - the `folder` of the entry of type `plot`: the PLOT FOLDER;
   - the `folder` of the entry of type `chronicle`: the CHRONICLE FOLDER.
2. Glob `<CHRONICLE FOLDER>/*.md`. File names start with the date, so the last one in sorted order is the newest page. Read the newest pages with the Read tool and keep their `played` lists. LAST_PLAYED is the first id of the newest non-empty `played` list, or none.
3. Glob `<PLOT FOLDER>/*/*.md`. A session main file is the file whose name equals its folder name. Read each main file and keep its `id`, its `name` (the title), its `depends_on` and its path.
4. A session is PLAYED when its `id` is in a `played` list of a chronicle page. A session is READY when every id in its `depends_on` is PLAYED.
5. The TARGET is the session the master names in MASTER_MESSAGE (compare names ignoring case and accents). Without a name, the TARGET is the only READY session that is not PLAYED. If there are several, ask ONE question that names them by their names, and stop.
6. If the TARGET is not READY, ask ONE question: say which prerequisite is not played and ask whether to prepare it anyway. Stop, unless the master says yes.
7. If the TARGET folder already exists, do not create a second one. Read its files, and change only what the master asks. A file with `provenance: played` is never changed. If the master asks to change a session that has already been played, use the fixed sentence for a session already played from the lexicon, and stop.

A session's name is the name of its folder, and a scene's name is the name of its file: the engine uses them as the titles.

Output: CAMPAIGN LANGUAGE, PLOT FOLDER, CHRONICLE FOLDER, LAST_PLAYED, TARGET (id, name, folder).

**Step 2 — Context pack.** Get the ids of the places, characters and items the master named: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" query . find "<name>"` for each name whose id you do not know. Then run:

`node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" context . --session <LAST_PLAYED> --place <PLACE_ID> --subjects "<ID1,ID2>"`

Leave out `--session` when LAST_PLAYED is none, `--place` when there is no place, and `--subjects` when there are no subjects. Read the output: it holds the world seed, the subjects near these ones, the relevant chronicle, the open threads and the work note.

Read the main file and the scene files of LAST_PLAYED with the Read tool, so that the new session continues them. The seed and the master-only notes are for your writing: never copy them into public text.

Output: the context pack, read.

**Step 3 — Plan the scenes.** Before any file, write in your reasoning one line per scene: its id (`<session-slug>-<nn>-<scene-slug>`), what happens, where, who is in it, which items matter, and which scenes it depends on. Decide all dependencies now, in this one pass:
- the first scenes have `depends_on: []`;
- a choice or a fork makes several scenes depend on the same earlier scene (these are the branches);
- a scene that several branches lead to depends on all of them (a rejoin);
- the order of the list is not a dependency: only `depends_on` is;
- no cycle, and no scene depends on itself.

Decide also the main file: its `id`, its `depends_on` (the ids of the sessions that must be played before, from Step 1), and its scenes in order.

Output: the scene plan.

**Step 4 — Characters, places and items.** For each name the scenes use:
1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" query . find "<name>"`. An existing subject is reused as it is: its identity does not change. You may link to it, never redefine it. If `find` gives several matches for one name, ask ONE question.
2. A missing subject is created in the same batch:
   - a full sheet when a scene needs details of it (how it looks, how it speaks, what it wants, what it knows);
   - a sketch otherwise: `sketch: true`, a title, one sentence, its kind, its provenance, its relations and its location.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" query . sketches`. A sketch the session uses is expanded into a full sheet in the same batch, with the same `id`.
4. Use the field lists and the templates of the content format, as authoring.md gives them. Write the fields in these forms:
   - `location: [place-id]` and `characters: [id1, id2]` and `items: [id1]`: flow lists;
   - `relations`: a block list, one entry for each relation, with `to` (an id) and `type`, which is one of `member-of`, `kin-of`, `ally-of`, `rival-of`, `depends-on`:
     ```yaml
     relations:
       - to: gilda-del-sale
         type: depends-on
     ```
   - `appearances`: a block list, only where the scene places a subject in a place:
     ```yaml
     appearances:
       - subject: ilde-varno
         location: [porto-di-selce]
     ```
5. Invention is free. Whatever the sources do not give, you invent: a name, a place, a relation, a past. Each invention is declared to the master in Step 6. A secret (what someone hides, the true cause of an event) goes only into the reserved master block of its document, never into scene text.
6. Stats, difficulties, prices and effects come from your knowledge of the game system, or from a web search that never receives master-only text. The engine checks their shape. Without a system adapter, values stay in words.

Output: the list of new and expanded subjects, and the list of invented facts.

**Step 5 — Write the batch.** Write every file of the session as drafts, then run the write cycle once for the whole batch:
- the session's main file, `<PLOT FOLDER>/<Session folder>/<Session folder>.md`, as a STUB: metadata block with only `id`, `depends_on` (the session prerequisites from Step 3) and `provenance: generated`, and no body. Do not draft its body or its scene list: the engine derives them at the commit. The stub is still needed, because the plot map ignores every scene file whose session has no main file (it reports `event-session-mismatch`), and the engine rebuilds the stub's metadata block and body from the scene files.
- one file per scene: `<PLOT FOLDER>/<Session folder>/Eventi/<Scene>.md`. Metadata block: `id`, `session` (the id of the session), `depends_on` (from Step 3, a list of scene ids; `[]` for the first scenes), `location` when the scene has one, `characters` and `items` when they matter, `appearances` (the block form of Step 4) only where the scene explicitly places a subject in a place, and `provenance: generated`. Body: the scene in the campaign language, with links to the subjects it names.
- the new and expanded subject files, with `provenance: generated`.
- the world seed (the file named by the `campaign.seed` key of `campaign.yaml`), only when the session adds something that holds for the whole world, such as a faction or a naming convention.

Every link points to a file that exists in the batch or in the campaign. Give the commit message in the campaign language, one sentence, for example «Preparata la sessione <name>». If something is still to do after this batch (for example a sketch you did not expand), say it in the note of the commit.

Output: the batch committed, with its result.

**Step 6 — Tell the master.** After the commit succeeds, write a few sentences in the campaign language:
- what the session contains: one short line per scene, in plain words;
- what you invented, each item named (a character, a place, a relation, a fact), and labelled «Inventato dall'assistente» (English «Invented by the assistant»), so the master can say what to change;
- one sentence on what happens next, for example «Dimmi cosa cambiare, o quando giocarla».

If the write cycle asks the master a question, ask that question instead, and stop.

## Examples

Correct: the master writes «prepara la sessione del faro». The target is «Il faro spento 2», its prerequisite «Il faro spento 1» is played, and the scenes are three: an arrival at the port, a conversation with the keeper, a choice to climb or to wait. The two last scenes depend on the first. The message names the three scenes in one line each, and says that the keeper's family name and the port's tavern are invented.

Wrong: writing the scenes with the dependencies of the file list (each scene after the previous one). The order of the list is not a dependency; only `depends_on` is.

Wrong: putting the keeper's secret in the scene text. It goes into the master block of the keeper's sheet, and the scene only shows what the characters do.
