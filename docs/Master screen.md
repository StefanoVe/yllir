# Master screen

**Stato:** Bozza di progetto

**Parte di:** [Framework per campagne di GDR](Framework%20per%20campagne%20di%20GDR.md)

## Scopo

Questo documento descrive il master screen: la parte del framework che il master usa per consultare la campagna, seguire una sessione e vedere il lavoro dell'agente mentre accade. Riunisce in un unico strumento le funzioni che altrimenti si dividerebbero fra più programmi separati (musica, stampa, consultazione) e le fa convergere con la chat con l'agente.

È una specifica ad alto livello. Non fissa tecnologie, layout definitivi né dettagli di implementazione: quelli si decidono quando la fase corrispondente parte.

## Decisioni dell'autore

- La prima versione del framework non ha una interfaccia grafica: si usa dal terminale o dall'app di Claude. Il master screen è un passo successivo.
- Il master screen è locale: gira sul computer del master, legge e scrive i file della sua campagna e non dipende da un servizio esterno per funzionare.
- Le funzioni di consultazione, sessione live, musica e stampa si progettano da zero e confluiscono in un unico strumento, invece che in strumenti separati.
- La versione iniziale del master screen è snella: una chat con l'agente in cui si vedono, in tempo reale, le modifiche che l'agente fa ai file.
- **Interfacce semplici (Deciso).** Icone con tooltip al posto dei testi, nessuna complessità non richiesta.
- Quali altre funzioni confluiscono (enciclopedia pubblica, atlante, vedute illustrate dei luoghi, carte nautiche) non è ancora stato deciso. Le opzioni sono presentate in fondo al documento.

### Strumenti della sessione live estratti (Deciso)

Gli strumenti della sessione live non vivono dentro il master screen: sono funzioni di libreria generiche, usabili anche dal terminale o dall'app di Claude, e il master screen ne è soltanto una vista. Così la prima versione, senza interfaccia dedicata, ha già tutto ciò che serve al tavolo, e il master screen non duplica nessuna logica.

| Strumento | Funzione di libreria | Cosa resta allo schermo |
|---|---|---|
| Registro della partita | [Registro di sessione](Skill%20di%20libreria.md#l18-registro-di-sessione) | Mostrare il registro e i fili aperti |
| Combattimento | [Scontri](Skill%20di%20libreria.md#l12-scontri) | Pannello di iniziativa e risorse |
| Musica | Modulo musica e [ricerca musicale](Skill%20di%20libreria.md#l13-ricerca-musicale) | Player e controlli |
| Consultazione rapida | [Ricerca nel canone](Skill%20di%20libreria.md#l4-ricerca-nel-canone) e viste compatte della [gestione dei PNG](Skill%20di%20libreria.md#l14-gestione-dei-png) | Pannello laterale |
| Tela libera | Nessuna: è solo interfaccia | Tutta |

## Perché uno strumento unico, progettato da zero

- Più strumenti che leggono i Markdown in modi diversi, ciascuno con una propria ricostruzione di titoli, scene, schede e stato, portano a risultati incoerenti. Il framework deve avere un solo indice dei documenti, condiviso da tutto.
- Più modi di avvio (terminale, server locale, script) significano per il master più cose da ricordare. Il master screen deve essere un unico punto d'ingresso.
- Le parti più fragili di uno strumento sono quelle legate al tracciato di una singola campagna: nomi di cartelle, sinonimi, percorsi, font, la cartella dei personaggi giocanti. Vanno trasformate in configurazione, non ereditate.
- Uno strumento che cresce per accumulo di funzioni diventa incoerente: serve un disegno unitario fin dall'inizio, coerente con le preferenze dell'autore (interfacce semplici, icone con tooltip, niente complessità).

## Requisiti di partenza

Accanto a ciascuna, ciò che il framework deve evitare.

| Area | Requisito | Da evitare |
| --- | --- | --- |
| Chat e modifiche | Una chat che modifica il master screen in tempo reale; annullamento per gruppi di azioni; un indice ricostruibile dai file senza perdita di dati | Un pannello di modifiche che non si collega ai messaggi che le hanno causate; un indice che diventa fonte di verità |
| Mappa della trama | Nodi per sessioni e scene, costruiti dalle dipendenze dichiarate nei documenti; registro e combattimento come pannelli laterali | Dipendenze ricavate solo dall'ordine nel file |
| Musica | Ricerca per scena e atmosfera nei link che il master ha inserito; lettura dei link dai documenti; comandi essenziali (riproduci, pausa, volume, ciclo, dissolvenza) | Dipendenza da un solo sistema operativo; programmi esterni da installare a mano; sinonimi legati a una sola campagna |
| Stampa | Stato di stampa dentro la scheda; generazione deterministica; QR verso la voce pubblica; distinzione fra carte e annunci; colore sRGB o CMYK | Layout e font legati a una campagna; dipendenza da un browser e da Python per leggere i modelli; percorsi fissi |
| Master screen in generale | Un unico punto d'ingresso; interfaccia a icone con tooltip; modifiche sempre visibili e annullabili | Il master screen che non può modificare i documenti; l'assenza di una vista per i giocatori come scelta non discussa |

## Funzioni del master screen

Il master screen raccoglie cinque aree. Ciascuna è raggiungibile da un'icona con tooltip. Tutte devono funzionare senza che il master conosca il formato dei file.

### Chat con l'agente e modifiche in tempo reale

- La chat è la superficie principale. Il master chiede in linguaggio naturale («prepara una scheda per un mercante del porto») e l'agente lavora.
- Ogni modifica ai documenti compare subito in un pannello «cosa è cambiato», con i file toccati e la differenza rispetto a prima. Le modifiche dell'agente passano dagli stessi percorsi usati per tutti gli altri cambiamenti (vedi [Architettura](#architettura-proposta)), così non esiste una modalità separata.
- Ogni gruppo di modifiche è collegato al messaggio che lo ha causato, in modo che il master sappia perché un file è cambiato.
- Annullamento in linguaggio naturale: «torna a com'era» riporta indietro l'ultimo gruppo di modifiche. La cronologia dei gruppi resta consultabile. Il versionamento sottostante non è visibile.
- Una riga di stato dice cosa sta facendo l'agente, senza log tecnici, e si può fermare il lavoro in corso.
- Gli esiti dei controlli automatici (audit di continuità, collegamenti) si mostrano come frasi semplici, per esempio «Ho controllato 3 collegamenti: 2 aggiunti, 1 da confermare».

### Consultazione della campagna

- **Ricerca globale** con icona e scorciatoia da tastiera, su tutti i documenti. La ricerca può procedere per parole intere e prefissi; se il framework debba anche correggere i refusi è da decidere.
- **Lettore** con indice della sezione, documento affiancato a un altro, preferiti e recenti.
- **Separazione pubblico e master.** Ogni blocco riservato al master è marcato in modo visibile e non compare mai nelle viste pubbliche o nelle esportazioni. Il framework genera questa marcatura dalla configurazione, non la lascia da scrivere a mano (vedi `Configurazione.md`).
- **Mappa della trama.** Nodi per sessioni e scene; collegamenti dal campo `depends_on` delle sessioni. La mappa distingue dipendenze reali da semplice ordine nel file. Proposta: tenere la distinzione e spiegarla con una legenda, senza icone ambigue.
- **Galleria** delle immagini e delle carte, con ingrandimento.
- **Controlli.** Un pannello delle Impostazioni mostra i collegamenti rotti, i file non indicizzati e le esclusioni, con un pulsante per ricontrollare.

### Sessione live e scontri

- Il registro di sessione mostra ciò che è accaduto, le decisioni, le intenzioni e i fili aperti. Le sue regole sono in [Registro di sessione](Skill%20di%20libreria.md#l18-registro-di-sessione).
- La **tela libera** è una superficie con schede (documenti, mappe, immagini, note), cornici per scena e frecce per le diramazioni. Il master sposta e ridimensiona gli elementi liberamente; la disposizione si salva senza entrare nell'annullamento.
- Il pannello di **combattimento** mostra iniziativa, risorse e note. Le regole sono in [Scontri](Skill%20di%20libreria.md#l12-scontri) e nell'adattatore del sistema di gioco (vedi `Sistemi di gioco e stili.md`). Il pannello si apre da solo quando inizia uno scontro.

### Musica

- Le tracce di un luogo vengono dalla sottosezione `### Musica` della sua scheda, scritta dal master o proposta dalla [ricerca musicale](Skill%20di%20libreria.md#l13-ricerca-musicale). Ricerca per scena o atmosfera fra questi link, con riproduzione nel player condiviso, ciclo e dissolvenza.
- Il player resta attivo quando si cambia sezione o documento.
- In sessione la musica si suggerisce mostrandola nel master screen; parte solo su richiesta esplicita del master.
- Il suono esce dal computer su cui gira il master screen. La dipendenza dal sistema operativo è da valutare (vedi le questioni aperte).

### Stampa

- Stato di stampa per ogni carta, nel metadato `print`: `to-print` (da stampare), `printed` (stampata), `reprint` (da rifare). Con copie per personaggio giocante quando la carta è personale.
- Fogli 5×7 e A4 con retro QR, fogli-bacheca perforabili per gli annunci, uscita in PDF e PNG; CMYK solo per le tipografie che lo chiedono.
- Anteprima prima di generare. Il PDF si scarica o si apre dal master screen.
- I QR puntano alla voce pubblica della carta. Un indirizzo ricavato dal nome del file si rompe al primo cambio di nome: rinominare un oggetto già stampato romperebbe i QR sulle copie esistenti. Il framework deve legare l'indirizzo a un identificativo stabile, non al nome.

## Principi di interfaccia

- **Una schermata principale.** La chat e il pannello delle modifiche occupano il centro. Gli altri pannelli si aprono a richiesta e si chiudono senza perdere lo stato.
- **Icone con tooltip (Deciso).** Ogni icona ha un tooltip e un nome accessibile. Nessuna barra di testo sopra le icone. Se un'icona non basta, la soluzione è cambiarla, non aggiungere etichette.
- **Linguaggio del master.** Nell'interfaccia si usano parole come documento, scena, scheda, sessione, annuncio, personaggio. Restano fuori parole come commit, indice, canone, frontmatter, provider, token. I termini tecnici vivono nel glossario di `Principi.md`.
- **Nessuna modifica silenziosa.** Ogni cambiamento è visibile, collegato a una richiesta e annullabile.
- **Nessun aggiornamento ottimistico.** Ciò che compare sullo schermo è ciò che è stato davvero scritto. Vale per la musica come per tutto il resto.
- **Il master decide, l'agente propone.** Le scelte di trama, di regole e di contenuto restano al master; l'agente indica le opzioni.
- **Funziona senza rete** per tutto ciò che non è esplicitamente online (musica da piattaforme di streaming, ricerche di immagini remote).
- **Preferenze locali.** Preferiti, recenti, tema e dimensione del testo si salvano sul computer e restano separati per campagna.

## Architettura proposta

Proposta, non decisione. Lo schema descrive i ruoli, non la tecnologia.

```text
Master
  │
  ▼
Master screen locale ───────────► Agente (Claude o Codex)
  ▲   │                            │  usa solo gli strumenti del framework
  │   ▼                            ▼
  │  Cosa è cambiato        File della campagna (Markdown e immagini)
  │                                 │
  └──── aggiornamento live ◄────────┤
                                    ▼
                          Indice ricostruibile (cache)

Moduli attivabili: musica · stampa · enciclopedia · altri (vedi sotto)
```

Componenti:

1. **Applicazione locale.** Un solo processo sul computer del master, raggiungibile solo dal computer stesso. Si avvia con un'azione semplice (un doppio clic o un comando) e si chiude senza lasciare processi.
2. **Collegamento all'agente.** Il master screen parla con uno o più agenti (Claude e Codex, secondo la specifica di orchestrazione). Ogni turno riceve solo gli strumenti previsti dal framework e mai una shell libera. Un possibile meccanismo è un server di strumenti locale con un token valido per il solo turno: è un'ipotesi da valutare, non un obbligo.
3. **Lettura dei file.** I Markdown e le immagini della campagna sono la fonte di verità. L'indice è una cache: se si cancella, si ricostruisce dai file senza perdere nulla.
4. **Aggiornamento in tempo reale.** Un osservatore dei file rileva ogni creazione, modifica, rinomina ed eliminazione, qualunque ne sia l'autore: l'agente nel master screen, l'agente nel terminale o il master con un editor. La vista si aggiorna da questo flusso, così il master screen non è un secondo motore.
5. **Stato di sessione.** Chat, registro, tela libera e combattimento vivono in `.campaign/state/`, separata dal canone (vedi [Architettura](Architettura.md#3-campagna-generata)): è lo stato operativo della campagna e non modifica i file del canone. Se il master chiede una modifica canonica, questa passa dal processo di manutenzione con i suoi controlli.
6. **Moduli.** Musica, stampa e le funzioni da decidere sono moduli attivati dalla configurazione della campagna. Se un modulo è spento, la sua sezione non compare.
7. **Preferenze.** Solo sul computer del master, mai nei file della campagna.

Principio guida: il master screen è un modo di guardare la campagna, non un luogo in cui succedono cose che il terminale non può fare. Ogni operazione deve poter essere eseguita anche dal terminale o dall'app di Claude.

## Fasi di rilascio

| Fase | Contenuto | Criterio di uscita |
| --- | --- | --- |
| 0. Prima versione | Nessuna interfaccia grafica: skill di core e di libreria usate da terminale o dall'app di Claude. | Un master senza esperienza crea una campagna e prepara una sessione senza incontrare termini tecnici. |
| 1. MVP del master screen | Chat con l'agente; pannello «cosa è cambiato» in tempo reale; «torna a com'era»; ricerca e lettura con marcatura pubblico/master; impostazioni essenziali. | Il master prepara e rivede una sessione di prova solo dal master screen, senza usare il terminale. |
| 2. Sessione e trama | Sessione nel master screen, con la tela libera per schede, cornici e frecce; registro; combattimento con adattatore; mappa della trama. | Una sessione live si gioca e si registra dal master screen, con annullamento dei gruppi. |
| 3. Moduli principali | Musica e stampa, come moduli attivabili. | La musica parte e si ferma senza bloccare la chat; i fogli si generano e si anteprimano. |
| 4. Completo | Le funzioni confluite dopo la decisione (vedi sotto), configurazione completa, installazione semplificata. | Tutte le funzioni richieste sono coperte o dichiarate fuori ambito. |

La fase 1 segue la prima versione, come deciso dall'autore: nessun master screen prima che il framework funzioni da solo.

## Funzioni candidate a confluire

Quattro funzioni potrebbero entrare nel master screen o restare fuori dal framework. Nessuna è ancora decisa e nessuna è da considerare già esistente: le opzioni sotto sono per la valutazione, non per l'implementazione.

Per ciascuna ci sono tre possibilità:

- **A. Sezione del master screen:** la funzione diventa una sezione consultabile o usabile dal master screen.
- **B. Modulo richiamato:** la funzione resta un generatore separato, che il master screen o l'agente richiamano e da cui ricevono l'output.
- **C. Fuori dal framework:** la funzione resta un progetto a sé della campagna.

| Funzione | Cosa farebbe | Opzione | Pro | Contro |
|---|---|---|---|---|
| Enciclopedia pubblica | Un sito statico con una voce per ogni oggetto, carte consultabili, mappe e testi protetti da codice, pubblicato su un dominio. Sarebbe il bersaglio dei QR della stampa. | A. Sezione del master screen che genera e pubblica | Un solo strumento per il master; il QR resta coerente con la scheda | Il master screen diventa anche un editor pubblico; la pubblicazione richiede un hosting e delle credenziali |
| | | B. Modulo di pubblicazione richiamato | Parte pubblica separata e riutilizzabile per altri GDR | Un altro strumento da capire; la sincronizzazione dei cambi va progettata |
| | | C. Strumento separato | Nessun lavoro nel framework | Il master usa due strumenti; il QR dipende da un progetto esterno al framework |
| Atlante | Un sito statico con mappa interattiva e sinossi delle terre, scritte a partire dalle schede. | A. Pannello di consultazione con mappa | Mappa e trama nello stesso posto; riusa l'indice dei documenti | Richiede coordinate verificate su una mappa e sinossi da tenere aggiornate a mano |
| | | B. Modulo di pubblicazione | Stessa architettura dell'enciclopedia | Si sovrappone alla mappa della trama; due viste dello stesso mondo |
| | | C. Progetto a sé | Nessun costo per il framework | Perde il collegamento con la trama e con le schede |
| Vedute illustrate dei luoghi | Vedute a volo d'uccello dei luoghi, con etichette dei soli luoghi attestati, generate con uno script. | A. Galleria nel master screen | Immagini pronte da consultare; nessuna generazione richiesta | Le immagini restano legate alla campagna da cui derivano |
| | | B. Modulo di generazione richiamato dall'agente, con stile da un profilo | Riutilizzabile per altri mondi, con etichette e stile configurabili | Font e percorsi di sistema da generalizzare |
| | | C. Fuori dal framework | Nessun vincolo per il framework | Nessuna integrazione con le schede e la galleria |
| Carte nautiche | Carte in stile portolano ricavate da una maschera di terra e mare di una carta del mondo; coordinate e font dovrebbero essere parametri. | A. Sezione mappe del master screen | Un unico punto per le mappe, insieme alla galleria | Dipende da una carta maestra e da una maschera di terra e mare: dati che un altro mondo potrebbe non avere |
| | | B. Caso della libreria di mappe | Si unisce alla skill di mappe già prevista | Richiede di generalizzare l'input della maschera |
| | | C. Fuori dal framework | Nessun costo di generalizzazione | Resta uno script con percorsi fissi e dipendenze a parte |

Nota: se più funzioni entrano nel framework, serve un modello comune per le immagini generate (percorsi, nomi, licenze, stile). Va deciso insieme ai moduli opzionali descritti in `Architettura.md`.

## Questioni aperte

- Quali funzioni confluiscono nel master screen (enciclopedia pubblica, atlante, vedute, carte nautiche) e con quale opzione, fra A, B e C per ciascuna.
- Esiste una vista per i giocatori? Non è prevista nella prima specifica. Le schede pubbliche sono già adatte a una vista condivisa, ma è una scelta di prodotto.
- Piattaforma: alcune funzioni (musica, vedute, carte nautiche) potrebbero dipendere dal sistema operativo. Il framework deve girare anche altrove? Qual è il minimo accettabile per la fase 1?
- Tecnologia del master screen: da scegliere all'inizio della fase 1, con criteri chiari (semplicità d'installazione, facilità di modifica da parte di un agente, supporto alle icone con tooltip).
- Autonomia dell'agente: le modifiche compaiono in tempo reale, ma il master le approva dopo o prima? Serve un'approvazione esplicita per i file del canone?
- Marcatura pubblico/master: il formato è definito in `Configurazione.md`, ma il master screen deve applicarlo anche ai file scritti dall'agente. Chi controlla che un blocco riservato non esca in una vista pubblica?
- Parità fra master screen e terminale: quali operazioni devono esistere in entrambi, e quali sono solo del master screen (per esempio il pannello delle modifiche)?
