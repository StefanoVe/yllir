# Linee guida dell'interfaccia e restyling

Regole visive del master screen. Valgono per tutte le sue viste; non valgono per l'enciclopedia pubblica né per la stampa (vedi sotto).

## Decisione dell'autore (Deciso, 2026-11-13)

L'interfaccia è testo nero su bianco nel tema chiaro e bianco su nero nel tema scuro; il tema decide. Lo stile è quello di un taccuino, in flat design squadrato. Fa eccezione un semi-skeuomorfismo mirato: i nodi della mappa della trama e della tela del cockpit sono pezzi di carta strappata, e i popup dei documenti sono pagine di un quaderno. Precisa la decisione «Interfaccia» del 2026-11-12 in [Master screen](Master%20screen.md).

## Colore

- **Monocromo (Deciso, 2026-11-13).** Solo nero e bianco, con i grigi necessari a bordi e testo secondario, invertiti dal tema. Nessun colore d'accento decorativo.
- **Unica eccezione (Deciso, 2026-11-13).** Un rosso spento per gli errori e per il salvataggio non riuscito, e per il margine delle pagine di quaderno.
- **Parte del master (Deciso, 2026-11-13).** La parte riservata al master e quella pubblica si distinguono con il segno grafico, non con il colore: bordo tratteggiato e icona del lucchetto per la parte del master.
- **Contrasto (Deciso, 2026-11-13).** Il contrasto è leggibile in entrambi i temi.

## Forme e superfici

- **Angoli vivi (Deciso, 2026-11-13).** Niente arrotondamenti.
- **Niente effetti (Deciso, 2026-11-13).** Niente ombre sfumate né gradienti; bordi sottili a tratto pieno.
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

## Fuori ambito

- **Enciclopedia e stampa (Deciso, 2026-11-13).** Enciclopedia pubblica e stampa non seguono queste linee guida: sono per i giocatori, la stampa vuole il bianco puro e l'enciclopedia ha lo stile della campagna.

## Questioni aperte

- Un eventuale profilo di stile «taccuino» per enciclopedia e stampa, nei profili di stile (vedi [Sistemi di gioco e stili](Sistemi%20di%20gioco%20e%20stili.md)).
