# Skill di libreria

**Stato:** Bozza di progetto
**Parte di:** [Framework per campagne di GDR](Framework%20per%20campagne%20di%20GDR.md)

## Scopo del documento

Questo file definisce il catalogo delle funzioni del framework: le skill specialistiche che il core richiama per fare un lavoro preciso, insieme ai processi del core, ai moduli opzionali e agli strumenti di output che le affiancano. Il catalogo dice che cosa c'è, in quale strato e perché. Per ogni skill di libreria indica scopo, momento di avvio, input e output, parti deterministiche affidate a script, parti di giudizio affidate all'agente, modello (assegnato solo in [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md)), dipendenze, requisiti e rischi da evitare.

Convenzioni: ciò che è **Deciso** dall'autore è nell'indice; le scelte fatte qui sono **Proposta** e sono segnate come tali. I rischi elencati nelle schede sono ragionamenti sulla forma delle skill: dove si tratta di un'ipotesi sulla causa, è dichiarato. Le verifiche reali richiedono i casi di prova previsti nel documento [Robustezza e test](Robustezza%20e%20test.md).

## Principi comuni alle skill di libreria

Decisi dall'autore (dall'indice):

- nessuna skill esistente si estrae come codice: si ripensa, si generalizza o si scarta;
- le istruzioni devono funzionare con Claude e con Codex;
- i sub-agent sono obbligatori; l'agente principale decide e supervisiona, i modelli economici eseguono sotto revisione;
- ogni scrittura passa da una revisione indipendente di un sub-agent distinto, senza eccezioni (vedi [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md));
- la parte meccanica va in script deterministici; all'agente resta il giudizio;
- il core non contiene nulla di una campagna specifica o di un sistema di gioco.

Proposte:

- **P1, contratto di esito.** Ogni skill di libreria restituisce un esito strutturato: elementi trattati, elementi scartati con motivo, verifiche eseguite (con il comando o lo script), dubbi. Un esito vuoto deve dichiarare la copertura, non limitarsi a «nessun problema». È la risposta proposta al rischio di un audit che non segnala nulla senza dire che cosa ha controllato.
- **P2, revisione con altro host.** Quando un secondo host è disponibile, l'esecutore e il revisore appartengono a host diversi (Claude e Codex). Il revisore riceve evidenze e non il verdetto atteso.
- **P3, nomi di strumento astratti.** Le istruzioni scritte per un solo host usano nomi di strumento legati a quell'host (per esempio `request_user_input_async`, `collaboration.spawn_agent`, `image_gen`, `view_image`, `codex exec`). Nel framework si scrive l'azione («chiedi una decisione all'autore», «avvia un revisore indipendente», «genera un'immagine») e una tabella per host traduce il nome dello strumento.
- **P4, avvio dichiarato.** Ogni skill dichiara se parte in autorun (su un evento dell'utente) o solo se chiamata dal core. La tabella di avvio sta nel file del core, non nella skill.

## Catalogo delle funzioni

Il catalogo elenca le funzioni del framework, non gli strumenti che le realizzano oggi. Ogni voce indica uno strato: **libreria** (skill richiamata dal core), **core** (processo che il master vive), **modulo opzionale** (attivato dalla configurazione della campagna) oppure **da valutare**. «Deciso» indica che l'autore ha già scelto la funzione; la forma di ciascuna resta proposta. Tra parentesi, l'id interno della skill.

### Funzioni di libreria

| Funzione | Strato | Motivazione | Stato |
|---|---|---|---|
| [Ingest di documenti](#l1-ingest-di-documenti) (`document-ingest`) | Libreria, in autorun | Portare in digitale appunti, lettere, mappe, scansioni e PDF già esistenti, e integrarli nelle schede della campagna. | Deciso |
| [Audit di continuità](#l2-audit-di-continuità) (`continuity-audit`) | Libreria, chiamata dal core | Individuare contraddizioni e lacune prima di ogni modifica di documenti canonici. | Deciso |
| [Collegamenti](#l3-collegamenti) (`linker`) | Libreria, chiamata dal core | Collegare ogni menzione di un soggetto alla sua scheda o fonte, senza alterare testo, fatti o regole. | Deciso |
| [Ricerca nel canone](#l4-ricerca-nel-canone) (`canon-research`) | Libreria, sola lettura | Rispondere a domande su chi o che cosa è qualcosa, con prove e limiti. | Deciso |
| [Mappa della trama](#l5-mappa-della-trama) (`plot-map`) | Libreria, chiamata dal core | Vista d'insieme delle dipendenze fra documenti di trama: grafo, tabella, nodi aperti, rami. | Deciso |
| [Intrecci dei PG](#l6-intrecci-dei-pg) (`pc-weaving`) | Libreria, chiamata dal core | Trasformare la scheda di un giocatore in un piano di integrazione con la trama. | Deciso |
| [Schede di luoghi e oggetti](#l7-schede) (`sheets`) | Libreria, chiamata dal core | Creare e aggiornare le schede di luoghi e oggetti, con un blocco riservato al master. | Deciso |
| [Gestione dei PNG](#l14-gestione-dei-png) (`npc-manager`) | Libreria, chiamata dal core | Creare e mantenere personaggi non giocanti, nemici e venditori con schede sempre standardizzate. | Deciso |
| [Artwork](#l8-artwork) (`artwork`) | Libreria, chiamata dal core | Dipingere una creatura o un personaggio partendo da una descrizione verificata, e collegare il dipinto alla scheda. | Deciso |
| [Carte](#l9-carte) (`cards`) | Libreria, chiamata dal core | Creare la carta illustrata di un oggetto o di un annuncio, con il sorgente a livelli accanto all'esportazione. | Deciso |
| [Mappe di luogo e di battaglia](#l11-mappe) (`maps`) | Libreria, chiamata dal core | Creare mappe con livelli separati, per luoghi e scontri. | Deciso |
| [Mappe del mondo](#l11-mappe) (`maps`) | Libreria, chiamata dal core | Modificare una carta del mondo senza alterarne la geometria. | Deciso |
| [Scontri](#l12-scontri) (`combat-tracker`) | Libreria, con adattatore | Tenere lo stato di uno scontro per il master: iniziativa, PF, fasi, condizioni, risorse dei nemici. | Deciso |
| [Bilanciamento degli incontri](#l15-bilanciamento-degli-incontri) (`encounter-balancer`) | Libreria, su richiesta | Ribilanciare scontri e prove quando il master lo chiede, per esempio se cambia il gruppo. | Deciso |
| [Economia](#l16-economia) (`economy-manager`) | Libreria, chiamata dal core | Mantenere il documento di economia del mondo e far sì che prezzi, salari e ricompense delle schede lo rispettino. | Deciso |
| [Dottore della campagna](#l17-dottore-della-campagna) (`campaign-doctor`) | Libreria, su richiesta e nella manutenzione | Analizzare l'intera campagna, riportare problemi narrativi, logici e strutturali e proporre soluzioni. | Deciso |
| [Manutenzione della continuità](#l19-manutenzione-della-continuità) (`continuity-keeper`) | Libreria, chiamata dal core | Rinominare, unire, dividere, spostare e cancellare soggetti, e correggere un fatto stabilito, propagando il cambiamento a tutta la campagna. | Deciso |
| [Registro di sessione](#l18-registro-di-sessione) (`session-log`) | Libreria, durante la sessione live | Registrare fatti, decisioni, intenzioni e fili aperti della partita, anche senza master screen. | Deciso (estratto dal master screen) |
| [Ricerca musicale](#l13-ricerca-musicale) (`music-search`) | Libreria, in autorun alla creazione di un luogo | Proporre più tracce di sottofondo (soprattutto video di ambience) e colonne sonore adatte a un luogo. | Deciso (nice to have) |

### Processi del core, moduli e strumenti di output

| Funzione | Strato | Motivazione | Stato |
|---|---|---|---|
| Sessione live | Core | È il processo che il master vive al tavolo. La realizzazione tecnica (chat, registro, pannelli) appartiene al master screen. | Proposta |
| Master screen | Strumento locale unico | Interfaccia locale unica per chat con l'agente, consultazione, sessione live, musica e stampa. Si costruisce dopo la prima versione. | Deciso (strumento unico); forma Proposta |
| Stampa (`print`) | Modulo opzionale (output fisici) | Fogli di carte (5×7 o A4) e fogli-bacheca, con retro e codici QR, in RGB o CMYK. | Proposta |
| Enciclopedia pubblica | Modulo opzionale (output digitale) | Pagina statica consultabile dai giocatori, costruita da schede con segnaposto e da carte in formato compresso. | Proposta |
| Atlante | Modulo opzionale (output digitale del master) | Indice dei luoghi su una carta, con dati scritti nella configurazione. | Proposta |
| Musica | Modulo opzionale, nel master screen | Colonna sonora di scene e sessioni. | Proposta |
| Stile per output web | Modulo opzionale | Profilo grafico per le pagine di enciclopedia e master screen. Una skill esterna di design per siti web (design-taste-frontend) è un candidato da valutare in quel contesto. | Proposta |
| Vedute e carte nautiche | Da valutare | Output non ancora analizzati. Rientrano nella questione aperta sugli strumenti da confluire. | Da valutare |

Dipendenze richiamate dalle funzioni sopra: adattatore del sistema di gioco, profili di stile, moduli di output (`print`, `encyclopedia`, `master_screen`, `music`) e gerarchia delle fonti. Il loro contenuto è nei documenti [Sistemi di gioco e stili](Sistemi%20di%20gioco%20e%20stili.md) e [Configurazione](Configurazione.md).

## Schede delle funzioni di libreria

Ogni scheda segue lo stesso schema. «Deterministico» indica ciò che deve diventare uno script; «giudizio» ciò che resta all'agente. In **Requisiti** stanno le condizioni che la skill deve soddisfare; in **Rischi da evitare** gli errori di forma che la rendono fragile. I modelli si assegnano solo in [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md).

### L1. Ingest di documenti

- **Scopo:** portare in digitale materiale esistente (appunti, lettere, mappe, scansioni, PDF, trascrizioni), conservando l'originale, trascrivendolo, verificando ogni affermazione e integrandola nelle schede esistenti senza duplicati.
- **Avvio:** autorun, quando l'utente condivide foto, scansioni o documenti. È una decisione dell'autore e va scritta nel core.
- **Input → output:** file originali → cartella di acquisizione con originale, scheda di acquisizione (modello), trascrizione con localizzatori, elenco delle affermazioni con stato, domande aperte, pagine aggiornate, esito.
- **Deterministico:** inventario dei file e dei duplicati (hash); identificativi stabili; confronto fra trascrizione e testo finale (diff) per rilevare omissioni; controllo del modello di acquisizione (campi obbligatori); conteggio dei dubbi aperti.
- **Giudizio:** lettura visiva delle pagine, trascrizione, distinzione fra chi scrive e chi parla, affermazioni da fatti, integrazione e riesame.
- **Modello:** vedi [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md).
- **Dipendenze:** gerarchia delle fonti ([Principi](Principi.md), punti 3, 7 e 8: classi di affermazione, regole di integrazione); configurazione (struttura delle cartelle di destinazione); strumento di lettura PDF dell'host; [audit di continuità](#l2-audit-di-continuità) e [collegamenti](#l3-collegamenti), chiamati in quest'ordine dopo ogni integrazione.
- **Requisiti:**
  - nessun elemento legato a una specifica ambientazione entra nella skill: archivi separati, fonti storiche e regole di canone sono configurazione o gerarchia delle fonti;
  - la cartella di destinazione è letta dalla configurazione del progetto;
  - l'autorun è dichiarato nel core, non nella skill.
- **Rischi da evitare:**
  - un riesame ridotto a un elenco di domande in prosa, senza evidenza registrata, non distingue un riesame svolto da uno saltato: il riesame deve lasciare traccia;
  - un percorso fisso nelle istruzioni lega la skill a un solo progetto: i percorsi vengono dalla configurazione;
  - un modello di acquisizione senza controllo meccanico arriva incompleto alle schede: uno script ne verifica la presenza dei campi.

Collegamento diretto (sidestep): i file già completi non vengono copiati né trascritti. La skill crea un collegamento simbolico all'originale direttamente nella categoria del canone, anche quando l'originale sta fuori dal repository della campagna; in quel caso l'esito avvisa che il backup git non copre quel contenuto. Il criterio è un markdown con front matter valido (verificato da uno script) più il giudizio di un agente economico, che collega solo i documenti finiti e privi di dubbi; nel dubbio il file segue il flusso normale. L'originale collegato non viene mai modificato.

### L2. Audit di continuità

- **Scopo:** individuare contraddizioni e lacune fra documenti e fonti, senza modificare nulla. Sono riportate separatamente le differenze spiegabili (tempo, prospettiva, rivelazione successiva). I documenti delle fonti esterne sono letti come canone in sola lettura e riportati a parte nel conteggio, così che un audit che non ha letto il mondo condiviso si veda.
- **Avvio:** dal core, prima di ogni modifica di documenti canonici; su richiesta esplicita.
- **Input → output:** elenco dei file toccati e corpus → rapporto con gravità, localizzatori relativi, esclusioni applicate, ambito coperto (file letti e piste seguite) e dichiarazione esplicita di ciò che non è stato controllato.
- **Deterministico:** inventario dei file; indice dei soggetti (nomi, alias, appellativi) con tutte le occorrenze; estrazione di valori ripetuti (date, CD, PF, quantità, nomi di luogo) in tabella; applicazione del registro delle esclusioni; elenco dei documenti letti.
- **Giudizio:** confronto semantico, distinzione fra contraddizione diretta, discrepanza e prospettiva diversa.
- **Modello:** vedi [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md).
- **Dipendenze:** gerarchia delle fonti ([Principi](Principi.md), punti 3, 7 e 8); adattatore del sistema di gioco per le regole numeriche; registro delle esclusioni nella configurazione del progetto.
- **Requisiti:**
  - il registro delle esclusioni è configurazione, non prosa della skill;
  - la ricerca trasversale è fatta da uno script di indice dei soggetti, non dalla sola lettura dell'agente;
  - il rapporto dichiara l'ambito coperto: file letti, piste seguite, ciò che non è stato controllato;
  - quando il rapporto non trova nulla, un revisore indipendente verifica la copertura dell'elenco prima di chiudere (proposta; di altro host, se disponibile).
- **Rischi da evitare:**
  - una procedura aperta («segui i filoni») senza lista di controllo né registro di copertura rende un rapporto vuoto indistinguibile da un controllo non fatto: un rapporto vuoto deve dimostrare che cosa ha letto (vedi P1);
  - istruzioni che scoraggiano dal classificare come errore le differenze apparenti spingono al silenzio: le differenze spiegabili vanno riportate a parte, non omesse;
  - un audit senza script di indice dipende dalla memoria di lettura dell'agente. Ipotesi da verificare con casi di prova.

### L3. Collegamenti

- **Scopo:** collegare con link relativi ogni menzione di un soggetto che ha una scheda o una fonte, senza alterare testo, fatti o regole.
- **Avvio:** dal core, dopo ogni scrittura o modifica di Markdown; su richiesta esplicita. Oltre che dal core dopo ogni scrittura, il linker parte quando il controllo a ogni messaggio segnala menzioni non collegate (modifiche a mano, documenti collegati dall'ingest, migrazioni); non scrive mai nei file che sono collegamenti simbolici.
- **Input → output:** documenti toccati e indice dei soggetti → elenco dei candidati con ID ed esito secondo la scala comune di [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md), modifiche applicate, verifica finale.
- **Deterministico:** costruzione dell'indice dei soggetti (`.campaign/cache/subjects.json`, derivato dai campi `aliases` delle schede); ricerca di tutte le occorrenze con posizione; esclusione automatica di titoli, blocchi di codice, commenti HTML, corsivi narrativi (secondo il marcatore del formato) e testo già collegato; applicazione dei link per posizione; verifica che i percorsi risolvano, che le ancore esistano e che il testo fuori dai link sia invariato (diff che ammette soltanto `[`, `](…)`). Il collegamento è bidirezionale: dopo la scrittura di una scheda, lo script include nell'ambito anche tutti i documenti che ne menzionano nome o alias.
- **Giudizio:** se una menzione si riferisce davvero al soggetto; se il link è utile; decisioni di identità (decisione chiesta al master).
- **Modello:** vedi [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md).
- **Dipendenze:** configurazione (convenzione dei corsivi narrativi); gerarchia delle fonti ([Principi](Principi.md), punti 3, 7 e 8) per le identità.
- **Requisiti:**
  - l'agente non cerca le menzioni: riceve dallo script i candidati e decide su ciascuno;
  - le esclusioni (titoli, blocchi di codice, commenti, corsivi narrativi, testo già collegato) sono dati di configurazione, non prosa;
  - gli alias dei soggetti stanno nel campo `aliases` delle schede, non nella memoria della skill;
  - ogni lotto è rivisto da un sub-agent distinto prima di essere applicato, senza eccezioni.
- **Rischi da evitare:**
  - una procedura di collegamenti che si affida alla sola lettura del modello perde menzioni: per questo l'enumerazione delle occorrenze è affidata a uno script. Una menzione non enumerata non entra mai nel lotto, e il revisore non può vederla, perché può solo approvare o respingere le proposte che riceve;
  - una skill che dichiara uno script di supporto ma non lo fornisce lascia tutta la procedura al giudizio;
  - gli alias non definiti in alcuna scheda sono un'ipotesi della causa dei collegamenti mancati, da verificare con esempi concreti.

Le destinazioni dei collegamenti possono essere anche documenti di categorie `external` (fonti esterne: cartelle di un'altra campagna o di materiale condiviso, collegate in sola lettura). Il linker li usa solo come bersaglio: non cerca menzioni al loro interno e non li modifica. Per l'audit di continuità e la ricerca nel canone sono invece canone in sola lettura (deciso il 2026-11-09): vengono letti e confrontati con i documenti della campagna, non vengono mai modificati, e la ricerca dichiara quando una prova viene dal mondo condiviso. Due documenti con lo stesso titolo, uno esterno e uno della campagna, sono omonimi e vanno in revisione al master, come gli altri omonimi. Identificativi e regole sono in [Configurazione](Configurazione.md), sezione «Fonti esterne».

### L4. Ricerca nel canone

- **Scopo:** rispondere a «chi o cosa è», «come sono collegati», «cosa dicono le fonti», «è vero che…», con le prove e i limiti. Cerca anche nelle fonti esterne (canone in sola lettura, deciso il 2026-11-09) e dichiara nella risposta quando una prova viene dal mondo condiviso.
- **Avvio:** dal core, su domanda in linguaggio naturale. Mai in autorun. È in sola lettura.
- **Input → output:** domanda → risposta diretta, prove con file e sezione, informazioni indirette segnalate come tali, ambito coperto, piste non verificate.
- **Deterministico:** ricerca per nome, varianti e alias su tutto il corpus; grafo dei rimandi Markdown estratto dallo script di indice (condiviso con audit e collegamenti); elenco dei documenti letti.
- **Giudizio:** valutazione delle prove e separazione di fatto, affermazione di fonte, interpretazione, ipotesi e silenzio.
- **Modello:** vedi [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md).
- **Dipendenze:** gerarchia delle fonti ([Principi](Principi.md), punti 3, 7 e 8: categorie di fonte); configurazione (quali cartelle sono canone, quali bozze).
- **Requisiti:**
  - il grafo dei rimandi è un indice del framework, condiviso con audit e collegamenti, non uno strumento esterno;
  - le regole sulle categorie di fonte sono configurazione.
- **Rischi da evitare:**
  - una skill che presuppone uno strumento esterno non descritto nel progetto non funziona altrove: ogni dipendenza va dichiarata;
  - il criterio «ogni documento letto per intero» non è verificabile senza un registro di letture: il registro è un output dello script;
  - istruzioni molto lunghe che alternano regole di tono e regole di metodo si perdono: vanno separate, perché il modello economico le segua.

### L5. Mappa della trama

- **Scopo:** mantenere la vista d'insieme della trama: grafo, tabella dei documenti, nodi aperti, rami e rientri. **Proposta (2026-11-09):** genera anche, per ogni sessione, il file principale con la mappa concettuale dei suoi eventi (un file per evento in `Eventi/`, vedi [Formato dei contenuti](Formato%20dei%20contenuti.md), 2.8). Dopo la generazione, un sub-agente indipendente rivede la mappa e le correzioni vanno alle fonti. `plot-map` possiede quindi sia l'analisi della trama sia la generazione delle mappe concettuali delle sessioni, e i suoi script vivono nella sua cartella (`skills/library/plot-map/scripts/`), non in una cartella condivisa.
- **Avvio:** dal core, dopo modifiche che toccano ordine, ingressi, uscite o scelte. Le modifiche interne a una scena non la richiamano. **Proposta (2026-11-09):** la seconda funzione, il collegamento degli eventi (link-events), si avvia dal core dopo la migrazione delle campagne esistenti e alla creazione di nuovi eventi di una sessione.
- **Input → output:** documenti di trama con il loro campo `depends_on` → file della mappa (grafo Mermaid, tabella, nodi aperti) e rapporto di incoerenze.
- **Deterministico:** lettura del campo `depends_on`, generazione del grafo dalle dipendenze, controllo di link rotti, documenti assenti, dipendenze mancanti o cicliche, rigenerazione della tabella. **Proposta (2026-11-09), link-events:** segnalazione delle sessioni con due o più eventi e nessuna dipendenza fra di essi.
- **Giudizio:** quali scelte creano un ramo, dove un ramo facoltativo rientra nel filone principale, quali archi restano aperti. **Proposta (2026-11-09), link-events:** l'agente esamina i testi degli eventi di una sessione e scrive il solo campo `depends_on` dei file evento, con rami, rientri e primi eventi secondo [Formato dei contenuti](Formato%20dei%20contenuti.md), 2.9; non crea, rinomina, unisce né cancella eventi, e non ammette cicli.
- **Modello:** vedi [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md).
- **Dipendenze:** configurazione (formato delle scelte); modello di trama (campo `depends_on` obbligatorio, vedi [Formato dei contenuti](Formato%20dei%20contenuti.md), sezione 2).
- **Requisiti:**
  - il campo `depends_on` è un contratto del modello di trama, non una convenzione letta a mano;
  - lo script è indipendente dalla cartella di lavoro: la radice della campagna si trova da configurazione o da un marcatore, non da un numero fisso di livelli di cartelle;
  - il formato delle scelte è dichiarato, così che rami e rientri siano leggibili dallo script.
- **Rischi da evitare:**
  - un percorso calcolato con livelli fissi si rompe al primo cambio di struttura;
  - scelte e rientri decisi a mano senza formato dichiarato fanno divergere la mappa dai testi senza che nessun controllo lo veda;
  - uno script che segnala ma non corregge lascia la riparazione al giudizio: vanno dichiarate quali correzioni sono meccaniche.

### L6. Intrecci dei PG

- **Scopo:** trasformare la scheda di un giocatore in una scheda di consultazione e in un piano di integrazione (ancore, agganci, segreti innestabili, proposte di canone, domande).
- **Avvio:** dal core, quando il giocatore condivide scheda o background, o su richiesta del master.
- **Input → output:** originali (PDF, foto, testo), conservati in `Fonti/` → scheda `Giocatori/<Nome>.md` con le sezioni del suo modello ([Formato dei contenuti](Formato%20dei%20contenuti.md), 4.8), domande raggruppate.
- **Deterministico:** estrazione dei campi dei PDF; controllo delle sezioni della scheda rispetto al modello; controllo che ogni aggancio abbia gancio, innesco, posta e stato (pronto o da proporre); controllo dei link verso la trama.
- **Giudizio:** trascrizione, scomposizione in affermazioni, classificazione (ancorabile, compatibile, silenzio, conflitto), proposte.
- **Modello:** vedi [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md).
- **Dipendenze:** adattatore del sistema di gioco per i dati meccanici da tenere; configurazione (regole di coerenza dichiarate dal master, per esempio su nomi, divinità o epoche passate); [mappa della trama](#l5-mappa-della-trama).
- **Requisiti:**
  - la scrittura tocca solo la scheda del personaggio e i suoi originali in `Fonti/`; nessuna scheda pubblica la linka;
  - le regole di coerenza sono configurazione;
  - un riassunto del mondo, se la campagna ne ha uno, diventa parte del template di creazione.
- **Rischi da evitare:**
  - la classificazione (ancorabile, compatibile, silenzio, conflitto) affidata a un giudizio senza esempi è instabile: servono esempi di riferimento nella skill;
  - un'indicazione di prudenza non operativa («osa con misura») non cambia il comportamento: va tradotta in criteri verificabili;
  - regole su nomi e divinità di una campagna scritte nella skill non valgono per le altre campagne: vanno in configurazione.

### L7. Schede

- **Scopo:** creare e aggiornare le schede di luoghi e oggetti, con un blocco riservato al master e i collegamenti a immagini e output. Personaggi non giocanti, nemici e venditori sono della [gestione dei PNG](#l14-gestione-dei-png).
- **Avvio:** dal core, su richiesta (nuovo luogo, nuovo oggetto) o dopo una sessione per gli aggiornamenti.
- **Input → output:** dettagli dell'autore, tipo, luogo → scheda Markdown nella categoria giusta, con sezioni obbligatorie del tipo, immagini collegate, esito di validazione.
- **Deterministico:** template per tipo; ricerca del luogo già esistente e dei duplicati prima di creare; nome del file e slug; validazione (sezioni, blocco riservato come ultimo contenuto, segnaposti, percorsi delle immagini che esistono).
- **Giudizio:** prosa, distinzione fra parte pubblica e riservata, cosa conoscono i personaggi.
- **Modello:** vedi [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md).
- **Dipendenze:** adattatore del sistema di gioco (sezioni delle statistiche e degli effetti); profilo di stile e registro della prosa; [economia](#l16-economia) in lettura (prezzi e valore degli oggetti); moduli di output (`print`, `encyclopedia`).
- **Requisiti:**
  - una sola skill con due tipi (luogo, oggetto), con i modelli nel [formato dei contenuti](Formato%20dei%20contenuti.md) (proposta); i prezzi degli oggetti seguono il documento di [economia](#l16-economia);
  - gli attributi di stampa e di enciclopedia non stanno nella skill ma nei moduli di output;
  - lo stato di stampa è letto da un validatore comune, non da ciascuno strumento.
- **Rischi da evitare:**
  - una skill che mescola contenuto e output (stato, formato di stampa, codici QR, enciclopedia) diventa difficile da mantenere: ogni modifica al formato tocca la prosa;
  - lo stato di stampa scritto in più posti diverge: sta solo nel metadato `print` della scheda (vedi [Formato dei contenuti](Formato%20dei%20contenuti.md)).

### L8. Artwork

- **Scopo:** generare un dipinto per una creatura o un personaggio, dalla descrizione verificata, e collegarlo alla scheda.
- **Avvio:** dal core, su richiesta.
- **Input → output:** scheda, tratti visibili, profilo di stile → PNG in `img/`, file del prompt accanto, collegamento Markdown sotto il titolo.
- **Deterministico:** nomi dei file; dimensioni e trasparenza; scrittura del prompt in file; inserimento del collegamento in una sola riga (script); script di generazione con gestione di blocchi e timeout.
- **Giudizio:** descrizione visiva senza segreti; confronto voce per voce fra immagine e descrizione; decisione su correzioni.
- **Modello:** vedi [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md).
- **Dipendenze:** profilo di stile (per creature e per personaggi sono due profili, non due skill); adattatore del sistema di gioco per i dati di taglia e aspetto; script di generazione per host.
- **Requisiti:**
  - l'attivazione passa dal core, non da frasi generiche;
  - gli stili sono profili, e lo script di generazione è un adattatore per host, generalizzato;
  - le correzioni di stile hanno un criterio misurabile (per esempio una lista di tratti da confrontare voce per voce), non solo l'indicazione di rigenerare da zero.
- **Rischi da evitare:**
  - istruzioni specifiche di un solo host (comando di esecuzione, soglie di timeout) fuori dall'adattatore rendono la skill inutilizzabile con l'altro host;
  - correzioni suggerite in prosa, senza criterio, non convergono.

### L9. Carte

- **Scopo:** creare la carta illustrata di un oggetto (titolo, illustrazione, testo) o di un annuncio, con il sorgente a livelli accanto all'esportazione.
- **Avvio:** dal core, dopo la creazione o la revisione di una scheda. Mai in autorun.
- **Input → output:** parte pubblica della scheda (con limite temporale), profilo grafico → coppia PNG e PSD nella `img/` della categoria.
- **Deterministico:** misure e impaginazione del testo (conteggio delle righe con metriche del font); esportazione alla dimensione fissa; nomi delle coppie; controllo dei livelli del PSD; ritaglio della trasparenza.
- **Giudizio:** quale testo mettere sulla carta (ciò che i personaggi sanno al momento scelto); sintesi se il testo è troppo lungo; revisione indipendente del testo.
- **Modello:** vedi [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md).
- **Dipendenze:** profilo di stile (base grafica, font, layout); adattatore del renderer (Photoshop oggi); modulo `encyclopedia` (la parte di regole sta lì, non sulla carta).
- **Requisiti:**
  - il limite «mai modificare la scheda» resta: la carta è un derivato della scheda;
  - il criterio di conoscenza resta: la carta mostra solo ciò che i personaggi sanno al momento scelto;
  - base grafica, font e layout sono profilo di stile; il layout per gli annunci di bacheca è un layout del profilo;
  - le misure del layout sono parametri del profilo, non costanti nel codice.
- **Rischi da evitare:**
  - una composizione legata a un renderer e a un font installato a mano non è riproducibile: il font va dichiarato e verificato;
  - un testo controllato solo a occhio sfugge agli errori di impaginazione: il conteggio delle righe deve usare le metriche del font;
  - istruzioni al sub-agent con un nome di strumento legato a un host non si trasferiscono (vedi P3).

### L10. Stampa

- **Scopo:** produrre fogli di carte (5×7 o A4) e fogli-bacheca, con retro e QR, in RGB o CMYK.
- **Avvio:** solo dal core, su richiesta del master. Non modifica lo stato delle carte: `print` passa a `printed` solo per indicazione dell'autore.
- **Input → output:** carte e metadato `print` → PNG o TIFF, PDF, indice con posto e QR, rapporto con carte escluse e senza QR.
- **Deterministico:** tutto. Il giudizio riguarda solo quali carte includere.
- **Modello:** vedi [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md).
- **Dipendenze:** modulo `print`; profilo di stile (font e gamma); modulo `encyclopedia` (QR verso la voce).
- **Requisiti:**
  - parametri di formato e di tipografia sono in configurazione del modulo;
  - il conteggio dei destinatari delle carte personalizzate viene dall'elenco dei personaggi del progetto;
  - le dipendenze di sistema (strumenti di elaborazione immagini, generatore di QR, font, profilo colore, stampante) sono dichiarate e verificate prima dell'esecuzione.
- **Rischi da evitare:**
  - uno script legato a strumenti di sistema, a un font installato a mano e a una stampante specifica non è portabile;
  - un conteggio fatto contando le cartelle a mano invece di leggere l'elenco dei personaggi sbaglia appena cambia la composizione del gruppo;
  - un formato di annuncio con passaggi manuali (estrazione del testo dal sorgente grafico, elenco scritto a mano) perde sincronia con le schede: va generato dai dati.

### L11. Mappe

- **Scopo:** modificare una carta del mondo senza alterarne la geometria, o creare una mappa di luogo o di battaglia con livelli separati.
- **Avvio:** solo dal core, su richiesta. Il passaggio dal core evita attivazioni su frasi generiche.
- **Input → output:** richiesta, schede di luogo, base grafica → immagini base, file di dati (etichette, territori), anteprime, registro delle modifiche, prompt salvati accanto alle immagini.
- **Deterministico:** rendering di etichette e territori da dati; ritaglio, ricomposizione e maschere; verifica del pixel fuori dalle aree richieste; controllo della costa; esportazione.
- **Giudizio:** quali modifiche fare e con quale fonte; scrittura dei prompt; verifica visiva dei risultati.
- **Modello:** vedi [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md).
- **Dipendenze:** profilo di stile (carta antica o moderna); configurazione dello spazio di coordinate; adattatore del sistema di gioco per le mappe di battaglia (griglia, dimensione del quadretto).
- **Requisiti:**
  - proposta: una sola skill con due modalità (mondo, luogo);
  - l'esportazione verso motori di gioco è scartata nel core; l'atlante passa al modulo di output;
  - il percorso della carta di partenza e lo spazio di coordinate vengono dalla configurazione, e il registro delle modifiche è generato dallo script;
  - le istruzioni che chiedono di mostrare immagini al modello usano un nome di strumento astratto (vedi P3).
- **Rischi da evitare:**
  - una skill molto ampia rispetto all'uso narrativo appesantisce il contesto del modello: le parti di gioco (livelli, collisioni) restano fuori dal core;
  - residui di altre distribuzioni nella cartella (descrizioni per un marketplace, file statistici) confondono chi la legge e vanno eliminati;
  - un registro scritto a mano e un percorso fisso alla carta di partenza rendono la procedura fragile.

### L12. Scontri

- **Scopo:** tenere lo stato di uno scontro per il master (iniziativa, PF, fasi, condizioni, risorse dei nemici), senza tirare dadi e senza scegliere tattiche.
- **Avvio:** dal core, quando il master dichiara l'inizio di uno scontro; durante la sessione live.
- **Input → output:** schede dei nemici, dati oneshot, comandi del master → file di stato dello scontro, tre tabelle (iniziativa, statistiche, opzioni).
- **Deterministico:** tutto lo stato, in un file dati (non in prosa): ordinamento per iniziativa, applicazione di danni e guarigioni, soglie di fase, scadenze delle condizioni, round. Nessun tiro di dadi nel framework se non richiesto da un adattatore.
- **Giudizio:** interpretare un messaggio del master come comando (danno, condizione, fine turno); segnalare le opzioni dei nemici.
- **Modello:** vedi [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md).
- **Dipendenze:** adattatore del sistema di gioco obbligatorio, con un adattatore per sistema (D&D 2024 come primo); schede dei nemici nel formato del sistema.
- **Requisiti:**
  - lo stato dello scontro vive in un file dati, e un solo modulo lo tiene: la funzione di sessione non ne duplica la gestione;
  - la logica di regole passa nell'adattatore; per i PG la configurazione decide quali dati tenere (per esempio solo nome, iniziativa e posizione);
  - un validatore controlla lo stato prima di ogni salvataggio.
- **Rischi da evitare:**
  - regole di un sistema scritte nella skill la legano a quel sistema: vanno nell'adattatore, D&D 2024 incluso;
  - due moduli che tengono lo stato dello stesso scontro divergono;
  - uno stato aggiornato dal modello a ogni messaggio, in forma di prosa, è un punto debole per la coerenza (ipotesi da verificare); senza un validatore nessun errore viene segnalato.

### L13. Ricerca musicale

- **Scopo:** proporre al master più tracce per un luogo: soprattutto video di ambience (taverna, foresta di notte, porto con la pioggia, città sotterranea) e, in seconda battuta, colonne sonore strumentali di giochi o film adatte all'atmosfera. Le canzoni con testo sono escluse salvo richiesta del master.
- **Avvio:** autorun quando si crea un luogo, da qualunque processo (decisione dell'autore, come nice to have). Il master può anche chiederla su un luogo esistente o su una scena. Si attiva solo se il modulo `music` è attivo nella configurazione.
- **Input → output:** parte pubblica della scheda del luogo (atmosfera, clima, ora, pericoli, cultura) e registro della prosa scelto nella configurazione (`prose.register`, vedi [Formato dei contenuti](Formato%20dei%20contenuti.md#19-registro-e-lingua)); il blocco riservato non entra mai nelle ricerche (vedi [Sicurezza e privacy](Sicurezza%20e%20privacy.md)) → da tre a cinque proposte, ciascuna con titolo, autore o canale, durata, tipo (ambience od OST), una riga sul perché si adatta e il link. Le proposte vanno nella scheda del luogo, sotto `### Musica` nel blocco riservato al master: è l'unico posto in cui stanno, e il master screen le legge da lì.
- **Deterministico:** verifica che ogni link esista e sia riproducibile (risposta del servizio, titolo e durata letti dalla piattaforma e non dal modello); scarto dei doppioni e dei link già proposti per altri luoghi, se il master lo preferisce; scrittura della sottosezione nel formato fisso.
- **Giudizio:** tradurre la scheda in parole chiave d'atmosfera; scegliere fra i risultati della ricerca quelli coerenti con il tono; preferire ambience lunghe (indicativamente da un'ora in su) e senza voci per il sottofondo, brani più brevi per i momenti chiave.
- **Modello:** vedi [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md).
- **Dipendenze:** modulo `music`; una capacità di ricerca sul web dell'agente; nessuna dipendenza da Codex.
- **Requisiti:**
  - nessun link inventato: ogni proposta viene da un risultato di ricerca reale ed è verificata dallo script prima di essere scritta;
  - le proposte non sono canone: non toccano la parte pubblica della scheda e non passano dall'audit di continuità;
  - se la ricerca non trova nulla di adatto, la skill lo dice e non riempie la lista con proposte deboli;
  - il master sceglie: la proposta preferita si segna come tale, le altre restano come alternative da provare al tavolo.
- **Rischi da evitare:**
  - URL plausibili ma inesistenti, generati dal modello invece che trovati: è il rischio principale e lo blocca la verifica deterministica;
  - video rimossi o resi privati col tempo: proposta, da confermare, che la manutenzione ricontrolli i link e segnali quelli morti;
  - una ricerca in autorun che rallenta la creazione del luogo: parte dopo che la scheda è scritta e non la blocca.

### L14. Gestione dei PNG

- **Scopo:** creare, aggiornare e tenere uniformi le schede di personaggi non giocanti, nemici e venditori, così che ogni scheda abbia sempre la stessa forma e si possa usare al tavolo senza cercare.
- **Avvio:** dal core, quando serve un nuovo personaggio o una nuova creatura (preparazione, dopo la sessione, ingest, generatori al tavolo quando il master dice «tienilo»), o su richiesta («sistema le schede dei PNG»).
- **Input → output:** dettagli del master, ruolo (PNG, nemico, venditore, creatura), luogo → scheda nella categoria giusta, dal modello del ruolo; per le schede esistenti, un rapporto delle differenze dal modello e la correzione proposta.
- **Deterministico:** modelli per ruolo (sezioni obbligatorie, ordine, metadati); validatore che confronta ogni scheda con il suo modello; ricerca dei duplicati e degli omonimi prima di creare; per i nemici, la forma del blocco statistiche è data dall'adattatore del sistema; per i venditori, il controllo dei prezzi contro il documento di economia; il controllo `plot-cast` verifica che ogni `id` in `characters` degli eventi di trama esista e sia una scheda di personaggio, senza duplicati, e segnala come informazione (mai come errore) i nomi con la maiuscola che non corrispondono a nessun soggetto noto.
- **Giudizio:** personalità, voce, motivazioni, che cosa sa e che cosa nasconde; quale parte è pubblica e quale riservata; quali personaggi nominati nella trama richiedono una scheda; se un testo di trama contraddice la scheda, la discrepanza è una domanda per il master, non una correzione silenziosa.
- **Modello:** vedi [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md).
- **Dipendenze:** adattatore del sistema di gioco (statistiche dei nemici); [economia](#l16-economia) in lettura (inventari e prezzi dei venditori); artwork per i ritratti.
- **Requisiti:**
  - un modello per ruolo, dichiarato dal campo `template` (`npc`, `enemy`, `vendor`, `creature`), e un solo ruolo per scheda: un PNG che vende e combatte usa il modello più ricco e dichiara le sezioni opzionali, invece di avere due schede;
  - una scheda vecchia non si riscrive in silenzio: la standardizzazione propone le differenze e le applica dopo conferma, conservando ogni contenuto;
  - la vista compatta per il tavolo (voce, tic, cosa vuole, cosa sa) è derivata dalla scheda, non scritta a parte;
  - ogni personaggio definito in un documento di trama ha la sua scheda, scritta prima o insieme al primo evento che lo definisce. La scheda è la fonte di verità per l'identità (chi è), non per le azioni in trama, che stanno nei documenti di trama e nella cronaca (vedi [Formato dei contenuti](Formato%20dei%20contenuti.md#26-identità-e-rimandi)).
- **Rischi da evitare:**
  - modelli che si moltiplicano per eccezioni fino a non essere più uno standard;
  - statistiche scritte a mano nella scheda e non validate dall'adattatore;
  - azioni della trama scritte nella scheda (la scheda diventerebbe una seconda trama);
  - identità dei personaggi ridefinita negli eventi.

### L15. Bilanciamento degli incontri

- **Scopo:** ribilanciare scontri e prove quando il master lo chiede: un gruppo più grande o più piccolo, un livello diverso, una sessione troppo facile o troppo dura.
- **Avvio:** solo su richiesta del master, una volta per richiesta («ribilancia la campagna per cinque giocatori», «questo scontro è troppo facile»). Mai in autorun.
- **Input → output:** composizione del gruppo (dai personaggi giocanti), curva di progressione, perimetro scelto (uno scontro, una sessione, un arco, tutta la campagna) → un piano di ribilanciamento: per ogni incontro difficoltà attuale, difficoltà obiettivo e modifiche proposte; dopo conferma, le modifiche applicate alle schede e alle sessioni.
- **Deterministico:** censimento di tutti gli incontri nel perimetro; calcolo della difficoltà con le regole dell'adattatore; confronto con l'obiettivo; elenco dei documenti da toccare.
- **Giudizio:** come raggiungere l'obiettivo senza snaturare l'incontro (più punti ferita, un'azione in più, un gregario in più, terreno), rispettando i vincoli che il master dichiara (per esempio «i boss restano soli»).
- **Modello:** vedi [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md).
- **Dipendenze:** adattatore del sistema di gioco obbligatorio: la difficoltà si calcola solo con un adattatore che la dichiara; [gestione dei PNG](#l14-gestione-dei-png) per le schede dei nemici; [economia](#l16-economia) in lettura, per le ricompense.
- **Requisiti:**
  - il piano si mostra prima di toccare qualunque documento, con una riga per incontro;
  - i vincoli del master valgono per tutto il ribilanciamento e si registrano nel piano;
  - le ricompense e la progressione si ribilanciano insieme agli scontri, se il master lo chiede, seguendo il documento di economia.
- **Rischi da evitare:**
  - incontri dimenticati perché il censimento è fatto a memoria invece che da uno script;
  - numeri di lavoro (budget, punteggi) che finiscono nei testi per i giocatori.

### L16. Economia

- **Scopo:** mantenere un documento di economia del mondo (valute e cambi, prezzi base per categorie di merci e servizi, salari, variazioni per luogo) e far sì che tutte le schede lo rispettino.
- **Avvio:** dal core la prima volta che serve un prezzo, un salario o una ricompensa, e quando il master modifica il documento. Come controllo, ogni volta che una scheda scrive un prezzo, un salario o una ricompensa.
- **Input → output:** decisioni del master sull'economia → `Storia/Economia.md`, l'unico posto in cui stanno le regole economiche; per le schede, un esito di conformità con le differenze e i valori proposti.
- **Deterministico:** tabelle del documento in forma leggibile da uno script; validatore che confronta ogni prezzo, salario e ricompensa delle schede con gli intervalli del documento e con le variazioni del luogo; elenco delle schede da aggiornare quando l'economia cambia.
- **Giudizio:** dare un prezzo a una merce che il documento non prevede, partendo dalle categorie più vicine; spiegare una deroga voluta (un mercato nero, una carestia) e registrarla nella scheda come eccezione motivata.
- **Modello:** vedi [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md).
- **Dipendenze:** nessuna skill di libreria. Lo script elenca le schede da aggiornare; sono poi le skill di PNG, di schede e di bilanciamento, che leggono il documento in lettura, a eseguire il lavoro. Facoltativa: una base di prezzi dall'adattatore del sistema di gioco.
- **Requisiti:**
  - le schede scrivono il prezzo concreto di ciò che descrivono; le regole stanno solo nel documento di economia, e una scheda non le ripete;
  - una deroga è sempre esplicita e motivata nella scheda: il validatore la accetta solo se dichiarata;
  - quando l'economia cambia, nessuna scheda si aggiorna senza che il master veda l'elenco.
- **Rischi da evitare:**
  - prezzi inventati sessione per sessione che divergono fra luoghi vicini;
  - un documento di economia così dettagliato da non essere mantenibile: si parte dalle categorie che la campagna usa davvero (YAGNI).

### L17. Dottore della campagna

- **Scopo:** analizzare l'intera campagna e riportare i problemi, con una soluzione proposta per ciascuno: narrativi (fili lasciati aperti, PNG introdotti e dimenticati, indizi che nessuna strada permette di trovare, finali irraggiungibili), logici (cronologia, geografia, tempi di viaggio, chi sa cosa), strutturali (link rotti, metadati mancanti, file orfani, schede fuori standard, prezzi fuori economia).
- **Avvio:** su richiesta del master («controlla la campagna», «cosa non torna?») e come primo passo del processo di manutenzione. Mai in autorun.
- **Input → output:** tutta la campagna, o il perimetro scelto → un rapporto ordinato per gravità: problema, documenti coinvolti con la prova, una o più soluzioni proposte, e se la soluzione è meccanica o narrativa.
- **Deterministico:** tutti i controlli strutturali; il grafo della trama per gli ingressi, le uscite e i nodi irraggiungibili; il censimento di PNG, indizi e fili aperti fra trama e cronaca; il registro di copertura di ciò che è stato letto.
- **Giudizio:** riconoscere i problemi narrativi e logici, distinguere un mistero voluto da una lacuna, proporre soluzioni coerenti con il canone e con il tono.
- **Modello:** vedi [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md).
- **Dipendenze:** [audit di continuità](#l2-audit-di-continuità) (per le contraddizioni fra fatti), [mappa della trama](#l5-mappa-della-trama), [gestione dei PNG](#l14-gestione-dei-png), [economia](#l16-economia), [collegamenti](#l3-collegamenti); le operazioni che propone (unire duplicati, spostare, cancellare) le esegue la [manutenzione della continuità](#l19-manutenzione-della-continuità).
- **Requisiti:**
  - il dottore riporta e propone, non corregge da solo: le soluzioni meccaniche si applicano con una sola conferma, quelle narrative le sceglie il master una per una;
  - un rapporto senza registro di copertura non può dichiarare «nessun problema»;
  - ciò che il master ha già deciso di lasciare aperto si registra e non si ripresenta alla visita successiva.
- **Rischi da evitare:**
  - un rapporto lunghissimo e piatto: la gravità ordina, e i problemi minori si raggruppano;
  - soluzioni che introducono fatti nuovi presentati come canone: restano proposte finché il master non le sceglie.

### L18. Registro di sessione

- **Scopo:** tenere il registro della partita in corso (fatti accaduti, decisioni dei giocatori, intenzioni, fili aperti) e consegnarlo al processo «dopo la sessione», che ne ricava la cronaca.
- **Avvio:** dal core, quando il master apre una sessione live; vive per tutta la sessione.
- **Input → output:** messaggi del master durante il gioco → voci strutturate in `.campaign/state/`; a fine sessione, la bozza della pagina di `Cronaca/`.
- **Deterministico:** formato delle voci, ordine temporale, collegamento alla scena e ai soggetti citati.
- **Giudizio:** distinguere una domanda, un fatto dichiarato, una correzione e un'ipotesi: le ipotesi e i condizionali non fanno avanzare la partita.
- **Modello:** vedi [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md).
- **Dipendenze:** nessuna obbligatoria; scontri e musica si affiancano se attivi.
- **Requisiti:**
  - funziona dal terminale o dall'app di Claude, senza master screen: lo schermo ne è solo una vista;
  - il registro non è canone e non tocca le schede durante la sessione.
- **Rischi da evitare:**
  - un registro che il master deve correggere a mano perché scambia ipotesi per fatti.

### L19. Manutenzione della continuità

- **Scopo:** eseguire le operazioni che cambiano la forma del canone senza romperne la continuità: rinominare un soggetto, unire due schede che descrivono lo stesso soggetto, dividerne una in due, spostare un luogo nella gerarchia del mondo o un soggetto in un altro luogo, cancellare un soggetto, correggere un fatto già stabilito (un retcon) e propagarlo.
- **Avvio:** dal core, quando il master lo chiede («Ilde Varno e Ilde Sarto sono la stessa persona», «il porto ora sta nella Costa di Selce», «togli quel mercante», «in realtà il faro è stato costruito cento anni prima»), o quando il master accetta un'operazione proposta da un rapporto del [dottore della campagna](#l17-dottore-della-campagna).
- **Input → output:** operazione e soggetti coinvolti → un piano che elenca ogni documento toccato e come; dopo conferma, le modifiche applicate, i collegamenti aggiornati e un esito di verifica.
- **Deterministico:**
  - censimento di tutti i riferimenti al soggetto (link, menzioni dall'indice dei soggetti, metadati `location` e `depends_on`);
  - spostamento e rinomina dei file, aggiornamento dei link relativi;
  - gestione degli `id` secondo le regole sotto;
  - verifica finale: nessun link rotto, nessun riferimento al soggetto vecchio rimasto fuori dalle eccezioni previste, nessun `id` riusato.
- **Giudizio:** nell'unione, quale versione di un fatto prevale quando le due schede divergono (lo decide il master se la differenza tocca il canone); nella divisione, a quale delle due parti appartiene ciascuna menzione; nel retcon, quali documenti cambiano davvero significato e quali no.
- **Modello:** vedi [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md).
- **Dipendenze:** [audit di continuità](#l2-audit-di-continuità) prima e dopo; [collegamenti](#l3-collegamenti) per le menzioni; [mappa della trama](#l5-mappa-della-trama) quando cambia una sessione; [gestione dei PNG](#l14-gestione-dei-png) e schede per il formato.
- **Regole sugli `id`** (una sola fonte, nessun riferimento esterno rotto):
  - *rinomina* e *spostamento*: l'`id` non cambia mai;
  - *unione*: sopravvive l'`id` della scheda che resta; l'altro si registra nei suoi metadati come `merged_ids`, così QR stampati e route dell'enciclopedia portano alla scheda che resta;
  - *divisione*: la parte principale conserva l'`id`; la nuova parte riceve un `id` nuovo;
  - *cancellazione*: l'`id` non si riusa mai; se il soggetto ha una carta già stampata, la cancellazione chiede una conferma esplicita e la route mostra che la voce non è più disponibile.
- **Regole sulla storia:**
  - la `Cronaca/` racconta ciò che è successo e non si riscrive: i link si aggiornano, il testo resta com'era, con il nome usato allora;
  - le schede e la `Trama/` ancora da giocare si aggiornano al nuovo canone;
  - un retcon che contraddice qualcosa già giocato si segnala al master prima di procedere: è una scelta narrativa, non un'operazione meccanica.
- **Requisiti:**
  - il piano si mostra prima di toccare qualunque documento, con l'elenco dei file e una riga per ciascuno;
  - un'operazione è una sola versione salvata: «torna a com'era» la annulla per intero;
  - nessun contenuto si perde: nell'unione i dettagli presenti in una sola scheda passano nella scheda che resta.
- **Rischi da evitare:**
  - riferimenti dimenticati perché cercati a memoria invece che dall'indice dei soggetti;
  - un retcon applicato come rinomina meccanica, che cambia anche ciò che i giocatori hanno già vissuto.

## Questioni aperte

- **Manutenzione della continuità:** un retcon richiede sempre la conferma documento per documento, o basta il piano complessivo? Proposta: il piano complessivo, con conferma singola solo per i documenti già giocati.
- **Gestione dei PNG e schede:** le creature non ostili (animali, cavalcature) stanno nella gestione dei PNG o nelle schede? Proposta: nella gestione dei PNG, con il ruolo «creatura» (`template: creature`).
- **Economia:** serve una sola valuta di riferimento per i confronti?
- **Ricerca musicale:** fonti ammesse (solo YouTube o anche altre piattaforme) e lingua delle ricerche.
- **Mappe:** una skill con due modalità o due skill? La scelta incide sulla dimensione della skill, non sul risultato.
- **Stampa:** libreria attivata da un modulo, o modulo puro? Nel documento è trattata come modulo opzionale con una skill di esecuzione; confermare.
- **Modelli:** l'assegnazione dei modelli è in [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md), dove si discutono le scelte da confermare.
- **Autorun:** oltre all'ingest e alla ricerca musicale (entrambe decise), deve partire da sola anche la ricerca nel canone su certe domande? Proposta: no.
- **Esclusioni dell'audit:** **Deciso (2026-11-07):** il registro sta in `campaign.yaml`, nella sezione `audit.exclusions` (vedi [Configurazione](Configurazione.md)).
- **Funzioni da valutare:** vedute e carte nautiche entrano nel catalogo come funzioni o restano fuori? Da decidere insieme alla questione aperta dell'indice sugli strumenti da confluire.
