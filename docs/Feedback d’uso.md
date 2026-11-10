# Feedback d’uso

Il feedback serve a individuare gli attriti di ogni uso delle skill, senza affidarsi a stime aggregate. Il registro resta nella campagna, sotto `.campaign/state/feedback/`.

## Copertura

Gli hook attuali registrano l’inizio e la fine della richiesta in Claude Code. Nessun hook disponibile segnala l’avvio o la conclusione di una singola skill; Codex non riceve questi eventi nel cablaggio attuale. La copertura per skill è quindi esplicita: il chiamante registra inizio e fine, anche quando una skill viene eseguita leggendo il suo file di istruzioni. Non va dichiarata una copertura automatica fornita dagli hook.

Ogni invocazione ha un identificatore, il nome della skill, il suo modello quando noto, il riferimento all’invocazione chiamante, l’esito e gli orari. Una skill annidata usa come `parent` l’identificatore del chiamante; ogni tentativo ripetuto riceve un nuovo identificatore. Gli esiti comprendono completamento, completamento parziale, fallimento, blocco e domanda in attesa. Un avvio senza fine resta visibile come invocazione incompleta. Se il comando di feedback viene rifiutato o fallisce, il lavoro prosegue e la copertura non viene dichiarata.

## Trascrizioni e rapporti locali

Il chiamante conserva nel file locale di trascrizione il testo disponibile in ingresso e in uscita, insieme ai passaggi osservabili: chiamate e risultati degli strumenti, decisioni, ripetizioni e revisioni. Le parti non disponibili si indicano come tali; non si ricostruiscono né si inventano. La trascrizione descrive ciò che il chiamante ha potuto osservare e non garantisce un dump completo della sessione del runtime. Non include ragionamenti interni nascosti.

Le trascrizioni, i nomi dei file, gli attriti e i dettagli possono contenere testo della campagna, comprese le note riservate al master. Restano in `.campaign/state/feedback/`, esclusi dal controllo delle versioni e senza invio automatico in rete. Questa conservazione locale è stata autorizzata dall’autore il 2026-11-10 e sostituisce per le trascrizioni di feedback la precedente restrizione ai soli metadati descritta in Robustezza e test. Il rapporto locale può mostrare le trascrizioni su richiesta. Le esportazioni non comprendono mai il corpo delle trascrizioni, gli ingressi, gli esiti testuali, gli artefatti o i problemi: questi campi possono riportare contenuti della campagna o note riservate. L’esportazione dettagliata, scelta esplicitamente, aggiunge solo identificatori di invocazione, relazioni padre-figlio, nomi delle skill, modello, stato e disponibilità della trascrizione.

## Comandi per lo sviluppatore

Il registro storico resta compatibile: `summary` continua a riassumere le richieste e le note di feedback già raccolte. Per leggere le invocazioni per skill:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/feedback.mjs" report .
node "${CLAUDE_PLUGIN_ROOT}/scripts/feedback.mjs" report . --include-transcripts yes
```

Il primo mostra conteggi per skill, invocazioni concluse e incomplete senza i corpi delle trascrizioni. Il secondo legge le trascrizioni locali. L’esportazione mantiene per impostazione predefinita l’aggregato storico; `--include-details yes` aggiunge i soli metadati per skill descritti sopra. Entrambe le modalità escludono testi e percorsi sensibili.
