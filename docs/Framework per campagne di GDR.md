# Framework per campagne di GDR

**Stato:** To do
**Creato:** 2026-11-07.

## Obiettivo

Costruire un framework per creare e mantenere campagne di gioco di ruolo, non legato a D&D né a un sistema in particolare. Deve poterlo usare anche un master che non ha mai usato un’intelligenza artificiale e non sa cosa sia un orchestratore, un commit o una skill: tutta la complessità resta sotto il cofano, e ciò che il framework produce deve essere fatto bene senza che l’utente sappia come.

Questo documento raccoglie l’idea e le decisioni prese finora; non avvia il lavoro.

## Documenti della specifica

Questo file è l’indice: raccoglie le decisioni dell’autore, che sono vincolanti. I documenti seguenti le sviluppano in dettaglio; ciò che vi è marcato come **Proposta** resta da approvare, e ognuno chiude con le proprie questioni aperte.

| Documento | Contenuto |
|---|---|
| [Principi](Principi.md) | Principi di progetto e glossario dei termini interni, con la parola che vede il master |
| [Architettura](Architettura.md) | Strati core, libreria e moduli; struttura del pacchetto e di un progetto-campagna; flusso di una richiesta |
| [Formato dei contenuti](Formato%20dei%20contenuti.md) | Regole comuni dei documenti, convenzioni dei testi di trama, modelli per tipo di scheda, controlli |
| [Configurazione](Configurazione.md) | File di configurazione della campagna, istruzioni generate da template, personalizzazioni dell’utente |
| [Processi di core](Processi%20di%20core.md) | Nuova campagna, preparazione, sessione live, dopo la sessione, manutenzione, import di materiale, completamento di una scheda (**Proposta**) |
| [Skill di libreria](Skill%20di%20libreria.md) | Catalogo e schede delle skill specialistiche |
| [Sistemi di gioco e stili](Sistemi%20di%20gioco%20e%20stili.md) | Adattatori dei sistemi di gioco e profili di stile visivo |
| [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md) | Agente principale, esecutori economici, revisori, Claude e Codex |
| [Esperienza utente](Esperienza%20utente.md) | Uso da parte di chi non programma: ingresso, onboarding, lessico, versioni, dialoghi d’esempio |
| [Aggiornamenti e migrazioni](Aggiornamenti%20e%20migrazioni.md) | Versioni, controllo all’avvio, migrazioni, skill di update |
| [Robustezza e test](Robustezza%20e%20test.md) | Modi di fallimento noti di collegamenti e audit, script deterministici, casi di prova |
| [Integrazioni esterne](Integrazioni%20esterne.md) | Photoshop MCP, fornitori di immagini alternativi a Codex, altre skill utili |
| [Sicurezza e privacy](Sicurezza%20e%20privacy.md) | Contenuti non fidati, chiavi e segreti, cosa esce dal computer, pubblicazione, permessi, dati dei giocatori |
| [Installazione e requisiti](Installazione%20e%20requisiti.md) | Requisiti minimi e per modulo, installazione guidata, controlli all’avvio, disinstallazione |
| [Gestione delle sessioni](Gestione%20delle%20sessioni.md) | Cambio automatico di argomento, handoff fra sessioni, finestre di contesto gestite senza il master |
| [Master screen](Master%20screen.md) | La GUI locale futura e le funzioni che vi confluiscono |

## Decisioni dell’autore

- **YAGNI e una sola fonte di verità per ogni cosa.** Il framework contiene solo ciò che serve oggi; ogni informazione ha un solo posto e tutto il resto è derivato e si rigenera (vedi [Principi](Principi.md)).
- **Il framework è scritto in inglese, la campagna in qualunque lingua.** Skill, istruzioni, codice, nomi interni e documentazione del framework sono in inglese; le campagne, i documenti generati e i messaggi al master sono nella lingua scelta nella configurazione.
- **L’intervista iniziale crea solo i file core.** Configurazione, istruzioni, scheda radice del mondo e poco altro; tutto il resto lo costruisce il master poco alla volta, quando gli serve (vedi [Processi di core](Processi%20di%20core.md#1-nuova-campagna-intervista-guidata)).
- **Sessioni gestite dal framework.** Il master resta in un’unica chat senza organizzare le richieste: il sistema di gestione del contesto riconosce i cambi di argomento e allunga molto la stessa sessione, passandosi da solo gli handoff, senza chiedere gesti al master. Se il master lo vuole, può comunque usare più sessioni, che il framework riconosce e riprende (vedi [Gestione delle sessioni](Gestione%20delle%20sessioni.md)).
- **Git dalla prima creazione, backup solo con git.** La creazione della campagna inizializza sempre un repository git locale, e il framework fa commit automaticamente quando lo ritiene giusto. Lo storico git è il backup; l’unica copia remota possibile è un repository git remoto privato dell’utente, se vuole attivarlo. Senza git il framework non scrive.
- **Revisione indipendente sempre.** Ogni scrittura passa da una revisione indipendente di un sub-agent distinto, senza eccezioni.
- **Codex è facoltativo.**
- **Consenso una volta, all’attivazione.** Il consenso a far uscire dati dal computer si chiede quando si attiva un’integrazione, in linguaggio semplice, ed è revocabile; non a ogni invio (vedi [Sicurezza e privacy](Sicurezza%20e%20privacy.md)).
- **Note riservate e agenti.** Gli agenti che lavorano sul canone vedono anche il blocco riservato; non lo ricevono mai i revisori dei testi destinati ai giocatori, i fornitori di immagini, le ricerche web e i servizi di pubblicazione (vedi [Principi](Principi.md)).
- **Interfacce semplici.** Icone con tooltip invece di testi, niente complessità non richiesta.
- **Navigazione a scelta.** Il master può muoversi da solo nelle cartelle della campagna, con un editor qualunque, oppure usare il master screen. La struttura resta quindi leggibile a mano: Markdown semplice e link relativi standard (vedi [Architettura](Architettura.md#3-campagna-generata)).
- **Si progetta da zero.** Eventuali skill e strumenti già esistenti servono al più come ispirazione, indicata dall’autore in fase di costruzione; non si estrae codice e non si eredita una struttura.
- **Ingest di documenti in autorun.** Il framework porta in digitale una campagna scritta su file, quaderni o foto: trascrive il materiale, lo integra nelle schede e lo collega in automatico. È una skill di libreria che parte da sola quando l’utente condivide foto, scansioni o documenti.
- **Skill robuste.** Collegamenti e audit di continuità devono funzionare in modo ripetibile: una funzione di collegamenti che perde menzioni o un audit che non segnala mai nulla, mentre gli errori capitano, sono i modi di fallimento da evitare. Le istruzioni devono funzionare sia con Claude sia con Codex, che ha bisogno di istruzioni molto più esplicite.
- **Tabelle delle statistiche (Deciso, 2026-11-10).** Nelle schede, sotto `## Statistiche`, i dati si presentano in tre tabelle localizzate: «Caratteristica» / «Valore» (`Characteristic` / `Value`), «Attacco o capacità» / «Dettagli» (`Attack or ability` / `Details`) e «Oggetto» / «Dettagli» (`Item` / `Details`) per l’equipaggiamento. Le statistiche possono comparire anche nelle schede di PNG e venditori, quando pertinenti; restano validi i requisiti esistenti per i PNG che combattono, i segnaposto e la dichiarazione di assenza di statistiche per creature non combattenti.
- **Conversione dopo l’aggiornamento (Deciso, 2026-11-10).** Dopo l’aggiornamento, il framework individua automaticamente le schede con statistiche nel formato precedente e le converte: i passaggi meccanici sono deterministici, Luna prepara la prosa necessaria e un revisore indipendente controlla la bozza nel cablaggio di scrittura. Valori, personalizzazioni, assortimenti dei venditori e separazione delle note riservate restano invariati. Le ambiguità restano in sospeso e il lavoro può riprendere senza duplicare modifiche; la migrazione è reversibile con git.
- **Un unico master screen fatto a modo.** Le funzioni di consultazione, sessione live, musica e stampa si riuniscono in un solo strumento progettato da zero, invece che in strumenti separati e abbozzati.
- **Destinatari.** Chiunque voglia creare una campagna, di D&D o di un altro GDR, con un mondo talmente dettagliato che a mano sarebbe ingestibile, anche senza alcuna conoscenza di intelligenza artificiale o di programmazione.
- **Prima versione nel terminale o nell’app di Claude.** Il terminale e l’interfaccia di Claude bastano: non si parte subito con strumenti GUI dedicati.
- **Più agenti, con ruoli distinti.** Il framework supporta Claude e Codex insieme, e i sub-agent sono obbligatori. Un agente principale con un modello di alto livello prende le decisioni e supervisiona; l’esecuzione (scrittura del codice e lavoro in serie) va a modelli economici come Haiku o Luna, sotto la sua revisione. Le istruzioni delle skill devono quindi essere abbastanza esplicite da funzionare anche con i modelli minori.
- **Non solo skill proprie.** Il framework include anche skill e integrazioni di terze parti utili, come l’MCP di Photoshop, e la generazione di immagini non deve dipendere per forza da Codex (vedi [Integrazioni esterne](Integrazioni%20esterne.md)).
- **Ricerca musicale in autorun (nice to have).** Quando si crea un luogo, una skill cerca sottofondi (soprattutto video di ambience più che canzoni) e colonne sonore adatte, e offre più proposte fra cui il master sceglie (vedi [Skill di libreria](Skill%20di%20libreria.md#l13-ricerca-musicale)).
- **Skill aggiuntive** (vedi [Skill di libreria](Skill%20di%20libreria.md)):
  - `encounter-balancer`, il bilanciamento degli incontri: gira una volta, quando il master chiede di ribilanciare;
  - `economy-manager`, l'economia: la campagna ha un documento di economia del mondo, e le schede lo seguono;
  - `npc-manager`, la gestione di PNG, nemici e venditori, così che le schede siano sempre standardizzate;
  - `campaign-doctor`, il dottore della campagna: analizza e riporta problemi narrativi, logici e strutturali, e offre soluzioni;
  - `continuity-keeper`, la manutenzione della continuità: rinomina, unisce, divide, sposta e cancella soggetti e corregge fatti stabiliti, propagando il cambiamento senza rompere link, QR e storia.
- **Gli strumenti della sessione live sono generici.** Registro, scontri, musica e consultazione rapida sono funzioni di libreria usabili anche senza master screen; lo schermo ne è solo una vista (vedi [Master screen](Master%20screen.md)).
- **Perimetro dell'MVP (2026-11-07).**
  - **Si parte dalla robustezza.** Prima vengono gli script deterministici (indice dei soggetti, scansione delle menzioni, verifica dei link, validatori), la testbench con le trappole seminate e le skill `linker` e `continuity-audit` con i loro casi di prova. Dopo viene una fetta sottile del core: `new-campaign`, il cablaggio di scrittura, il generatore delle istruzioni e il ripristino. Infine `prepare-session` e `after-session` in forma minima.
  - **Il formato dei contenuti è adottato in via provvisoria.** Valgono i metadati minimi, il blocco `## Master` in fondo alla scheda, le categorie piatte con `Mondo/` a cascata e `subjects.json`, come descritti in [Formato dei contenuti](Formato%20dei%20contenuti.md) e [Architettura](Architettura.md). Si rivedono dopo le prime misure.
  - **Il pacchetto è un plugin per Claude Code e per Codex.** La forma esatta va verificata su entrambi gli strumenti.
  - **Nessun adattatore di sistema di gioco nell'MVP (2026-11-07, superato).** C'è solo il core agnostico. L'adattatore di D&D 2024 è ora installato e si applica fin dall'intervista, se il gioco scelto corrisponde (vedi [Processi di core](Processi%20di%20core.md), «Nuova campagna»).
  - **Fetta di core (2026-11-07).** Portineria (ingresso, «dove eravamo rimasti», «torna a com'era»), `new-campaign` e cablaggio di scrittura. La gestione automatica di argomenti e riepiloghi per riprendere ([Gestione delle sessioni](Gestione%20delle%20sessioni.md)) entra nella fetta successiva, insieme a `prepare-session`.
  - Restano fuori dall'MVP il master screen, artwork, carte, stampa, mappe, musica, enciclopedia e ingest. Resta previsto l’aggiornamento di `version.yaml`; la conversione delle statistiche in tabelle è una trasformazione post-aggiornamento approvata (vedi [Aggiornamenti e migrazioni](Aggiornamenti%20e%20migrazioni.md)).
- **GUI dedicata e locale, in un secondo momento.** Resta un nice to have: una versione snella del master screen in cui si chatta con l’agente e si vedono le sue modifiche in tempo reale. Tutto gira in locale, sul computer dell’utente.
- **Fantasia del modello, bloccata per default (Deciso, 2026-11-10).** L'agente non inventa nulla che le fonti non danno. La sua capacità creativa si sblocca solo per conto del master, con tre condizioni in quest'ordine:
  - (a) il master chiede esplicitamente di inventare, o di scegliere lui (per esempio «inventa tu»): vale per quella richiesta sola, e la configurazione non cambia;
  - (b) la configurazione ha `allow_model_imagination: true`, che decide senza domande; con `false` non si inventa, salvo la richiesta esplicita del punto (a), che vale per quella sola richiesta;
  - (c) con `allow_model_imagination: null` (il valore predefinito, anche se la chiave manca), prima di ogni aggiunta o modifica il framework chiede con una domanda a quattro risposte: Sì / No / Sempre sì / Sempre no. «Sì» e «No» valgono per quella richiesta sola; «Sempre sì» e «Sempre no» si salvano nella configurazione come `true` e `false`.
  - Il campo vale per la preparazione della sessione, il completamento di una scheda e l'import (per le schede dei personaggi creati lì). Non vale mai per la cronaca dopo la sessione né per la trascrizione fedele dell'ingest.
  - Quando la fantasia è sbloccata, cadono i limiti sul non inventare (nomi, storia, relazioni, segreti, statistiche, prezzi, bottino). Restano: il canone non si contraddice (l'audit di continuità e il revisore fermano le contraddizioni); segreti e contenuti riservati stanno solo nel blocco master; un'invenzione non si presenta mai come citazione di una fonte; il master è avvisato in una frase di che cosa è stato inventato.
  - Senza permesso (valore `no`, o risposta «No») il framework non inventa nulla, nemmeno le proposte brevi. Una lacuna di una scheda resta «Da definire» e il messaggio dice che il master può chiedere di inventarla. Un personaggio che la scena richiede ma che il master non ha nominato resta senza nome e senza scheda: la scena lo chiama per ruolo.

## Architettura

Modello di riferimento: Baltimora, il framework di skill usato al lavoro dall’autore per i progetti Angular. Gli strati core / libreria / moduli e il meccanismo di aggiornamento sono decisioni dell’autore; la forma del file di configurazione e delle istruzioni generate è una proposta.

- **Skill di core.** Definiscono i processi che il master vive, con nomi comprensibili: nuova campagna (intervista breve che crea solo i file core), preparazione della sessione, sessione live, dopo la sessione (riepilogo, canone, conseguenze), manutenzione, completamento di una scheda (**Proposta**). L’utente parla in linguaggio naturale e non chiama mai una skill per nome.
- **Skill di libreria.** Fanno una cosa specifica e vengono richiamate dal core: ingest di documenti, audit di continuità, collegamenti, ricerca nel canone, mappa della trama, intrecci dei PG, schede di luoghi e oggetti, gestione dei PNG, artwork, carte, stampa, mappe, tracker degli scontri, registro di sessione, e le skill aggiuntive sopra. Le regole di lavoro (audit prima di modificare, collegamenti dopo, mappa della trama aggiornata) sono il cablaggio interno del core, non istruzioni che l’agente deve ricordarsi.
- **Moduli opzionali, attivati dalla configurazione della campagna:**
  - adattatori del sistema di gioco (scontri, risorse, difficoltà, progressione);
  - profili di stile per artwork e carte;
  - output fisici e digitali: stampa, enciclopedia pubblica, master screen.
- **Configurazione della campagna (proposta).** Un file con lingua, registro della prosa, sistema, categorie e struttura delle cartelle, profili di stile e regole del canone. Le istruzioni per l’agente si generano da un template invece di essere scritte a mano; le regole aggiunte dall’utente vivono in un file separato.
- **Aggiornamenti come in Baltimora.** Il progetto registra la versione del framework. All’avvio un controllo automatico confronta la versione con l’ultima pubblicata e chiede all’utente se vuole aggiornare; una skill di update applica in ordine le migrazioni dichiarate (spostamenti, rinomine, nuovi formati), aggiorna i collegamenti e verifica il risultato. I file del framework si sovrascrivono; i contenuti dell’utente si toccano solo tramite migrazioni reversibili, e le sue personalizzazioni mai.

## Piano di lavoro

- [ ] **Definire il catalogo delle funzioni:** per ogni funzione decidere se è core, libreria o modulo opzionale (vedi [Skill di libreria](Skill%20di%20libreria.md)).
- [ ] **Rendere robusti collegamenti e audit.** Spostare la parte meccanica su script deterministici (per esempio un indice dei soggetti per trovare tutte le menzioni) e lasciare all’agente solo il giudizio.
- [ ] **Misurare la robustezza.** Scrivere per ogni skill casi di prova con l’esito atteso, da eseguire sia con Claude sia con Codex, così che un cambiamento alle istruzioni si possa verificare.
- [ ] **Progettare l’ingest di documenti:** trascrizione, provenienza verificabile, integrazione nelle schede esistenti, audit ripetuti e domande esplicite sui dubbi. Le fonti finiscono nella struttura della campagna definita dalla configurazione, e i collegamenti passano dalla skill dei collegamenti.
- [ ] **Definire l’orchestrazione dei modelli:** quali passaggi di ogni processo decide l’agente principale e quali delega ai modelli economici, come si fa la revisione e come si distribuisce il lavoro fra Claude e Codex. I compiti si assegnano per punti di forza del modello, non solo per costo: secondo le osservazioni dell’autore, Luna rende bene con ImageGen e nelle revisioni, ma male nella scrittura di schede in serie.
- [ ] **Definire il modello di configurazione** e il template delle istruzioni generate.
- [ ] **Definire l’astrazione del sistema di gioco.** Scegliere fra adattatori per pochi sistemi noti e un modello generico (risorse, orologi, tracce) che copra anche i giochi narrativi; partire da D&D 2024 come primo adattatore.
- [ ] **Progettare l’esperienza di chi non programma:** punto d’ingresso unico, onboarding con una sessione di prova, nessun gergo tecnico nei messaggi, salvataggio delle versioni invisibile con un «torna a com’era» in linguaggio naturale, riepilogo «dove eravamo rimasti» all’apertura, import di appunti, PDF e foto già esistenti tramite l’ingest di documenti, separazione automatica fra materiale pubblico e note del master.
- [ ] **Progettare il meccanismo di aggiornamento:** versione, controllo all’avvio, formato delle migrazioni, skill di update, distribuzione (plugin e marketplace di Claude Code o altro).
- [ ] **Costruire il master screen**, dopo la prima versione, come unico strumento locale: chat con l’agente, modifiche visibili in tempo reale, consultazione della campagna, sessione live, musica, stampa.
- [ ] **Scegliere nome e repository** del framework.

## Domande aperte

- Quali altre funzioni confluiscono nel master screen oltre a consultazione, sessione live, musica e stampa (enciclopedia pubblica, atlante, vedute illustrate dei luoghi, carte nautiche)? Ancora da vedere.
- **Fantasia del modello senza lo strumento di domanda.** La decisione del 2026-11-10 dice che, se l'agente non ha lo strumento di domanda interattivo (per esempio in Codex, se non lo espone), il valore resta `no` e nulla viene chiesto in testo. Resta da decidere se il master debba essere avvisato in una frase che la fantasia è bloccata, o se il silenzio va bene.

## Criteri di completamento

- [ ] Un master che non ha mai usato un’IA crea una campagna, prepara e gioca una sessione e la aggiorna dopo il gioco senza incontrare termini tecnici.
- [ ] Collegamenti e audit hanno casi di prova che passano in modo ripetibile.
- [ ] Un aggiornamento del framework si propone e si applica da solo, senza perdere né alterare i contenuti dell’utente.
- [ ] Nessun riferimento a un mondo o a un sistema di gioco specifico resta nel core; D&D 2024 è soltanto un adattatore.
