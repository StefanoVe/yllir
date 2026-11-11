# Feedback d’uso

**Stato:** Bozza di progetto. Riscritto dopo la [Riprogettazione](Riprogettazione.md) (2026-11-11).
**Parte di:** [Framework per campagne di GDR](Framework%20per%20campagne%20di%20GDR.md)

Il feedback serve a individuare gli attriti dell’uso, senza affidarsi a impressioni. Il registro resta nella campagna, sotto `.campaign/state/feedback/`, e solo quando la raccolta è accesa.

## Stato dopo la Riprogettazione

- **Registrazione spenta per default** (**Deciso**, 2026-11-11, decisione 17). Trascrizioni ed eventi si scrivono solo in due casi: in sviluppo, con la variabile d’ambiente `YLLIR_FEEDBACK=1` (usata dal testbench), oppure quando il master lo chiede, con il file `.campaign/state/feedback/on`. Questo modifica la decisione «Trascrizioni locali del feedback» dell’[indice](Framework%20per%20campagne%20di%20GDR.md) (2026-11-10).
- **Fuori dal percorso normale** (**Deciso**, 2026-11-11, [Riprogettazione](Riprogettazione.md), sezione 9): il protocollo di feedback per skill non viene eseguito a ogni richiesta. Quello che segue descrive il meccanismo di sviluppo, quando la raccolta è accesa; è **Proposta** per la parte non ancora verificata sul motore riscritto.
- Il framework è distribuito solo come plugin per Claude Code (decisione 11). Non ci sono più copertura e comandi per Codex.

## Copertura

Gli hook di Claude Code registrano l’inizio e la fine della richiesta. Nessun hook disponibile segnala l’avvio o la conclusione di una singola skill. La copertura per skill è quindi esplicita: il chiamante registra inizio e fine, anche quando una skill viene eseguita leggendo il suo file di istruzioni. Non va dichiarata una copertura automatica fornita dagli hook.

Ogni invocazione ha un identificatore, il nome della skill, il suo modello quando noto, il riferimento all’invocazione chiamante, l’esito e gli orari. Una skill annidata usa come `parent` l’identificatore del chiamante; ogni tentativo ripetuto riceve un nuovo identificatore. Gli esiti comprendono completamento, completamento parziale, fallimento, blocco e domanda in attesa. Un avvio senza fine resta visibile come invocazione incompleta. Se il comando di feedback viene rifiutato o fallisce, il lavoro prosegue e la copertura non viene dichiarata.

## Trascrizioni e rapporti locali

Quando la raccolta è accesa, il chiamante conserva nel file locale di trascrizione il testo disponibile in ingresso e in uscita, insieme ai passaggi osservabili: chiamate e risultati degli strumenti, decisioni, ripetizioni e revisioni. Le parti non disponibili si indicano come tali; non si ricostruiscono né si inventano. La trascrizione descrive ciò che il chiamante ha potuto osservare e non garantisce un dump completo della sessione del runtime. Non include ragionamenti interni nascosti.

Le trascrizioni, i nomi dei file, gli attriti e i dettagli possono contenere testo della campagna, comprese le note riservate al master. Restano in `.campaign/state/feedback/`, esclusi dal controllo delle versioni e senza invio automatico in rete. Il rapporto locale può mostrare le trascrizioni su richiesta. Le esportazioni non comprendono mai il corpo delle trascrizioni, gli ingressi, gli esiti testuali, gli artefatti o i problemi: questi campi possono riportare contenuti della campagna o note riservate. L’esportazione dettagliata, scelta esplicitamente, aggiunge solo identificatori di invocazione, relazioni padre-figlio, nomi delle skill, modello, stato e disponibilità della trascrizione.

Questa conservazione locale, autorizzata dall’autore il 2026-11-10, vale solo con la raccolta accesa (decisione 17).

## Comandi per lo sviluppatore

Il registro storico resta compatibile: `summary` continua a riassumere le richieste e le note di feedback già raccolte. Per leggere le invocazioni per skill:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/feedback.mjs" report .
node "${CLAUDE_PLUGIN_ROOT}/scripts/feedback.mjs" report . --include-transcripts yes
```

Il primo mostra conteggi per skill, invocazioni concluse e incomplete senza i corpi delle trascrizioni. Il secondo legge le trascrizioni locali. L’esportazione mantiene per impostazione predefinita l’aggregato storico; `--include-details yes` aggiunge i soli metadati per skill descritti sopra. Entrambe le modalità escludono testi e percorsi sensibili.

## Questioni aperte

- Se e come inviare il registro d’uso all’autore: un pacchetto di diagnosi con consenso e redazione (vedi [Sicurezza e privacy](Sicurezza%20e%20privacy.md), sezione 8). Oggi il registro resta solo locale e spento per default. **Non deciso.**
