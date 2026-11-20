---
name: atlas
description: Library skill. Creates and keeps the atlas of the campaign, a map of the world or of a part of it, or a plan of a city or district, at any scale, as one painted base picture plus data (land and sea, labels, territories, places): it starts from a picture of the master, from the sources, or from one generation by the image service, changes the painted parts only through zoomed crops, and never changes approved land unless the master asks. Invoked by the entry skill when the master asks for the atlas or a map of the world or of a region, by the master screen's atlas button, and by build-world or write-document with the argument "update" after a batch that added places.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" *), Bash(node */skills/library/atlas/scripts/atlas.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/atlas-repaint-job.mjs" *), Bash(node */skills/library/images/scripts/atlas-repaint-job.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/image-select.mjs" *), Bash(node */skills/library/images/scripts/image-select.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" *), Bash(node */scripts/versions.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" *), Bash(node */scripts/engine.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/rasterizer-setup.mjs" *), Bash(node */skills/library/atlas/scripts/rasterizer-setup.mjs *), Read, Write, Glob, Grep, WebSearch, WebFetch
---

# Atlas

You keep the atlas. It is one painted base picture plus data. The picture has no text, no frame and no border: it is the land and the sea as they look. The data (the land mask, the labels, the territories and the places) is canon: it lives in the atlas folder and is saved in the history like any document. Everything drawn for viewing (the master site, the players' site, the previews, the crops) is derived and goes to `.campaign/cache/atlas/`; `render` rebuilds it at any time. Scripts do the mechanics: crops, compositions, checks, writes. You decide what to ask, what to repaint and what to accept.

**Commands.** Run each command exactly as written, in its own block, as ONE single command: nothing before it, nothing after it, no `;`, `&&`, `|`, `2>&1`, `echo`, `cat`, `mkdir` or `cd`. Run it from the campaign root, with `.` as the campaign folder. The output ends with `exit: <code>`: `0` is done, `1` is a refusal or a problem (read its `error:` and `message:` lines), `2` is a usage error. You write candidate files only under `.campaign/state/atlas/`, with the Write tool. You never write in the atlas folder yourself: only the scripts do.

## Rules

1. **Only on request.** Never start an atlas on your own, and never suggest one at the end of other work.
2. **Never take anything for granted.** What the documents say is used. What they do not say, you ask, one question at a time: the extent, the relative position of regions when no document gives it, a name the map would show that no document gives. Never invent a place name or a geographic name. A sea, a range or a continent with no name in the documents gets no label, unless the master gives one.
3. **Provenance.** A position you chose inside what the documents allow: `agent-choice`. A position stated by a campaign document: `document`, with `sources` (file and section). What the master said in this conversation, or a name printed on a picture the master gave: `master`. A shape that a picture in the sources shows: `document`, with the picture as source.
4. **The land never changes after approval.** Once the master approves the land, it is locked. New land is added only outside the approved land, with `accept --extend`. The shape of approved land changes only with `--unlock`, and only when the master, in this conversation, explicitly asked for it: tell the master in plain words what changes, get a clear yes, then unlock. A refusal from a script is never worked around (no editing of files in the atlas folder, no deleting of locks).
5. **Outside sources.** When the seed or the sheets name a published setting, search its geography with WebSearch and WebFetch, and use what you find as a source. Record an outside fact in the item's `note`, with its URL, never as a campaign source. Never put in a search any text from the reserved block (`<!-- master -->` and what follows it), from the seed's master-only parts, or from any master-only item. Search only public names.
6. **Secrets.** A place, label or territory that the players must not know gets `visibility: "master"`. Its name and position never reach the players' site. The reserved block and master-only items never go into a provider prompt, a search or the players' site.
7. **Words for the master.** Never say to the master: script, JSON, file, path, mask, crop, provider, base, hash, lock, exit code, grid, layer, PNG or the name of a command. Say «carta», «terre e mari», «ritocco di una zona», «approvare la forma delle terre», «mappa dipinta in un'unica immagine», «rifinitura», «l'immagine che mi hai dato». For a city plan you may say «mura», «strade», «quartieri», «edifici». Never say «rasterizzare» or «PNG».
8. **Previews.** You look at every picture yourself with the Read tool before you show it. Show the master a picture only with `preview` or `render`, and with `--open` only outside the master screen (rule 10). In a creation the master approves twice: the land and sea (Step 5), then the whole atlas (Step 7). When the conversation runs inside the master screen, a message that waits for an approval MUST end with the question itself (for example «Ti va bene, o vuoi cambiare qualcosa?»), never with a pointer or a closing remark, because the screen offers an answer box only after a question.
9. **Style.** The look has a style: `fantasy-color` (default), `antique-parchment` or `dark-fantasy`. The game system may pick one (`auto`), or the master picks one. Changing the style never changes the land or the data.
10. **Inside the master screen.** The first message says «This conversation runs inside the master screen». There, never use `--open`: the master already sees the atlas in the master screen, section Atlante. Outside the master screen, `--open` is how the master sees the picture.

## Outside image service: consent and repaint

Used in Step 4 (c) and Step 6. The atlas picture leaves the campaign only through this procedure.

1. Ask which service is available:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/image-select.mjs" . --operation repaint
   ```
   Read the lines `provider`, `reason` and `needs-consent`. `provider: none` or `reason: requested-unavailable`: say in one sentence that no image service is available for this now, and stop. The current picture stays.
2. `needs-consent: yes`: say the consent sentence [consent] of the lexicon, with «Atlante» as the title and the plain name that the images skill gives for that service (for codex: «Codex di OpenAI», in English «OpenAI's Codex»). If the base came from the master or from the sources, add in the same question that cut-outs of that picture go to the service. Wait for the master's answer. Without a yes, stop. On a yes, run `image-select.mjs . --consent <id>` with the id from the `provider` line, then go on.
3. Never name the service in any other message.
4. The prompt sent to the service is public text only: the geography from the public parts of the seed and sheets, the style, and the instruction that the picture has no text. Never a master-only name or item.

## Step 0: mode

The argument decides. `update` means the update mode, Step 8. Anything else, or nothing, means the normal flow from Step 1.

## Step 1: state

Run:
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" status .
```
Read `exists`, `folder`, `layers`, `problems` and `pending`. Take the first case that matches:
- The master asks for another look: Step 9.
- The atlas exists and the master only asks to see it: run `render . --open` (outside the master screen only, rule 10) and say one sentence. Inside the master screen, say in one sentence that it is in the section Atlante, and stop.
  ```
  node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" render . --open
  ```
- The atlas exists and has no base picture (`layers.terrain.present` is false): Step 4.
- The atlas exists and the master asks to change the painted picture, or to add land outside the approved one: Step 6.
- The atlas exists and the master asks for new places, labels or territories: Step 7.
- The atlas does not exist: Step 2.

## Step 2: read the world

1. List the places, with their parent and whether each is already placed:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" places .
   ```
2. Read the world seed and the place sheets with the Read tool. With more than 40 places, read the top-level ones and their direct children first; read the rest when you place them.
3. Note every geographic statement, with its file and section: directions («a nord di», «oltre il mare»), distances, coasts, rivers, mountains, islands, climates, borders and realms.
4. If a published setting is named, do the outside search of rule 5.

## Step 3: extent and questions

1. The method is the same at every scale: world, continent, region, settlement or district. A city is a base picture of the city plus its districts, drawn as territories, and its places.
2. Propose the extent in one sentence, based on what exists: «Ti propongo la carta di <region>, con <top places>. Va bene?» If the documents describe only one region, propose that region and say the atlas can grow later.
3. Then ask only what you cannot derive, one question at a time, in plain words with concrete options: the extent when more than one is plausible; the relative position of regions with no stated direction («Il Lago Grigio è a nord o a sud di Borgo Cenere? I documenti non lo dicono.»); a name the map needs and no document gives, only when the master wants it shown.
4. A detailed city inside a larger map: ask one question only when the documents do not say which city deserves a plan: «Vuoi la pianta dettagliata di <city> dentro la carta?»
5. Write the scope with the Write tool, as `.campaign/state/atlas/scope.json`:
   `{ "scope": { "kind": "world|continent|region|settlement|district", "places": [<top place ids>], "note": "<one line>" } }`

## Step 4: the base picture

The base is `base.png`: one painted picture, no text, no frame. Take the first source that applies.

**(a) A picture the master gave.** A file the master named, or a path you can see: use it. A picture pasted into the conversation has no path: invoke the import skill (it keeps the original in the sources) and use the path of that original. If that is not possible, ask in one sentence for the file to be put in the campaign folder. Read the picture with the Read tool and go to Step 5 after the `init` below.

**(b) A picture in the sources.** Run Glob on the sources folder (the folder of type `sources` in `campaign.yaml`) for `*.png`, `*.jpg`, `*.jpeg` and `*.webp`. Read the ones whose name suggests a map. If one is a map to draw, ask ONE question: «Ho trovato <name>: la uso come base per la carta?» Never use a picture you found yourself without a yes.

**(c) No picture: one generation.**
1. Write `.campaign/state/atlas/prompt-base.txt` with the Write tool. It is one English text with: the geography in words, from public text only (coasts, sea, mountains, rivers, climate, the size of the region); the style in one line; a line that forbids text, letters, frames, borders and any name; the shape of the picture (a wide landscape for a region or world, a square for a city).
2. Run the consent procedure of «Outside image service». On a yes, run:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/atlas-repaint-job.mjs" --mode base --prompt-file .campaign/state/atlas/prompt-base.txt --size 1536x1024 --out .campaign/cache/atlas/work/base-1.png
   ```
   `--size` gives the shape of the picture: `1536x1024` for a region or world, `1024x1024` for a city or district. Add `--style <id>` only when the master chose a style.
3. Read the result with the Read tool. It is usable when it has no text or frame, one continuous land with its sea, and the proportions you asked for.
4. If it is not usable, rewrite `prompt-base.txt` as a whole new text (never add corrections on top of the last text) and run the job again, `--out` with the next number. At most 3 attempts. After the third, say in one sentence that the picture does not come out, and ask the master for a picture to use instead.

**Then create the atlas with the picture.** Use the scope from Step 3:
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" init . .campaign/state/atlas/scope.json --base <path of the chosen picture>
```
The canvas takes the size of the picture. Save a version, in the campaign language:
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" save . --message "Atlante: estensione e carta decise."
```

## Step 5: land and sea approval

1. Make the land preview from the base picture, and read it:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" land . --out .campaign/cache/atlas/work/land-preview.png
   ```
   If the sea is not recognised, rerun with `--sea-color <#hex>` (the colour of the sea in the picture, read by eye) and `--tolerance <n>` (more tolerance takes in more shades of the shore). At most 3 rounds.
2. Read the preview with the Read tool. Check it against the documents: every coast, island, lake and direction stated in Step 2. A bay filled in, a missing island or a coast on the wrong side is wrong: correct the parameters and rerun.
3. If the preview shows a lake or a river as land (white), find a point inside it on the grid view and rerun `land` with `--water-at <x,y>` (repeatable, canvas pixels); `--clear-waters` forgets them. A lake or river drawn on the map is water, not land.
4. Before the first `preview` of the conversation, run once, in its own block:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/rasterizer-setup.mjs"
   ```
   If it prints `unavailable`, the preview has no names on it: say nothing technical about it; the master sees the full map in the Atlante section anyway.
5. Show the approved shape: outside the master screen, `preview . --open`; inside, `preview .` and Read. Ask: «Ecco la forma di terre e mari. Ti va bene, o vuoi cambiare qualcosa?»
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" preview . --open
   ```
6. On a yes, lock the land and the base, then save a version:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" lock . land
   ```
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" lock . base
   ```
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" save . --message "Atlante: terre e mari approvate."
   ```
7. On a change request, adjust and repeat from point 1.

## Step 6: painted changes

Use this for a change to the picture: a zone repainted, a coast moved on purpose, new land added outside the approved land. Each change goes through one crop. Keep the box as small as the change allows (a crop is scaled 2 to 3 times and is at most about 1100 px a side).

1. **Box.** Choose the zone in canvas pixels, `x0,y0,x1,y1`, with a margin around the change. Read the zone with a numbered grid, for you only (never show it to the master):
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" grid . --box <x0,y0,x1,y1> --out .campaign/cache/atlas/work/grid-1.png
   ```
   Read it. Take every coordinate from its numbers.
2. **Crop.** Cut and zoom the box. The output prints `scale`, `size` and the formula from canvas coordinates to crop coordinates: keep them for step 3.
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" crop . --box <x0,y0,x1,y1> --out .campaign/cache/atlas/work/crop-1.png
   ```
3. **Prompt.** Write `.campaign/state/atlas/prompt-crop-1.txt` with the Write tool, in English, with every position in CROP coordinates (use the formula). It says:
   - the visible land in words (sea, coast, hills, forest, plain, river mouth), with where each is;
   - for EVERY named settlement in the crop, its name and its position, with the words «must stay exactly where it is and unchanged». For a settlement with `visibility: "master"`, give its position only, never its name;
   - «sea stays sea»; no new land appears unless the change is a coast the master asked for;
   - the change asked, in one sentence;
   - the last line: «No text.»
   Public text only: no reserved block, no master-only name or item.
4. **Consent.** Run the consent procedure of «Outside image service». The question is asked once: after a yes, the procedure no longer asks.
5. **Repaint the crop.**
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/atlas-repaint-job.mjs" --mode crop --prompt-file .campaign/state/atlas/prompt-crop-1.txt --input .campaign/cache/atlas/work/crop-1.png --out .campaign/cache/atlas/work/repaint-1.png
   ```
   Read the `result` line. `result: ok` goes on; anything else: «When something fails».
6. **Compare.** Read the crop and the repainted picture with the Read tool, one after the other. Keep the result only when the layout is the same (coasts, rivers, roads and named settlements in their places), there is no text or frame, the look is uniform, and nothing new appears where the sea was. Otherwise rewrite the prompt as a whole new text and repaint (new `--out` number). At most 3 attempts per crop, never stacked corrections.
7. **Compose.** Put the repainted crop back on the base, only where it is allowed:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" compose . --raw .campaign/cache/atlas/work/repaint-1.png --box <x0,y0,x1,y1> --mode land --out .campaign/cache/atlas/work/candidate-1.png
   ```
   The modes:
   - `land` (the normal one): only the land of the base is repainted; the sea stays the base's sea.
   - `box`: the whole box is taken from the repaint. Only when a coast changes on purpose and the master asked for it.
   - `mask` with `--mask <png>`: the white part of the mask is taken. For a light or a mist over the land, never for a coast.
   Optional flags: `--margin <n>` softens the edge of the box; `--zone x0,y0,x1,y1` (repeatable) limits the change to those areas; `--restore x0,y0,x1,y1` (repeatable) puts the base back in that area, for a settlement or a river the repaint changed; `--no-color-match` turns off the colour matching, only when it makes the result worse.
8. **Verify.**
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" verify . --after .campaign/cache/atlas/work/candidate-1.png --box <x0,y0,x1,y1> --out .campaign/cache/atlas/work/verify-1.png
   ```
   Read the output lines: land gained, land lost, changed land blocks, `pixelsOutsideBox`. `pixelsOutsideBox` must be `0`; otherwise the composition is wrong: redo step 7. Land gained must be only the land the master asked for. Land lost must be zero unless a coast change was approved. Read the picture with before, after and difference. Look for straight edges at the border of the box, visible seams and half objects (a half tree, a cut road). A fault means a new attempt from step 5, at most 3 rounds in total for this change.
9. **Accept.**
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" accept . --candidate .campaign/cache/atlas/work/candidate-1.png --box <x0,y0,x1,y1>
   ```
   Add `--extend` only when the land is locked and the change only adds new land (sea to land) inside the box. Without it, a change to locked land is refused. `--unlock` only under rule 4.
10. **Show and save.** Render, then read the preview yourself:
    ```
    node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" preview .
    ```
    ```
    node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" render .
    ```
    Outside the master screen, show it with `render . --open`. Ask: «Ecco il ritocco. Ti piace, o vuoi cambiare qualcosa?» Then save, with one sentence:
    ```
    node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" save . --message "Atlante: <one sentence>."
    ```

## Step 7: labels, territories and places

1. Read the current labels with the Read tool, from the atlas folder the status command named (`<folder>/labels.json`), if it exists. Write `.campaign/state/atlas/labels.json` with the Write tool as the WHOLE content: the existing items, unchanged, plus your additions. Shape:
   - `lands`, `regions`, `nature`: `{ "id", "text", "x", "y", "size", "provenance", "sources", "visibility" }`, with `x`, `y` in canvas pixels (origin top-left, read from the grid of Step 6).
   - `places`: `{ "id", "place", "x", "y", "kind", "provenance", "sources", "visibility" }`. The `place` is the id of the sheet; there is no name here, the name comes from the sheet. `kind`: capital, city, town, village, fort, ruin, landmark or port. A port lies within 12 px of the sea; any other place lies on land.
   - `territories`: `{ "id", "color", "seeds", "separate", "add", "remove", "subtract", "provenance", "sources", "visibility" }`. A seed (a point on the land) is inside the territory it names; a seed in the sea is an error. `separate` cuts polygons out of the land, `add` and `remove` change the polygons, and `subtract` lists territories that come earlier in the list and are taken out of this one.
   - `legend`: `{ "show": true, "corner": "top-left" }`.
   Every item has a unique `id`. A name comes only from a document (listed in `sources`) or from the master. A sea, a range or a continent with no name gets no label. Outside facts go in `note`.
2. Check the candidate:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" labels-write . .campaign/state/atlas/labels.json
   ```
   Exit `1`: read the `error:` lines, fix the candidate, and run it again. If a place cannot go where the documents put it (on the sea, for example), ask the master one question with options.
3. Preview the territories and read them yourself:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" territories . --out .campaign/cache/atlas/work/territories.png
   ```
   Each territory must be one area, with its seed inside it, and its borders where the documents put them. At most 3 rounds.
4. Before the first `preview` of the conversation, run once, in its own block:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/rasterizer-setup.mjs"
   ```
   If it prints `unavailable`, the preview has no names on it: say nothing technical about it; the master sees the full map in the Atlante section anyway.
5. Preview and render the whole atlas, read the preview yourself, and show it:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" preview .
   ```
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" render . --open
   ```
   Outside the master screen, `--open` is included; inside, drop it. Ask the whole approval: «Ecco l'atlante intero. Vuoi cambiare qualcosa prima che lo fissi?»
6. On a yes, save a version. Labels, territories and places are not locked: they grow with the world.
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" save . --message "Atlante: approvato."
   ```

## Step 8: update mode

Another process invoked you with `update` after it added places. Step 8 is the update mode, and the report file below is its only contract. The master screen's prompt also says «follow its Step 8». In this mode nothing is shown with `--open`: the master may not be watching.

1. Run the status command of Step 1. If the atlas does not exist, or `pending` is empty, write the report with nothing to place and stop:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" report . --placed none --ask none
   ```
2. Otherwise read the sheet of each pending place with the Read tool, and decide:
   - **Position follows from its sheet or its parent, and lies on the approved land:** add it to `places` of the labels candidate (Step 7), with `provenance: "document"` and its sheet as source. A place whose sheet marks it as secret gets `visibility: "master"`.
   - **Needs land outside the approved one:** only the new area is repainted, with Step 6 and `--extend` on its `accept`. Never change the approved land.
   - **Ambiguous** (the documents allow two very different spots, or give no position): not placed. It goes into the question of the report.
3. Write the labels candidate as the WHOLE content (Step 7, point 1), then:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" labels-write . .campaign/state/atlas/labels.json
   ```
   A place refused for being on the sea is ambiguous: it goes to the question, not forced.
4. Render, and save a version with the titles of the places added, in the campaign language:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" render .
   ```
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" save . --message "Atlante: aggiunti <titles>."
   ```
5. Write the report. Pass the ids of the places placed, comma-separated, or `none`; pass the question for the ambiguous places in the campaign language, one question, or `none`:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" report . --placed <ids or none> --ask "<question or none>"
   ```
   The report is the last action. Print nothing else.

## Step 9: style

1. List the installed styles:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" styles .
   ```
2. Pick the style whose name matches what the master said. If none matches, say in one sentence which styles exist, by their names in the campaign language, and ask which one. `auto` goes back to the style chosen by the game system.
3. Set it, render, and save a version:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" set-style . <style id>
   ```
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" render .
   ```
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/versions.mjs" save . --message "Atlante: stile cambiato."
   ```
   Outside the master screen, show it with `render . --open` instead of the plain render.

## Step 10: closing

Tell the master in a few plain sentences:
- what the atlas shows, and its extent;
- which positions you chose yourself, in one sentence («ho scelto io dove mettere…»), so the master knows they can change;
- that the atlas will follow the world as it grows;
- where to see it: in the master screen, section Atlante; outside the master screen, the window that just opened.
- what failed, if anything, and any choice made without a source.

Say nothing about the players' version unless asked. When asked, render it (outside the master screen, with `--open`):
```
node "${CLAUDE_PLUGIN_ROOT}/skills/library/atlas/scripts/atlas.mjs" render . --audience players --open
```

## When something fails

- **The image service is unavailable, or the job ends with `result: failed` and an `error:` line.** Say in one sentence «Non sono riuscito a completare questa operazione. Non è stato perso nulla: possiamo riprovare.» Keep the current picture, offer to retry, and stop. Never try another service on your own.
- **The service refuses the request.** Say so in one sentence, keep the current picture, and stop. Never reword the prompt to get around a refusal.
- **`accept` refused with `land-locked`.** The change would move approved land. Say in plain words what would change, and ask whether the master wants that. Only with a clear yes, repeat `accept` with `--unlock`. Without a yes, stop.
- **`accept` refused with `outside-box`.** The picture changed outside the box. Never accept it: compose again with `--restore` on the area that changed, or repaint with a smaller box.
- **`labels-write` refused.** Fix the item the error names. A place on the sea is a question for the master, not a forced position.
- **Any other refusal.** Keep the atlas as it is, say what the master needs to decide, and stop. Never write in the atlas folder by hand, never delete a lock, and never look for a way around a refusal.
