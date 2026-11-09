---
name: update
description: Handles the framework update for the master: campaign alignment after the assistant was updated, the update notice and its yes or no, and an interrupted update. It is read by the entry skill, never called by the master.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/core/update/scripts/update-campaign.mjs" *), Bash(claude plugin update *), Bash(codex plugin marketplace upgrade *), Read, Skill
---

# Update

This file is read by the entry skill (`${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/SKILL.md`) and followed step by step. Part A aligns the campaign. Part B handles the update notice.

The lexicon (`${CLAUDE_PLUGIN_ROOT}/skills/core/yllir/lexicon.md`) must already be in your context: the entry skill reads it in its Step 2. Every sentence to the master uses only lexicon words, in the campaign language.

Run every command from the campaign root (the folder the master opened). Never run a command from another folder.

**Commands.** Run each command exactly as written in this file, as one single command: nothing before it and nothing after it, no `;`, `&&`, `|`, `2>&1`, `echo`, `cat`, `mkdir` or `cd`. Anything added makes the command refused. Every script prints its result and, as its last line, `exit: <code>`: read the exit code from that line (the `exit:` line). Read result files with the Read tool. If a command is refused, run it again exactly as written, with nothing added; if it is refused again, end this skill with `status: FAILED`, reason "permission refused".

## Part A — Campaign alignment

Use this part only when the block `YLLIR SESSION CHECK` has the line `campaign alignment: needed`: the assistant was updated and the campaign's generated files are older.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/update/scripts/update-campaign.mjs" .`. Read the JSON result and its `exit:` line.
2. If `status` is `updated`: say the fixed sentence of the lexicon «L'assistente è stato aggiornato. Nulla di tuo è cambiato.» (in the campaign language, as it is written there). Then do the following, in this order:
   - If `migrated` is not empty (it lists the old session files that were converted), link the scenes, once:
     1. Invoke the skill `yllir:plot-map` (if your tool has no way to invoke a skill, read `${CLAUDE_PLUGIN_ROOT}/skills/library/plot-map/SKILL.md` with the Read tool, and follow it exactly as if it had been invoked) with:
        - `MODE=link-events`
        - `SESSIONS=UNLINKED`
        - `CONTINUE_WITH="update Part A: read the plot-map report, then end"`
     2. When it has finished, read `.campaign/state/plot-map/report.txt` with the Read tool. The report is for you, never for the master: do not show it or quote it.
     3. If its `status` is `DONE`: add ONE sentence for the master, in the campaign language, in plain words: the sessions have been reorganised so that each scene is its own document, and each session has a map of its scenes. Use only the lexicon words «Sessione» and «Mappa della trama» (English: «Session» and «Plot map»), and the plain words «scena» (English: «scene»). Do not use the words «evento», «file», «migrazione» or «depends_on».
     4. If its `status` is `FAILED`, or any other status: say nothing about it and do not retry. The check runs again the next time the master prepares a session.
   - If `restored_by_hand` is not empty, add in one sentence that a file managed by the assistant was restored, and that their own rules belong in «Your rules».
   - Do not run `generate-instructions` as well.
3. If `status` is `up-to-date`: say nothing.
4. If `status` is `failed` and the first item of `errors` has `code` `interrupted-update`: say the fixed sentence of the lexicon for an earlier update that was not finished. Then offer two choices in plain words: continue the update, or go back to how it was. Write no campaign content until the master chooses.
   - On «continue»: run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/update/scripts/update-campaign.mjs" . --resume`. Read its JSON result and apply step 2 (`updated`) or step 5 (any other failure).
   - On «go back»: run `node "${CLAUDE_PLUGIN_ROOT}/skills/core/update/scripts/update-campaign.mjs" . --cancel`. If `status` is `cancelled`, tell the master in one sentence that everything is as it was before the update.
5. Any other failure, or any other status: say the fixed sentence of the lexicon for an update that could not be applied, which says that nothing was changed (the script has already restored the campaign). Stop writing.

Output: the campaign is aligned (updated, with the scenes linked when `migrated` was not empty, or already up to date), or the master has been told about the problem and nothing was written.

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
  Plugin update command, in Claude Code: `claude plugin update yllir@yllir --json`
  Plugin update command, in Codex: `codex plugin marketplace upgrade yllir --json`
  Run the one for the tool you are running in (you know whether you are Claude Code or Codex). Never run both. These are the only places where the commands are written; change them here if the marketplace name changes.
  - «yes» (any clear consent, for example «sì», «aggiorna», «ok, aggiorna pure»): run the Plugin update command of your tool above, as one single command, exactly as written there.
    If its exit code is 0 (and, in Codex, the JSON `errors` list is empty; if it is not empty, treat it like a non-zero exit code): tell the master in plain words that the update is ready, that they must close and reopen the assistant once for it to start working, and that nothing of theirs changes. Say that the campaign itself is aligned the next time it is opened (the entry skill's Step 4). If the exit code is not 0: say the fixed sentence of the lexicon for an update that could not be applied, which says that nothing was changed.
  - «no» or «later» (or any clear refusal): say that it is fine and that you will mention it again tomorrow. Run nothing.
  - Anything else (a new request): handle it normally with Step 6 of the entry skill. Do not repeat the question.
  Output: the update is ready, or nothing was changed, or nothing was run.
