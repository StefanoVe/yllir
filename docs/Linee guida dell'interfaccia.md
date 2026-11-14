# Linee guida dell'interfaccia e restyling

Regole visive del master screen. Valgono per tutte le sue viste; non valgono per l'enciclopedia pubblica né per la stampa (vedi sotto).

## Decisione dell'autore (Deciso, 2026-11-13)

Lo stile è quello di un taccuino, in flat design. Dal 2026-11-15 i colori sono carta avorio e inchiostro caldo con un solo accento (vedi «Colore»), non più nero puro su bianco puro; il tema decide chiaro o scuro. Fa eccezione un semi-skeuomorfismo mirato: i nodi della mappa della trama e della tela del cockpit sono pezzi di carta strappata, e i popup dei documenti sono pagine di un quaderno. Precisa la decisione «Interfaccia» del 2026-11-12 in [Master screen](Master%20screen.md).

## Colore

- **Palette calda e un accento (Deciso, 2026-11-15).** Supera il «Monocromo» del 2026-11-13, che con nero puro su bianco puro rendeva l'interfaccia dura e poco leggibile. Carta avorio e inchiostro caldo nel tema chiaro, carta scura e inchiostro chiaro nel tema scuro; quattro livelli di superficie per separare le zone senza linee; un solo colore d'accento, un inchiostro blu, con i ruoli della mappa sotto. Nessun altro colore decorativo.
- **Unica eccezione (Deciso, 2026-11-13).** Un rosso spento per gli errori e per il salvataggio non riuscito, e per il margine delle pagine di quaderno.
- **Parte del master (Deciso, 2026-11-13).** La parte riservata al master e quella pubblica si distinguono con il segno grafico, non con il colore: bordo tratteggiato e icona del lucchetto per la parte del master.
- **Contrasto (Deciso, 2026-11-13).** Il contrasto è leggibile in entrambi i temi: almeno 4,5:1 per il testo e 3:1 per i contorni dei controlli e per l'accento.

## Mappa dei ruoli (Deciso, 2026-11-15)

Ogni segno ha un solo significato, in tutte le viste.

| Cosa | Segno |
|---|---|
| Azione principale | pulsante pieno nel colore d'accento, uno per vista |
| Opzione scelta, chip attivo, interruttore acceso | bordo e testo d'accento su fondo d'accento tenue, con spunta o «Sì/No» |
| Voce attiva della barra laterale | barretta d'accento a sinistra e fondo tenue |
| Selezionato | contorno d'accento di 2 px |
| Evidenziato ai giocatori | barra d'accento spessa ed etichetta «In vista» |
| Appena cambiato | contorno tratteggiato che svanisce |
| Turno in corso | l'unica riga invertita (inchiostro pieno) |
| Alleato e nemico | quadrato pieno e rombo vuoto, più l'etichetta |

I divisori interni usano il bordo chiaro; il bordo forte resta ai contorni dei controlli. Il testo che conta (lucchetto, punti ferita, condizioni, percorsi, conteggi) non scende sotto i 14 px; i 12 px sono solo per i metadati.

## Forme e superfici

- **Raggi piccoli (Deciso, 2026-11-15).** Supera «Angoli vivi» del 2026-11-13: 3 px per controlli e chip, 6 px per carte e pannelli, 8 px per i modali. La carta strappata resta senza raggio.
- **Ombra minima (Deciso, 2026-11-15).** Supera «Niente effetti» del 2026-11-13: un'ombra leggera solo su ciò che galleggia (barre degli strumenti mobili, menu, popup e modali). Niente gradienti; bordi sottili a tratto pieno.
- **Flat (Deciso, 2026-11-13).** Barra laterale, chat, impostazioni, pulsanti e pannelli restano flat.

## Font

- **Due al massimo (Deciso, 2026-11-13).** Al massimo due font, inclusi nel pacchetto del master screen, così funzionano senza rete.
- **Ruoli (Deciso, 2026-11-13).** Un sans leggibile per il testo; un font in stile manoscritto solo per i titoli dei nodi e delle pagine, mai per testo lungo.

## Carta strappata: nodi della mappa e della tela

- **Dove (Deciso, 2026-11-13).** Si applica ai nodi della mappa della trama e alle schede sulla tela del cockpit.
- **Forma deterministica (Deciso, 2026-11-13).** Il bordo strappato è generato in SVG o clip-path, in modo deterministico dall'identificativo del nodo: lo stesso nodo ha sempre la stessa forma, fra un avvio e l'altro e a ogni aggiornamento.
- **Nessuna immagine (Deciso, 2026-11-13).** Segue il tema da solo e resta nitido a ogni zoom; nessuna immagine.
- **Margine di sicurezza (Deciso, 2026-11-13).** Il testo e le aree cliccabili stanno in un'area interna con un margine di sicurezza: il bordo non taglia mai testo né controlli.

## Pagina di quaderno: popup dei documenti

- **Dove (Deciso, 2026-11-13).** Si applica al lettore dei documenti e ai popup che mostrano un documento, anche nel cockpit.
- **Solo qui (Deciso, 2026-11-13).** Righe del quaderno e margine in rosso tenue, solo in questo punto: altrove non ci sono righe.
- **Animazioni e densità (Deciso, 2026-11-13).** Con «animazioni ridotte» o densità alta le righe si spengono.

## Restyling

- **Copertura (Deciso, 2026-11-13).** Il restyling copre tutte le viste esistenti del master screen: barra laterale, chat, cosa è cambiato, documenti, ricerca, mappa della trama, cockpit, scontro, musica, stampa, impostazioni, anteprima dell'enciclopedia.
- **Come (Deciso, 2026-11-13).** Si fa con variabili di tema comuni nel foglio di stile globale del client (`master-screen/client/src/styles.css`), non vista per vista.
- **Principi validi (Deciso, 2026-11-13).** Restano validi i principi già decisi: icone con tooltip, dimensione del testo e «animazioni ridotte» delle impostazioni.

## Elementi comuni

**Proposta (2026-11-13).** Idea di come deve apparire ciascuna parte; da approvare.

- **Pulsanti.** Il pulsante principale è pieno nel colore d'accento; il secondario ha solo il bordo; il terziario è solo testo sottolineato. Raggio piccolo.
- **Campi di testo.** Hanno solo una linea sotto, come una riga su cui scrivere; con il fuoco la linea diventa più spessa.
- **Fuoco della tastiera.** È un contorno pieno di 2 px, staccato dall'elemento e sempre visibile.
- **Chip e filtri.** Sono rettangoli con bordo; quello attivo ha bordo e testo d'accento su fondo tenue.
- **Tooltip.** Un piccolo riquadro invertito, senza freccia.
- **Avvisi temporanei.** Un riquadro con bordo spesso in basso a destra; gli errori hanno il bordo in rosso spento.
- **Caricamento.** Blocchi grigi piatti al posto del contenuto, fermi se le animazioni sono ridotte.
- **Stati vuoti.** Una frase breve nel font manoscritto, al centro, senza illustrazioni.
- **Icone.** Sono a tratto, con lo stesso spessore dei bordi; l'icona attiva ha il fondo d'accento tenue e l'icona in accento.
- **Immagini della campagna.** Ritratti, illustrazioni e mappe restano a colori, perché sono contenuto e non interfaccia; stanno in cornici quadrate con bordo sottile.

## Aspetto delle pagine

**Proposta (2026-11-13).** Idea di come deve apparire ciascuna parte; da approvare.

### Barra laterale e cornice

- **Barra.** È stretta, a sinistra, separata dal resto da una sola linea verticale, come il dorso di un taccuino. Le icone sono a tratto e la voce attiva ha la barretta d'accento a sinistra.
- **Gruppo in fondo.** Anteprima pubblica, tema e impostazioni stanno in fondo, separati da una linea orizzontale.
- **Strisce in alto.** L'avviso di assenza di rete è una striscia con bordo in rosso spento; l'anteprima «vista giocatori» è una striscia con bordo tratteggiato.

### Home: chat e cosa è cambiato

- **Divisione.** La chat sta a sinistra e i cambiamenti a destra, divisi da una linea.
- **Messaggi.** I messaggi del master sono blocchi invertiti allineati a destra; quelli dell'agente sono testo sul foglio, con una linea verticale a sinistra.
- **Cosa è cambiato.** È un elenco come un registro: l'ora sta nel margine sinistro, poi il titolo della richiesta e i file toccati.
- **Confronto delle modifiche.** Niente verde e rosso: le righe aggiunte sono sottolineate e in grassetto, quelle tolte sono barrate. «Torna a com'era» è un pulsante secondario.

### Documenti

- **Indice.** È come l'indice di un taccuino: i gruppi hanno il titolo nel font manoscritto e il numero di documenti.
- **Righe dei documenti.** Ogni documento è una riga con miniatura quadrata, titolo, puntini fino al tipo e, se è solo del master, un lucchetto.
- **Filtri e ricerca.** I filtri sono chip in alto; la ricerca è un campo a linea.

### Lettore dei documenti e popup

- **Pagina.** È una pagina di quaderno con righe e margine in rosso spento; il testo poggia sulle righe.
- **Indice e rimandi.** L'indice del documento sta nella colonna del margine; i rimandi («citato in») stanno in fondo, come note a piè di pagina.
- **Blocco del master.** Ha bordo tratteggiato e lucchetto.
- **Popup del cockpit.** È la stessa pagina, staccata dal fondo solo da un bordo spesso, senza ombra.

### Ricerca

- **Ricerca rapida.** È un riquadro squadrato al centro con bordo spesso: campo a linea in alto e risultati raggruppati sotto, con i titoli dei gruppi in maiuscoletto.
- **Pagina di ricerca.** Usa la stessa forma, a tutta larghezza.

### Mappa della trama

- **Fondo.** È semplice, senza righe né quadretti.
- **Sessioni e scene.** Sono pezzi di carta strappata; le sessioni sono più grandi delle scene e il titolo sta nel font manoscritto.
- **Dipendenze.** Le dipendenze reali sono una linea piena con freccia; il semplice ordine nel file è una linea a puntini.
- **Stato e legenda.** Lo stato (giocata, prossima) si segna con un simbolo nell'angolo, una spunta o un cerchio pieno, non con il colore. La legenda sta in un riquadro piatto in un angolo.

### Tavolo live (cockpit)

- **Divisione.** La tela sta a sinistra e la chat del tavolo a destra, divise da una linea che si trascina.
- **Schede sulla tela.** Personaggi, luoghi e oggetti sono pezzi di carta strappata con miniatura quadrata e nome nel font manoscritto, appoggiati leggermente storti: una piccola rotazione fissa per ogni scheda, nessuna con animazioni ridotte.
- **Pannelli.** Registro e pannelli laterali sono piatti, con titolo e una linea sotto.
- **Scena in corso.** È un'etichetta rettangolare in alto.

### Scontro

- **Schermo e iniziativa.** Lo scontro è a tutto schermo e piatto. L'iniziativa è una tabella con righe separate da linee; la creatura di turno è la riga invertita.
- **Alleati e nemici.** Si distinguono dalla forma del segno accanto al nome, quadrato pieno per gli alleati e rombo vuoto per i nemici, più l'etichetta, non dal colore.
- **Punti ferita e condizioni.** I punti ferita sono una barra a segmenti nel colore dell'inchiostro con il numero accanto; quando sono bassi i segmenti diventano tratteggiati, oltre che rossi; le condizioni sono etichette rettangolari con la durata.
- **Campo di battaglia e avvisi.** Le pedine sono quadrati con bordo spesso e illustrazione dentro; la pedina di turno ha il bordo doppio. Gli avvisi automatici sono avvisi temporanei.

### Musica

- **Elenco.** Sono schede quadrate con copertina a colori e titolo sotto; il brano che suona ha la scheda invertita.
- **Barra.** È in basso, piatta, separata da una linea, con i comandi come icone a tratto; l'indicatore che si muove resta fermo con animazioni ridotte.

### Stampa

- **Elenco.** Le carte sono righe con casella di spunta squadrata.
- **Stato.** Da stampare, stampata, da ristampare: lo stato è una parola e un simbolo, non un colore. Le anteprime delle carte restano come sono, perché la stampa è fuori ambito.

### Enciclopedia

- **Pagina di controllo.** Controlli prima della pubblicazione, indirizzo e pulsanti sono piatti, come le impostazioni; i controlli superati hanno la spunta, quelli falliti la croce e il bordo in rosso spento.
- **Anteprima.** L'anteprima del sito dentro la pagina mantiene lo stile della campagna.

### Impostazioni

- **Sezioni.** L'indice sta nella colonna sinistra come linguette attaccate al bordo del foglio; la sezione attiva ha la barretta d'accento.
- **Voci.** Ogni impostazione è una riga: nome e spiegazione a sinistra, controllo a destra, una linea fra le righe.
- **Salvataggio.** Lo stato («salvato», oppure l'errore in rosso spento) sta in alto a destra della sezione.

## Fuori ambito

- **Enciclopedia e stampa (Deciso, 2026-11-13).** Enciclopedia pubblica e stampa non seguono queste linee guida: sono per i giocatori, la stampa vuole il bianco puro e l'enciclopedia ha lo stile della campagna.

## Questioni aperte

- Un eventuale profilo di stile «taccuino» per enciclopedia e stampa, nei profili di stile (vedi [Sistemi di gioco e stili](Sistemi%20di%20gioco%20e%20stili.md)).
