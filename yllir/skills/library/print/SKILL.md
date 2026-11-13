---
name: print
description: Library skill. Lists the object cards of the campaign and their print state, makes the printable sheets (5x7 cards or A4 sheets, each card with a QR code to its encyclopedia entry, as a PDF), and changes a card's print state (to print, printed, to reprint) only when the master says so. Invoked by the entry skill when the master asks to print cards, or to mark them as printed.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/print/scripts/print.mjs" *), Bash(node */skills/library/print/scripts/print.mjs *), Bash(node */scripts/engine.mjs *), Read, Glob, Grep
---

# Print

This skill prints the cards of the campaign. It runs only when the print module is on: read `modules` in `campaign.yaml`. If `print` is not `true`, tell the master in one sentence that printing is off and how to turn it on through the assistant, then stop.

The skill never changes a card's text. A card is made from the public part of an object sheet (`## In breve`, or `## Descrizione` for old sheets). Nothing from the master block, the seed or a master-only category reaches a card, a sheet or a job file.

## Commands

All commands run from the plugin, with the campaign folder as `<root>`. Each prints JSON and ends with an `exit:` line: 0 done, 1 refused (read the JSON), 2 usage error.

- `node "${CLAUDE_PLUGIN_ROOT}/skills/library/print/scripts/print.mjs" list <root>`: every card with its id, title, print state and whether it has an image. Use it first, to show the master what is there.
- `... print.mjs state <root> --id <id> --state <to-print|printed|reprint>`: changes the print state of one card. It saves the change through the framework's write cycle, never by a direct write.
- `... print.mjs sheets <root> [--ids a,b] [--format 5x7|a4] [--copies id=n,...] [--cmyk true|false]`: writes the PDF to `.campaign/cache/print/`, keeps the last five, and returns the page count, the excluded cards with their reasons, and the warnings. Without `--ids` it takes the cards marked `to-print` or `reprint`.
- `... print.mjs render-card <root> --id <id> [--renderer node|photoshop] [--overwrite]`: the card image. The cards skill decides how it is used; this skill only lists and prints.

## Print state (only on the master's word)

- `to-print`: the master wants the card printed. You may set it when the master asks to prepare cards for printing.
- `printed`: set it ONLY when the master says the cards were printed. Never set it on your own, even after a sheet was made.
- `reprint`: the master says the card must be printed again (for example after a change). A card that is `printed` whose title or text changed goes to `reprint` only when the master agrees.

Rules for `state`:
1. Run `state`. When it succeeds, tell the master in one sentence which card changed and to what.
2. When the result's `errors` has the code `review-required`, the change needs a model review first, as in the write cycle of the framework. Do this: launch the `yllir:batch-reviewer` agent with the keys `CAMPAIGN_ROOT` (the campaign folder, absolute), `DRAFTS` (the `path` of the result), `FINAL_FILES` (the `finalFiles` of the result), `SEED` (the `campaign.seed` value of `campaign.yaml`) and `INTENT` (one English sentence: the print state of one card changes). Record its outcome with the engine: `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" review <root> --outcome <the outcome of the reviewer's answer> --drafts-hash <the draftsHash of the result>`. Then run `state` again with the same arguments. Do not write the review file by hand or invent its answer.
3. When the reviewer answers `FIX`, tell the master in one sentence that the change could not be saved, and stop.
4. Any other error: say in one sentence that the card could not be marked, and stop.

## Making sheets

1. Run `list`. Show the master the cards that will be printed (title and state), and ask one question if the choice is not clear: which cards, and which format (5x7 for single cards, A4 for four per page). Use the campaign defaults when the master does not care.
2. Run `sheets` with the choices. For personal cards (`personal: true`) the number of copies is the number of player characters, unless the master gives another number.
3. Report in a few sentences: how many pages, where the file is (its full path, in a plain sentence), and what was left out and why. The excluded reasons, in plain words:
   - `no-public-text`: the card has no public text. Ask whether the master wants to add an `In breve` section.
   - `no-id`, `invalid-id`, `duplicate-id`: the card's code is missing or shared. This is a problem of the sheet: tell the master which card it is.
   - `retired-id`: the card's code is no longer used. It cannot be printed as it is.
   - `master-only-category`: the card is not public and is never printed.
   - `not-found`: no card has that name.
4. Warnings, in plain words: `text-truncated` (the text was cut to fit the card), `cmyk-images` (the pictures are not converted to print colours; ask the print shop), `card-image-older-than-sheet` (the card image is older than the sheet: offer to render it again).

## QR codes

Each card's QR code points to its entry in the encyclopedia: the address of the campaign plus the card's code. The address comes from the campaign settings. If the encyclopedia module is off, the QR still points to the configured address; say so once, in one sentence, when the master asks about the QR. Never show the address as a technical term; say «il collegamento della voce».

## Card images

- A finished card image, `img/<name>.png` next to the sheet, is the whole front of the card. Sheets print it as it is, full size.
- A JPEG, `img/<name>.jpg`, is an illustration. The vector card places it in a framed area, under the title, and draws the title, the text and the id around it.
- With no image, the card is drawn directly as vector in the PDF from its text: this is the normal path. It needs no renderer and no fonts to install.
- The Node renderer (`render-card --renderer node`) draws a finished PNG face with a built-in pixel font. It is the fallback when Photoshop is not available. It is legible at full size, but it is plainer than the vector card, so it is used only when the master asks for a finished image.
- `--renderer photoshop` does not draw anything: it writes the job file that the cards skill uses to drive Photoshop.

## Words for the master

Use the words of the lexicon for the campaign language. For this skill: «carta» (card), «foglio» or «fogli» (sheet, sheets), «da stampare», «stampata», «da ristampare» (to print, printed, to reprint), «collegamento» (the link of an entry), «encyclopedia» (the entry pages). Never say: command, JSON, exit code, state file, review, engine, draft, PDF library, renderer, batch, metadata. Say what happened: «ho preparato i fogli di 6 pagine: li trovi in ...».

## What this skill does not do

- It does not edit a sheet, and never changes the text of a card.
- It does not publish anything; the encyclopedia is local.
- It does not choose the print shop's settings. CMYK and the format are campaign settings the master changes through the assistant.
