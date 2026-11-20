---
name: atlas
description: Library skill. Creates the atlas of the campaign (a map of the world or of a part of it, drawn in layers from the documents in the look of a hand-painted fantasy map, and also a map of a settlement or a district: a city, a village, a quarter, when the world is that small or the master asks) only when the master asks, and keeps it up to date: places new places, adds new land outside the existing one, and never changes land already approved unless the master asks for it explicitly. The extent can mix scales: a region or world map can hold a detailed city, and a city plan can have forests, hills or mountains around it. Invoked by the entry skill when the master asks for the atlas or a map of the world or of a region, by the master screen's atlas button, and by build-world or write-document with the argument "update" after a batch that added places. It can start from a picture of the map, found in the sources or given by the master, and trace it into the layers.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" *), Bash(node */skills/library/atlas/scripts/atlas.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/bake-setup.mjs" *), Bash(node */skills/library/atlas/scripts/bake-setup.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/bake-job.mjs" *), Bash(node */skills/library/images/scripts/bake-job.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/image-select.mjs" *), Bash(node */skills/library/images/scripts/image-select.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" *), Bash(node */scripts/versions.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" *), Bash(node */scripts/engine.mjs *), Read, Write, Glob, Grep, WebSearch, WebFetch
---

# Atlas

You draw and keep the atlas. Its data lives in the atlas folder of the campaign: it is canon, saved in the history like any document. The drawing is derived and goes to `.campaign/cache/atlas/`, and it can always be rebuilt. The shape of the land comes from scripts and a fixed seed, never from your own hand-drawn imagination. **You decide the constraints; the scripts draw.**

**Commands.** Run the command exactly as written, as one single command: nothing before it, nothing after it, no `;`, `&&`, `|`, `2>&1`, `echo`, `cat`, `mkdir` or `cd`. Run it from the campaign root, with `.` as the campaign folder. The script ends its output with `exit: <code>`. You write candidate JSON files only under `.campaign/state/atlas/`, with the Write tool. You never write in the atlas folder directly: only the script writes there.

**Rules.**
1. **Only on request.** Never start an atlas on your own, and never suggest one at the end of other work. The one exception is the offer of Step 10, made once.
2. **Never take anything for granted.** What the documents say is used. What they do not say, you ask, one question at a time. This covers the extent of the atlas, where a region lies relative to another when no document says it, and a name the map would show that no document gives. Never invent a place name or a geographic name. A sea, a mountain range or a continent with no name in the documents gets no label, unless the master gives one.
3. **Positions you choose** within what the documents allow are fine, with `provenance: "agent-choice"`. Positions stated by documents use `provenance: "document"` with `sources` (file and section). Positions or names given by the master in this conversation use `provenance: "master"`.
4. **The land never changes.** After the master approved the land, it is locked. You may add new land only outside it, by appending constraints. You use `--unlock` only when the master, in this conversation, explicitly asked to change the shape of land already drawn; before writing, tell the master what changes and get a clear yes. When a script refuses a write because a layer is locked, do not look for a way around it.
5. **Outside sources.** When the world seed or the sheets say the campaign is set in a published setting (a known published world), search its geography with WebSearch and WebFetch, and use it as a source. The model accepts only campaign files as sources, so record outside facts in the constraint `note`, with the URL. Never put in a search any text from the reserved block (`<!-- master -->` onward), from the world seed, or from a master-only category. Search only public names.
6. **Secrets.** A place or feature that the players must not know gets `visibility: "master"`. Its name and position then never reach the players' version.
7. **Words.** Never say to the master: script, JSON, layer ids, constraint, seed, canvas, hash, lock, exit codes, file paths. Say «terre e mari», «montagne», «fiumi», «confini», «carta», «approvare la forma delle terre». For a city map, also «mura», «strade», «isolati», «quartieri», «edifici». For the painted version, say «mappa dipinta in un'unica immagine» and «rifinitura»; never «bake», «rasterizzare», «PNG» or «provider».
8. **Previews.** You look at every preview yourself with the Read tool before showing it. The master sees it through the preview and render commands with `--open` (rule 10 says where). Ask the master's approval twice in a creation: once for the land and sea, once for the whole atlas. When the conversation runs inside the master screen, a message that waits for the master's approval of the land and sea or of the whole atlas MUST end with the question itself (for example "Ti va bene, o vuoi cambiare qualcosa?") and never with a pointer to a section or a closing remark, because the screen only offers an answer box after a question.
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
11. **Base picture.** The master may give a picture of the land or of the town (a map, a plan, a drawing), or the sources may hold one, to be used as the base of the atlas. The picture is traced into data and never painted into the map: the scripts still draw, the layers are still approved and locked as always. Words for the master: «la carta che mi hai dato», «l'immagine»; never «reference», «overlay», «grid», «outline» or the commands. The picture is master-only material: it never goes to a search, to an image service or to the players' version. The painted version (Step 10) still receives only the drawing made from the layers, never the base picture.

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
- If the atlas does not exist and the master gave a picture, or the sources hold a map, Step 2b applies right after Step 2.
- If it does not exist, go to Step 2.

**Step 2: read the world.**
- Run the places command to get every place, its parent and whether it is already placed:
  ```
  node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" places .
  ```
- Read the world seed and every place sheet with the Read tool. With more than 40 places, read the top-level ones and their direct children first, and the rest only when you place them.
- Note every geographic statement you find, with its file and section: directions («a nord di», «oltre il mare»), distances («tre giorni di cammino»), coasts, rivers, mountains, islands, climates, borders and realms.
- If a published setting is named, do the outside search (Rule 5).

**Step 2b: base picture.** Do this only when the master gave a picture for the atlas (in the conversation, or by naming a file), or when you find one in the sources.
1. **Find it.**
   - A file the master named, or a path you can see: use it.
   - A picture pasted or dragged into the conversation has no path: invoke the import skill (the master's material, kept as an original in the sources), then use the path of the original it keeps. If that is not possible, ask in one sentence for the file to be put in the campaign folder.
   - Without a picture from the master, use Glob on the sources folder of the campaign (the folder of type `sources` in `campaign.yaml`) for `*.png`, `*.jpg`, `*.jpeg` and `*.webp`. Read the ones whose name suggests a map. If one is a map of the world or town to draw, ask ONE question: «Ho trovato <name>: la uso come base per la carta?». Never use a picture you found yourself without a yes.
2. **Read it** with the Read tool. Note, for yourself: whether it is a land (coasts, islands, rivers, mountains, forests, borders) or a town (shore, walls, streets, districts, parks, buildings); what it shows and what it hides. A name that is printed on the picture and that you can read counts as a name given by a document when the picture is in the sources, and as a name given by the master when the master gave the picture (Rule 3 for the provenance); a name you cannot read with certainty is not used (Rule 2).
3. **Extent.** The picture usually answers the extent of Step 3: propose it in one sentence, and ask only what the picture and the documents do not say. If the picture is a whole island covered by one city, the extent is `settlement` with an island (see Step 3).
4. **Create with the picture.** In Step 4, run the init command with the picture. The canvas then takes the proportions of the picture:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" init . .campaign/state/atlas/scope.json --reference <path of the picture>
   ```
   Then prepare the drawing tools, once per conversation, and make the coordinate view of the picture (for you only):
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/bake-setup.mjs" --data-dir "${CLAUDE_PLUGIN_DATA}"
   ```
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" reference-grid . --data-dir "${CLAUDE_PLUGIN_DATA}"
   ```
   If the first prints `unavailable`, say in one sentence that the picture cannot be used now, and offer to make the atlas from the documents alone. Read `.campaign/cache/atlas/reference/grid.png` with the Read tool: it is the picture on the canvas with a pink grid; the numbers at the top and at the left are the x and y of the canvas, and a thicker line every four. Take every coordinate from it. The grid and the overlay below are for you only: never use `--open` on them and never show them to the master.
5. **Trace.** In Steps 5 and 6 and in the Urban scale, the constraints come from what the picture shows, with `provenance: "document"` and `sources: [{ "file": "<the path in the field reference of the status command>" }]` (the copy kept in the atlas folder); use `provenance: "master"` for what the master told you in words. Never `agent-choice` for a shape that the picture shows. Where the picture is silent, the usual rules apply. Where the picture and a document disagree: the document wins for names and facts, the picture for shapes; if it is a real contradiction, ask the master one question.
   - **Land and sea:** one `landmass` per island or continent with `outline`: the points of its coast taken from the grid, in order, 12 to 60 points, following every bay and peninsula that the picture shows. With an `outline` the `center` and `radius` are not needed. Lakes, seas and open edges as usual. Leave `roughness` out or at most 0.2, so the script keeps the traced coast.
   - **Rivers, mountains, forests, borders, places, routes:** the constraints of Step 6 with the points read from the grid.
   - **Island city:** the ground `island` with `at` (a point well inside the island) and `outline` (20 to 60 points along the shore, harbours and bays included; the coast must not cross itself). `radius` is not needed. Then the walls ring along the walls of the picture, the main streets along its main streets (a `grid` only where the picture shows a regular quarter), one `district` per quarter that the picture shows (seeds read from the grid), the parks, and one building feature per named building at its place in the picture.
   - **Not a copy.** The script draws its own streets between the ones you give, and its own blocks and houses. Give the structure (shore, walls, main streets, districts, named buildings), not every lane.
6. **Check against the picture.** After you write and generate a layer, make the overlay (the drawing at half opacity over the picture) and Read it:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" reference-overlay . --data-dir "${CLAUDE_PLUGIN_DATA}"
   ```
   Open `.campaign/cache/atlas/reference/overlay.png` with the Read tool. A coast, wall, street, district or building that is off by more than about one grid square, or a bay that is filled in, or a missing island, is wrong: fix the constraints, write and generate again. At most 3 rounds per layer; then go on with the best result and tell the master in one sentence what still differs. The approvals of the master (land and sea, then the whole map) stay as in Steps 5 and 6 and the Urban scale, on the normal preview.
7. **A picture given later** for an atlas that already exists: run `atlas.mjs reference-set . <path>`, then use it only for new land or for places not drawn yet; approved layers change only by Rule 4.

**Step 3: extent and questions.**
- Propose the extent in one sentence: the whole world, one continent or one region, and which top places it contains. Base it on what exists. If the documents describe only one region, propose that region, and say the atlas can grow later.
- Then ask, one at a time, only what you cannot derive: the extent, if more than one is plausible; the relative position of regions with no stated direction; names the map needs and nothing gives, only when the master wants them shown.
- Ask in plain words, with concrete options when possible: «Il Lago Grigio è a nord o a sud di Borgo Cenere? I documenti non lo dicono.»
- The extent can mix scales: a region or world map can hold a detailed city, and a city plan can have forests, hills or mountains around it. Ask the master only when the documents do not say which cities deserve a detailed plan inside a bigger map, in one question: «Vuoi la pianta dettagliata di <city> dentro la carta?»
- When the documents describe one city or village (or the master asks for a city map), the extent is `settlement` (whole town with surroundings) or `district` (a quarter, a harbour, a castle with its village), and the urban steps of the "Urban scale" section apply instead of Steps 5 and 6. If there is a world and a described capital, propose the wider map and offer the second in one sentence.
- When the documents say that the whole world, or the area to map, is a city that stands on an island (a city-island), the extent is `settlement` with an island, not a geographic map with one dot: the city map covers the island, with its districts and named buildings on it. Say it to the master in one sentence, for example «Il mondo della campagna è una città su un'isola: ti propongo la carta della città, con l'isola, i quartieri e gli edifici nominati.»

**Step 4: create.**
- Write `.campaign/state/atlas/scope.json` with the Write tool: `{ "scope": { "kind": "world"|"continent"|"region", "places": [<top place ids>], "note": "<one line>" } }`. Leave out `seed`, `canvas` and `style`: the script gives them. For a settlement or a district, follow "Urban scale" (a) instead.
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
- In the master screen, the bigger round synopsis markers (one symbol per kind) open the spoiler-free card of the place.
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

**Urban scale: settlement or district.** Used when Step 3 chose `settlement` or `district`. It replaces Steps 5 and 6; the other steps still apply. The canvas is 2400 wide and 1800 high, set by `init`; x grows to the east and y to the south. The urban layers are drawn in this order: `ground`, `green`, `walls`, `streets`, `blocks`, `buildings`, `districts`, `labels`. For each layer, write its candidate file with the Write tool, then write the layer, then generate it. Preview and render as in Step 5 and Step 6, and look at every preview yourself.

(a) **Scope.** Write `.campaign/state/atlas/scope.json` as `{ "scope": { "kind": "settlement"|"district", "places": [<top place ids>], "note": "<one line>", "unit": "m"|"paces" } }`. `unit` is optional: take it from the documents when they give a hint. If they give none, ask the master in one question (metres or paces); with no clear answer, use metres. Leave out `seed`, `canvas` and `style`. Then run the init command of Step 4 and save a version as in Step 4.

(b) **Ground: water.** Write `.campaign/state/atlas/ground.json` as `{ "layer": "ground", "constraints": [...], "features": [] }`. The land is the whole canvas, so the constraints are water only:
- `river`: `id`, `source` [x,y], `mouth` [x,y], optional `via` [[x,y]...], `width` > 0, optional `meander` 0..1.
- `coast`: `id`, `side` north|south|east|west, `depth` > 0 (how far the water enters from that canvas edge), optional `roughness` 0..1.
- `pond`: `id`, `at` [x,y], `radius` > 0, optional `roughness`.
- `canal`: `id`, `path` [[x,y]...] with at least 2 points, `width` > 0.
- `island`: the city is on an island. The whole canvas is sea and the land is ONE island (a noisy ellipse around its centre): `{ "kind": "island", "id": "<kebab>", "at": [x, y], "radius": [rx, ry], "roughness": 0.4, "provenance", "sources" }`. Use it only for an island city, at most one per map. `radius` at most [0.42 * width, 0.42 * height] of the canvas, so the island fits inside it with a margin. The script then writes the sea as four water polygons and one `land` feature (the island outline). Rivers, canals and ponds may be added on the island, as above. With a picture, give `outline` (a polygon of 20 to 60 points along the shore, taken from the picture, with `at` inside it) instead of relying on `radius` and `roughness`: see Step 2b.

Every constraint has `id` (kebab-case, unique in the layer), `provenance`, `sources`, and optional `note` and `visibility`. Add only the water that the documents mention or the master asks for; a position you choose is `agent-choice`. Then:
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" write-layer . ground .campaign/state/atlas/ground.json
```
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" generate . ground
```
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" preview .
```
Look at `.campaign/cache/atlas/preview.png` with the Read tool, check the water against the documents, and fix it at most 3 rounds. The island of an island city is approved with the rest of the water, in the same approval.

Walls of an island city follow its coast, and this is done in (c): read the generated `ground.json` in the atlas folder of the campaign (the folder the `status` command reports, for example `Atlante/ground.json`) with the Read tool, take the `features` of type `land` and their field `polygon` (the island outline), and write a wall ring of 10 to 16 points taken from that outline, moved inward by about the wall thickness times 2. Streets, blocks and districts then fill the inside; the outside stays fields and shore. Then show it (outside the master screen only, rule 10):
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" preview . --open
```
Ask the master for approval of the water: «Ecco l'acqua della città: fiume, costa e canali. Ti va bene, o vuoi cambiare qualcosa?» On a yes, lock the layer and save a version:
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" lock . ground
```
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" save . --message "Atlante: acqua della città approvata."
```
On a change request, adjust, write, generate and ask again.

(c) **Walls and streets.** Write `.campaign/state/atlas/walls.json` as `{ "layer": "walls", "constraints": [...], "features": [] }`, with one constraint `wall`:
- `id`, and exactly one of `ring` [[x,y]...] with at least 3 points (a closed perimeter, only when the documents say the town is walled all around) or `path` [[x,y]...] with at least 2 points (an open wall);
- `thickness` > 0;
- `towers`: corners|spaced|none (default corners); optional `towerSpacing` > 0 (default 120, used by spaced);
- optional `gates`: a list of `{ "at": [x,y], "width": optional }`.

Write the walls layer and generate it, then write `.campaign/state/atlas/streets.json` as `{ "layer": "streets", "constraints": [...], "features": [] }`, with these constraints:
- `street`: `id`, `rank` main|secondary|lane, `path` [[x,y]...] with at least 2 points, optional `width` > 0 (default by rank: main 14, secondary 9, lane 5);
- `square`: `id`, `at` [x,y], `size` [w,h] with both > 0, optional `angle` in radians;
- `grid`: `id`, `area` [[x,y]...] polygon with at least 3 points, `spacing` > 0, optional `angle` in radians (default 0), optional `jitter` 0..1 (default 0.15), optional `rank` secondary|lane (default lane).

Main streets follow the documents (the roads to the gates, the way to the market). Use a `grid` only where the documents describe a regular quarter. The script adds a bridge by itself wherever a main or secondary street crosses water. Then:
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" write-layer . walls .campaign/state/atlas/walls.json
```
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" generate . walls
```
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" write-layer . streets .campaign/state/atlas/streets.json
```
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" generate . streets
```
Run the preview command, look at it yourself and fix what is wrong (at most 3 rounds), show it with `preview . --open` (outside the master screen only), and ask: «Ecco le mura e le strade. Ti vanno bene, o vuoi cambiare qualcosa?» On a yes, lock both layers and save a version:
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" lock . walls
```
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" lock . streets
```
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" save . --message "Atlante: mura e strade approvate."
```

(d) **Green and districts.** Green is not locked yet. Write `.campaign/state/atlas/green.json` as `{ "layer": "green", "constraints": [...], "features": [] }`, with one constraint `park` per green area: `id`, `type` park|garden|field|wood|orchard, `at` [x,y], `radius` > 0, optional `roughness`. Use only the green that the documents or the master give, plus `agent-choice` fields where the documents are silent. Then:
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" write-layer . green .campaign/state/atlas/green.json
```
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" generate . green
```
Districts are not locked yet either. Write `.campaign/state/atlas/districts.json` as `{ "layer": "districts", "constraints": [...], "features": [] }`, with one constraint `district` per quarter: `id`, `color` #rrggbb, `seeds` [[x,y]...] with at least 1 point, optional `cuts` and `reach`, `place` (the id of its place sheet) or `name`, optional `character` poor|common|rich. Take `character` from the district's sheet when it says poor, common or rich; if the sheet says nothing, leave it out. A `name` comes only from a document or from the master: a district with no name in the documents gets none, and the map shows none (rule 2). Then:
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" write-layer . districts .campaign/state/atlas/districts.json
```
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" generate . districts
```

(e) **Blocks.** Write `.campaign/state/atlas/blocks.json` as `{ "layer": "blocks", "constraints": [ { "kind": "fill", "id": "<id>", "character": "common" } ], "features": [] }`. A `fill` takes an optional `area` [[x,y]...] with at least 3 points (default: the whole canvas), `character` poor|common|rich (default common), and an optional `district` (the id of a district constraint: its character applies inside). One fill for the whole town is usually enough; add a second fill with `area` only where the documents describe the character of a quarter, and set `district` when that quarter is a district. Then:
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" write-layer . blocks .campaign/state/atlas/blocks.json
```
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" generate . blocks
```
The blocks are the free regions left by the streets and walls: do not draw them. Blocks are never locked.

(f) **Buildings.** Each named building of the documents gets one feature, written directly like places, with no generation step. Write `.campaign/state/atlas/buildings.json` as `{ "layer": "buildings", "constraints": [], "features": [ { "id": <place id>, "place": <place id>, "at": [x,y], "kind": <kind>, "size": optional [w,h], "angle": optional, "provenance", "visibility", "sources" } ] }`. `id` equals `place`, and the place must have a sheet in the world. `kind` is one of tavern|inn|temple|shrine|palace|castle|keep|tower|mill|warehouse|market|guildhall|smithy|house|shop|gatehouse|landmark. `at` must be on a block or a square, never in a street or in water: the script refuses those. Provenance and sources follow Rule 3, and a secret building gets `visibility: "master"` as in Rule 6. Then:
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" write-layer . buildings .campaign/state/atlas/buildings.json
```
Buildings are never locked by you. A building added later never changes the locked layers.

(g) **Labels.** As in the other scales: write the labels layer with the write command for `labels`, each label's `target` as `<layer>/<id>` on any existing layer. Labels are never locked.

(h) **Approval of the whole map.** Run the preview command, look at it yourself, show the render (outside the master screen only, rule 10), and ask the single approval of the whole map: «Ecco la città intera. Vuoi cambiare qualcosa prima che lo fissi?»
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" preview .
```
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" render . --open
```
On a yes, lock green and districts, render again, and save a version:
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" lock . green
```
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" lock . districts
```
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" render .
```
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" save . --message "Atlante: città approvata."
```
A change to approved ground, walls or streets follows Step 8 and rule 4.

(i) **Update mode for an urban atlas.** In Step 9, replace point 2 with this, and keep the other points. Pending places are placed as buildings, or as a district when the sheet describes a quarter; ground, walls and streets never change. A place whose building would stand on a street or in water is refused by the script, and a place whose layer is locked is not forced (rule 4): both go to the report. Write the new features into `buildings.json` with the existing ones, then write the layer; for a district, append a `district` constraint to `districts.json` and generate it. Then render, save the version and write the report with `new-land: no`.

(j) **Mixing scales.** The atlas is one canvas and one coordinate system. The scope `kind` only sets the default canvas size at `init`: it does not restrict the layers, so geographic and urban layers can share the same atlas. Each family locks its own layers: the geographic family (`terrain`, `relief`, `water`, `biomes`, `political`, `places`, `routes`) and the urban family (`ground`, `green`, `walls`, `streets`, `blocks`, `buildings`, `districts`). A change to the geographic layers never moves the city, and a change to the city never moves the land (Rule 4 applies unchanged).
- **A city inside a geographic map.** Write and approve the geographic layers first (Steps 5 and 6). Then write the urban layers of the city inside its area of the canvas, with sub-steps (b) to (h), but in (b) use only the water kinds `river`, `canal` and `pond`, and no `coast` or `island`: the land is the terrain, and the water is drawn on top of it. Draw the city larger than its true scale: in a region map a city needs a footprint of at least about 300 units across to read, with streets 5 to 14 units wide and lots 6 to 16. This is a drawing choice: never say it to the master.
- **A city plan with scenery.** Write the urban layers first, then add `relief` and `biomes` constraints outside the walls, in the same format as Step 6, and generate them. The stamps avoid blocks, parks, squares and the inside of closed walls; without a `terrain` layer they take as land the island of `ground`, or the whole canvas. In (h), lock relief and biomes too, with green and districts.
- **Never** use the geographic `places` icon for a city that has a detailed plan inside: its buildings and districts are the places. A `places` feature inside a block is not drawn, because the buildings replace it.

**Step 10: painted version (the bake).** It runs only after the master approved the whole atlas: the final approval of a creation (Step 6, or sub-step (h) of the urban scale), or any time later when the master asks to «rifinire» or «dipingere la mappa». It is a look of the approved drawing: it never changes the layers.

The service receives only the drawing made from the layers; the base picture of Step 2b is never sent.

**Offer.** After the master's final yes of a creation, offer it ONCE, in one sentence, and only then: «Vuoi che la faccia rifinire come un'unica immagine dipinta? Resta tutto uguale, cambia solo l'aspetto, e uso un servizio esterno che riceve solo la carta disegnata, senza testi né segreti.» This is the only exception to Rule 1. If the master declines, never repeat it.

(a) **Consent and service.** Run:
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/image-select.mjs" . --operation bake
```
Read the lines `provider`, `reason` and `needs-consent`.
- `provider: none` or `reason: requested-unavailable`: say in one sentence that no service for this is available, and stop. The drawn map stays.
- `needs-consent: yes`: say the consent sentence [consent] of the lexicon, with the plain service name that the images skill gives for that service (for codex: «Codex di OpenAI» in Italian, «OpenAI's Codex» in English) and «Atlante» as the title. Wait for the master's answer in the conversation. Without a yes, stop. On a yes, run `image-select.mjs . --operation bake --consent <id>` with the id of that service, then go on.
- Never name the service in any other message.

(b) **Setup**, once per conversation:
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/bake-setup.mjs" --data-dir "${CLAUDE_PLUGIN_DATA}"
```
If it prints `unavailable`, say in one sentence that the tool cannot be prepared now, and stop.

(c) **Input.** Run:
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" bake-input . --data-dir "${CLAUDE_PLUGIN_DATA}"
```
Read `.campaign/cache/atlas/bake/input.png` with the Read tool and check that it shows the map and is not blank; if it is blank, say so in one sentence and stop. The input is made for the PLAYERS audience on purpose: master-only places never reach the service. Say nothing about it unless the master asks.

(d) **Repaint.** Take the id of the current style from the styles command of Rule 9, then run:
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/bake-job.mjs" --atlas-input .campaign/cache/atlas/bake/input.png --style <current style id> --out .campaign/cache/atlas/bake/baked.png
```
Read the `result:` line. `result: ok`: go to (e). `error: unavailable`, `error: timeout` or `error: failed`: try nothing else, say it in one sentence, and stop.

(e) **Check.** Read `input.png` and `baked.png` with the Read tool and compare them. The result must keep the same layout (coasts, mountains, rivers, roads, walls, streets and buildings at the same places), contain no text or frames, and look uniform. If it fails the check, repeat (d) as a corrective retry, at most 2 retries in total. If it still fails, say it in one sentence and stop. Never keep a result that moved things.

(f) **Save and ask.** Run:
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" bake-set . .campaign/cache/atlas/bake/baked.png
```
Then render the atlas (`--open` outside the master screen only, rule 10):
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" render .
```
Ask: «Ecco la mappa dipinta. Ti piace, o torno a quella disegnata?»
- On a no: run `bake-clear`, render again, and say in one sentence that the drawn map is back:
  ```
  node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" bake-clear .
  ```
- On a yes: save a version:
  ```
  node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" save . --message "Atlante: mappa dipinta."
  ```
- Labels, texts and the markers stay on top of the picture and are never part of it. Say it in one sentence only if the master asks why.

(g) **Later changes.** Run the status command of Step 1. `bake: stale` means the layers changed after the bake; the site then shows the drawn map by itself. After any change to the layers, in the same message to the master, offer the repaint again in one sentence, without insisting. `bake: current` means the painted version is up to date; `bake: none` means there is none.
