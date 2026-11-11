# Gestione delle sessioni

**Stato:** Bozza di progetto
Riscritto dopo la [Riprogettazione](Riprogettazione.md) (2026-11-11).
**Parte di:** [Framework per campagne di GDR](Framework%20per%20campagne%20di%20GDR.md)

## Scopo

Una conversazione con un agente ha una finestra di contesto limitata, e a un certo punto il riassunto automatico della conversazione rischia di perdere decisioni e dettagli del canone. Il master non deve occuparsene. Questo documento descrive come il framework garantisce la continuità del lavoro: il master resta in una sola chat continua, senza organizzare le proprie richieste e senza gesti particolari. Dalla Riprogettazione la continuità non passa più per argomenti e handoff, ma per il pacchetto di contesto del motore e per una nota sul lavoro in corso (vedi sotto).

## Decisioni dell'autore

- **Deciso.** Il framework gestisce da solo le finestre di contesto: il master può restare in un'unica conversazione senza alcun gesto, e non deve sapere che esistono sessioni. È l'obiettivo «sessioni gestite dal framework» dell'[indice](Framework%20per%20campagne%20di%20GDR.md).
- **Deciso.** Il master non scrive «riprendiamo» e non apre conversazioni nuove.
- **Deciso (Riprogettazione, decisione 15, 2026-11-11).** Argomenti e handoff spariscono. Per riprendere il lavoro bastano il pacchetto di contesto del motore e una nota breve sul lavoro in corso, che il motore aggiorna a ogni salvataggio.
- **Deciso (indice, «Sessioni gestite dal framework»).** Il master può usare più sessioni, e il framework le riprende.
- **Superata dalla Riprogettazione (decisione 15, 2026-11-11).** Il riconoscimento dei cambi di argomento, gli handoff salvati prima di ogni riassunto automatico e l'indice degli argomenti: argomenti e handoff spariscono. Il meccanismo è sostituito, l'obiettivo no.
- **Proposta.** La ripresa di più conversazioni avviene dalla nota sul lavoro in corso e dal pacchetto di contesto. Il riconoscimento di una conversazione «ripresa» non è descritto.
- **Deciso (2026-11-09).** Una sessione non ancora giocata si può rivedere scena per scena, su richiesta del master; una sessione già giocata no, e il framework glielo dice in parole semplici.

## Come lavora il framework

**Deciso (Riprogettazione, architettura, 2026-11-11).** L'autore è l'agente principale, nella stessa conversazione del master: scrive direttamente mondo, schede e scene. Non c'è più un sub-agent che esegue il processo al suo posto. I modelli economici eseguono solo ordini precisi (per esempio espandere una riga della scaletta in una scheda) e non portano la continuità: quella sta nel pacchetto di contesto e nella nota.

**Superata dalla Riprogettazione (2026-11-11).** Le due strade della prima stesura. La «portineria» (**Deciso (2026-11-07)** nella prima stesura: un agente riceveva ogni messaggio, lo attribuiva a un argomento e affidava il lavoro a un sub-agent con l'handoff) è sostituita dal lavoro diretto dell'autore, perché argomenti e handoff spariscono (decisione 15) e il sub-agent che esegue il processo è rimosso. Le «sessioni vere» con il master screen o un lanciatore dipendevano dagli handoff e da sessioni possedute dal framework: il master screen non è nella prima versione (vedi [Installazione e requisiti](Installazione%20e%20requisiti.md), sezione 2).

## La continuità: pacchetto di contesto e nota sul lavoro in corso

**Implementato in 0.30.0.** Due strumenti sostituiscono argomenti e handoff.

1. **Pacchetto di contesto.** Il comando `context` del motore, dato ciò che si sta per scrivere (soggetti, luogo, sessione), restituisce: il seme del mondo, i soggetti vicini nel grafo, la cronologia pertinente, i fili aperti dell'ultima pagina di cronaca, gli abbozzi, i soggetti non trovati e gli errori del grafo che riguardano il fuoco. Si ricalcola ogni volta dai documenti: non è una copia da tenere aggiornata.
2. **Nota sul lavoro in corso.** Un file breve, `.campaign/state/work-note.md`, con una riga `note:` che dice che cosa è in corso e che cosa resta. Il motore la aggiorna a ogni salvataggio (`commit`), con il testo che l'autore passa nel salvataggio. La nota non è canone: vive in `.campaign/state/`, come gli altri stati di lavoro.

I documenti restano la fonte di verità. Il pacchetto e la nota dicono solo da dove riprendere.

**Proposta.** La nota è scritta per un agente che non sa nulla del lavoro precedente: una riga per ciò che è in corso, senza ripetere il contenuto dei documenti.

## Ganci dell'ambiente

**Implementato in 0.30.0.** Il pacchetto dichiara tre hook di Claude Code (`yllir/hooks/hooks.json`):

- **All'avvio, alla ripresa, dopo `/clear` e dopo la compattazione del contesto** (`startup|resume|clear|compact`). Il controllo della cartella riporta lo stato della campagna, la versione, eventuali aggiornamenti e la nota sul lavoro in corso (riga `work note:`), e chiede all'assistente di invocare il processo di ingresso prima di rispondere al master. Dopo un riassunto automatico, quindi, la nota viene ricaricata da sola.
- **A ogni messaggio del master.** Il controllo del turno riporta la nota e, in una riga, i file della campagna con menzioni non ancora collegate. È di sola lettura.
- **Alla fine di ogni turno.** Registra solo la trascrizione del feedback, se è attiva (vedi [Configurazione](Configurazione.md), «Trascrizioni del feedback»). Altrimenti non fa nulla.

I due controlli di lettura non scrivono nella campagna. Non esiste un ripiego per ambienti senza hook: la distribuzione è solo Claude Code (decisione 11 della Riprogettazione).

## Cosa vede il master

Nulla del meccanismo. Al massimo una riga come «Riprendo da dove avevamo lasciato la taverna». Le parole sessione, contesto, nota, handoff e sub-agent non compaiono mai (vedi il glossario in [Principi](Principi.md)).

## Fuori dalla prima versione (YAGNI)

- Cronologia navigabile delle sessioni passate.
- Più conversazioni che lavorano in parallelo sulla stessa campagna, finché la questione aperta sotto non è decisa.

Sono fuori dalla prima versione anche, per la Riprogettazione, gli argomenti attivi multipli, i cambi automatici di argomento e l'unione o divisione di argomenti: non esistono più.

## Questioni aperte

- ~~Soglia di riempimento.~~ **Deciso (2026-11-07):** nessuna soglia. Il riepilogo per riprendere si aggiorna a ogni passo importante, e dopo un riassunto automatico l'hook di avvio (che parte anche su `compact`) ricarica l'argomento attivo.
- **Superata dalla Riprogettazione (decisione 15, 2026-11-11):** Durata di un argomento chiuso. Non ci sono più argomenti chiusi né handoff da archiviare: la nota si sostituisce a ogni salvataggio.
- **Superata dalla Riprogettazione (decisione 15, 2026-11-11):** Se la sessione live debba restare un argomento unico. Non ci sono più cambi di argomento automatici da limitare.
- **Superata dalla Riprogettazione (2026-11-11):** Quale strumento usare per le sessioni vere e se il lanciatore anticipi il master screen. Le sessioni possedute dal framework sono state tolte; il master screen non è nella prima versione.
- **Aperta (aggiunta con questa riscrittura, 2026-11-11).** La nota sul lavoro in corso è una sola per campagna. Se due conversazioni scrivono sulla stessa campagna, la nota dell'una può sovrascrivere quella dell'altra: va deciso se basta l'ultima scrittura o se la nota va divisa per conversazione.
