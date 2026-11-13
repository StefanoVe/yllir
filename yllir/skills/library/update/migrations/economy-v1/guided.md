# Economy question (economy-v1)

Guided part of the migration `economy-v1`. Follow the rules in `${CLAUDE_PLUGIN_ROOT}/skills/library/update/post-update.md` (commands and writes, questions, result). Run the commands of this file exactly as written, from the campaign root, with `${CLAUDE_PLUGIN_ROOT}` for the plugin root.

The campaign language is `language.main` in `campaign.yaml`. `it` means Italian; any other value means English. Use the matching names everywhere below.

## Steps

1. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/economy-question.mjs" . --status`. Read its `status`:
   - `present` or `deferred`: the question is settled. Go to Completion.
   - `open`: go on with step 2.
2. The question is open. Read `campaign.yaml` (Read tool) and take the key `system.adapter`. If it is set and is not `none`, read `${CLAUDE_PLUGIN_ROOT}/modules/systems/<adapter id>/adapter.yaml` (Read tool) and take the key `economy.reference_item`, label `it` for Italian and `en` for English. If there is no adapter, or no such key, the food is «un pasto semplice» (Italian) or «a simple meal» (English).
3. Ask the master ONE question, in ONE message, with the exact wording of the campaign language, putting the food in place of `{cibo}` / `{food}`:
   - Italian: «Con quali valute si paga nel mondo, e quanto vale una rispetto alle altre (per esempio «una corona vale dieci scudi»)? E quanto costa in quelle valute «{cibo}»? Puoi anche rispondere «più tardi»: ne riparliamo quando servirà un prezzo.»
   - English: «Which currencies are used in the world, and how much is one worth compared to the others (for example «one crown is worth ten silver»)? And how much does «{food}» cost in them? You can also answer «later»: we will come back to it when a price is needed.»
   Then STOP this step. The migration stays pending. Do not write anything.
4. If the master has not answered the question of step 3 yet, stop here with the migration pending. Otherwise read the answer:
   - «later», «più tardi», or any answer that does not name at least one currency AND one price: the answer is later. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/economy-question.mjs" . --defer`. Its `status` must be `deferred`. Go to Completion.
   - Otherwise (at least one currency and one price): go on with step 5.

## Draft of the economy document

5. Find the economy folder. Read `campaign.yaml` (Read tool).
   - If its `structure` list has an entry with `type: free`, its `folder` is the economy folder. Do not change `campaign.yaml`.
   - If it has no `type: free` entry, the economy folder is `Storia` (Italian) or `History` (English). Add this entry at the END of the `structure` list, keeping every other line exactly as it is:
     Italian:
     ```yaml
       - id: storia
         folder: Storia
         type: free
     ```
     English: `id: history`, `folder: History`.
     Write the whole file to `.campaign/drafts/campaign.yaml` (Write tool). Then `campaign.yaml` is part of the batch of step 8.
6. Write the economy document with the Write tool at `.campaign/drafts/<economy folder>/<file name>`. The file name is `Economia.md` (Italian) or `Economy.md` (English). The document has exactly this shape, every table with a header row and a separator row:
   - Metadata block first, in the comment form: `<!-- yllir`, then `id: economia`, then `provenance: master`, then `-->`.
   - Title: `# Economia` (English `# Economy`).
   - `## Valute` (English `## Currencies`), columns `Valuta`, `Equivalenza`, `Nota` (English `Currency`, `Equivalence`, `Note`). The first currency the master names is the unit of account: its row says `unità di conto` (English `unit of account`). Every other currency has a row with how many units of the unit currency one piece of it is worth, written `<number> <unit currency form>`, with `.` as decimal separator. The master's words «una corona vale dieci scudi» make the crown the unit, and the scudo row says `0.1 corone`. The `Nota` cell is empty unless the master gave a note. A currency cell may give two written forms joined by ` / `, for example `corona / corone`.
   - `## Prezzi base` (English `## Base prices`), columns `Categoria`, `Minimo`, `Massimo`, `Unità` (English `Category`, `Minimum`, `Maximum`, `Unit`). One row for the reference food of step 2, with `Minimo` and `Massimo` both equal to the price the master gave, as a plain number (`2`, `0.5`, never `2 scudi`), unless the master gave a range. The `Unità` cell is the unit-of-account currency (the first currency named, for example `corona`), never a time or a measure.
   - `## Salari` (English `## Wages`): header row and separator row only.
   - `## Variazioni per luogo` (English `## Variations by place`): header row and separator row only.
   - Master block last: `<!-- master -->`, `## Master`, `### Indicazioni per il master` (the same in English), one line saying that the prices come from the first interview, then `<!-- /master -->`.

   Example (Italian, the master said «Usiamo corone e scudi: una corona vale dieci scudi. Una razione costa due scudi.»):

   ```markdown
   <!-- yllir
   id: economia
   provenance: master
   -->

   # Economia

   ## Valute

   | Valuta | Equivalenza | Nota |
   | --- | --- | --- |
   | corona / corone | unità di conto | |
   | scudo / scudi | 0.1 corone | |

   ## Prezzi base

   | Categoria | Minimo | Massimo | Unità |
   | --- | --- | --- | --- |
   | Razione (un giorno) | 2 | 2 | corona |

   ## Salari

   | Mestiere | Paga | Periodo |
   | --- | --- | --- |

   ## Variazioni per luogo

   | Luogo | Fattore | Motivo |
   | --- | --- | --- |

   <!-- master -->
   ## Master

   ### Indicazioni per il master

   I prezzi vengono dalla prima intervista: una corona vale dieci scudi, e una razione costa due scudi.
   <!-- /master -->
   ```

   Never add a fact the master did not give. Never invent a currency, a price or a range.
7. Check the drafts the Write-cycle way of `post-update.md`: `engine.mjs check . --files "<paths>"` with the economy document path (campaign-relative, without `.campaign/drafts/`), and `campaign.yaml` too when step 5 changed it. If the check fails, correct the draft once and check again. If it still fails, do not write: stop with the migration pending, and say so in the result.
8. Write the batch through the write cycle of `post-update.md`: independent review by `yllir:batch-reviewer`, then `commit` with the same `--files`, and the version message «Economia: valute e prezzo di base dalla prima intervista» (English: «Economy: currencies and base price from the first interview»). No `--note`.
9. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/economy-question.mjs" . --status`. Its `status` must be `present`. Go to Completion.

## Completion

When the question is settled (`present` or `deferred`), run `node "${CLAUDE_PLUGIN_ROOT}/skills/library/update/scripts/update-campaign.mjs" . --complete economy-v1`. Report the migration complete only when its JSON `status` is `complete`.

## Result

Your message to the master says only, in the campaign language:
- when the economy was written: that the currencies and the price of the reference food are saved, with the names of the currencies and the price as the master gave them;
- when deferred: one sentence that the prices will be set when a price is first needed («la definiremo quando servirà un prezzo» / «we will set it when a price is first needed»);
- any question you asked, and that the migration is still pending when the draft did not pass.

Do not mention steps, scripts, drafts, reviews or markers.
