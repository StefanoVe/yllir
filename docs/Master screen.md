# Master screen

**Stato:** Bozza di progetto. Fasi 1, 2 e musica (fase 3) implementate (2026-11-12): sorgente in `master-screen/`, pacchetto pubblicato come release di GitHub dalla CI e scaricato dal launcher; chat, modifiche con annullamento, lettura e ricerca, tavolo live (il cockpit importato dal prototipo: tavola, registro, scontri con mappa di battaglia), mappa della trama, player musicale, enciclopedia locale (generazione e anteprima, senza pubblicazione) e stampa (fogli PDF con QR, stato di stampa, carte con Photoshop o renderer Node).

**Parte di:** [Framework per campagne di GDR](Framework%20per%20campagne%20di%20GDR.md)
Allineato alla [Riprogettazione](Riprogettazione.md) (2026-11-11) e alle decisioni dell'autore del 2026-11-12.

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
- **Tecnologia (Deciso, 2026-11-12).** Client-server: un server Node.js con Express e un client Angular, con aggiornamenti in tempo reale via SSE. Il server ascolta solo su 127.0.0.1, cioè solo sul computer del master.
- **Distribuzione (Deciso, 2026-11-12).** Il sorgente sta in `master-screen/`, fuori da `yllir/`. Una CI (GitHub Actions) compila il server in un unico file `server.mjs` e il client statico, impacchetta il risultato in modo deterministico e pubblica una release di GitHub `master-screen-v<versione>` con due file: il pacchetto `yllir-master-screen-<versione>.tar.gz` e il suo checksum `yllir-master-screen-<versione>.tar.gz.sha256`. La versione la decide il commit: `master-screen/VERSION` contiene la versione completa `MAJOR.MINOR.PATCH`, e chi committa aggiorna nello stesso commit `master-screen/VERSION`, `yllir/master-screen.json` (solo versione e indirizzo del pacchetto) e la versione del framework in `yllir/.claude-plugin/plugin.json`. La CI controlla che il pin corrisponda a `master-screen/VERSION`, e se la release di quella versione esiste già avvisa e non pubblica. La CI non committa nulla. Il launcher scarica il pacchetto una sola volta in `~/.yllir/master-screen/<versione>/`, scarica il `.sha256` dalla stessa release, verifica il pacchetto con quello e lo riusa. La rete serve solo al primo avvio e dopo un aggiornamento del framework che cambia la versione; se manca, si usa l'ultima versione già scaricata. Tra il push e la fine della CI la release non esiste ancora: in quell'intervallo il launcher non trova il pacchetto e usa l'ultima versione già scaricata. Il framework `yllir/` non contiene alcun build, e sul computer del master non serve `npm install`. Aggiornato il 2026-11-13: versione decisa dal commit, checksum pubblicato nella release, nessun commit della CI.
- **Avvio (Deciso, 2026-11-12).** Alla creazione di una campagna, Yllir crea nella sua cartella una scorciatoia che avvia server e client e apre il browser: `.command` su macOS, `.cmd` su Windows, `.sh` o `.desktop` su Linux. C'è un'istanza per campagna, e la chiusura non lascia processi residui.
- **Node.js (Deciso, 2026-11-12).** Il launcher controlla che Node.js, versione minima 20, sia nel PATH o in `~/.yllir/node`. Se manca, lo scarica da nodejs.org in `~/.yllir/node`: versione LTS fissata, checksum SHA256 verificato, nessun permesso di amministratore, nessun installer. Il master non installa nulla a mano.
- **Agente (Deciso, 2026-11-12).** Il server parla con Claude tramite Claude Agent SDK. Un server MCP locale espone solo gli strumenti del framework, con un token valido per il solo turno; nessuna shell libera. Vedi [Architettura proposta](#architettura-proposta), componente 2.
- **Prototipo (Deciso, 2026-11-12).** Esiste un prototipo dell'autore, fuori dal repository. Ne va portata solo la parte di sessione live; il resto si riprogetta secondo questo documento.
- **Cockpit del tavolo live (Deciso, 2026-11-12).** L'autore ha deciso di importare il cockpit del prototipo e di adattarne il tema. È il punto di partenza del tavolo live, con tre adattamenti:
  - registro e scontri passano dalle librerie del framework (`session-log` e `combat-tracker`), così restano leggibili dal terminale e dall'app di Claude anche senza il master screen;
  - le schede create al tavolo si salvano tramite l'engine, con controllo e revisione prima del salvataggio, come ogni altra scheda;
  - il tema segue quello del master screen.
- **Annullamento e chat del tavolo (Deciso, 2026-11-12).** L'annullamento dei gruppi di azioni dell'agente riguarda solo la tavola e la posizione: registro e scontri si correggono parlando con l'agente. Per ogni sessione live c'è una sola conversazione con l'agente del tavolo; lo scontro ha la sua (decisione successiva).
- **Agente dello scontro (Deciso, 2026-11-13).** Lo scontro ha una sessione d'agente propria, separata da quella del tavolo, e funziona come il cockpit: la vista è deterministica (iniziativa, campo di battaglia, pedine, letti dallo stato del framework) e l'agente agisce solo con strumenti MCP. Una conversazione per scontro: nasce col primo messaggio dello scontro e si chiude quando lo scontro finisce. Strumenti: quelli dello scontro (`combat_*`), la mappa di battaglia e le pedine, la lettura delle schede (`search_docs`, `read_doc`) e la nota nel registro (`ledger_note`). L'agente del tavolo perde ogni strumento di scontro: uno scontro si avvia solo dal pulsante con le spade. Modello predefinito più leggero di quello del tavolo (Haiku).
- **Personaggi giocanti nello scontro (Deciso, 2026-11-12).** Nello scontro i personaggi giocanti hanno solo nome, iniziativa e posizione. Le loro statistiche non entrano nel master screen.
- **Fasi e sessione live (Deciso, 2026-11-12).** Le fasi di rilascio restano. Si parte dalla fase 1: chat, pannello «cosa è cambiato», «torna a com'era», ricerca e lettura con marcatura pubblico/master, impostazioni essenziali. La sessione live (tela, registro, combattimento, musica) viene dopo. Combattimento e musica sono skill di libreria non ancora realizzate ([L12 Scontri](Skill%20di%20libreria.md#l12-scontri), [L13 Ricerca musicale](Skill%20di%20libreria.md#l13-ricerca-musicale)): il master screen ne è solo una vista.
- **Piattaforme (Deciso, 2026-11-12).** Il master screen gira su macOS e Windows. Linux non è un obiettivo della fase 1 (il launcher ha i file per Linux ma non è provato).
- **Approvazione delle modifiche (Deciso, 2026-11-12).** Il master non approva le modifiche prima: compaiono subito nel pannello «cosa è cambiato» e si annullano dopo con «torna a com'era». Nessuna approvazione preventiva, nemmeno per i file del canone.
- **Vista per i giocatori (Deciso, 2026-11-12).** Per ora non c'è. L'anteprima «vista giocatori» (nasconde il blocco riservato) resta solo un controllo del master.
- **Enciclopedia pubblica (Deciso, 2026-11-12): opzione A.** È una sezione del master screen che genera il sito statico e lo mostra in anteprima. Il sito è il bersaglio dei QR della stampa, quindi gli indirizzi si legano a un identificativo stabile e non al nome del file. **Solo in locale per ora** (decisione dell'autore, 2026-11-12): il sito si genera in `.campaign/cache/encyclopedia/` e non viene pubblicato; nessuna credenziale e nessun dominio. La pubblicazione su un host resta da decidere.
- **Interfaccia (Deciso, 2026-11-12).** Moderna e semplice da usare, ma abbastanza funzionale. È coerente con le icone con tooltip decise sopra.
- **Impostazioni del master screen (Deciso, 2026-11-13).** L'icona delle impostazioni sta nel gruppo in fondo alla barra laterale, insieme all'anteprima pubblica e al tema, e apre una pagina. Le impostazioni su come funziona il master screen si salvano nel file della campagna `.campaign/master-screen.yaml`, sotto git, e valgono su ogni browser; il file contiene solo ciò che il master ha cambiato, il resto prende i valori predefiniti, uguali al comportamento precedente. Tema, dimensione del testo, preferiti e recenti restano sul computer, separati per campagna.
- **Stile dell'interfaccia (Deciso, 2026-11-13).** Monocromo secondo il tema, taccuino in flat design squadrato; i nodi della mappa della trama e della tela del cockpit sono pezzi di carta strappata, i popup dei documenti pagine di quaderno. Precisa la decisione «Interfaccia» del 2026-11-12. Regole complete in [Linee guida dell'interfaccia](Linee%20guida%20dell'interfaccia.md).
- **Conversazioni nel master screen (Deciso, 2026-11-13).** Il master crea ed elimina conversazioni con l'agente e sceglie quale continuare da un elenco nella chat. Ogni conversazione parte con un contesto nuovo: la continuità viene dai documenti, dal pacchetto di contesto e dalla nota sul lavoro in corso. La parola mostrata è «conversazione», mai «sessione». La coda dei turni resta una per campagna, e l'indicatore degli assistenti al lavoro è visibile nella chat e nella barra di navigazione. Dettagli in [Gestione delle sessioni](Gestione%20delle%20sessioni.md#conversazioni-nel-master-screen).

### Strumenti della sessione live estratti (Deciso)

Gli strumenti della sessione live non vivono dentro il master screen: sono funzioni di libreria generiche, usabili anche dal terminale o dall'app di Claude, e il master screen ne è soltanto una vista. Così la prima versione, senza interfaccia dedicata, ha già tutto ciò che serve al tavolo, e il master screen non duplica nessuna logica.

| Strumento | Funzione di libreria | Cosa resta allo schermo |
|---|---|---|
| Registro della partita | [Registro di sessione](Skill%20di%20libreria.md#l18-registro-di-sessione) | Mostrare il registro e i fili aperti |
| Combattimento | [Scontri](Skill%20di%20libreria.md#l12-scontri) | Schermata dello scontro: iniziativa, campo di battaglia, pedine e chat |
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
- **Conversazioni (Deciso, 2026-11-13).** Il master può creare una conversazione nuova ed eliminarne una. Più conversazioni esistono accanto e il master sceglie da un elenco nella pagina della chat quale continuare. Ogni conversazione è separata e parte con un contesto nuovo: la continuità viene dai documenti, dal pacchetto di contesto del motore e dalla nota sul lavoro in corso, non dalla storia della conversazione precedente. Il titolo viene dal primo messaggio del master; non si rinomina.
- **Eliminare una conversazione (Deciso, 2026-11-13).** Rimuove solo la cronologia della chat. Le modifiche già fatte ai documenti restano, e il master viene avvisato di questo in parole semplici prima di confermare: lo schermo chiede sempre conferma.
- **Una scrittura alla volta (Deciso, 2026-11-13).** La coda dei turni è una per campagna: due conversazioni non scrivono il canone nello stesso momento. Un messaggio inviato mentre un'altra conversazione lavora attende, e lo schermo lo dice.
- **Indicatore degli assistenti (Deciso, 2026-11-13).** Mentre l'agente lavora, la chat mostra in modo compatto quanti assistenti sono attivi e una frase semplice per ciascuno su che cosa sta facendo, senza termini tecnici. Se il master è su un'altra pagina, lo stesso indicatore sta nella barra di navigazione, così sa che l'agente è ancora al lavoro. Non compare mai la parola «sub-agent».
- Le conversazioni del tavolo e degli scontri non cambiano: quella del tavolo resta una per sessione live, quella di ogni scontro ha la sua (vedi «Sessione live e scontri»).

### Consultazione della campagna

- **Ricerca globale** con icona e scorciatoia da tastiera, su tutti i documenti. La ricerca può procedere per parole intere e prefissi; se il framework debba anche correggere i refusi è da decidere.
- **Lettore** con indice della sezione, documento affiancato a un altro, preferiti e recenti.
- **Separazione pubblico e master.** Ogni blocco riservato al master è marcato in modo visibile e non compare mai nelle viste pubbliche o nelle esportazioni. Il framework genera questa marcatura dalla configurazione, non la lascia da scrivere a mano (vedi `Configurazione.md`).
- **Mappa della trama.** Nodi per sessioni e scene; collegamenti dal campo `depends_on` delle sessioni. La mappa distingue dipendenze reali da semplice ordine nel file. Proposta: tenere la distinzione e spiegarla con una legenda, senza icone ambigue.
- **Galleria** delle immagini e delle carte, con ingrandimento.
- **Controlli.** Un pannello delle Impostazioni mostra i collegamenti rotti, i file non indicizzati e le esclusioni, con un pulsante per ricontrollare.
- **Impostazioni.** Una pagina divisa in sezioni con un indice: Tavolo (modello dell'agente del tavolo e di quello dello scontro), Scontro (mostra mappe di battaglia, pannelli aperti all'avvio, scomparsa automatica dei pannelli e dopo quanti secondi), Musica (volume iniziale, durata della dissolvenza, ripetizione, barra della musica sempre visibile o solo quando suona), Aspetto e navigazione (tema, dimensione del testo, densità, animazioni ridotte, pagina iniziale, voci della barra laterale da mostrare), Controlli e Informazioni. Ogni modifica si salva da sola e la pagina mostra se il salvataggio è riuscito; ogni sezione ha «ripristina i valori predefiniti». Senza git la pagina lo dice e non salva.

### Sessione live e scontri

- Il registro di sessione mostra ciò che è accaduto, le decisioni, le intenzioni e i fili aperti. Le sue regole sono in [Registro di sessione](Skill%20di%20libreria.md#l18-registro-di-sessione). Lo tiene la libreria del framework: il master lo corregge parlando con l'agente.
- La **tela libera** è una superficie con schede (documenti, mappe, immagini, note), cornici per scena e frecce per le diramazioni. L'agente dispone ciò che entra in scena; il master sposta e ridimensiona gli elementi liberamente, e la disposizione si salva senza entrare nell'annullamento.
- Le schede create al tavolo (un PNG o un luogo improvvisato) passano dallo stesso ciclo di scrittura delle altre modifiche: controllo, revisione e salvataggio. Compaiono in «cosa è cambiato» e si possono annullare da lì.
- Lo **scontro** si apre dal pulsante con le spade sulla scheda di un PNG o di un nemico. A tutto schermo ha due passi. Il primo è l'iniziativa: i personaggi giocanti, i PNG e i nemici presenti sulla tela, ciascuno alleato o nemico. Il secondo è il campo di battaglia: se c'è una mappa di battaglia e la preferenza «mostra mappe di battaglia» è attiva, le pedine si trascinano sulla mappa; altrimenti i combattenti appaiono in elenco, in ordine di iniziativa. Passando sopra una pedina si vede un riepilogo delle statistiche, ricavato dalla parte pubblica della scheda secondo le regole del sistema di gioco. In elenco, PNG e nemici mostrano sempre punti ferita, condizioni, statistiche e attacchi; i personaggi giocanti solo nome e iniziativa. Un pannello del turno mostra le azioni della creatura di turno e, per le altre, reazioni e azioni leggendarie, secondo i gruppi dell'adattatore; pedine e righe mostrano l'illustrazione della scheda quando c'è; le condizioni hanno etichette e durate dell'adattatore, e i cambi automatici di stato (condizione finita, sconfitto, privo di sensi, nuovo turno) compaiono come avvisi. Pulsanti rapidi, senza passare dall'agente: turno successivo, danno e cura di una quantità, sconfitto, togli dallo scontro. Accanto ai combattenti c'è la chat dello scontro, con il suo agente: raccoglie ciò che il master dice sullo scontro e lo applica con gli strumenti dello scontro. La chat del tavolo non tocca lo scontro.
- Le regole dello scontro sono in [Scontri](Skill%20di%20libreria.md#l12-scontri) e nell'adattatore del sistema di gioco (vedi `Sistemi di gioco e stili.md`). Lo scontro si apre da solo quando inizia mentre il tavolo è a schermo, e resta chiuso quando il master lo chiude.

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
- Niente programmi esterni per la stampa (decisione dell'autore, 2026-11-12). Il renderer predefinito è Photoshop tramite MCP; quando Photoshop manca si usa un renderer Node, che disegna il layout vettoriale direttamente nei fogli PDF. Le librerie per QR e PDF sono vendorizzate nel framework. Fogli e carte si generano in `.campaign/cache/print/`.

## Principi di interfaccia

- **Una schermata principale.** La chat e il pannello delle modifiche occupano il centro. Gli altri pannelli si aprono a richiesta e si chiudono senza perdere lo stato.
- **Icone con tooltip (Deciso).** Ogni icona ha un tooltip e un nome accessibile. Nessuna barra di testo sopra le icone. Se un'icona non basta, la soluzione è cambiarla, non aggiungere etichette.
- **Linguaggio del master.** Nell'interfaccia si usano parole come documento, scena, scheda, sessione, conversazione, annuncio, personaggio. «Sessione» indica sempre la giocata; la conversazione con l'agente si chiama «conversazione» (decisione del 2026-11-13). Restano fuori parole come commit, indice, canone, frontmatter, blocco dei metadati, provider, token, sub-agent. I termini tecnici vivono nel glossario di `Principi.md`.
- **Nessuna modifica silenziosa.** Ogni cambiamento è visibile, collegato a una richiesta e annullabile.
- **Nessun aggiornamento ottimistico.** Ciò che compare sullo schermo è ciò che è stato davvero scritto. Vale per la musica come per tutto il resto.
- **Il master decide, l'agente propone.** Le scelte di trama, di regole e di contenuto restano al master; l'agente indica le opzioni.
- **Funziona senza rete** per tutto ciò che non è esplicitamente online (musica da piattaforme di streaming, ricerche di immagini remote).
- **Preferenze locali e impostazioni della campagna.** Preferiti, recenti, tema e dimensione del testo si salvano sul computer e restano separati per campagna. Le impostazioni su come funziona il master screen stanno nel file della campagna (vedi le decisioni dell'autore, 2026-11-13).
- **Stile visivo.** Segue le [Linee guida dell'interfaccia](Linee%20guida%20dell'interfaccia.md).

## Architettura proposta

Proposta, salvo i componenti 1 e 2, che sono decisioni del 2026-11-12. Lo schema descrive i ruoli; la tecnologia è nelle decisioni dell'autore.

```text
Master
  │
  ▼
Master screen locale ───────────► Agente (Claude)        
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

1. **Applicazione locale (Deciso, 2026-11-12).** Un server locale (Node.js) e un'interfaccia nel browser, sul computer del master. Il server ascolta solo su 127.0.0.1 ed è raggiungibile solo dal computer stesso. Si avvia con la scorciatoia della campagna, con un doppio clic, e si chiude senza lasciare processi. C'è un'istanza per ogni campagna.
2. **Collegamento all'agente (Deciso, 2026-11-12).** Il master screen parla con l'agente principale di Claude tramite Claude Agent SDK. Un server di strumenti locale (MCP) espone solo gli strumenti previsti dal framework, con un token valido per il solo turno: nessuna shell libera. Codex non fa più parte del framework, al più è un fornitore facoltativo di immagini (Riprogettazione, decisioni 4 e 11).
3. **Lettura dei file.** I Markdown e le immagini della campagna sono la fonte di verità. L'indice è una cache: se si cancella, si ricostruisce dai file senza perdere nulla.
4. **Aggiornamento in tempo reale.** Un osservatore dei file rileva ogni creazione, modifica, rinomina ed eliminazione, qualunque ne sia l'autore: l'agente nel master screen, l'agente nel terminale o il master con un editor. La vista si aggiorna da questo flusso, così il master screen non è un secondo motore.
5. **Stato di sessione.** Chat, registro, tela libera e combattimento vivono in `.campaign/state/`, separata dal canone (vedi [Architettura](Architettura.md#3-campagna-generata)): è lo stato operativo della campagna e non modifica i file del canone. Se il master chiede una modifica canonica, questa passa dal motore di scrittura (`commit`), con i suoi controlli (Riprogettazione, sezione 2).
6. **Moduli.** Musica, stampa e le funzioni da decidere sono moduli attivati dalla configurazione della campagna. Se un modulo è spento, la sua sezione non compare.
7. **Preferenze e impostazioni (Deciso, 2026-11-13).** Le preferenze del computer (tema, dimensione del testo, preferiti, recenti) restano nel browser. Le impostazioni di funzionamento stanno in `.campaign/master-screen.yaml`: il server le controlla, le scrive e salva una versione con git limitata a quel file. Non sono canone, quindi non passano dal motore di scrittura, e il pannello «cosa è cambiato» non le mostra.

Principio guida: il master screen è un modo di guardare la campagna, non un luogo in cui succedono cose che il terminale non può fare. Ogni operazione deve poter essere eseguita anche dal terminale o dall'app di Claude.

## Fasi di rilascio

| Fase | Contenuto | Criterio di uscita |
| --- | --- | --- |
| 0. Prima versione | Nessuna interfaccia grafica: skill di core e di libreria usate da terminale o dall'app di Claude. | Un master senza esperienza crea una campagna e prepara una sessione senza incontrare termini tecnici. |
| 1. MVP del master screen | Chat con l'agente; pannello «cosa è cambiato» in tempo reale; «torna a com'era»; ricerca e lettura con marcatura pubblico/master; impostazioni essenziali. | Il master prepara e rivede una sessione di prova solo dal master screen, senza usare il terminale. |
| 2. Sessione e trama | Sessione nel master screen, con la tela libera per schede, cornici e frecce; registro; combattimento con adattatore; mappa della trama. | Una sessione live si gioca e si registra dal master screen, con annullamento dei gruppi. |
| 3. Moduli principali | Musica e stampa, come moduli attivabili. | La musica parte e si ferma senza bloccare la chat; i fogli si generano e si anteprimano. |
| 4. Completo | Le funzioni confluite dopo la decisione (vedi sotto), configurazione completa, installazione semplificata. | Tutte le funzioni richieste sono coperte o dichiarate fuori ambito. |

La fase 1 segue la prima versione, come deciso dall'autore: nessun master screen prima che il framework funzioni da solo. La fase 1 deve lasciare predisposta la registrazione di pannelli e moduli, in vista della sessione live che viene dopo.

## Funzioni candidate a confluire

Quattro funzioni potrebbero entrare nel master screen o restare fuori dal framework. Nessuna è ancora decisa e nessuna è da considerare già esistente: le opzioni sotto sono per la valutazione, non per l'implementazione.

Per ciascuna ci sono tre possibilità:

- **A. Sezione del master screen:** la funzione diventa una sezione consultabile o usabile dal master screen.
- **B. Modulo richiamato:** la funzione resta un generatore separato, che il master screen o l'agente richiamano e da cui ricevono l'output.
- **C. Fuori dal framework:** la funzione resta un progetto a sé della campagna.

| Funzione | Cosa farebbe | Opzione | Pro | Contro |
|---|---|---|---|---|
| Enciclopedia pubblica | Un sito statico con una voce per ogni oggetto, carte consultabili, mappe e testi protetti da codice, pubblicato su un dominio. Sarebbe il bersaglio dei QR della stampa. | A. Sezione del master screen che genera il sito (**scelta**, 2026-11-12) | Un solo strumento per il master; il QR resta coerente con la scheda | Il master screen diventa anche un editor pubblico; la pubblicazione richiede un hosting e delle credenziali (per ora non attiva) |
| | | B. Modulo di pubblicazione richiamato (*non scelta*) | Parte pubblica separata e riutilizzabile per altri GDR | Un altro strumento da capire; la sincronizzazione dei cambi va progettata |
| | | C. Strumento separato (*non scelta*) | Nessun lavoro nel framework | Il master usa due strumenti; il QR dipende da un progetto esterno al framework |
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

- Quali altre funzioni confluiscono nel master screen (atlante, vedute, carte nautiche) e con quale opzione, fra A, B e C per ciascuna. L'enciclopedia pubblica è decisa (opzione A).
- Pubblicazione dell'enciclopedia: servizio di hosting, dominio e conservazione del token. Finché non c'è, il sito resta locale in `.campaign/cache/encyclopedia/`.
- Piattaforma: alcune funzioni (musica, vedute, carte nautiche) potrebbero dipendere dal sistema operativo; la fase 1 è per macOS e Windows (deciso), il resto si valuta modulo per modulo.
- Marcatura pubblico/master: il formato è definito in `Configurazione.md`, ma il master screen deve applicarlo anche ai file scritti dall'agente. Chi controlla che un blocco riservato non esca in una vista pubblica?
- Parità fra master screen e terminale: quali operazioni devono esistere in entrambi, e quali sono solo del master screen (per esempio il pannello delle modifiche)?
