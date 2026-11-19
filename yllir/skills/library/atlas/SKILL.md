---
name: atlas
description: Library skill. Creates the atlas of the campaign (a map of the world or of a part of it, drawn in layers from the documents in the look of a hand-painted fantasy map) only when the master asks, and keeps it up to date: places new places, adds new land outside the existing one, and never changes land already approved unless the master asks for it explicitly. Invoked by the entry skill when the master asks for the atlas or a map of the world or of a region, by the master screen's atlas button, and by build-world or write-document with the argument "update" after a batch that added places.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" *), Bash(node */skills/library/atlas/scripts/atlas.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" *), Bash(node */scripts/versions.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" *), Bash(node */scripts/engine.mjs *), Read, Write, Glob, Grep, WebSearch, WebFetch
---

# Atlas

You draw and keep the atlas. Its data lives in the atlas folder of the campaign: it is canon, saved in the history like any document. The drawing is derived and goes to `.campaign/cache/atlas/`, and it can always be rebuilt. The shape of the land comes from scripts and a fixed seed, never from your own hand-drawn imagination. **You decide the constraints; the scripts draw.**

**Commands.** Run the command exactly as written, as one single command: nothing before it, nothing after it, no `;`, `&&`, `|`, `2>&1`, `echo`, `cat`, `mkdir` or `cd`. Run it from the campaign root, with `.` as the campaign folder. The script ends its output with `exit: <code>`. You write candidate JSON files only under `.campaign/state/atlas/`, with the Write tool. You never write in the atlas folder directly: only the script writes there.

**Rules.**
1. **Only on request.** Never start an atlas on your own, and never suggest one at the end of other work.
2. **Never take anything for granted.** What the documents say is used. What they do not say, you ask, one question at a time. This covers the extent of the atlas, where a region lies relative to another when no document says it, and a name the map would show that no document gives. Never invent a place name or a geographic name. A sea, a mountain range or a continent with no name in the documents gets no label, unless the master gives one.
3. **Positions you choose** within what the documents allow are fine, with `provenance: "agent-choice"`. Positions stated by documents use `provenance: "document"` with `sources` (file and section). Positions or names given by the master in this conversation use `provenance: "master"`.
4. **The land never changes.** After the master approved the land, it is locked. You may add new land only outside it, by appending constraints. You use `--unlock` only when the master, in this conversation, explicitly asked to change the shape of land already drawn; before writing, tell the master what changes and get a clear yes. When a script refuses a write because a layer is locked, do not look for a way around it.
5. **Outside sources.** When the world seed or the sheets say the campaign is set in a published setting (a known published world), search its geography with WebSearch and WebFetch, and use it as a source. The model accepts only campaign files as sources, so record outside facts in the constraint `note`, with the URL. Never put in a search any text from the reserved block (`<!-- master -->` onward), from the world seed, or from a master-only category. Search only public names.
6. **Secrets.** A place or feature that the players must not know gets `visibility: "master"`. Its name and position then never reach the players' version.
7. **Words.** Never say to the master: script, JSON, layer ids, constraint, seed, canvas, hash, lock, exit codes, file paths. Say «terre e mari», «montagne», «fiumi», «confini», «carta», «approvare la forma delle terre».
8. **Previews.** You look at every preview yourself with the Read tool before showing it. The master sees it through the preview and render commands with `--open` (rule 10 says where). Ask the master's approval twice in a creation: once for the land and sea, once for the whole atlas.
9. **Style.** The look of the atlas has a style. The game system picks it (`auto`), or the master picks one.
   - When the master asks for a different look («fai l'atlante in stile pergamena», «più cupo»), list the installed styles, pick the one whose name matches, set it, render, and save a version:
     ```
     node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" styles .
     ```
     ```
     node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" set-style . <style-id>
     ```
     ```
     node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" render .
     ```
     ```
     node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" save . --message "Atlante: stile cambiato."
     ```
   - If no installed style matches, say in one sentence which styles exist, using their names in the campaign language, and ask which one.
   - `auto` goes back to the style chosen by the game system.
   - Changing the style never changes the land.
10. **Inside the master screen.** When the conversation started from the master screen, the master already sees the previews and the atlas in the master screen. Never use `--open` there. The first message says so («This conversation runs inside the master screen»). Outside the master screen, `--open` is the way to show the master the drawing.

**Step 0: mode.** The argument decides the mode: `update` means the update mode (Step 9); anything else, or nothing, means the create-or-change mode.

**Step 1: state.** Run:
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" status .
```
and read `exists`, `layers` and `pending`. Then follow the first case that matches:
- If the master asks for a different look, follow Rule 9.
- If the atlas exists and the master asked for a change («sposta il porto più a est», «aggiungi le isole del sud», «rifai la costa nord»), go to Step 8.
- If it exists and the master just asked to see it, run the render command below with `--open` (outside the master screen only, rule 10), and stop, with one sentence:
  ```
  node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" render . --open
  ```
- If it does not exist, go to Step 2.

**Step 2: read the world.**
- Run the places command to get every place, its parent and whether it is already placed:
  ```
  node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" places .
  ```
- Read the world seed and every place sheet with the Read tool. With more than 40 places, read the top-level ones and their direct children first, and the rest only when you place them.
- Note every geographic statement you find, with its file and section: directions («a nord di», «oltre il mare»), distances («tre giorni di cammino»), coasts, rivers, mountains, islands, climates, borders and realms.
- If a published setting is named, do the outside search (Rule 5).

**Step 3: extent and questions.**
- Propose the extent in one sentence: the whole world, one continent or one region, and which top places it contains. Base it on what exists. If the documents describe only one region, propose that region, and say the atlas can grow later.
- Then ask, one at a time, only what you cannot derive: the extent, if more than one is plausible; the relative position of regions with no stated direction; names the map needs and nothing gives, only when the master wants them shown.
- Ask in plain words, with concrete options when possible: «Il Lago Grigio è a nord o a sud di Borgo Cenere? I documenti non lo dicono.»

**Step 4: create.**
- Write `.campaign/state/atlas/scope.json` with the Write tool: `{ "scope": { "kind": "world"|"continent"|"region", "places": [<top place ids>], "note": "<one line>" } }`. Leave out `seed`, `canvas` and `style`: the script gives them.
- Run the init command. It also sets up the campaign for the atlas (its folder and the module) when that is missing:
  ```
  node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" init . .campaign/state/atlas/scope.json
  ```
- Then save a version, in the campaign language:
  ```
  node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" save . --message "Atlante: estensione decisa."
  ```

**Step 5: land and sea.**
1. Write `.campaign/state/atlas/terrain.json` with the Write tool, as `{ "layer": "terrain", "constraints": [...], "features": [] }`. The canvas is 4000 wide and 3000 high; x grows to the east and y to the south (north is up). Constraint kinds:
   - `landmass`: one per continent or large island, with `id`, `center`, `radius: [rx, ry]` and `roughness`. Use 0.6 to 0.8 for a natural coast. Compose several overlapping landmasses to get non-oval shapes.
   - `region`: one per top place, with `place`, `at` and `radius`, so that the place is surely on land.
   - `sea`: for bays, gulfs and straits the documents mention.
   - `lake`: for named lakes.
   - `open-edge`: when the land continues beyond the map (region atlases).
   Every constraint carries `provenance`, `sources` and an optional `note`. Use the positions from Step 2 and the answers from Step 3.
2. Write the layer, then generate it:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" write-layer . terrain .campaign/state/atlas/terrain.json
   ```
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" generate . terrain
   ```
3. Run the preview command, and look at `.campaign/cache/atlas/preview.png` with the Read tool. Check it against the documents: is every stated coast, island, lake and direction right? If not, change the constraints, write and generate again. At most 3 rounds.
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" preview .
   ```
4. Show it to the master (outside the master screen only, rule 10):
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" preview . --open
   ```
   Ask the master: «Ecco la forma di terre e mari. Ti va bene, o vuoi cambiare qualcosa?»
5. On a yes, lock the layer and save a version:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" lock . terrain
   ```
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" save . --message "Atlante: terre e mari approvate."
   ```
   On a change request, adjust, write, generate and ask again.

**Step 6: the other layers.** In this order, for each layer that the documents give reasons for: write its candidate file, then write the layer, then generate it. A layer with nothing in the documents is skipped, except for the small unnamed features of the last point.
- **relief:** `range` with `id`, `type` (`mountains` or `hills`), `spine` (at least 2 points), `width` and `roughness`. Write `.campaign/state/atlas/relief.json`, then:
  ```
  node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" write-layer . relief .campaign/state/atlas/relief.json
  ```
  ```
  node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" generate . relief
  ```
- **water:** `river` with `id`, `source`, `mouth` (at a coast or a lake) and `via`. Write `.campaign/state/atlas/water.json`, then:
  ```
  node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" write-layer . water .campaign/state/atlas/water.json
  ```
  ```
  node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" generate . water
  ```
- **biomes:** `biome` with `id`, `type` (`forest`, `swamp`, `desert`, `ice` or `grassland`), `at`, `radius`, and an optional `variant` (`conifer` or `broadleaf`) for forests. You may add small unnamed forests and hills where the documents are silent and they only make the map read better. They carry `provenance: "agent-choice"` and never get a name. Write `.campaign/state/atlas/biomes.json`, then:
  ```
  node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" write-layer . biomes .campaign/state/atlas/biomes.json
  ```
  ```
  node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" generate . biomes
  ```
- **political:** `realm` with `id`, `color` (distinct, muted colours), `seeds`, an optional `cuts`, `reach`, and `place` or `name`. A name comes only from a document or from the master. Write `.campaign/state/atlas/political.json`, then:
  ```
  node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" write-layer . political .campaign/state/atlas/political.json
  ```
  ```
  node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" generate . political
  ```
- **places:** write the `places` layer directly with features; there is no generation step for it. Each feature is `{ "id": <place id>, "place": <place id>, "at": [x, y], "icon": capital|city|town|village|fort|ruin|landmark|port, "provenance", "visibility", "sources" }`. Place every in-scope place. The position must be inside its parent's region and agree with the documents. When the documents allow two very different spots, ask (Rule 2). Ports go on the coast. Write `.campaign/state/atlas/places.json`, then:
  ```
  node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" write-layer . places .campaign/state/atlas/places.json
  ```
- **routes:** `road`, `trail` or `sea-route` with `id`, `from`, `to` and `via`, only for routes the documents mention. Routes come after the places, since they need them. Write `.campaign/state/atlas/routes.json`, then:
  ```
  node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" write-layer . routes .campaign/state/atlas/routes.json
  ```
  ```
  node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" generate . routes
  ```

Then run the preview command, look at it yourself and fix what is wrong:
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" preview .
```
Then render the atlas, and show it to the master (outside the master screen only, rule 10):
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" render . --open
```
Ask: «Ecco l'atlante. Vuoi cambiare qualcosa prima che lo fissi?»
- On a yes, lock each of these layers that exists, render again, and save a version:
  ```
  node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" lock . relief
  ```
  ```
  node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" lock . water
  ```
  ```
  node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" lock . biomes
  ```
  ```
  node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" lock . political
  ```
  ```
  node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" render .
  ```
  ```
  node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" save . --message "Atlante creato."
  ```
- Places, routes and labels are not locked: they grow with the world.

**Step 7: tell the master.** In a few plain sentences:
- what the atlas shows;
- which positions you chose yourself, in one sentence («ho scelto io dove mettere…»), so the master knows they can change them;
- that the atlas will follow the world as it grows;
- where to see it: in the master screen, section Atlante; outside the master screen, the window that just opened.
- Mention the style in one sentence only if the master chose one.

Say nothing about the players' version unless asked. When asked, render the players' version (outside the master screen, with `--open`) and report:
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" render . --audience players --open
```

**Step 8: change an existing atlas.**
- Find which layer the request touches.
- Places, routes and labels: rewrite that layer's file and write it with the write command for that layer (Step 6). Routes and the other generated layers are generated again after the write.
- A locked layer:
  - an addition that touches nothing approved (a new island far away, a new river in a new land) is done by appending constraints, then writing and generating the layer, as in Step 5 or Step 6;
  - a change to approved land, coasts, mountains or borders needs Rule 4: describe the change, get the yes, then write the changed layer with the unlock flag, and generate it. The layer is unlocked by that write; lock it again after the master approves the new shape:
    ```
    node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" write-layer . <layer> .campaign/state/atlas/<layer>.json --unlock
    ```
    ```
    node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" generate . <layer>
    ```
- After the change: run the preview command and look at it yourself, render the atlas, save a version with one sentence, and tell the master in one sentence:
  ```
  node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" render .
  ```
  ```
  node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" save . --message "Atlante: <one sentence>."
  ```

**Step 9: update mode.** Another process invoked you with `update`, after it added places.
1. Run the status command. If the atlas does not exist, or `pending` is empty, write `.campaign/state/atlas/report.txt` with the single line `nothing` and stop.
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" status .
   ```
2. Otherwise, read the sheets of the pending places with the Read tool, and decide each one:
   - **Inside the existing land:** if its position follows from its document or from its parent, add it to the places layer (and add the routes that the sheet states), and write the layer with the write command for `places` (and `routes`), as in Step 6.
   - **Outside every existing land** (a new continent or island): append the constraints to terrain, write the terrain layer and generate it. Do not lock.
   - **Ambiguous:** a place whose position is ambiguous is not placed. List it in the report.
3. Then render the atlas and save a version with the titles of the places added:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" render .
   ```
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" save . --message "Atlante: aggiunti <titles>."
   ```
4. Write `.campaign/state/atlas/report.txt` with the Write tool, with exactly these three lines:
   - `placed: <titles of the places placed, comma-separated, or none>`
   - `new-land: yes` or `new-land: no`
   - `ask: <one question for the master about the ambiguous places, or none>`
5. Your last action is writing this file. Print nothing else.
