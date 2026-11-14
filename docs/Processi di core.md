# Processi di core

**Stato:** Bozza di progetto
**Parte di:** [Framework per campagne di GDR](Framework%20per%20campagne%20di%20GDR.md)

Riscritto dopo la [Riprogettazione](Riprogettazione.md) (2026-11-11).

## Scopo del documento

Descrive i processi che il master vive durante una campagna, nella forma in cui sono implementati nella versione 0.30.0. Sono gli otto processi della [Riprogettazione](Riprogettazione.md), sezione 8:

1. creare la campagna;
2. costruire o ampliare il mondo, su richiesta del master;
3. creare o cambiare un documento da una descrizione;
4. preparare una sessione;
5. dopo la sessione: registrare la cronaca e applicare le conseguenze;
6. rispondere a una domanda sul mondo;
7. portare dentro materiale esistente;
8. tornare a una versione precedente.

Ogni processo è un'istruzione breve (obiettivo, vincoli, formato) che l'autore segue nella conversazione principale. Non ci sono più processi che girano in un sub-agent, né argomenti o handoff. Il master non sceglie mai una skill per nome e non vede i passi interni.

I nomi tra parentesi, come `yllir:after-session`, sono quelli usati dal framework; nei testi si usano i nomi in italiano. Le istruzioni di ciascun processo sono in `yllir/skills/core/<processo>/SKILL.md`.

**Processi precedenti non più descritti qui.** La versione precedente aveva anche il registro di sessione dal vivo, la manutenzione («fai ordine»), il riordino del canone, il ribilanciamento degli incontri, il completamento di una scheda e la ricerca musicale. Nessuno di questi è tra gli otto processi della Riprogettazione, e nella versione 0.30.0 non esistono come processi di core. Restano come questione aperta, in fondo.

## Come funzionano tutti i processi

### Riconoscimento del processo

- L'autore riconosce il processo dal significato della frase, non da parole chiave. *Implementato in 0.30.0.*
- Se due processi sono plausibili e la scelta cambia ciò che verrebbe scritto, pone una sola domanda con due opzioni in linguaggio comune, per esempio: «Vuoi preparare la prossima serata o registrare quella appena giocata?». *Implementato in 0.30.0.*
- La domanda sul mondo non è un processo: l'autore risponde leggendo il canone e non scrive nulla.

### Avvio

- I processi girano nella conversazione principale, nell'agente che parla con il master. Non c'è un processo che li esegue al posto dell'autore. *Deciso, 2026-11-11* (Riprogettazione, sezioni 1 e 9).
- Nessun processo di scrittura parte da solo. Fa eccezione l'import: quando il master condivide file, parte subito, senza chiedere. *Implementato in 0.30.0.*

### Ciclo di scrittura

Ogni processo che crea o modifica documenti usa lo stesso ciclo, descritto in [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md), sezione «Il ciclo di scrittura»:

1. contesto del motore (`context`), con il seme del mondo;
2. bozze scritte in `.campaign/drafts/`, mai direttamente nella campagna;
3. controllo del motore (`check`), senza scrivere: formato, schema dell'adattatore, grafo, mappa della trama, link;
4. revisione di un solo revisore del lotto, solo se il lotto aggiunge fatti al canone; esito `APPLY` o `FIX`;
5. scrittura del motore (`commit`), in un'unica transazione: salvataggio delle modifiche a mano, collocazione geografica, link sicuri, schede di sessione derivate, indici, nota sul lavoro in corso, una versione salvata.

Se il controllo o il commit fallisce, non si scrive nulla. *Implementato in 0.30.0.*

**Collegamenti sui documenti che menzionano un soggetto nuovo.** **Deciso** (2026-11-07): quando la scrittura crea un soggetto o un alias nuovo, si collega su ogni documento che lo menziona; l'indice dei soggetti dice quali sono. **Superata dalla Riprogettazione (2026-11-11):** il linker come skill è eliminato (sezione 9); i link li applica il motore nel commit, e le menzioni ambigue le giudica l'autore. La revisione è proporzionata: un lotto che sposta soltanto documenti non la richiede (*Deciso, 2026-11-11*, decisioni 5 e 14). Sostituisce il cablaggio di scrittura a otto passi della versione precedente, che era una skill eseguita dal modello economico (Riprogettazione, sezione 9).

### Ruoli

- **Autore**: decide che cosa scrivere, quali conflitti sono risolti, quali proposte accettare e quando chiedere. Riassume il risultato per il master. Scrive le bozze, anche delle schede fino a tre per lotto.
- **Esecutori economici**: `yllir:sheet-expander`, per le schede in serie oltre la soglia. Non decidono nulla che riguardi il canone.
- **Revisore del lotto**: `yllir:batch-reviewer`, in sola lettura, solo sui lotti che aggiungono fatti. Giudica solo le contraddizioni di senso, i segreti nel testo pubblico e le invenzioni presentate come citazioni.

Dettagli in [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md).

### Canone e identità

- Ciò che il master dice durante la sessione è un fatto dichiarato. Diventa canone nel processo «dopo la sessione», se il master lo afferma; le conseguenze che l'autore ricava da solo sono solo proposte. *Implementato in 0.30.0.*
- Le schede dedicate (personaggi, luoghi, oggetti) sono la fonte di verità per l'identità. Una sessione descrive il comportamento in scena e rimanda alla scheda; non ridefinisce nulla.
- Le fonti caricate (appunti, PDF, foto) sono prove. Un conflitto fra fonti non si risolve scegliendo una versione: si documenta e si chiede.

### Provenienza e invenzione

**Deciso, 2026-11-11** (decisioni 6 e 7). Ogni documento dichiara la sua provenienza: `master` (detto dal master), `played` (giocato al tavolo), `generated` (generato dal framework). Il framework inventa ciò che le fonti non danno e lo dichiara al master in una frase. Sostituisce «Fantasia del modello, bloccata per default» dell'indice e la chiave `allow_model_imagination`, che la migrazione rimuove.

Restano ferme due cose: la cronaca della serata riporta solo ciò che il master racconta, e la trascrizione del materiale importato è fedele alla fonte. Un'invenzione non si presenta mai come citazione di una fonte, e un segreto inventato sta solo nel blocco riservato.

**Superate** le sezioni «Fantasia del modello (2026-11-10)» della versione precedente, che bloccavano l'invenzione con un permesso per richiesta: la risposta a quattro opzioni e il principio 17 di [Principi](Principi.md) non valgono più.

### Lessico verso l'utente

Le parole mostrate al master sono nel lessico della skill di ingresso (`yllir/skills/core/yllir/lexicon.md`), nella lingua della campagna. I processi usano solo quelle parole nei messaggi: niente «bozza», «commit», «revisione», «script», «file».

### Errori comuni

- Un passo fallito si dichiara fallito, con il materiale coinvolto e ciò che resta da fare. Nessun processo dice «fatto» senza un risultato verificato. Si usa la frase fissa del lessico per le operazioni non completate.
- Se il revisore del lotto non risponde o l'esito non è `APPLY`, nulla si applica: il lotto resta in bozza e il master è informato. *Implementato in 0.30.0.*
- Se manca git, nessun processo scrive: il processo lo dice in una frase e propone l'installazione (vedi [Esperienza utente](Esperienza%20utente.md)). Questa regola viene dalla versione precedente e non è ancora rivista.
- Un conflitto con il canone ferma la scrittura interessata e porta la domanda al master.
- Un documento che il master ha cambiato a mano non viene sovrascritto: il motore salva le modifiche a parte e il master è avvisato. *Implementato in 0.30.0.*

## 1. Creare la campagna

**Frasi che lo attivano:** «voglio creare una campagna», «ho in mente un mondo, aiutami a metterlo in ordine», «ricominciamo da zero», «nuovo gioco, nuovo mondo».

**Prerequisiti:** la cartella è vuota. Se contiene già una campagna, il processo lo dice in una frase e si ferma. Se una creazione precedente si è interrotta, riprende dai file già scritti, senza rifare l'inizializzazione.

**Spostato in libreria (2026-11-11):** la skill è in `skills/library/new-campaign/`; il processo resta descritto qui, invariato.

**Passi** (`yllir:new-campaign`, *implementato in 0.30.0*):

1. **Primo giro di domande, a scelta.** Lingua; gioco di ruolo (se corrisponde a un adattatore installato, oggi `dnd-2024`, le sue regole si applicano da subito; se non c'è un adattatore, la campagna funziona lo stesso e il master lo sente in una frase); tono (evocativo, asciutto o colloquiale); materiale di un mondo condiviso, sì o no. Le domande già risposte nel primo messaggio non si ripetono.
2. **Secondo giro, a testo libero.** Solo ciò che manca: il nome della campagna, la premessa (due o tre frasi sul mondo e sulla storia; se manca, una frase di default), il percorso della cartella condivisa, se il master ha risposto sì.
3. **Riepilogo e una conferma.** In parole semplici: nome, lingua, tono, gioco, materiale condiviso, e i due documenti che verranno scritti. Salta la conferma se il messaggio del master la contiene già.
4. **File core.** La configurazione della campagna, la cartella del mondo (come categoria dei luoghi) e il repository git con la prima versione. Se il master ha un mondo condiviso, la sua cartella si collega come categoria `external` in sola lettura; se il collegamento fallisce, la campagna si crea lo stesso e il master lo sente in una frase.
5. **Due documenti iniziali**, scritti con il ciclo di scrittura: il seme del mondo (`Seme del mondo.md`, o `World seed.md` in inglese), con la premessa, il tono e il gioco; e la descrizione del mondo nella cartella del mondo (**Deciso**, 2026-11-07: la scheda radice del mondo è `Mondo/<Nome del mondo>.md`, con la premessa come primo testo). Quando nasce il primo sotto-luogo, la scheda diventa una cartella con la scheda omonima, tramite uno spostamento di `continuity-keeper` (**Deciso**, 2026-11-07; lo strumento non è descritto nella 0.30.0, da verificare).
6. **Prima versione salvata**, con il messaggio della creazione.
7. **Chiusura.** Due o tre frasi d'esempio per proseguire («descrivimi il primo luogo», «prepariamo la prima sessione», «ho degli appunti da importare»).

**Deciso.** L'intervista serve solo a creare i primi file core della campagna. Tutto il resto (luoghi, personaggi, oggetti, economia, moduli, stili) lo costruisce il master poco alla volta, quando gli serve, con gli altri processi. *Confermato dalla Riprogettazione, decisione 8 (2026-11-11).* Le altre categorie nascono la prima volta che servono (principio di economia della campagna). Le domande su categorie di documenti, regole del canone, giocatori, ritmo, finali, combattimenti, immagini, stampa, enciclopedia, musica e materiale da importare si pongono quando servono, non all'inizio.

**Deciso (2026-11-09):** l'intervista funziona così.

- **Domande vere, non testo.** Le domande si pongono al master con lo strumento di domanda interattivo dell'agente principale: scelte fra poche opzioni, con la possibilità di rispondere a parole proprie. Il processo gira in un sotto-agente senza accesso al master: restituisce le domande a scelta in forma strutturata, e la skill di ingresso le pone. Le risposte libere (nome della campagna, premessa del mondo, percorso di una cartella) restano domande in testo semplice. *Nota 2026-11-11:* nella 0.30.0 il processo gira nella conversazione principale, senza sotto-agente (*Deciso, 2026-11-11*, Riprogettazione sezioni 1 e 9); la regola sulle domande a scelta resta.
- **Due giri.** Il primo giro è a scelta: lingua, gioco di ruolo, tono e, se c'è, il materiale di un mondo condiviso (sì o no). Il secondo giro è a testo libero e chiede solo ciò che manca: il nome, la premessa e, se il master ha risposto sì, il percorso della cartella condivisa. Se il primo messaggio del master contiene già le risposte, non si chiede nulla.
- **Il gioco si applica subito.** Se il gioco scelto corrisponde a un adattatore installato (oggi `dnd-2024`), `system.adapter` della configurazione lo contiene fin dalla creazione, e il master sente che le regole di quel gioco sono applicate. Se non c'è un adattatore per quel gioco, la campagna funziona lo stesso, senza regole di gioco, e il master lo sente in una frase.
- **Il materiale condiviso si collega subito.** Se il master ha materiale di un mondo condiviso, il processo lo collega alla campagna come categoria `external` (collegamento simbolico alla sua cartella, in sola lettura) fin dalla creazione. Se il collegamento fallisce, la campagna viene creata lo stesso e il master lo sente in una frase.
- **Nulla si perde.** Le informazioni date oltre le risposte alle domande, o dopo la creazione (gioco, cartella condivisa, altri dettagli sul mondo), si applicano così. Durante la creazione, dopo la creazione dei file core: le impostazioni nella configurazione, e i dettagli sul mondo nella scheda radice, con le sole parole del master. Dopo la creazione, il processo ha una modalità «completamento» che le applica a una campagna esistente. La scheda radice e la configurazione si completano, non si ricreano. *Nota 2026-11-11:* la modalità «completamento» non è nella 0.30.0 e non è descritta come implementata.

**Cosa vede l'utente:** le domande dell'intervista, poi il riepilogo e la conferma, poi le frasi per proseguire.

**Output:** configurazione della campagna, seme del mondo, descrizione del mondo, repository git con la prima versione.

**Conferme richieste:** una sola, prima di creare i file core.

**Errori:** una cartella con già una campagna: il processo non la tocca e lo dice. Una scrittura non riuscita: la frase fissa del lessico, nulla è perso, si può riprovare.

## 2. Costruire o ampliare il mondo

**Frasi che lo attivano:** «crea la regione intorno al lago», «riempi il villaggio di personaggi», «aggiungi una fazione del sale», «fammi un po' di storia per la costa».

**Prerequisiti:** la campagna è configurata. Il seme del mondo esiste: ogni scelta deve essere coerente con esso.

**Passi** (`yllir:build-world`, *implementato in 0.30.0*):

1. **Richiesta.** Si legge la configurazione (lingua, adattatore, seme) e si annota in una frase che cosa il master ha chiesto.
2. **Contesto.** Il comando `context` con i soggetti già nominati nella richiesta. Gli id dei soggetti esistenti sono gli unici che si possono usare nei legami verso soggetti già presenti.
3. **Scaletta.** Una riga per soggetto, con sette colonne: titolo, id, tipo, luogo, legami, una frase, e il numero sulla cronologia per gli eventi. Tutti i legami si decidono qui, in un solo passaggio. Una regione è di solito fra cinque e trenta righe; oltre si divide la richiesta in due passate e lo si dice in una frase. Se la scaletta aggiunge fatti per tutto il mondo (una fazione, una convenzione dei nomi, un tema), va nel seme nello stesso lotto.
4. **Divisione.** Le righe che servono subito diventano schede complete, scritte dall'autore fino a tre, poi da un `sheet-expander` per scheda. Tutte le altre diventano abbozzi (`sketch: true`): un documento valido del canone, con nome, tipo, legami e una frase. Nessuna riga si perde. *Deciso, 2026-11-11* (Riprogettazione, sezione 5 e decisione 13).
5. **Lotto.** Un solo lotto con tutte le bozze: controllo, eventuale revisione, scrittura.
6. **Illustrazioni degli oggetti** (*Deciso, 2026-11-14*): dopo il salvataggio, per ogni scheda oggetto nuova del lotto (non un annuncio) parte l'illustrazione, con `yllir:images`; al massimo cinque, le altre si fanno su richiesta. Salta se il master ha detto di non farle, o se `workflow.auto_item_images` è falso.
7. **Messaggio.** Che cosa è stato creato, con i nomi principali; che tutto è inventato, quindi cambiabile; che cosa è solo un abbozzo e sarà completato quando serve.

**Deciso, 2026-11-11** (Riprogettazione, sezione 5): la generazione avviene a passate (scaletta, espansione, coerenza) e **senza conferma**: il master non approva la scaletta. Il framework genera, dice in poche frasi che cosa ha creato, e il master corregge parlando.

**Deciso, 2026-11-11** (Riprogettazione, sezione 4): il seme cresce da solo. Ogni volta che un lotto aggiunge un'informazione per tutto il mondo, il seme si aggiorna nello stesso lotto. Il master lo può correggere in qualunque momento parlando.

**Cosa vede l'utente:** il messaggio finale, in una dozzina di righe al massimo.

**Output:** nuove schede complete, abbozzi, eventuale aggiornamento del seme, una versione salvata.

**Conferme richieste:** nessuna.

**Errori:** richiesta ambigua su più soggetti con lo stesso nome: una sola domanda. Controllo non superato: la frase fissa del lessico, nulla scritto.

## 3. Creare o cambiare un documento

**Frasi che lo attivano:** «crea un oste burbero al Vecchio Mulino», «cambia la descrizione del lago», «espandi la scheda di Ilde», «la scheda della guardia è praticamente vuota».

**Prerequisiti:** la campagna è configurata. Per cambiare o espandere, il documento si trova con il comando `query find`.

**Passi** (`yllir:write-document`, *implementato in 0.30.0*):

1. **Operazione.** Dalla richiesta si decide se è una creazione, una modifica o l'espansione di un abbozzo. Per le modifiche e le espansioni si trova il documento con il comando `query find`. Se ce ne sono più d'uno, si chiede al master quale, in una frase.
2. **Contesto.** Come nel processo 2.
3. **Tipo e modello.** Il tipo è uno fra luogo, personaggio (PNG o venditore), creatura (nemico o no), oggetto (oggetto o annuncio), fazione, evento storico. I campi del modello sono nel formato dei contenuti (`templates/content-format.md`); i campi facoltativi di luoghi e personaggi (abitanti, punti d'interesse, motivazioni, legami, segreti, agganci di trama) si compilano quando la richiesta li dà o il contesto li richiede.
4. **Valori di regola.** Solo se la campagna ha un adattatore: statistiche, difficoltà, prezzi ed effetti vengono dalla conoscenza del sistema o da una ricerca che non riceve il blocco riservato; il motore ne controlla forma e aritmetica. Senza adattatore, restano a parole. *Deciso, 2026-11-11* (decisione 10); *il controllo è implementato in 0.30.0*.
5. **Piano e conferma** (*Deciso, 2026-11-14*): prima di scrivere, l'assistente riassume ciò che creerà o cambierà, i documenti toccati e ciò che inventerà, e chiede al master se può procedere. Con `workflow.auto_accept: true` in `campaign.yaml` (predefinito falso) salta la domanda e scrive subito.
6. **Bozza.** Un solo documento, con la sua provenienza. Un documento `generated` si può cambiare liberamente; un documento `master` o `played` non si sovrascrive né si contraddice.
7. **Conseguenze.** Il comando `query related` e `query timeline` dicono quali altri documenti dipendono dalla modifica. Quelli che la modifica rende incoerenti si correggono nello stesso lotto, cambiando solo le righe in conflitto. Un documento `master` o `played` in conflitto non si cambia: il conflitto va al master.
8. **Scrittura.** Il ciclo di scrittura, con tutte le bozze nello stesso lotto.
9. **Illustrazione dell'oggetto** (*Deciso, 2026-11-14*): dopo il salvataggio, se la scheda è un oggetto nuovo del lotto (non un annuncio) e non ha ancora un'immagine, parte la sua illustrazione con `yllir:images`, senza altre richieste; le schede cambiate o espanse non la ricevono. Salta se il master ha detto di non farle, o se `workflow.auto_item_images` è falso.
10. **Messaggio.** Che cosa è stato creato o cambiato, per nome; che cosa è inventato («L'ho inventato io: il suo passato e il suo debito»); che cosa resta a parole perché non c'è un adattatore; quali altri documenti sono cambiati per la modifica.

**Cosa vede l'utente:** il messaggio finale, senza parole tecniche.

**Output:** un documento creato o cambiato, eventuali documenti collegati, una versione salvata.

**Conferme richieste:** una, il piano prima di scrivere, saltata con `workflow.auto_accept: true`. Un conflitto con un documento `master` o `played` attende la decisione del master.

**Errori:** più documenti con lo stesso nome: una sola domanda. Il documento che il master ha cambiato a mano: le sue modifiche si salvano a parte e il master è avvisato. Il tipo non ha un modello: il processo lo dice e propone il tipo più vicino.

## 4. Preparare la sessione

**Frasi che lo attivano:** «preparo la prossima serata», «cosa succede nella prossima sessione?», «ho due scene, quali ritrovo», «prepariamo il combattimento col capitano», «cambia il debito dei minatori».

**Prerequisiti:** la campagna è configurata. Le sessioni giocate si leggono dalle cronache (`played`); una sessione è pronta quando tutte le sue dipendenze sono giocate.

**Passi** (`yllir:prepare-session`, *implementato in 0.30.0*):

1. **Stato della storia.** Si legge `campaign.yaml`, si leggono le pagine più recenti della cronaca e le sessioni (il file principale di ciascuna cartella di sessione). Una sessione è *giocata* se il suo id compare in una pagina della cronaca; è *pronta* se tutte le dipendenze sono giocate.
2. **Bersaglio.** La sessione che il master nomina, oppure l'unica pronta e non giocata. Se ce ne sono più d'una, una domanda sola con i loro nomi. Se il bersaglio non è pronto, una domanda sola: procedere comunque?
3. **Cartella esistente.** Se la sessione esiste già, si cambia solo ciò che il master chiede. Un file con `provenance: played` non si cambia mai. Se il master chiede di cambiare una sessione già giocata, il processo lo dice e si ferma.
4. **Piano delle scene.** Prima dei file, una riga per scena: id, che cosa accade, dove, chi c'è, quali oggetti contano e da quali scene dipende. Le dipendenze si decidono qui, in un solo passaggio: le prime scene non dipendono da nulla; una scelta fa dipendere più scene dalla stessa; una scena che riunisce più rami dipende da tutti.
5. **Personaggi, luoghi e oggetti.** Per ogni nome usato dalle scene si cerca il soggetto con `query find`. Un soggetto esistente si riusa com'è: si può citare, mai ridefinire. Un soggetto mancante si crea nello stesso lotto. Un abbozzo che la sessione usa si espande in scheda completa, con lo stesso id.
6. **Lotto.** Il file principale della sessione è solo uno stub (id, dipendenze, provenienza): il motore ricostruisce il corpo e l'elenco delle scene. Ogni scena è un file nella cartella `Eventi/`, con id, sessione, dipendenze, luogo e personaggi, e provenienza `generated`. Insieme, le schede nuove e il seme, solo se la sessione aggiunge qualcosa per tutto il mondo.
7. **Illustrazioni degli oggetti** (*Deciso, 2026-11-14*): dopo il salvataggio, per ogni scheda oggetto nuova della sessione (non un annuncio) parte l'illustrazione, con `yllir:images`; al massimo cinque, le altre si fanno su richiesta. Salta se il master ha detto di non farle, o se `workflow.auto_item_images` è falso.
8. **Messaggio.** Che cosa è pronto, che cosa è stato inventato, che cosa resta da completare, e le illustrazioni avviate.

**Invenzione.** Ciò che le fonti non danno si inventa: un nome, un luogo, un legame, un passato. Ogni invenzione si dichiara al master nel messaggio. Un segreto (ciò che qualcuno nasconde, la vera causa di un evento) sta solo nel blocco riservato. *Deciso, 2026-11-11* (decisione 7).

**Modalità revisione.** **Deciso (2026-11-09).** Il master può cambiare alcune scene di una sessione già preparata e non ancora giocata («cambia il debito dei minatori», «la consegna dei documenti avviene in un'altra scena»: aggiorna quattro scene già scritte). Non è un processo nuovo: è la modalità revisione del processo di preparazione. Il processo riscrive solo le scene nominate, e il documento principale della sessione solo se il suo testo ne dipende. Passi: identifica la sessione e le scene (una sola domanda se non sono chiare); rifiuta, in parole semplici, una sessione già giocata (lo stato «giocata» della trama), senza scrivere nulla; legge le scene e i documenti coinvolti, e le sessioni che dipendono da quella (sola lettura); riscrive solo le scene cambiate, lasciando identico il resto; passa per la scrittura (salvataggio delle modifiche a mano, revisione, scrittura, collegamenti, verifica, versione salvata); se una scena cambia ordine, entrate, uscite o scelte, ricontrolla i collegamenti della trama per quella sessione. Gli identificativi e i nomi dei file delle scene restano; le sessioni diverse da quella indicata non si scrivono mai, e quelle che dipendono dalla modificata si segnalano al master. Aggiungere o togliere una scena non è previsto in questa versione: il processo lo dice e si ferma. Il messaggio finale dice quali scene sono cambiate e che cosa è rimasto com'era. *Nota 2026-11-11:* la revisione del lotto è quella della decisione 5 (Riprogettazione), e la verifica della trama è del motore.

**Cosa vede l'utente:** la lista di ciò che è pronto e di ciò che manca, le scene in parole semplici, le invenzioni dichiarate.

**Output:** file principale di sessione (derivato), un file per scena, schede nuove o aggiornate, eventuale seme.

**Conferme richieste:** una domanda per la sessione non pronta; una per la scelta fra più sessioni. Nessuna conferma per le scene.

**Errori:** una dipendenza non giocata si dichiara, non si nasconde. Un nome che corrisponde a più soggetti: una domanda. Un errore del motore nel grafo della trama: il lotto non si scrive, e la correzione torna alle scene.

## 5. Dopo la sessione

**Frasi che lo attivano:** «abbiamo finito», «chiudiamo la serata», «ieri i giocatori hanno…», «aggiorna la campagna con quello che è successo».

**Prerequisiti:** il master descrive la serata. Serve almeno un racconto con due eventi concreti: cose accadute al tavolo, con chi, dove o che cosa si è trovato. Se il racconto è troppo povero, una domanda sola.

**Passi** (`yllir:after-session`, *implementato in 0.30.0*):

1. **Data e pagina.** La data è quella del master, altrimenti oggi. La pagina della cronaca è `<data>.md` nella cartella delle cronache. Se esiste già, si usa `<data>-b`, poi `<data>-c`. Una pagina vecchia non si apre né si cambia mai: se il master lo chiede, il processo si ferma e lo dice.
2. **Sessioni giocate.** Il master nomina le sessioni giocate, confrontate per nome. Se la serata non è stata una sessione della trama, nessuna è segnata. Se non è chiaro quale sia stata giocata, una domanda sola. Se una sessione dipende da un prerequisito che non risulta giocato, una domanda sola: registrarla comunque?
3. **Cronaca (fase 1).** Una pagina nella lingua della campagna, con due sezioni: che cosa è accaduto, e i fili aperti. Contiene solo ciò che il master ha detto. Un'ipotesi detta al tavolo resta un'ipotesi. Nessun nome, luogo, esito o numero che il master non ha detto.
4. **Conseguenze (fase 2).** Per ogni nome usato dal master si cerca il soggetto con `query find` e si leggono i documenti trovati, blocchi riservati compresi. Si distinguono due elenchi:
   - **dichiarate**: i cambiamenti che il master ha detto avvenuti (un fatto nuovo su una scheda, una relazione cambiata, una morte con la sua data, una distruzione, un evento con la sua posizione nella cronologia). Si scrivono, ciascuna nel documento interessato, con le sole righe cambiate;
   - **proposte**: ciò che la serata sembra implicare ma il master non ha detto, e ogni invenzione. Non si scrivono: si elencano nel messaggio.
   Possesso, luogo, stato ed effetti non si deducono mai dagli eventi.
5. **Lotto.** La pagina della cronaca e i documenti cambiati stanno nello stesso lotto. Il messaggio di commit è una frase, per esempio «Registrata la serata del `<data>`».
6. **Messaggio.** Che cosa è stato registrato; quali cambiamenti dichiarati sono stati applicati; quali proposte restano da decidere, in forma di domanda.

**Deciso, 2026-11-11** (Riprogettazione, sezione 8): il processo scrive la cronaca e applica le conseguenze dichiarate; le altre le propone. Sostituisce il passo «Canone» più le fasi separate della versione precedente: cronaca e conseguenze sono due fasi di un solo lotto.

**Cosa vede l'utente:** la cronaca in una forma leggibile, le modifiche applicate, le proposte in forma di domanda.

**Output:** pagina della cronaca, documenti cambiati per le conseguenze dichiarate, una versione salvata.

**Conferme richieste:** non servono per i fatti che il master ha detto. Un conflitto con il canone attende la decisione del master, e il processo non scrive la parte in conflitto.

**Errori:** un racconto troppo povero: una domanda. Un conflitto nella scrittura: la scrittura si ferma e la domanda è portata al master, come nel ciclo di scrittura.

## 6. Rispondere a una domanda sul mondo

**Frasi che lo attivano:** «chi è…», «dove si trova…», «cosa dice la campagna su…», «il capitano è vivo?».

**Passi** (nella skill di ingresso, `yllir:yllir`, *implementato in 0.30.0*):

1. Il comando `query` con il sottocomando adatto (`find`, `at`, `where`, `related`, `timeline`, `sketches`, `errors`). Quando serve più contesto, il comando `context` con i soggetti nominati.
2. Lettura dei documenti che la risposta cita, blocchi riservati compresi: l'autore lavora sul canone.
3. Risposta in parole semplici: prima la risposta diretta, poi i documenti su cui si basa, citati per titolo e mai per percorso. Si dice chiaramente quando il canone non dice nulla, quando qualcosa è un'ipotesi o l'affermazione di un personaggio, e quando due persone hanno lo stesso nome.

**Nessun sub-agent e nessuna scrittura.** La ricerca sul canone (`canon-research`) della versione precedente è eliminata; la risposta la dà l'autore, con il motore e la lettura dei documenti (*Deciso, 2026-11-11*, Riprogettazione sezione 9; *implementato in 0.30.0*).

**Output:** solo la risposta.

**Errori:** una domanda sul canone che il motore non trova: l'autore lo dice e non inventa.

## 7. Portare dentro materiale esistente

**Frasi che lo attivano:** «ho degli appunti da digitalizzare», «ti mando le foto del quaderno», «questo PDF è la mia vecchia campagna», «importa questa scheda», o semplicemente la condivisione di foto, scansioni o documenti.

**Prerequisiti:** la campagna è configurata. Se non lo è, si propone prima la creazione della campagna (processo 1), con il materiale già in mano.

**Avvio.** Quando il master condivide file, il processo parte subito, senza chiedere. *Implementato in 0.30.0.*

**Spostato in libreria (2026-11-11):** la skill è in `skills/library/import/`, con l'ingest di documenti incluso; il processo resta descritto qui, invariato.

**Passi** (`yllir:import`, con l'ingest di documenti incluso, *implementato in 0.30.0*):

1. **Impostazioni.** Lingua della campagna e cartella delle fonti (`Fonti/` in italiano, `Sources/` in inglese). Se la cartella non esiste, si crea.
2. **Risposta in sospeso.** Se la nota sul lavoro in corso dice che un import attende la risposta del master, la risposta si applica prima di tutto il resto.
3. **File.** I percorsi condivisi dal master si controllano uno per uno: se mancano, si dice quale.
4. **Data e provenienza.** La data è quella di oggi. La provenienza è ciò che il master ha detto sull'origine del materiale, in poche parole; altrimenti `unknown`.
5. **Acquisizione.** La parte di ingest della skill `import` conserva gli originali senza modificarli, ne fa la trascrizione fedele, la scompone in affermazioni verificabili, le fa controllare dal revisore della trascrizione (`ingest-reviewer`, riga per riga) e le integra nei documenti esistenti senza duplicarli. Quando una lettura è dubbia, pone una domanda alla volta e riprende quando il master risponde.
6. **Messaggio.** Dalla relazione della skill: stato, fonti acquisite, pagine integrate, duplicati, invenzioni, e la domanda aperta, se c'è, in una sola frase.

**Deciso, 2026-11-11** (decisione 7): la trascrizione del materiale importato resta fedele alla fonte e non si inventa nulla in essa. Le invenzioni del processo, quando la scheda integrata manca di un dato, si dichiarano nel messaggio.

**Cosa vede l'utente:** la relazione finale in linguaggio comune, con le pagine illeggibili elencate e le domande raggruppate.

**Output:** originali in `Fonti/` (o `Sources/`), trascrizioni, documenti della campagna aggiornati, una versione salvata con le fonti.

**Conferme richieste:** quando un dubbio blocca l'integrazione, il master risponde prima che il passo venga applicato. Il silenzio non vale come conferma. Un conflitto con il canone attende la decisione del master.

**Errori:** una pagina illeggibile non si completa con un'invenzione: resta marcata. Un import interrotto lascia le fonti già acquisite e segnala che cosa manca; non si dichiara completo. *Proposta*: il messaggio di interruzione è da verificare sul testbench.

## 8. Tornare a una versione precedente

**Frasi che lo attivano:** «torna a com'era», «annulla l'ultima modifica», «riporta la campagna a ieri».

**Passi** (nella skill di ingresso, `yllir:yllir`; il percorso passa dallo script delle versioni, `versions.mjs`):

1. Si elencano le ultime versioni salvate, con data e descrizione.
2. Si sceglie la versione. «Annulla l'ultima modifica» significa la versione appena prima dell'ultima. Una data o una descrizione indica la versione corrispondente. Se sono plausibili due versioni, una domanda sola, con al massimo tre scelte numerate, con date.
3. Una conferma: a quale versione si torna, e che le versioni successive restano nella storia e si possono recuperare. Si salta solo se il master l'ha già confermato, e la versione è univoca.
4. Se ci sono modifiche a mano non ancora salvate, si salvano in una versione a parte.
5. Si torna alla versione scelta; se il master ha nominato un solo documento, solo quello.
6. Un messaggio: che cosa è com'era, e che «torna a com'era» annulla anche questo.

**Deciso, 2026-11-11** (Riprogettazione, sezione 8: «tornare a una versione precedente»). Le versioni sono quelle di git, già salvate dal motore a ogni commit (*implementato in 0.30.0*). Il ritorno indietro non riscrive la storia.

**Output:** la campagna com'era nella versione scelta, con la versione del ritorno salvata.

**Errori:** nessuna versione disponibile: lo si dice. Un ritorno non riuscito: la frase fissa del lessico, nulla è perso.

## Aggiornamento e migrazione (non è un processo del master)

Non compare tra gli otto processi: l'aggiornamento del framework lo gestisce la skill `yllir:update`, che la skill di ingresso legge e il master non chiama.

- Dopo un aggiornamento, un controllo allinea la campagna. Il master decide sul sì o no alla notifica di aggiornamento: non si aggiorna mai senza un «sì» chiaro. *Implementato in 0.30.0.*
- Una migrazione post-update porta la campagna al nuovo formato: aggiunge a ogni documento i metadati di tipo e di provenienza (tutto il contenuto esistente diventa `master`, lasciando il resto dei byte com'è), crea il seme del mondo dalla descrizione precedente, rimuove la chiave `allow_model_imagination`, trasforma i temi aperti in nota sul lavoro in corso, ricostruisce gli indici e salva una versione. È riprendibile e reversibile con git (salvo lo stato locale). *Deciso, 2026-11-11* (Riprogettazione, sezione 10); *implementato in 0.30.0* con la migrazione `world-graph-v1`.
- Un'interruzione si dichiara, e il master sceglie tra riprendere l'aggiornamento o tornare com'era.

## Tabella riassuntiva

| Processo | Skill | Scrive | Controllo |
|---|---|---|---|
| Creare la campagna | `yllir:new-campaign` | File core, seme, descrizione del mondo, prima versione | Una conferma; nessuna revisione di lotto |
| Costruire o ampliare il mondo | `yllir:build-world` | Scaletta, schede complete, abbozzi, eventuale seme | Controllo del motore; revisione del lotto se aggiunge fatti |
| Creare o cambiare un documento | `yllir:write-document` | Il documento e i documenti che dipendono da esso | Controllo del motore; revisione se aggiunge fatti |
| Preparare la sessione | `yllir:prepare-session` | Stub della sessione, scene, soggetti nuovi, eventuale seme | Controllo del motore, grafo della trama; revisione del lotto |
| Dopo la sessione | `yllir:after-session` | Cronaca, cambiamenti dichiarati | Controllo del motore; revisione del lotto |
| Domanda sul mondo | `yllir:yllir` (risposta diretta) | Nulla | Nessuno: lettura |
| Portare dentro materiale | `yllir:import` (con l'ingest di documenti) | Fonti, trascrizioni, documenti integrati | Revisione della trascrizione; controllo del motore; revisione del lotto |
| Tornare a una versione | `yllir:yllir`, `versions.mjs` | Ritorno a una versione, con la versione del ritorno | Conferma; nessuna revisione |

## Questioni aperte

Le questioni marcate **Superata dalla Riprogettazione (2026-11-11)** restano qui per memoria, con la ragione.

- **Nomi dei processi.** Le etichette degli otto processi sono comprensibili per il master? Va verificato con un utente che non ha mai usato un'IA, in [Esperienza utente](Esperienza%20utente.md).
- **Preparazione e dopo la sessione.** La preparazione scrive documenti di sessione: vanno considerati parte del processo dopo la sessione o restano un documento separato? **Superata dalla Riprogettazione (2026-11-11):** sono due processi distinti nella sezione 8.
- **Confini del processo «dopo la sessione».** La creazione di carte degli oggetti appartiene a questo processo o solo alla manutenzione? Proposta: la carta si genera al momento dell'oggetto, non a fine sessione, per evitare di aspettare. *Aperta:* la versione 0.30.0 non descrive le carte, e questa domanda resta da chiudere con il processo di creazione di oggetti.
- **Conferme sulle conseguenze.** Quali conseguenze sulle sessioni future richiedono conferma esplicita? Il processo dopo la sessione applica solo le conseguenze dichiarate dal master e propone le altre; le proposte che riscrivono una sessione futura richiedono una conferma. *Aperta.* Aggiunta (2026-11-09): riscrivere una sessione non ancora giocata è esplicito per natura, perché è il master a chiederlo.
- **Revisione dell'import.** L'import di materiale condiviso senza richiesta deve sempre chiedere il permesso prima di scrivere, o solo quando il materiale tocca il canone? L'import oggi parte subito quando i file sono condivisi. *Aperta:* l'autore decide il limite.
- **Ordine dei passi «Canone» e «Conseguenze».** **Superata dalla Riprogettazione (2026-11-11):** cronaca e conseguenze sono due fasi di un solo lotto, senza ordine da stabilire (sezione 8).
- **Fonti consentite per le regole.** **Superata dalla Riprogettazione (2026-11-11):** le statistiche si possono ricavare dalla conoscenza del modello o da una ricerca, che non riceve mai il blocco riservato, e lo schema dell'adattatore le valida (decisione 10). Il web non è più escluso per principio, ma la ricerca non riceve il blocco riservato.
- **Oggetti e annunci.** Il completamento di una scheda vale anche per oggetti e annunci, o solo per personaggi, creature, venditori e luoghi? **Superata dalla Riprogettazione (2026-11-11):** il completamento di una scheda non è più un processo di core (sezione 8); la domanda torna se il processo viene ripreso.
- **Conferma delle proposte creative.** Le proposte creative vanno confermate dal master prima di scrivere, o si scrivono e si segnalano come proposte da cambiare dopo? **Superata dalla Riprogettazione (2026-11-11):** la generazione è senza conferma: il master corregge parlando (decisione 3, sezione 5).
- **Aggiunta (2026-11-11), da decidere.** Manutenzione («fai ordine»), riordino del canone, ribilanciamento degli incontri, registro di sessione dal vivo e completamento di una scheda non sono tra gli otto processi della Riprogettazione, e nella versione 0.30.0 non esistono come processi di core. Tornano come processi o restano fuori? Se tornano, la loro descrizione va scritta da capo, con il motore.
- **Aggiunta (2026-11-11), da decidere.** La ricerca musicale (`music-search`), che la versione precedente avviava quando si creava un luogo, non compare né nella sezione 8 della Riprogettazione né nella versione 0.30.0. Resta una funzione opzionale da riprendere o si elimina?
