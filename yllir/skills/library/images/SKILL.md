---
name: images
description: Library skill. Creates an image for a campaign document (a portrait, an illustration of a place or an item, or a battle map of a place (a top-down map with a grid, an interactive preview and files for virtual tabletops and Tiled)), or removes the background of an existing image, with the image service it picks by itself or the one the master names; adds a new image service to the campaign when the master names one that is not there. Invoked by the entry skill when the master asks for an image.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/image-probe.mjs" *), Bash(node */skills/library/images/scripts/image-probe.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/image-select.mjs" *), Bash(node */skills/library/images/scripts/image-select.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/image-prompt.mjs" *), Bash(node */skills/library/images/scripts/image-prompt.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/comfyui-run.mjs" *), Bash(node */skills/library/images/scripts/comfyui-run.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/codex-run.mjs" *), Bash(node */skills/library/images/scripts/codex-run.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/command-run.mjs" *), Bash(node */skills/library/images/scripts/command-run.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/http-run.mjs" *), Bash(node */skills/library/images/scripts/http-run.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/image-place.mjs" *), Bash(node */skills/library/images/scripts/image-place.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/provider-check.mjs" *), Bash(node */skills/library/images/scripts/provider-check.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/g2dmedia-run.mjs" *), Bash(node */skills/library/images/scripts/g2dmedia-run.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/maps/maps-setup.mjs" *), Bash(node */skills/library/images/scripts/maps/maps-setup.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/maps/maps-run.mjs" *), Bash(node */skills/library/images/scripts/maps/maps-run.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/maps/map-job.mjs" *), Bash(node */skills/library/images/scripts/maps/map-job.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/maps/map-uvtt.mjs" *), Bash(node */skills/library/images/scripts/maps/map-uvtt.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" *), Bash(node */scripts/engine.mjs *), Read, Write, Edit, Glob, Grep, WebSearch, WebFetch
---

# Images

You are the AUTHOR. Images make a picture for a campaign document: a portrait, an illustration of a place or of an item, or the same picture with its background removed. The picture is made by an image service. You choose the service with the scripts, you send it only the job the scripts build, you check the result, and you place it with `image-place.mjs`. Run commands from the campaign root (the folder that contains `campaign.yaml`), exactly as written, with nothing added. Words for the master come from the lexicon: never say a technical term.

**Rules.**
- An image service receives ONLY what `image-prompt.mjs` puts in the job. Never send, paste or summarize anything else: no master-only block, no seed, no master-only category, no names or facts from other documents. When you call a service yourself (a Photoshop tool or a campaign tool), the description you pass is exactly the `prompt` in `job.json`, word for word.
- A web search about a service contains only the service name and words like "image generation API", "CLI", "MCP": never campaign names, places or facts.
- API keys are never written in campaign files, documents, messages, commit messages or logs. A key the master gives goes only into `.campaign/state/keys.json` (a JSON object: provider id → key), which is never saved in the campaign history. Never repeat a key back to the master.
- Fallback to another service only when a service is unavailable or fails technically (`error: unavailable`, `timeout`, `failed`). Never because you do not like the result. When the master named the service, never switch: say the fixed sentence and ask.
- At most 2 corrective attempts after the first result, on the same service.
- Never name a service to the master, except in the consent sentence and when the master named it first.
- Images are written only by `image-place.mjs`; documents only through the write cycle.
- The style files and the new-service files you write in `.campaign/styles/` and `.campaign/image-providers/` are saved with `--sources`: these two folders are the only exception to the rule that `--sources` holds only files placed by scripts.
- The map tools are installed outside the campaign by `maps-setup.mjs`; never install, download or run Python yourself: every Python tool runs only through `maps-run.mjs`.

**Maps.** When the master asks for a map, battle map, floor plan or «mappa di battaglia» of a place, follow `maps.md` in this folder instead of the Steps below (read it with the Read tool). A map of the whole world or of a region is not made here: say [world map not available] and stop.

## Steps

**Step 1 — Settings.** Read `campaign.yaml` with the Read tool. Keep the CAMPAIGN LANGUAGE (`language.main`), `campaign.seed` and the `structure` entries.
1. Identify the DOCUMENT: the campaign-relative path of the document the image is for. Use the master's words: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" query . find "<the name the master used>"` and read its result; or use Glob in the campaign folders. If two documents are plausible, ask ONE question naming both by title, and stop.
2. OPERATION is `generate`. It is `map` when the master asks for a battle map or a map of a place (then follow `maps.md`). It is `remove_background` when the master asks to remove or clear the background of an image; then IMAGE is the campaign-relative path of that image, found under the document's title (Glob in the document's folder).
3. REQUESTED is the service the master named in THIS message («con gemini», «usa ComfyUI»), or none.
4. REQUEST is the extra visual wishes of the master for this image («di profilo», «al tramonto»), translated into English, at most 300 characters. None otherwise.

**Step 2 — Is this an answer?** Look at your previous message in this conversation. If it was a question of this tool, take the master's answer and continue from the step that asked it:
- a style confirmation: Step 5, with the style the master confirmed (or corrected);
- a consent question: run `image-select.mjs . --consent <id>` (the id of the service you asked about), then Step 4;
- a key request (Step A.4, or Step A0 for a service named there): merge the key as that step says;
- a question about which document: Step 1 with that answer.
If the previous message was not a question of this tool, go to Step 3.

**Step 3 — Services.** Once per conversation (skip it if you already ran it in this conversation): run
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/image-probe.mjs" . --photoshop <yes or no> --mcp-tools "<names>" --data-dir "${CLAUDE_PLUGIN_DATA}"`
1. `--photoshop yes` when a tool whose name contains `photoshop_get_capabilities` is available to you; otherwise `no`.
2. `--mcp-tools`: the comma-separated names of the `mcp__` tools you can see that a campaign service could use to create an image. Empty string `""` if none.
Read the output. Go to Step 4.

**Step 4 — Choose.** Run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/image-select.mjs" . --operation <OPERATION>`
- add `--provider "<REQUESTED>"` when REQUESTED is not none;
- add `--exclude <ids separated by commas>` after a technical failure (Step 6), listing every service that failed in this request.
Read the output lines `provider`, `reason`, `needs-consent`.
1. `reason: unknown-provider`: if REQUESTED is one of the names in Step A0, go to Step A0; otherwise go to Step A, then come back to Step 3.
2. `reason: requested-unavailable` or `reason: requested-unsupported`: say the fixed sentence [requested service unavailable] and stop.
3. `provider: none`: say the fixed sentence [no service] and stop.
4. `needs-consent: yes`: say the consent sentence [consent] with the service's plain name and the document title, and stop. The plain name is «Codex di OpenAI» (Italian) or «OpenAI's Codex» (English) for codex; «Agent Sprite Forge, che passa la descrizione al servizio di immagini per cui mi hai dato una chiave, oppure a Codex» (Italian) or «Agent Sprite Forge, which passes the description to the image service you gave me a key for, or to Codex» (English) for generate2dmedia; «Photoshop di Adobe» or «Adobe Photoshop» for photoshop; the `name` of the service for a campaign service. On a yes: run `image-select.mjs . --consent <id>`, then Step 4 again. On a no: run Step 4 again with `--exclude <id>`.
5. `provider: upload`: say the fixed sentence [send your own image] and stop. When the master then sends a file, go to Step 8 with `--file`.
6. Otherwise the provider is chosen: go to Step 5.

**Step 5 — Style (generate only).** Run:
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/image-prompt.mjs" . --document "<DOCUMENT>" --operation <OPERATION>`
- add `--request "<REQUEST>"` when REQUEST is not none;
- add `--image "<IMAGE>"` for remove_background.
Read the lines `job` (JOB) and `folder` (JOB_DIR). For remove_background, skip the style part and go to Step 6.
- `error: no-style`: the campaign has no image style yet. Read with the Read tool the PUBLIC part of the world description document: the part above `<!-- master -->` (find it with Glob in the places or world folder; it is the document that describes the world, not the seed). Propose ONE style in the campaign language (technique, palette, mood) in one sentence ending with a question mark. Stop. On a yes, or on a corrected version: write with the Write tool `.campaign/styles/base/profile.yaml` with these lines: `id: base`, `negative: "<English: what to avoid, for example text, watermark, extra limbs, modern objects>"`, `width: 1024`, `height: 1024`. Write `.campaign/styles/base/prompt.md`: one English paragraph with the style, then the exact placeholder `{SUBJECT_DESCRIPTION}`. Save them: first `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" check . --sources ".campaign/styles/base/profile.yaml,.campaign/styles/base/prompt.md"`, then, if its exit code is 0, `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" commit . --sources ".campaign/styles/base/profile.yaml,.campaign/styles/base/prompt.md" --message "<campaign language: Image style of the campaign>"`. If either exits 1, say the lexicon failure sentence and stop. Then run Step 5 again.
- `error: not-public`: say the fixed sentence [reserved document] and stop.
- any other `error:`: say the fixed sentence «Non sono riuscito a completare questa operazione. Non è stato perso nulla: possiamo riprovare.» (English: «I could not complete this operation. Nothing was lost: we can try again.») and stop.
- `job` is given: go to Step 6.

**Step 6 — Run, by provider.** Use the provider of Step 4.
- **comfyui**: Read `.campaign/state/image-providers.json`, take `providers.comfyui.checkpoint` and `providers.comfyui.url`. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/comfyui-run.mjs" "<JOB_DIR>" --checkpoint "<checkpoint>" --url "<url>"`.
- **codex**: run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/codex-run.mjs" "<JOB_DIR>"`. It can take minutes: wait for it.
- **generate2dmedia**: run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/g2dmedia-run.mjs" . "<JOB_DIR>" --data-dir "${CLAUDE_PLUGIN_DATA}"`, adding `--route <ROUTE>` when ROUTE is set (Step A0). It can take minutes: wait for it.
- **a campaign service of kind command**: run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/command-run.mjs" . "<JOB_DIR>" --provider <id>`.
- **a campaign service of kind http**: run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/http-run.mjs" . "<JOB_DIR>" --provider <id>`.
- **a campaign service of kind mcp**:
  1. Read `.campaign/image-providers/<id>/instructions.md` and `<JOB_DIR>/job.json` with the Read tool.
  2. Call the tool named in the instructions, as the instructions say. Pass the job `prompt` word for word. Pass `negative`, the size and the input image only when the instructions use them.
  3. Save the image as `<JOB_DIR>/result.png`.
  4. Write `<JOB_DIR>/run.json` with `{"provider":"<id>","parameters":{}}`.
- **photoshop**:
  1. Once per conversation, call `photoshop_get_capabilities`.
  2. Call `photoshop_get_state` and keep its `document_id` for every later call.
  3. Prefer the recipes that `photoshop_get_capabilities` lists.
  4. For generate: create the image from the job `prompt`, word for word. For remove_background: open the job `input` file and remove its background.
  5. Take at most one preview per major step.
  6. Export a PNG to `<JOB_DIR>/result.png`.
  7. Write `<JOB_DIR>/run.json` with `{"provider":"photoshop","parameters":{}}`.
  8. Then stop working in Photoshop.

Read the result of the run:
- `result: ok`: go to Step 7.
- `error: unavailable`, `error: timeout`, `error: failed`, `error: unsupported`, `error: invalid`, or a tool error: run Step 4 again, adding `--exclude` with every service that failed in this request. When the master named the service, say the fixed sentence [requested service unavailable] and stop instead.

**Step 7 — Visual check.** Read `<JOB_DIR>/result.png` with the Read tool. Compare it trait by trait with the PUBLIC description in `job.json` (the `prompt`) and with REQUEST: build, age, clothes, colours, objects, setting. For remove_background, check that the subject is intact and that the background is gone.
- If the result is not a usable picture at all (blank, a single colour, a few pixels, unreadable), treat it as a technical failure: go back to Step 6's failure rule (Step 4 with `--exclude`, or the fixed sentence when the master named the service).
- If it is a picture but some traits are wrong: correct it on the SAME service (at most 2 corrections), never switch service for this reason.
- If a trait is clearly wrong and fewer than 2 corrective attempts were made: write a short English correction (at most 300 characters, only traits that are in the public description). Run Step 5 with that correction as `--request`, which makes a new job, then Step 6 on the same provider. Count this attempt.
- Otherwise keep the best result.
Write REVIEW: one English sentence on what matches and what does not.

**Step 8 — Place and save.**
1. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/image-place.mjs" . --document "<DOCUMENT>" --alt "<campaign language: short description of the image, with no ] and no line breaks>" --provider <id> --job <JOB> --review "<REVIEW>"`.
   For an upload: `--provider upload --file "<absolute path the master gave>"` instead of `--job <JOB>`.
   Exit 1 means refused: nothing was placed. Read the `error:` and `message:` lines, say the lexicon sentence «Non sono riuscito a completare questa operazione. Non è stato perso nulla: possiamo riprovare.» (English: «I could not complete this operation. Nothing was lost: we can try again.»), and stop.
2. Read the output lines `image`, `sidecar` and `draft`.
3. Save with the write cycle of `${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/authoring.md` section 7. Use the same `--sources` in each command.
   - If `draft` is not `none`: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" check . --files "<DOCUMENT>" --sources "<image>,<sidecar>"`. Read its exit code. If it is 1, read the `errors`; you cannot fix them here, so say the lexicon failure sentence and stop. Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" commit . --files "<DOCUMENT>" --sources "<image>,<sidecar>" --message "<campaign language: short sentence, for example Ritratto di Oria Brunel>"`.
   - If `draft` is `none`: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" check . --sources "<image>,<sidecar>"`, and stop with the lexicon failure sentence if it exits 1. Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" commit . --sources "<image>,<sidecar>" --message "<same kind of sentence>"`.
   - An image-only change does not need the reviewer. If `reviewRequired` is true anyway, follow section 7 of authoring.md.
4. Read the commit output. Exit 1: nothing was written; say the lexicon failure sentence of step 1 and stop. Exit 0: go to Step 9.

**Step 9 — Message.** Send the master one or two sentences in the campaign language: which document now has an image, and what the image shows. Never say file names, service names (except when the master named one first) or technical words.

**Step A — New service.** The master named a service that is not known.
1. Check whether you can see an `mcp__` tool that clearly belongs to that service and creates images. If yes, KIND is `mcp`. If not, use WebSearch with ONLY "<service name> image generation API" and, if needed, "<service name> image generation command line". Read the official documentation page with WebFetch. KIND is `command` when the documentation describes a command-line program that writes an image file and the master has it installed. Otherwise KIND is `http`.
2. ID is the slug of the service name: lowercase, words joined with hyphens. It must not be `comfyui`, `codex`, `photoshop` or `upload`. Write with the Write tool `.campaign/image-providers/<ID>/provider.yaml`:
   - `id: <ID>`
   - `name: "<service name as the master says it>"`
   - `kind: <KIND>`
   - `operations: [generate]` (add `remove_background` only if the documentation offers it)
   - `external: true`
   - `added: "<current date and time, ISO, with T and Z>"`
   - kind command: a `command:` block, a list of quoted strings, the program first, then the placeholders `"{PROMPT}"` and `"{OUTPUT}"` (also `"{NEGATIVE}"`, `"{WIDTH}"`, `"{HEIGHT}"`, `"{INPUT}"` when the program supports them); a `probe:` list (for example the program and `"--version"`); `timeout_seconds: 600`.
   - kind mcp: `tool: <full tool name>`, and a file `.campaign/image-providers/<ID>/instructions.md` beside it with the exact parameters to pass.
   - kind http: `key_env: <ENV_VAR_NAME>` (the variable name the documentation uses, for example GEMINI_API_KEY), and a file `.campaign/image-providers/<ID>/request.json` with `method`, `url`, `headers`, `body` and `response`. `response` is `{"base64": "<dot path to the base64 image in the JSON reply>"}` or `{"url": "<dot path>"}`. Use the placeholders `{PROMPT}` and `{KEY}`.
   ALWAYS quote placeholders in YAML lists. NEVER write a key in these files.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/images/scripts/provider-check.mjs" . <ID>`. If `result: invalid`, fix the files from the `error:` lines, at most 3 rounds. If it is still invalid, say the fixed sentence «Non sono riuscito a completare questa operazione. Non è stato perso nulla: possiamo riprovare.» and stop.
4. Kind http with a key: when Step 3 or Step 4 says the service is unavailable because it has no key, ask the master ONE question with the fixed sentence [key needed]. When the master gives the key, merge it into `.campaign/state/keys.json` with the Write tool (read the file first if it exists), as a JSON object with the provider id as key. Never repeat the key, in any message, file or commit.
5. Save: first `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" check . --sources "<the files in .campaign/image-providers/<ID>/>"`, then, if its exit code is 0, `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" commit . --sources "<the same files>" --message "<campaign language: New image service: <name>>"`. If either exits 1, say the lexicon failure sentence and stop. The key file is never part of the commit.
6. From now on this service is the first choice of the campaign. Go back to Step 3.

**Step A0 — A service that Agent Sprite Forge covers.** The master named one of these services (match the name, in any case). Use the route and the key variable of its row.
- gemini, google, nano banana → ROUTE `gemini`, KEY VARIABLE `GEMINI_API_KEY`.
- openai, chatgpt, gpt image, dall-e → ROUTE `openai`, KEY VARIABLE `OPENAI_API_KEY`.
- grok, xai → ROUTE `xai`, KEY VARIABLE `XAI_API_KEY`.
- seedream, byteplus → ROUTE `byteplus`, KEY VARIABLE `ARK_API_KEY`.
- fal → ROUTE `fal`, KEY VARIABLE `FAL_KEY`.

1. REQUESTED becomes `generate2dmedia`. Keep ROUTE for Step 6.
2. Read `.campaign/state/keys.json` if it exists. If it has no `generate2dmedia` object that holds the KEY VARIABLE: ask the master the fixed sentence [key needed], with the service name the master used, and stop.
3. When the master gives the key: read `.campaign/state/keys.json` if it exists, then merge the key with the Write tool as `"generate2dmedia": {"<KEY VARIABLE>": "<key>"}`, keeping every other entry. Never repeat the key, in any message, file or commit. The keys file is never saved in the campaign history.
4. Run Step 3 (probe) again, then Step 4 with `--provider generate2dmedia`.

## Failures and fixed sentences

Use these sentences as they are. Italian first, English second, from the table «Fixed sentences for images» of the lexicon.

| Situation | Sentence |
|---|---|
| No image service is available | [no service] |
| The master named a service that is unavailable or unsupported, or it failed and the master named it | [requested service unavailable] |
| An outside service is about to receive the description for the first time (`needs-consent: yes`) | [consent], then wait for the answer |
| The document is reserved to the master (`error: not-public`) | [reserved document] |
| The master must send an image | [send your own image] |
| A service needs its key | [key needed] |
| Any other error that stops the operation | the lexicon sentence «Non sono riuscito a completare questa operazione…» |

## Examples

(a) Wrong: sending the sheet text, or a summary you wrote, to Photoshop as the description.
Correct: pass the `prompt` of `job.json`, word for word, and nothing else.

(b) Wrong: the master said «con Codex»; Codex timed out; you used ComfyUI without asking.
Correct: say [requested service unavailable] and ask whether the master wants another service. Wait for the answer.

(c) Wrong: writing `x-goog-api-key: AIza...` in `request.json`.
Correct: write `{KEY}` in the header, and put the key only in `.campaign/state/keys.json`.

(d) Wrong: retrying a third time because the cloak colour is slightly off.
Correct: keep the best result after 2 corrections, and write REVIEW with what does not match.

(e) Wrong: telling the master «ho usato ComfyUI con il checkpoint…».
Correct: «Ho aggiunto un ritratto alla scheda di Oria Brunel: una donna con il mantello blu davanti alla torre.»

(f) Wrong: the portrait shows a man instead of a woman, so you switch to another service.
Correct: a corrective attempt on the same service with «a small woman, not a man», at most 2 corrections in total.
