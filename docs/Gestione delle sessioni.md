# Gestione delle sessioni

**Stato:** Bozza di progetto
**Parte di:** [Framework per campagne di GDR](Framework%20per%20campagne%20di%20GDR.md)

## Scopo

Una conversazione con un agente ha una finestra di contesto limitata, e a un certo punto il riassunto automatico della conversazione rischia di perdere decisioni e dettagli del canone. Il master non deve occuparsene. Questo documento descrive come il framework gestisce da solo il ciclo di vita delle sessioni: il master resta in una sola chat continua, senza organizzare le proprie richieste e senza gesti particolari.

## Decisioni dell'autore

- **Deciso.** Il framework gestisce automaticamente le finestre di contesto: riconosce quando cambia argomento, salva un handoff prima di ogni riassunto automatico e lo ricarica dopo. Il master può restare in un'unica conversazione senza alcun gesto, e non deve sapere che esistono sessioni.
- **Deciso.** Il master non scrive più «riprendiamo» e non apre conversazioni nuove.
- **Deciso.** Il master può comunque usare più sessioni se vuole: il framework le riconosce e le riprende tramite l'indice degli argomenti.

## Due strade, a seconda dell'ambiente

### Prima versione: la portineria

**Deciso (2026-11-07).** Ogni processo che scrive gira in un sub-agent esecutore; la portineria riconosce l'argomento, passa il riepilogo per riprendere e riporta l'esito al master. Verificato: in Claude Code un sub-agent può avviare altri sub-agent (revisori, estrattori), quindi i processi mantengono la propria revisione indipendente.

**Proposta (testo originale).** Nel terminale o nell'app di Claude, da dentro una sessione l'agente non può aprirne un'altra né svuotare la propria: sono gesti dell'utente (da verificare sulle versioni reali degli strumenti). La sessione che il master vede resta quindi una sola, e fa da portineria:

1. Riceve il messaggio del master e lo attribuisce a un argomento (vedi sotto). Il modello economico propone l'attribuzione, e l'agente principale, che è la portineria, decide.
2. Non esegue il lavoro di persona: lo affida a un sub-agent che parte con un contesto pulito e riceve soltanto l'handoff di quell'argomento e il pacchetto dei documenti necessari. Il pacchetto segue la regola di visibilità del blocco riservato in [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md).
3. Il sub-agent lavora, aggiorna l'handoff e restituisce un riepilogo di poche righe.
4. La portineria conserva solo i riepiloghi, quindi la sua finestra cresce lentamente.
5. Se il master torna su un argomento precedente, la portineria riprende lo stesso sub-agent se è ancora disponibile, altrimenti ne avvia uno nuovo dall'handoff.

È la stessa disciplina che un utente esperto applica a mano, spostata dentro il framework. È coerente con la decisione che i sub-agent siano obbligatori (vedi [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md)).

**Limite.** Anche la portineria accumula contesto. Quando si avvicina alla soglia (vedi «Finestra piena»), il framework salva l'handoff della conversazione prima del riassunto automatico e lo ricarica dopo. La sessione si allunga così quanto serve, senza che il master faccia nulla.

### Con il master screen o un lanciatore: sessioni vere

**Proposta.** Quando il framework ha un proprio programma (il [master screen](Master%20screen.md) o un lanciatore da terminale), può possedere le sessioni: le avvia, le riprende e le chiude da sé tramite gli strumenti per avviare agenti da un programma (da verificare).

- Al cambio di argomento chiude la sessione corrente scrivendo l'handoff, ne apre una nuova con l'handoff come primo contenuto e archivia la vecchia.
- Il master vede comunque una sola chat continua; sotto ci sono tante sessioni corte.

## Pezzi comuni

### Riconoscere il cambio di argomento

**Proposta.** A ogni messaggio un modello economico confronta la richiesta con il riepilogo dell'argomento attivo e con l'indice degli argomenti, e propone uno di questi esiti. L'agente principale, cioè la portineria, decide.

| Esito | Esempio | Azione |
|---|---|---|
| Stesso argomento | «aggiungi un oste alla taverna» mentre si lavora alla taverna | Prosegue |
| Nuovo argomento | «ora prepariamo lo scontro al ponte» | Handoff dell'argomento attivo, nuovo argomento |
| Ritorno | «torniamo alla taverna di prima» | Handoff dell'argomento attivo, ripresa dell'argomento indicato |
| Domanda veloce | «come si chiamava il fabbro?» | Risponde senza cambiare argomento |

Regole:

- nel dubbio si resta sull'argomento attivo: frammentare troppo costa più che continuare;
- un ritorno ambiguo («quella cosa di ieri») si risolve mostrando al master due o tre argomenti recenti, con una riga ciascuno;
- il master può sempre dire «restiamo su questo» o «è un'altra cosa», e il framework obbedisce.

### Finestra piena

**Proposta.** Anche senza cambio di argomento, sopra una soglia di riempimento della finestra (per esempio il 60–70%, da tarare) il framework salva l'handoff e prosegue sullo stesso argomento con l'handoff ricaricato, prima che intervenga il riassunto automatico dell'ambiente. Se l'ambiente non espone il riempimento, si usa una stima: numero di scambi e dimensione dei documenti letti.

### L'handoff

**Proposta.** L'handoff è un file, l'unica fonte dello stato di un argomento: `.campaign/state/topics/<id>.md`. Contiene:

- obiettivo dell'argomento, in una frase;
- decisioni prese dal master, con le sue parole quando contano;
- file toccati, con le impronte, così che una sessione nuova si accorga se nel frattempo sono cambiati;
- che cosa è fatto e che cosa resta;
- domande in sospeso per il master;
- prossimo passo.

Regole:

- si aggiorna a ogni passo importante, non solo alla chiusura: un'interruzione improvvisa non perde nulla;
- non ripete il contenuto dei documenti: rimanda ai file, che restano la fonte di verità;
- è scritto per essere letto da un agente che non sa nulla, quindi in modo esplicito, anche per i modelli minori e per il servizio alternativo di programmazione.

### Indice degli argomenti

**Proposta.** `.campaign/state/topics/index.md` elenca gli argomenti aperti e chiusi, con una riga ciascuno, la data dell'ultima attività e l'identificativo della sessione o del sub-agent da riprendere. È derivato dagli handoff. Serve per riconoscere i ritorni, per il riepilogo «dove eravamo rimasti» all'apertura (vedi [Esperienza utente](Esperienza%20utente.md)) e per riconoscere le sessioni che il master ha scelto di usare.

### Ganci dell'ambiente

**Proposta, da verificare.** Gli hook di Claude Code all'avvio della sessione, all'invio di un messaggio e prima della compattazione servirebbero rispettivamente a caricare l'handoff dell'argomento attivo, a far girare il riconoscimento dell'argomento e a forzare il salvataggio dell'handoff prima del riassunto automatico. Il comportamento reale va verificato, e per gli altri ambienti va trovato l'equivalente; se un gancio manca, il core esegue lo stesso passo come prima azione di ogni turno.

### Cosa vede il master

Nulla del meccanismo. Al massimo una riga come «Riprendo da dove avevamo lasciato la taverna». Le parole sessione, contesto, handoff e sub-agent non compaiono mai (vedi il glossario in [Principi](Principi.md)).

## Fuori dalla prima versione (YAGNI)

- più argomenti attivi in parallelo: ce n'è uno attivo alla volta, più la possibilità di tornare a uno precedente;
- unione o divisione automatica di argomenti;
- una cronologia navigabile delle sessioni passate.

## Questioni aperte

- ~~Soglia di riempimento.~~ **Deciso (2026-11-07):** nessuna soglia. Il riepilogo per riprendere si aggiorna a ogni passo importante, e dopo un riassunto automatico l'hook di avvio (che parte anche su `compact`) ricarica l'argomento attivo.
- Durata di un argomento chiuso: per quanto tempo l'handoff resta riprendibile prima di essere considerato concluso e archiviato.
- Se la sessione live (vedi [Processi di core](Processi%20di%20core.md)) debba restare sempre un argomento unico, senza cambi automatici durante il gioco. Proposta: sì; le domande veloci al tavolo non cambiano argomento.
- Quale strumento usare per le sessioni vere nella seconda strada, e se il lanciatore da terminale anticipi il master screen.
