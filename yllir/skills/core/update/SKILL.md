---
name: update
description: Handles the framework update for the master: campaign alignment after the assistant was updated, the update notice and its yes or no, and an interrupted update. It is read by the entry skill, never called by the master.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/update/scripts/update-campaign.mjs" *), Bash(node */skills/core/update/scripts/update-campaign.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/update/scripts/post-update.mjs" *), Bash(node */skills/core/update/scripts/post-update.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/update/scripts/item-descriptions.mjs" *), Bash(node */skills/core/update/scripts/item-descriptions.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" *), Bash(node */scripts/engine.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/geographic-layout.mjs" *), Bash(node */scripts/geographic-layout.mjs *), Bash(claude plugin update *), Read, Write, Edit, Skill, Agent
---

# Update

This file is read by the entry skill (`${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/SKILL.md`) and followed step by step. Part A aligns the campaign. Part B handles the update notice.

The lexicon (`${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/lexicon.md`) must already be in your context: the entry skill reads it in its Step 2. Every sentence to the master uses only lexicon words, in the campaign language.

Run every command from the campaign root (the folder the master opened). Never run a command from another folder.

**Plugin root.** Use `${CLAUDE_PLUGIN_ROOT}` in every command below, exactly as written.
**Commands.** Run each command exactly as written in this file, as one single command: nothing before it and nothing after it, no `;`, `&&`, `|`, `2>&1`, `echo`, `cat`, `mkdir` or `cd`. Anything added makes the command refused. Every script prints its result and, as its last line, `exit: <code>`: read the exit code from that line. Read result files with the Read tool. If a command is refused, run it again exactly as written, with nothing added; if it is refused again, end this skill with `status: FAILED`, reason "permission refused".

## Part A — Campaign alignment

Use this part when the block `YLLIR SESSION CHECK` has `campaign alignment: needed` or `post-update: needed`.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/update/scripts/update-campaign.mjs" .`. Read the JSON result and its `exit:` line.
2. If `status` is `updated`: when `sheet_migration` is `pending`, say that the assistant has been updated and that some Statistics sections need a format update (translate into the campaign language). Otherwise say the fixed sentence of the lexicon «L'assistente è stato aggiornato. Nulla di tuo è cambiato.» (in the campaign language, as it is written there). Then do the following, in this order:
   - If `world_migration` is `complete` and `world_migration_files` is not empty, add ONE sentence for the master, in the campaign language, in plain words. The sentence says two things: each document now records what it describes, and its content comes from the master (the master's own material, which you did not invent; the migration marks all existing content as said by the master, so never say that you wrote it or that the assistant wrote it). The sentence also says that the campaign has a seed of the world (the general description that the sheets start from). In this sentence «you» always means the master, never the assistant. For an Italian campaign use exactly this sentence: «Ogni documento ora dice che cosa descrive e che il suo contenuto viene da te, e la campagna ha un seme del mondo (la descrizione generale da cui partono le schede).» Do not use technical words. The migration itself was done by the update script: do nothing else for it.
   - If `migrated` is not empty (it lists the old session files that were converted), regenerate the plot layout once with a layout-only engine commit: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/engine.mjs" commit . --message "<sentence in the campaign language>"` (no `--files`, no review needed). The engine rebuilds the session main files and the links of the scenes at every commit. Read its `exit:` line. If it is 0, add ONE sentence for the master, in the campaign language, in plain words: the sessions have been reorganised so that each scene is its own document, and each session has a map of its scenes. Use only the lexicon words «Sessione» and «Mappa della trama» (English: «Session» and «Plot map»), and the plain words «scena» (English: «scene»). Do not use the words «evento», «file», «migrazione» or «depends_on». If the exit code is not 0, say nothing about it and do not retry: the next commit of a session regenerates the layout.
   - If `restored_by_hand` is not empty, add in one sentence that a file managed by the assistant was restored, and that their own rules belong in «Your rules».
   - Do not run `generate-instructions` as well.
3. If `status` is `up-to-date`: say nothing about the framework update.
4. If `status` is `failed` and the first item of `errors` has `code` `interrupted-update`: say the fixed sentence of the lexicon for an earlier update that was not finished. Then offer two choices in plain words: continue the update, or go back to how it was. Write no campaign content until the master chooses.
   - On «continue»: run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/update/scripts/update-campaign.mjs" . --resume`. Read its JSON result and apply step 2 (`updated`) or step 5 (any other failure).
   - On «go back»: run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/update/scripts/update-campaign.mjs" . --cancel`. If `status` is `cancelled`, tell the master in one sentence that everything is as it was before the update.
5. Any other failure, or any other status: say the fixed sentence of the lexicon for an update that could not be applied, which says that nothing was changed (the script has already restored the campaign). Stop writing.

Output: the campaign is aligned (updated, with the scenes linked when `migrated` was not empty, or already up to date), or the master has been told about the problem and nothing was written.

### Sheet format follow-up

If the result has `sheet_migration: pending`, `item_description_migration: pending` or `geography_migration: pending` (whether its status is `updated` or `up-to-date`), finish those steps in this turn, before the master's request. The steps are in `${CLAUDE_PLUGIN_ROOT}/skills/core/update/post-update.md`: read it with the Read tool and follow it. It covers the geographic layout, the item descriptions and the Statistics tables, in that order.

- If a step needs the master's answer, ask one precise question in your message, in plain words, and stop that step. The step stays pending: the next time the campaign is opened, this follow-up runs again. If the master's next message answers the question, use the answer in that step and continue. Do not repeat a question the master has already answered.
- If the steps finish, or the master has no pending question, continue with the master's request (Step 6 of the entry skill).
- If the steps fail, say the fixed sentence of the lexicon for an operation that could not be completed, and continue with the master's request. Never claim that a step was done when it was not.

## Part B — Update notice

Use this part when your context has a block that starts with `YLLIR UPDATE AVAILABLE`, or when your previous message to the master asked whether to update. The master decides: never update without a clear «yes».

**(a) Ask.** First answer the master's request completely, as Step 6 of the entry skill says (if the master only wrote a greeting or «where were we», answer that first). Then, in the same final message, add a separate short paragraph after the answer:
  1. Say in plain words that an update is available («Aggiornamento disponibile» in the lexicon) and that the assistant the master uses now is out of date.
  2. Say what changes for the master, using the lines under `news for the master:` in the block. Rewrite them in the campaign language, with lexicon words. Use only what those lines say; if there are no lines, say only that there are improvements. Never name version numbers in this part.
  3. Say whether the master's documents are touched, ONLY if the news says so. If the news says nothing about it, say nothing about it.
  4. Ask whether to update now. This is the only question of the paragraph.
  5. Last, a note: «Versione <installed> → <published>» (in English campaigns: «Version <installed> → <published>»), with the values of the block's `installed:` and `published:` lines.
  After writing that paragraph in your message, and before the turn ends, run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/update/scripts/update-campaign.mjs" . --postpone` once, with nothing added. Its output is not shown to the master. Do not run it again in this turn.
  Output: the paragraph in the final message, then the postpone command has run once.

**(b) Answer to the question.** Look at your previous message in the conversation. If the master's message answers the update question of (a), do only this part (not Step 6 of the entry skill).
  Plugin update command: `claude plugin update yllir@yllir --json`. Run exactly that command, as one single command. It is the only place where the command is written; change it here if the marketplace name changes.
  - «yes» (any clear consent, for example «sì», «aggiorna», «ok, aggiorna pure»): run the plugin update command above.
    If its exit code is 0: tell the master in plain words that the update is ready and they must close and reopen the assistant once for it to start working. If the update notice says old Statistics sections need a format change, say that those sections may be updated the next time the campaign is opened. Otherwise say that nothing in the campaign changes. Say that the campaign itself is aligned the next time it is opened (the entry skill's Step 4). If the exit code is not 0: say the fixed sentence of the lexicon for an update that could not be applied, which says that nothing was changed.
  - «no» or «later» (or any clear refusal): say that it is fine and that you will mention it again tomorrow. Run nothing.
  - Anything else (a new request): handle it normally with Step 6 of the entry skill. Do not repeat the question.
  Output: the update is ready, or nothing was changed, or nothing was run.
