# Proiettore

**Stato:** implementato (master screen 0.21.0 del 2026-11-20 e 0.22.0 del 2026-11-21): finestra proiettore, «Apri proiettore», «Proietta» nella lightbox e combattimento proiettato; le altre questioni aperte restano aperte
**Parte di:** [Master screen](Master%20screen.md)

## Scopo del documento

Questo file raccoglie l'idea del proiettore del master screen, per svilupparla in futuro. Le richieste dell'autore sono marcate **Richiesta dell'autore**; il resto è **Proposta**, e le questioni aperte in fondo non sono risolte.

## 1. L'idea (Richiesta dell'autore, 2026-11-20)

- **Finestra proiettore.** Quando si apre il master screen, oltre alla pagina principale si apre una finestra pop-up nativa del browser che fa da proiettore. Il master la sposta su un secondo schermo (o dove vuole) e la lascia lì per tutta la sessione: è ciò che vedono i giocatori.
- **Tasto «Proietta».** Dove il master visualizza qualcosa ha un tasto per mandarlo al proiettore. Nella lightbox delle immagini (una mappa, un ritratto) si affianca ai tasti già esistenti: pop-up, chiudi, schermo intero, e ora proietta. Anche il combat tracker ha il suo tasto proietta.
- **Effetto.** Cliccando «Proietta», nella finestra proiettore compare la stessa cosa che il master sta guardando.

Questa idea supera, per il proiettore, la decisione «Vista per i giocatori: per ora non c'è» del 2026-11-12 in [Master screen](Master%20screen.md#decisioni-dellautore).

## Prima versione (2026-11-20)

- **Combat tracker escluso nella prima versione (2026-11-20).** L'autore ha chiesto di saltarlo nella 0.21.0, che proietta soltanto immagini e lo schermo di riposo; è arrivato con la 0.22.0 (sotto).
- **Cosa c'è.** La pagina `/projector` senza barra né tasti (un doppio clic la porta a schermo intero), il tasto «Apri proiettore» nella barra laterale e, quando qualcosa è proiettato, «Svuota il proiettore»; nella lightbox «Proietta» accanto al pop-up. Il proiettore si apre solo su richiesta del master: è la scelta prudente finché la prima questione aperta non è decisa.
- **Controllo sul server.** Si proietta un'immagine solo se la cita la parte pubblica di un documento non riservato, oppure se il master l'ha caricata sulla scrivania della partita live; altrimenti il tasto «Proietta» non compare e il server rifiuta la richiesta. L'indirizzo proiettato lo ricostruisce il server.
- **Un solo proiettore, immagine intera.** Il server resta su 127.0.0.1 e la mappa si proietta intera, senza zoom né nebbia.

## Combattimento proiettato (Deciso, 2026-11-21)

- **Cosa vedono i giocatori.** Round, ordine di iniziativa e turno corrente, con i nomi. Dei nemici solo lo stato a parole ricavato dai punti ferita (illeso, ferito, sanguinante, a terra), mai i numeri; di personaggi e alleati i punti ferita esatti. Classe armatura, condizioni, risorse e note restano al master; i combattenti nascosti non compaiono finché il master non li rivela.
- **Ordine e mappa.** Se il combattimento ha una battle map, il proiettore la mostra con le pedine dei combattenti visibili e l'ordine di iniziativa a lato; senza mappa mostra solo l'ordine. La mappa compare solo se è un'immagine pubblica, con lo stesso controllo delle immagini.
- **Aggiornamento.** Il tasto «Proietta il combattimento» nella barra del combattimento avvia la proiezione e, premuto di nuovo, la toglie; il server ricostruisce la vista a ogni cambio di turno, danno o spostamento di pedina.

## 2. Come potrebbe funzionare (Proposta)

- **Canale.** Il server ha già gli aggiornamenti in tempo reale via SSE. Il proiettore è una pagina del client (per esempio `/projector`) che ascolta un flusso SSE dedicato; «Proietta» è una richiesta del master al server (per esempio `POST /api/projector`) che il server rilancia al proiettore. Un WebSocket non serve: il proiettore riceve soltanto. In alternativa, se le due finestre restano nello stesso browser, basta un `BroadcastChannel` senza passare dal server; il server però permette di riaprire il proiettore e ritrovare l'ultima cosa proiettata.
- **Cosa si proietta.** Un messaggio dichiarativo, non HTML: `{ kind: "image", src }`, `{ kind: "combat" }`, `{ kind: "blank" }`. Il proiettore sa disegnare solo questi tipi.
- **Stato.** Il server tiene in memoria l'ultima proiezione; un proiettore che si riapre la riceve subito.
- **Schermo di riposo.** Senza proiezione il proiettore mostra uno sfondo neutro (nome della campagna o nero), mai il master screen.

## 3. Vincoli da rispettare (Proposta)

- **Niente segreti sul proiettore.** È una vista per i giocatori: il blocco riservato al master non arriva mai al proiettore (vedi [Sicurezza e privacy](Sicurezza%20e%20privacy.md)). Il controllo sta sul server, che costruisce il contenuto proiettato da dati pubblici, non sul client del master.
- **Combat tracker proiettato.** Mostra solo ciò che i giocatori possono sapere: ordine di iniziativa, turno corrente, nomi visibili. Punti ferita, condizioni nascoste e contatori dei nemici restano al master; il dettaglio è da decidere.
- **Immagini.** Si proiettano così come sono; un'immagine segnata come riservata al master non ha il tasto «Proietta».
- **Pop-up bloccati.** I browser bloccano le finestre aperte senza un clic. L'apertura automatica all'avvio quasi certamente non passa: serve un tasto «Apri proiettore» (o un clic iniziale), e il tasto riapre la finestra se il master l'ha chiusa.
- **Secondo schermo.** Il posizionamento automatico su un altro monitor richiede l'API Window Management (Chrome ed Edge, con permesso); altrimenti il master trascina la finestra a mano e la mette a schermo intero.
- **Stile.** Segue le [Linee guida dell'interfaccia](Linee%20guida%20dell'interfaccia.md), ma con il minimo di interfaccia: nessun tasto visibile sul proiettore.

## Questioni aperte

- Il proiettore si apre sempre all'avvio, o solo quando il master lo chiede? (L'apertura automatica è limitata dai browser, sezione 3.)
- Quali viste hanno «Proietta» oltre a lightbox e combat tracker: schede pubbliche, atlante, mappa di battaglia con le pedine?
- Proiezione di una mappa: intera, o la porzione e lo zoom che il master sta guardando, con eventuale nebbia di guerra?
- Un solo proiettore, o più finestre (per esempio un tablet al tavolo in rete locale)? Oggi il server ascolta solo su 127.0.0.1.
