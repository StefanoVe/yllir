# Esperienza utente

**Stato:** Bozza di progetto
**Parte di:** [Framework per campagne di GDR](Framework%20per%20campagne%20di%20GDR.md)
Allineato alla [Riprogettazione](Riprogettazione.md) (2026-11-11).

Questo file descrive come il master vive il framework senza sapere cos'è un'intelligenza artificiale, un orchestratore o una versione salvata nel repository git. Ogni affermazione è marcata come **Deciso** (presente nelle decisioni dell'indice) oppure **Proposta** (idea di questo documento, da confermare). Il funzionamento sotto il cofano è descritto nel file [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md), la cui lettura non è necessaria per il master.

## Obiettivo

**Deciso.** Un master che non ha mai usato un'IA deve poter creare una campagna, preparare e giocare una sessione e aggiornarla dopo il gioco senza incontrare termini tecnici. Tutta la complessità resta sotto il cofano, e ciò che il framework produce deve essere fatto bene senza che l'utente sappia come.

## Punto d'ingresso unico

**Deciso.** Prima versione nel terminale o nell'app di Claude; nessuna interfaccia dedicata all'inizio.

**Proposta.** C'è un solo modo di cominciare: aprire la cartella della campagna e scrivere, nel terminale o nell'app, una frase qualunque. Il framework riconosce se la cartella è una campagna, se è nuova o se è già in uso, e risponde di conseguenza:

- cartella vuota: propone la creazione di una nuova campagna;
- campagna esistente: fa il riepilogo «dove eravamo rimasti» e attende;
- cartella non riconosciuta: chiede se si tratta di appunti da importare, oppure se l'utente vuole creare una campagna lì dentro.

Il master non sceglie mai un comando, una skill o una procedura. Dice «voglio preparare la sessione di giovedì» e il framework fa il resto.

Il comando di avvio dipende dal nome del framework, ancora da scegliere (nel piano dell'indice). Nel resto del documento si usa «il framework» come nome generico.

## Onboarding con una sessione di prova

**Proposta.** Al primo avvio il framework propone una sessione di prova di circa venti minuti, in una campagna di esempio separata da quella vera. La campagna di prova contiene un luogo, due personaggi non giocanti, una scheda di oggetto e una sessione già scritta.

Il percorso di prova fa quattro cose, in quest'ordine:

1. Chiede al master una frase su un luogo che gli piace, e crea una scheda con quella frase.
2. Prepara una breve sessione con la scheda appena creata.
3. Simula una sessione: il master scrive che cosa è successo, il framework aggiorna la campagna.
4. Mostra il ritorno: il master annulla una modifica con una frase, e la campagna torna com'era.

Alla fine, il framework chiede se cancellare la campagna di prova o tenerla come esempio. Nessuna cartella della campagna vera viene toccata.

## Lessico verso il master

Nei messaggi al master il framework usa soltanto le parole della colonna «Cosa vede il master» del glossario in [Principi](Principi.md). Se il master usa termini tecnici, il framework non li ripete. Nessun nome di modello o di strumento compare nel dialogo, salvo quando il master lo chiede esplicitamente: la generazione di immagini, per esempio, si chiama «il servizio per le illustrazioni».

## Versioni salvate, invisibili

**Deciso.** Il framework salva le versioni della campagna con git, nella cartella della campagna. Il master non deve sapere che esiste git. Git è un requisito: senza di esso il framework non scrive (vedi installazione).

**Deciso.** Il framework salva una versione solo quando una modifica è completata e verificata. Prima di iniziare un lavoro, le modifiche fatte a mano dal master si salvano in una versione a parte, così che restino distinguibili da quelle del framework.

**Proposta.** Ogni volta che una modifica è completata e verificata, il framework salva una versione e la descrive in una frase (esempio fittizio):

> Ho salvato questa versione: «Aggiunta la taverna del porto alla scheda di Ormesta».

Il master non deve fare nulla. Il framework non salva a metà un'operazione e non salva le bozze non confermate.

**Deciso (copia remota).** Non esiste un backup remoto gestito dal framework. L'unica copia remota possibile è un repository git privato che appartiene al master: il framework lo propone solo se il master lo vuole, e lo collega soltanto con il suo consenso. Quella copia contiene tutta la campagna, anche le note riservate.

### «Torna a com'era»

Il master chiede il ritorno in linguaggio naturale: «torna com'era ieri», «annulla l'ultima modifica alla taverna», «rimetti il capitolo del porto come era prima della sessione». Il framework:

1. elenca le versioni salvate pertinenti in frasi, con data e descrizione, e chiede quale scegliere;
2. mostra in parole che cosa cambierebbe (per esempio «tornerebbero tre frasi della scheda e una scena del capitolo»);
3. chiede conferma esplicita con una domanda semplice;
4. applica il ritorno salvando prima lo stato attuale come versione salvata, così che anche il ritorno sia annullabile;
5. conferma: «Fatto. La scheda è tornata com'era ieri. Lo stato di prima è salvato: se vuoi, posso ripristinarlo».

Il ritorno non cancella mai nulla in modo definitivo. Il master non deve scegliere fra «annulla» e «ripristina» come concetti tecnici: sono la stessa operazione in due direzioni.

## «Dove eravamo rimasti»

**Proposta.** All'apertura di una campagna esistente, il framework fa un riepilogo breve, al massimo cinque righe (Riprogettazione, decisione 15: il riepilogo nasce dal pacchetto di contesto e dalla nota sul lavoro in corso):

- l'ultima sessione, con data e titolo;
- le cose rimaste in sospeso: domande senza risposta, conflitti aperti, personaggi con una scelta ancora da fare;
- l'ultima versione salvata;
- una domanda: «Vuoi riprendere da qui, o preparare qualcos'altro?»

Il riepilogo non elenca tutto il lavoro fatto: solo ciò che serve per decidere cosa fare dopo.

## Conferme, dubbi ed errori

Il framework distingue tre tipi di messaggio e li presenta in modo diverso.

**Conferme.** Brevi e concrete, con il modo di annullare. Esempio fittizio: «Fatto: ho aggiunto Lenny alla scheda dei personaggi del porto. Se non va bene, di' «annulla» e torno indietro.»

**Dubbi.** Una domanda alla volta, con poche opzioni numerate e una raccomandazione. Il framework non chiede al master ciò che può decidere da sé per motivi tecnici. Chiede solo le decisioni che dipendono da lui: identità, canone, intenzione narrativa.

> Nella scheda del capitano compare due volte il nome del figlio, con due grafie diverse.
> 1. Usa la grafia della sessione precedente (consigliata).
> 2. Usa la grafia della scheda del porto.
> 3. Te lo chiedo più avanti.

**Errori.** Si dice che cosa non è andato, che cosa è rimasto invariato e cosa si può fare. Mai una traccia tecnica nel dialogo.

> Non sono riuscito a completare l'aggiornamento della sessione. Nessuna scheda è cambiata. Posso riprovare, oppure preferisci fare la modifica a mano e poi la controllo io.

I dettagli dell'errore finiscono in un registro che il master può consultare da solo, se vuole, ma che non viene proposto spontaneamente.

### Rispondere sul problema concreto

**Proposta.** Quando il master segnala un problema preciso, il framework risponde a quel problema.

- Una domanda su un limite («non puoi farlo?», «perché non ci riesci?») ha una risposta di una frase: che cosa non si può fare e qual è il passo successivo utile. Non si elencano le funzioni del framework.
- Un problema concreto (una scheda vuota, una scena da sistemare) viene trattato subito. La manutenzione (versioni vecchie, collegamenti ambigui) resta in sottofondo: non viene proposta a parte, a meno che il master la chieda o che sia necessaria per rispondere.

Quando completa una scheda, il framework separa ciò che la campagna già dice da ciò che inventa, e lo dichiara (Riprogettazione, decisione 7).

> **Master:** Non puoi completare una scheda che esiste già?
>
> **Assistente:** Sì, per personaggi, creature, venditori e luoghi: dimmi quale scheda, e completo le parti vuote: ciò che la campagna già dice lo riprendo, il resto lo inventerò e te lo dirò.

## Separazione automatica fra pubblico e master

**Proposta.** Il master scrive normalmente. Il framework separa ciò che i giocatori possono vedere da ciò che resta riservato, senza chiedere al master di fare la separazione.

- Il materiale pubblico sta nella parte alta della scheda.
- Le note riservate stanno in fondo, nel blocco riservato, che è l'ultimo contenuto del file. Le regole del blocco sono in [Formato dei contenuti](Formato%20dei%20contenuti.md).
- Quando il master dice «questo resta tra noi» o «questo lo scopriranno», il framework lo sposta nel blocco riservato e lo conferma in una frase.
- Quando il framework genera materiale da mostrare ai giocatori (una scheda stampata, un'enciclopedia pubblica), il blocco riservato non entra mai. Il master può verificarlo in anteprima.

**Proposta.** Il framework non decide da solo se un contenuto è segreto quando il dubbio riguarda la trama: chiede. Quando è un dettaglio tecnico, come l'ordine delle sezioni, decide e non lo segnala.

## Dialoghi di esempio

I dialoghi seguenti mostrano come il framework parla al master. Il seme del mondo è il documento che raccoglie ciò che vale per tutto il mondo, e il framework lo aggiorna man mano (Riprogettazione, sezione 4). «Master» è l'utente; «Assistente» è il framework. Il linguaggio è semplice: nessun termine dell'elenco di esclusione. Tutti i nomi che compaiono (Vessel, Ormesta, Mira, il capitano) sono **esempi fittizi**.

### 1. Creare una nuova campagna

> **Master:** Voglio creare una campagna in un mondo di città costruite sull'acqua. Non so da dove cominciare.
>
> **Assistente:** Possiamo cominciare in modo semplice. Prima una domanda: vuoi che ti accompagni con una breve sessione di prova, con una campagna di esempio che poi puoi cancellare, oppure preferisci partire subito dalla tua?
>
> **Master:** Partiamo dalla mia.
>
> **Assistente:** Bene. Dammi qualche informazione: il nome del mondo, il tono che vuoi (cupo, avventuroso, malinconico), il gioco che usate, e due o tre frasi su che mondo si tratta. Non serve che siano complete.
>
> **Master:** Il mondo si chiama Vessel. Tono malinconico. Giochiamo con un sistema nostro. Ormesta è una città costruita su palafitte in una laguna che cambia con le maree.
>
> **Assistente:** Ho creato la campagna «Vessel» con la premessa che mi hai dato, e ho salvato questa versione. Ormesta avrà la sua scheda quando la chiederai. Ti faccio due domande, una alla volta: chi governa Ormesta? E ci sono luoghi che i giocatori non devono conoscere subito?
>
> **Master:** Governa un consiglio di mercanti. E la torre sommersa resta segreta.
>
> **Assistente:** Annotato nel seme del mondo: il consiglio dei mercanti governa Ormesta, e la torre sommersa resta tra noi. Vuoi che prepari la prima sessione, oppure aggiungiamo un personaggio prima?

### 2. Preparare la sessione del giovedì

> **Master:** Giovedì i personaggi arrivano al porto. Voglio che incontrino il capitano.
>
> **Assistente:** Ho guardato la scheda del porto e quella del capitano. Il capitano è citato nella sessione 3, dove risulta in debito con i mercanti. Prima di preparare la scena: vuoi che il debito sia ancora attivo, o è stato saldato?
>
> **Master:** Ancora attivo.
>
> **Assistente:** Preparo la sessione «Il capitano e il debito». Ho messo in evidenza tre cose: l'apertura al porto, le due scelte possibili per il capitano, e la conseguenza se i personaggi pagano o no. Una cosa non torna: nella sessione 2 il capitano ha un'altra nave. Te lo segnalo nella scheda, senza cambiarla. Vuoi risolvere ora o lo lasciamo come domanda aperta?
>
> **Master:** Lasciamolo aperto.
>
> **Assistente:** Fatto. La sessione è pronta e il punto è nelle domande aperte. Ho salvato questa versione: «Preparata la sessione del capitano e del debito».

### 3. Aggiornare la campagna dopo la sessione

> **Master:** Abbiamo finito. Il gruppo ha pagato il debito, ma Mira è rimasta ferita e il capitano ha detto che rivedrà i personaggi presto.
>
> **Assistente:** Registro così: il debito è saldato dal gruppo; Mira è ferita; il capitano ha promesso un nuovo incontro. Una domanda sola: la ferita di Mira è grave o leggera? Le conseguenze cambiano per la prossima sessione.
>
> **Master:** Leggera, ma le impedisce di usare il braccio sinistro per una settimana di gioco.
>
> **Assistente:** Aggiornato. Ho aggiunto la ferita alla scheda di Mira con la durata, e il nuovo incontro col capitano è nelle cose in sospeso per la prossima sessione. Non ho cambiato nulla della sessione precedente. Ho salvato questa versione. Vuoi che prepari un riepilogo da leggere ai giocatori a inizio sessione?

### 4. Tornare indietro dopo un errore

> **Master:** Ieri ho cambiato la storia del porto e adesso non mi piace. Rimettila com'era.
>
> **Assistente:** Ho trovato due versioni salvate dopo la fine della sessione di ieri. La prima è «Aggiornato il porto dopo la sessione» (ore 18:40). La seconda è «Aggiunta la nuova storia del molo» (ore 19:15). Quale vuoi?
>
> **Master:** Il primo.
>
> **Assistente:** Se torno al punto delle 18:40, perdo le modifiche delle 19:15: il nuovo molo e le due scene collegate. Lo stato attuale resta salvato, quindi potrai ripristinarlo. Confermi?
>
> **Master:** Sì.
>
> **Assistente:** Fatto. Il porto è tornato com'era alle 18:40. Il molo nuovo è salvato come versione separata, se ti servisse più avanti.

## Installazione per chi non ha mai aperto un terminale

**Proposta, da verificare sulle versioni reali degli strumenti.** Il framework richiede una cartella del computer, un accesso all'assistente, git per salvare le versioni e, se possibile, il servizio per le illustrazioni. Nessuna di queste cose è richiesta per la sola lettura delle schede.

1. **Accesso all'assistente.** Creare un account e attivare l'accesso previsto dal fornitore per l'uso dell'app o dello strumento da terminale. Verificare sul sito ufficiale quale piano serve.
2. **Installazione dell'app o dello strumento.** Seguire la pagina ufficiale di installazione. Non si installano pacchetti trovati altrove.
3. **Cartella della campagna.** Creare una cartella con il nome della campagna, in un percorso a scelta che non sia sincronizzato con servizi cloud. **Evitare le cartelle sincronizzate con servizi cloud** (per esempio certe cartelle del computer che si copiano automaticamente online), perché possono interferire con i salvataggi delle versioni.
4. **Installazione del framework.** Scaricare e avviare l'installatore dalla pagina ufficiale del progetto; il framework si installa fuori dalla cartella della campagna (vedi [Architettura](Architettura.md) e [Installazione e requisiti](Installazione%20e%20requisiti.md)). Il comando da incollare nel terminale resta un'alternativa per chi lo preferisce.
5. **Primo avvio.** Il framework si presenta, verifica che gli strumenti necessari siano disponibili e propone la sessione di prova.

Per aprire il terminale: su macOS, premere Cmd e barra spaziatrice, digitare «Terminale» e premere Invio. Su Windows, cercare «PowerShell» dal menu Start. Il framework spiega questi passi nella propria pagina d'installazione e, se il terminale non si apre, offre la via dell'app.

**Proposta.** Se manca git, il framework lo rileva al primo avvio e lo propone in una frase: senza di esso non scrive nulla. Se manca il servizio per le illustrazioni, il framework lo dice una volta sola, spiega che le immagini non saranno generate e continua con il resto.

## Una sola chat, senza organizzare le richieste

Il master non deve aprire conversazioni nuove né ordinare le proprie richieste: il framework riprende il lavoro dal pacchetto di contesto e dalla nota sul lavoro in corso, senza argomenti né handoff (Riprogettazione, decisione 15; vedi [Gestione delle sessioni](Gestione%20delle%20sessioni.md)). Al massimo vede una riga come «Riprendo da dove avevamo lasciato la taverna».

## Questioni aperte

- Il nome del framework e il comando di avvio, da scegliere nel piano dell'indice.
- Il framework deve funzionare anche con la sola app, senza terminale, o il terminale è sempre necessario per la prima versione?
- Il percorso di installazione: chi distribuisce il pacchetto e con quale garanzia di provenienza?
- Il master deve poter vedere i registri tecnici, e dove?
- La sessione di prova: quanto deve durare, e cosa succede se il master la interrompe a metà?
- La separazione pubblico/riservato vale anche per le immagini, o solo per il testo?
- Quante opzioni proporre in una domanda al master: due, tre, o lasciarne una sola con la raccomandazione?
