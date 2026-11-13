# Gestione delle sessioni

**Stato:** Bozza di progetto
Riscritto dopo la [Riprogettazione](Riprogettazione.md) (2026-11-11).
**Parte di:** [Framework per campagne di GDR](Framework%20per%20campagne%20di%20GDR.md)

## Scopo

Una conversazione con un agente ha una finestra di contesto limitata, e a un certo punto il riassunto automatico della conversazione rischia di perdere decisioni e dettagli del canone. Il master non deve occuparsene. Questo documento descrive come il framework garantisce la continuità del lavoro: il master resta in una sola chat continua, senza organizzare le proprie richieste e senza gesti particolari. Questo vale per il terminale e l'app di Claude; nel master screen la gestione delle conversazioni è decisa nella sezione «Conversazioni nel master screen». Dalla Riprogettazione la continuità non passa più per argomenti e handoff, ma per il pacchetto di contesto del motore e per una nota sul lavoro in corso (vedi sotto).

## Decisioni dell'autore

- **Deciso.** Il framework gestisce da solo le finestre di contesto: il master può restare in un'unica conversazione senza alcun gesto, e non deve sapere che esistono sessioni. È l'obiettivo «sessioni gestite dal framework» dell'[indice](Framework%20per%20campagne%20di%20GDR.md). Per il master screen il punto «un'unica conversazione» è superato dalla decisione del 2026-11-13 (vedi «Conversazioni nel master screen»); resta valido per il terminale e l'app di Claude.
- **Deciso.** Il master non scrive «riprendiamo» e non apre conversazioni nuove. **Superata per il master screen (2026-11-13):** lì il master apre ed elimina conversazioni, vedi sotto. Resta valida per il terminale e l'app di Claude.
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

Nulla del meccanismo. Al massimo una riga come «Riprendo da dove avevamo lasciato la taverna». Le parole sessione, contesto, nota, handoff e sub-agent non compaiono mai (vedi il glossario in [Principi](Principi.md)). Nel master screen la parola mostrata è «conversazione» (vedi la sezione seguente).

## Conversazioni nel master screen

**Deciso (2026-11-13).** Nel master screen il master gestisce le conversazioni con l'agente in modo normale. Questa decisione supera, solo per il master screen, le decisioni «il master resta in un'unica conversazione» e «il master non apre conversazioni nuove» della sezione «Decisioni dell'autore». Per il terminale e l'app di Claude restano valide.

- **Creare ed eliminare.** Il master può creare una conversazione nuova ed eliminarne una. Più conversazioni esistono una accanto all'altra: nella pagina della chat il master sceglie da un elenco quale continuare.
- **Parola per il master.** Il master vede la parola «conversazione». Mai «sessione»: nel suo vocabolario «sessione» è una giocata (vedi il glossario in [Principi](Principi.md)).
- **Titolo.** La conversazione prende il titolo dal primo messaggio del master. Non si rinomina (YAGNI).
- **Contesto nuovo.** Ogni conversazione è una sessione separata dell'agente e parte con un contesto vuoto. Non riporta la storia delle conversazioni precedenti: la continuità sta nei documenti, nel pacchetto di contesto del motore e nella nota sul lavoro in corso (`.campaign/state/work-note.md`).
- **Eliminare.** Eliminare una conversazione rimuove solo la sua cronologia di chat. Le modifiche già fatte ai documenti restano, e il master lo legge in parole semplici prima di confermare. Il master screen chiede conferma.
- **Una scrittura alla volta.** La coda dei turni resta una per campagna: due conversazioni non scrivono il canone nello stesso momento. Un messaggio inviato mentre un'altra conversazione lavora attende, e lo schermo lo dice.
- **Tavolo e scontri invariati.** La conversazione del tavolo resta una per sessione live. Ogni scontro ha la sua, che nasce col primo messaggio dello scontro e si chiude quando lo scontro finisce (vedi «Sessione live e scontri» in [Master screen](Master%20screen.md)).
- **Assistenti al lavoro.** Mentre l'agente lavora, il master vede un indicatore compatto degli assistenti (i sub-agent) attivi: quanti sono e una frase semplice per ciascuno su che cosa stanno facendo, senza termini tecnici. L'indicatore sta nella pagina della chat e, quando il master è su un'altra pagina, nella barra di navigazione, così sa che l'agente è ancora al lavoro. Nell'interfaccia non compare mai la parola «sub-agent».

## Fuori dalla prima versione (YAGNI)

- Cronologia navigabile delle sessioni passate.
- Scritture in parallelo di più conversazioni sulla stessa campagna: i turni restano in coda uno alla volta per campagna (decisione del 2026-11-13, vedi «Conversazioni nel master screen»).

Sono fuori dalla prima versione anche, per la Riprogettazione, gli argomenti attivi multipli, i cambi automatici di argomento e l'unione o divisione di argomenti: non esistono più.

## Questioni aperte

- ~~Soglia di riempimento.~~ **Deciso (2026-11-07):** nessuna soglia. Il riepilogo per riprendere si aggiorna a ogni passo importante, e dopo un riassunto automatico l'hook di avvio (che parte anche su `compact`) ricarica l'argomento attivo.
- **Superata dalla Riprogettazione (decisione 15, 2026-11-11):** Durata di un argomento chiuso. Non ci sono più argomenti chiusi né handoff da archiviare: la nota si sostituisce a ogni salvataggio.
- **Superata dalla Riprogettazione (decisione 15, 2026-11-11):** Se la sessione live debba restare un argomento unico. Non ci sono più cambi di argomento automatici da limitare.
- **Superata dalla Riprogettazione (2026-11-11):** Quale strumento usare per le sessioni vere e se il lanciatore anticipi il master screen. Le sessioni possedute dal framework sono state tolte; il master screen non è nella prima versione.
- **Aperta (aggiunta con questa riscrittura, 2026-11-11).** La nota sul lavoro in corso è una sola per campagna. Se due conversazioni scrivono sulla stessa campagna, la nota dell'una può sovrascrivere quella dell'altra: va deciso se basta l'ultima scrittura o se la nota va divisa per conversazione. Il master screen la rende più urgente (decisione del 2026-11-13): ogni conversazione riparte da un contesto vuoto e la nota è l'unico ponte fra l'una e l'altra, mentre oggi la nota è sovrascritta a ogni salvataggio. La questione resta aperta.
