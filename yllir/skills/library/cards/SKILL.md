---
name: cards
description: Library skill. Creates the card image of one object sheet (the finished front of the card, from the public part of the sheet only), with the Photoshop route first and the Node renderer when Photoshop is not available; asks before it replaces an existing image. Invoked by the entry skill after an object sheet is created or revised, when the master asks for a card.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/print/scripts/print.mjs" *), Bash(node */skills/library/print/scripts/print.mjs *), Read, Glob, Grep
---

# Cards

A card is the printed front of an object sheet: its title, its short text and its id, with the image if there is one. This skill makes the card image, `img/<name>.png` beside the sheet. The sheet is never changed here.

The sheet of an object is a card only when its category has `cards: true` in `campaign.yaml`. An announcement is an object with `template: notice`, and it is a card in the same way. If the category does not have the flag, tell the master in one sentence that the object cannot have a card, and stop.

## Rules

- Only the PUBLIC part of the sheet is used: the text above the master block. Read the sheet only up to the line `<!-- master -->`. Never pass a master note, a secret or the seed to any service, and never to Photoshop.
- The card text is `## In breve` (English `## In brief`), or `## Descrizione` (`## Description`) for an old sheet with no short text. The card must show what the characters know at the moment the master chooses, so take the sentences that are safe to show.
- Ask the master ONE question only when it matters: when the sheet holds facts that the characters learn later, ask which moment the card shows (for example «la lanterna è accesa o spenta, per i giocatori?»). Otherwise decide yourself and say what you used in one sentence.
- Never edit the sheet. A card is derived from it.
- Before replacing an existing `img/<name>.png` or `img/<name>.psd`, ask the master: «La carta ha già un'immagine. La sostituisco?». Replace only on a yes.

## The flow

1. Get the card's data. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/print/scripts/print.mjs" list <root>` and find the card by its id. A card with a problem (no public text, no id) cannot be made: say which problem, in plain words, and stop.
2. Choose the route:
   - **Photoshop first.** Run `print.mjs render-card <root> --id <id> --renderer photoshop`. It writes `.campaign/cache/print/job-<id>.json` and prints it: the title, the public text, the illustration if one exists, the size (5 x 7 inch, 1500 x 2100 pixels at 300 dpi) and the two output paths (`output.png`, `output.psd`). Read the job with the Read tool. Then, with the Photoshop tools (the tools whose names start with `photoshop_`, when they are available to you):
     1. Call `photoshop_get_capabilities` once, and `photoshop_get_state`. Keep the `document_id` for every later call.
     2. Create a new document of 1500 x 2100 pixels at 300 dpi.
     3. Make the layers, from the bottom: a paper background; the illustration (when the job has one) placed in a framed area under the title; the title; the short text, wrapped inside the frame; the footer with the id. The text is the job's `text` word for word, never a summary you wrote.
     4. Save the layered file as `<root>/<output.psd>`, and export the flattened card as `<root>/<output.png>`.
     5. Stop working in Photoshop. Read the exported PNG with the Read tool, and check it against the job's title and text. Fix a visible error once; then keep the result.
     If Photoshop tools are not available, or a call fails twice, use the Node route and say nothing technical about it.
   - **Node renderer otherwise.** Run `print.mjs render-card <root> --id <id> --renderer node`. It draws the card with a built-in font. When it answers `"error": "exists"`, ask the master before replacing the image, and then run it again with `--overwrite`.
3. Check the result. Read the PNG and confirm the title and the text are the public ones and the id is in the footer. If something is wrong, tell the master what, in one sentence, and offer to redo it.
4. Report in a few sentences: the card is ready, which route made it (in plain words: «con Photoshop» or «con il disegno del framework»), and that its print state did not change. If the card was already `printed` and its image or text changed, say that it may need printing again and ask whether the master wants it marked `reprint` (the print skill does that, on the master's word).

## Words for the master

«carta» (card), «immagine della carta» (card image), «testo pubblico» (public text), «Photoshop». Never say: job, JSON, renderer, PSD layer, MCP, command, exit code, engine. The illustration is «l'illustrazione», the short text is «il testo breve».
