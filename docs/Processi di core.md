# Processi di core

**Stato:** Bozza di progetto
**Parte di:** [Framework per campagne di GDR](Framework%20per%20campagne%20di%20GDR.md)

## Scopo del documento

Descrive i processi che il master vive durante una campagna: la creazione iniziale, la preparazione della sessione, la sessione giocata, il lavoro dopo la sessione, il riordino del canone, il ribilanciamento degli incontri, la manutenzione dell'archivio, l'import di materiale già esistente e il completamento di una scheda. Ogni processo è una skill di core: si attiva da una frase in linguaggio naturale, segue passi fissi e richiama, nell'ordine, le skill di libreria descritte in [Skill di libreria](Skill%20di%20libreria.md). Il master non sceglie mai una skill per nome e non vede i passi interni.

Le regole di lavoro che le istruzioni generate dell'agente devono rispettare (controllo prima di modificare, collegamenti dopo, mappa aggiornata, verifica finale) sono il cablaggio interno di ogni processo che scrive. Il modello di riferimento è Baltimora: skill di core che definiscono i processi e richiamano skill specialistiche.

Gli identificativi tra parentesi (per esempio `continuity-audit`) sono quelli usati dal framework; nei testi si usano i nomi in italiano.

## Regole comuni

### Riconoscimento del processo

- L'agente principale riconosce il processo dal significato della frase, non da parole chiave.
- Se due processi sono plausibili e la scelta cambia ciò che verrebbe scritto, pone una sola domanda con due opzioni in linguaggio comune, per esempio: «Vuoi preparare la prossima serata o registrare quella appena giocata?».
- La segnalazione di un problema su una scheda (per esempio «La guardia comune ha una scheda praticamente vuota») è una richiesta operativa: parte il processo di completamento della sezione 9, senza prima chiedere al master che cosa vuole fare.
- Nessun processo di scrittura parte da solo. Fanno eccezione l'import e la ricerca musicale, come indicato nella tabella «Avvio automatico».

### Avvio automatico

| Skill | Parte da sola | Quando | Che cosa scrive | Revisione |
|---|---|---|---|---|
| `document-ingest` (ingest di documenti) | Sì | Quando il master condivide foto, scansioni o documenti | Fonti in `Fonti/` e integrazione nelle schede, con il cablaggio di scrittura | Sempre, come ogni scrittura |
| `music-search` (ricerca musicale) | Sì, come funzione opzionale (nice to have) | Quando si crea un luogo | Solo la sezione `### Musica` nel blocco riservato della scheda del luogo | Sempre: passa comunque dalla revisione indipendente |

Tutte le altre skill partono solo dai processi, su richiesta del master.

### Cablaggio di scrittura

Ogni passo che crea o modifica un documento della campagna segue la stessa sequenza, nell'ordine indicato. Il processo la richiama con i suoi nomi, così un modello economico la può eseguire senza ricordarla.

1. **Versione delle modifiche a mano.** Se il master ha modificato a mano dei file dall'ultima versione salvata, quelle modifiche si salvano in una versione a parte prima di iniziare il lavoro.
2. **Controllo preventivo.** Audit di continuità (`continuity-audit`) sui documenti coinvolti e su quelli che li citano. Se emerge un conflitto che riguarda la modifica, la scrittura si ferma e il conflitto va al master.
3. **Bozza.** Il testo viene preparato. Se la bozza è affidata a un modello economico, l'agente principale la rilegge contro la fonte prima di proseguire.
4. **Revisione indipendente.** Sempre, da un sub-agent distinto da chi ha preparato la bozza, anche quando la prosa è dell'agente principale. Il revisore riceve soltanto ciò che serve al controllo, secondo la regola di visibilità in [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md). Esito: `APPLY` prosegue; `FIX` torna alla bozza (passo 3); `ASK` porta la decisione al master e ferma la scrittura interessata.
5. **Scrittura.** Il documento viene creato o modificato. Se la bozza cambia dopo la revisione, si torna al passo 4.
6. **Collegamenti.** Collegamenti (`linker`) sul documento scritto e, quando la scrittura crea un soggetto o un alias nuovo, su ogni documento che lo menziona: l'indice dei soggetti dice quali sono (**Deciso**, 2026-11-07). Le proposte passano dalla revisione indipendente: quelle approvate si applicano, quelle dubbie vanno al master.
7. **Derivati.** Rigenerazione dei derivati: mappa della trama (`plot-map`), viste per luogo, cache dei soggetti. La mappa della trama si aggiorna solo se cambiano ordine, ingressi, uscite o scelte della trama; altrimenti il controllo si chiude senza modifiche.
8. **Verifica deterministica.** Sempre. Lo script di controllo verifica i link che non risolvono, i riferimenti mancanti, i file attesi assenti, il blocco riservato ben formato e la coerenza della mappa con i prerequisiti. Il suo esito prevale sulla valutazione dell'agente. Se fallisce, si torna alla bozza (passo 3) con una nuova revisione (passo 4).
9. **Versione salvata.** Solo dopo la verifica superata, il framework salva una versione con una descrizione in frasi.

**Proposta.** Prima del controllo preventivo (passo 2) la sequenza calcola un livello di controllo, basso, medio o alto, dalla dimensione e dal rischio della modifica. Il calcolo è dello script di classificazione della scrittura, descritto in [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md), sottosezione «Livello di controllo proporzionato alla modifica». Ogni livello cambia tre cose. Al basso il controllo di continuità del passo 2 è saltato, il linker del passo 6 accetta da solo i link ovvi e fa giudicare al revisore solo gli altri, e un solo revisore del canone copre l'intero lotto. Al medio il controllo di continuità è eseguito, il linker è quello normale e un solo revisore copre l'intero lotto. All'alto il controllo è eseguito, il linker è quello normale e c'è un revisore del canone per ogni documento, in parallelo. La revisione indipendente del passo 4 non viene mai saltata, a nessun livello; solo il revisore può alzare il livello, da basso a medio, e in quel caso il controllo di continuità parte prima della scrittura.

Limiti: al massimo tre cicli fra bozza e revisione, o fra scrittura e verifica. Superato il limite, il processo si ferma e chiede al master. Proposta: ogni controllo meccanico (link che non risolvono, riferimenti mancanti, file attesi assenti) diventa uno script, come previsto in [Robustezza e test](Robustezza%20e%20test.md).

### Ruoli

- **Agente principale**: decide che cosa scrivere, quali conflitti sono risolti, quali proposte accettare e quando chiedere. Riassume il risultato per il master.
- **Modelli economici**: trascrizione, schede in serie, applicazione di collegamenti già approvati, controlli ripetitivi. Non decidono nulla che riguardi il canone.
- **Revisore indipendente**: sola lettura. Interviene sempre prima della scrittura (passo 4 della sequenza) e per ogni proposta di collegamento. Dettagli in [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md).

Quale modello svolge quale compito è deciso solo in [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md): i processi non assegnano modelli.

### Canone e identità

- Ciò che il master dice durante la sessione è un fatto dichiarato. Diventa canone soltanto nel passo «Canone» del processo dopo la sessione.
- Le schede dedicate (personaggi, luoghi, oggetti) sono la fonte di verità per l'identità. Una sessione descrive il comportamento in scena e rimanda alla scheda; non ridefinisce nulla.
- Le fonti caricate (appunti, PDF, foto) sono prove. Un conflitto fra fonti non si risolve scegliendo una versione: si documenta e si chiede.

### Lessico verso l'utente

Le parole mostrate al master sono definite solo nel glossario di [Principi](Principi.md), colonna «Cosa vede il master». I processi usano soltanto quelle parole nei messaggi.

### Errori comuni

- Un passo fallito si dichiara fallito, con il materiale coinvolto e ciò che resta da fare. Nessun processo dice «fatto» senza un risultato verificato.
- Se un passo della sequenza di scrittura fallisce, il documento già scritto è segnato «da verificare» nel riepilogo e i suoi collegamenti non si applicano.
- Se manca uno strumento (generazione di immagini, ricerca, script), il processo prosegue con ciò che può fare, elenca l'elemento mancante e non lascia collegamenti verso file inesistenti.
- Se manca git, nessun processo scrive: il processo lo dice in una frase e propone l'installazione (vedi [Esperienza utente](Esperienza%20utente.md)).
- Se il revisore indipendente non risponde, nulla si applica: le proposte restano in sospeso fino a una revisione riuscita.
- Un conflitto con il canone ferma la scrittura interessata e porta la domanda al master.

## 1. Nuova campagna (intervista guidata)

**Deciso.** L'intervista serve solo a creare i primi file core della campagna. Tutto il resto (luoghi, personaggi, oggetti, economia, moduli, stili) lo costruisce il master poco alla volta, quando gli serve, con gli altri processi.

**Frasi che lo attivano:** «voglio creare una campagna», «ho in mente un mondo, aiutami a metterlo in ordine», «ricominciamo da zero», «nuovo gioco, nuovo mondo».

**Prerequisiti:** nessuna campagna aperta nella cartella di lavoro. Se ne esiste una, il processo lo dice e chiede se si tratta di una campagna diversa o di una nuova cartella. Git deve essere disponibile: senza git il processo non crea nulla (vedi «Errori comuni»).

**Passi:**

1. Accoglie il master e spiega in due frasi che cosa succederà: poche domande, poi la campagna è pronta per cominciare.
2. Pone le domande dell'intervista (elenco sotto), accettando risposte parziali. Se manca una risposta a scelta (lingua, gioco, tono), usa il valore predefinito e lo dice; il nome della campagna e la premessa non hanno un valore predefinito sensato, quindi si chiedono a testo libero.
3. Mostra in linguaggio comune che cosa sta per creare: i file core, niente di più.
4. Dopo la conferma, crea i file core (sotto), inizializza il repository git locale della campagna ed esegue il cablaggio di scrittura sui file che contengono testo. Il passo 9 del cablaggio crea la prima versione salvata.
5. Chiude dicendo da dove si può partire, con due o tre esempi di frasi («descrivimi il primo luogo», «prepariamo la prima sessione», «ho degli appunti da importare»), e propone, senza imporla, una sessione di prova (vedi [Esperienza utente](Esperienza%20utente.md)).

**Domande dell'intervista** (solo ciò che serve ai file core; il perché si mostra solo se il master lo chiede):

- **1.** Come si chiama la campagna, e in che lingua scriviamo?
- **2.** Quale gioco di ruolo usate (ed edizione), oppure un sistema vostro? Serve a scegliere l'adattatore, che si applica già alla creazione.
- **3.** Che tono vuoi per le descrizioni: evocativo, asciutto, o altro?
- **4.** In due o tre frasi: di che mondo e di che storia si tratta?
- **5.** Hai materiale di un mondo condiviso con altre campagne? (se sì, in quale cartella) *Facoltativa.*

**Deciso (2026-11-09):** l'intervista funziona così.

- **Domande vere, non testo.** Le domande si pongono al master con lo strumento di domanda interattivo dell'agente principale: scelte fra poche opzioni, con la possibilità di rispondere a parole proprie. Il processo gira in un sotto-agente senza accesso al master: restituisce le domande a scelta in forma strutturata, e la skill di ingresso le pone. Le risposte libere (nome della campagna, premessa del mondo, percorso di una cartella) restano domande in testo semplice.
- **Due giri.** Il primo giro è a scelta: lingua, gioco di ruolo, tono e, se c'è, il materiale di un mondo condiviso (sì o no). Il secondo giro è a testo libero e chiede solo ciò che manca: il nome, la premessa e, se il master ha risposto sì, il percorso della cartella condivisa. Se il primo messaggio del master contiene già le risposte, non si chiede nulla.
- **Il gioco si applica subito.** Se il gioco scelto corrisponde a un adattatore installato (oggi `dnd-2024`), `system.adapter` della configurazione lo contiene fin dalla creazione, e il master sente che le regole di quel gioco sono applicate. Se non c'è un adattatore per quel gioco, la campagna funziona lo stesso, senza regole di gioco, e il master lo sente in una frase.
- **Il materiale condiviso si collega subito.** Se il master ha materiale di un mondo condiviso, il processo lo collega alla campagna come categoria `external` (collegamento simbolico alla sua cartella, in sola lettura) fin dalla creazione. Se il collegamento fallisce, la campagna viene creata lo stesso e il master lo sente in una frase.
- **Nulla si perde.** Le informazioni date oltre le risposte alle domande, o dopo la creazione (gioco, cartella condivisa, altri dettagli sul mondo), si applicano così. Durante la creazione, dopo la creazione dei file core: le impostazioni nella configurazione, e i dettagli sul mondo nella scheda radice, con le sole parole del master. Dopo la creazione, il processo ha una modalità «completamento» che le applica a una campagna esistente. La scheda radice e la configurazione si completano, non si ricreano.

**File core creati:**

- la configurazione della campagna, con lingua, registro, sistema e i soli moduli necessari;
- le istruzioni generate per gli agenti e il file delle personalizzazioni, vuoto;
- la scheda radice del mondo, `Mondo/<Nome del mondo>.md` (**Deciso**, 2026-11-07), con la premessa della risposta 4 come primo testo. Quando nasce il primo sotto-luogo diventa una cartella con la scheda omonima, tramite uno spostamento di `continuity-keeper`;
- il repository git locale della campagna, con la prima versione salvata.

Le cartelle delle categorie, il documento di economia (`Storia/Economia.md`), i profili di stile e i moduli opzionali **non** si creano qui: nascono la prima volta che servono (la prima scheda di un personaggio crea `Personaggi/`, il primo prezzo propone `Storia/Economia.md`, la prima immagine chiede lo stile). È l'applicazione di YAGNI alla campagna: nessuna cartella vuota, nessuna domanda su cose che il master non sta ancora facendo.

**Domande che non si fanno più all'inizio** e che il framework pone al momento giusto: categorie di documenti, livelli di verità e regole del canone, numero e schede dei giocatori, ritmo di gioco, finali, combattimenti tracciati, immagini e stile, stampa, enciclopedia, musica, materiale da importare (se il master lo condivide parte l'ingest), quanto decidere da solo e quanto interrompere.

**Chi fa che cosa:**

- Modelli economici: scrittura dei file core a partire dalle risposte.
- Agente principale (la skill di ingresso): pone al master le domande dell'intervista con lo strumento di domanda interattivo, sia quelle a scelta sia quelle a testo libero; valori predefiniti, prima stesura della scheda radice del mondo.

**Cosa vede l'utente:** le domande dell'intervista, prima quelle a scelta e poi, solo se mancano, quelle a testo libero; l'elenco breve di ciò che verrà creato, le frasi d'esempio per proseguire.

**Output:** i file core elencati sopra.

**Conferme richieste:** una sola, prima di creare i file core.

**Errori:** una cartella con lo stesso nome esiste già: il processo non la sovrascrive e propone un nome diverso.

## 2. Preparazione della sessione

**Frasi che lo attivano:** «preparo la prossima serata», «cosa succede nella prossima sessione?», «ho due scene, quali ritrovo», «prepariamo il combattimento col capitano».

**Prerequisiti:** la campagna è configurata; esiste almeno una scena, un documento della trama o una riga di prerequisito per la sessione da preparare. Se la sessione non ha prerequisito dichiarato, il processo lo dichiara e lo chiede.

**Passi:**

1. Individua la sessione o la scena da preparare dalla mappa della trama e dai prerequisiti.
2. Verifica che i prerequisiti siano stati giocati, leggendo le pagine di `Cronaca/` delle sessioni precedenti. Se non risultano giocati, avverte il master.
3. Legge le schede coinvolte (personaggi, luoghi, creature, oggetti) e le fonti pertinenti con la ricerca nel canone (`canon-research`).
4. Esegue l'audit di continuità (`continuity-audit`) in sola lettura sulla scena, senza scrivere.
5. Elenca i punti in cui i personaggi giocanti possono entrare nella scena (gli agganci del loro intreccio, se esiste).
6. Prepara le creature e i personaggi che mancano: se la scheda non esiste, la crea con la gestione dei PNG (`npc-manager`). Per gli oggetti nuovi usa la scheda di luoghi e oggetti (`sheets`). Per i ritratti usa `artwork`, se attiva.
7. Scrive la preparazione come documento della sessione, separando ciò che il gruppo vedrà da ciò che resta riservato al master, e la chiude con il cablaggio di scrittura.
8. Prepara, se la sessione prevede combattimenti, i dati degli avversari (dalle schede), senza avviare nulla.

**Funzioni di libreria, in ordine:** ricerca nel canone (`canon-research`, lettura) → audit di continuità (`continuity-audit`, sola lettura) → artwork (solo per ritratti richiesti) → gestione dei PNG (`npc-manager`) per personaggi e creature mancanti → schede di oggetti (`sheets`) se servono oggetti nuovi → scrittura della preparazione → cablaggio di scrittura (l'audit di continuità è già stato eseguito come controllo preventivo; collegamenti; mappa della trama solo se la preparazione cambia la struttura, di norma no).

**Delegato a modelli economici:** lettura e riassunto delle schede, bozza dei testi di scena, creazione delle schede mancanti, controlli di collegamento. **Decide l'agente principale:** quali scene proporre, come ordinare gli agganci, quali rischi segnalare, se un oggetto nuovo è davvero necessario.

**Cosa vede l'utente:** una lista di che cosa è pronto e che cosa manca; la preparazione della sessione; una nota sui prerequisiti non verificati; i punti di ingresso dei personaggi.

**Output:** documento di preparazione della sessione, con parte pubblica e parte riservata al master; schede nuove o aggiornate; eventuali immagini.

**Conferme richieste:** quando la preparazione richiede di modificare una scheda canonica (per esempio cambiare lo stato di un luogo), prima la proposta, poi la scrittura. Quando manca un prerequisito, il master decide se procedere.

**Errori:** un prerequisito non giocato viene dichiarato, non nascosto. Se la richiesta ha bisogno di un personaggio che non ha ancora la scheda (l'avversario di uno scontro richiesto, chi gestisce un luogo richiesto), l'agente la crea con proposte brevi e ne informa il master. Un personaggio di cui la richiesta non ha bisogno non viene inventato, ma segnalato.

**Modalità revisione.** **Deciso (2026-11-09).** Il master può cambiare alcune scene di una sessione già preparata e non ancora giocata («cambia il debito dei minatori», «la consegna dei documenti avviene in un'altra scena»: aggiorna quattro scene già scritte). Non è un processo nuovo: è la modalità revisione del processo di preparazione. Il processo riscrive solo le scene nominate, e il documento principale della sessione solo se il suo testo ne dipende. Passi: identifica la sessione e le scene (una sola domanda se non sono chiare); rifiuta, in parole semplici, una sessione già giocata (lo stato «giocata» della mappa della trama), senza scrivere nulla; legge le scene e i documenti coinvolti, e le sessioni che dipendono da quella (sola lettura); esegue il controllo di coerenza in sola lettura sul contenuto nuovo, incluse le decisioni del master; riscrive solo le scene cambiate, lasciando identico il resto; passa per la scrittura (salvataggio delle modifiche a mano, controllo di coerenza, revisione indipendente, scrittura, collegamenti, verifica, versione salvata); se una scena cambia ordine, entrate, uscite o scelte, ricontrolla i collegamenti della trama per quella sessione. Gli identificativi e i nomi dei file delle scene restano; le sessioni diverse da quella indicata non si scrivono mai, e quelle che dipendono dalla modificata si segnalano al master. Aggiungere o togliere una scena non è previsto in questa versione: il processo lo dice e si ferma. Il messaggio finale dice quali scene sono cambiate e che cosa è rimasto com'era.

**Fantasia del modello (2026-11-10).** Il processo inventa i dettagli mancanti solo quando la fantasia è sbloccata per questa richiesta (richiesta esplicita del master, configurazione `true`, o risposta «Sì» o «Sempre sì» alla domanda; vedi il principio 17 di [Principi](Principi.md)). Ciò che il master o una fonte dicono resta com'è: si inventa solo ciò che manca. Il messaggio finale dice in una frase che cosa è stato inventato, per scena o personaggio. Il canone non si contraddice mai e i segreti restano nel blocco riservato.

## 3. Sessione live

**Frasi che lo attivano:** «iniziamo», «avvia la sessione», «continuiamo da dove eravamo», «registra quello che succede».

**Prerequisiti:** la sessione è preparata oppure il master vuole giocare senza preparazione. Se esiste già una sessione aperta, il processo la continua.

**Passi:**

1. Apre la sessione, presenta la scena iniziale documentata e lascia la prima scelta ai giocatori.
2. Durante il gioco registra ogni fatto dichiarato dal master, distinguendo fatti, decisioni, intenzioni e questioni aperte. Una domanda non si registra; un'ipotesi o un condizionale non fanno avanzare la storia.
3. Risponde alle domande usando le fonti, senza aprire nulla di spontanea iniziativa.
4. Gestisce gli scontri solo quando il master li avvia: tiene iniziativa, turni, punti ferita e condizioni dei nemici; per i personaggi giocanti registra soltanto nome, iniziativa e posizione. Non tira dadi, non sceglie tattiche e non avanza il turno senza comando.
5. Mostra la musica o le immagini pertinenti nella scena, avviandole o fermandole solo su richiesta.
6. Quando il master corregge un dato, aggiorna la voce del registro invece di duplicarla. Quando un fatto viene annullato, la voce resta ma non avanza più la storia.
7. Chiude la sessione su comando, lasciando il registro pronto per il processo successivo.

**Funzioni di libreria, in ordine:** registro di sessione (`session-log`), tracker degli scontri (`combat-tracker`) solo se nasce uno scontro, ricerca nel canone (`canon-research`) per le domande. Durante la sessione non parte alcun audit di continuità: il canone non si tocca.

**Delegato a modelli economici:** il tracciamento delle voci del registro e la ricerca nelle fonti. **Decide l'agente principale:** se un'azione del master è un fatto o un'intenzione, se una correzione è un chiarimento o un errore, quando chiedere.

**Cosa vede l'utente:** la scena in corso, il registro della serata, eventuali moduli di consultazione, i nemici in combattimento. Nessuna parola tecnica: il registro si chiama «registro della serata»; il tavolo della scena è la vista del master screen.

**Output:** registro della sessione con fatti, decisioni, intenzioni e questioni aperte, ciascuno collegato al messaggio che l'ha generato; stato degli scontri, se avvenuti.

**Conferme richieste:** una sola domanda mirata quando un fatto è ambiguo e cambia la storia. Il master non viene interrotto per confermare dettagli minori.

**Errori:** se uno strumento di registrazione fallisce, il processo non dichiara avvenuta la registrazione, la ripete o lo segnala. Una differenza fra ciò che il master dice e ciò che dice una fonte è registrata come evento di gioco; la fonte non viene corretta.

## 4. Dopo la sessione (cronaca, canone, conseguenze, nuovi PNG)

**Frasi che lo attivano:** «abbiamo finito», «chiudiamo la serata», «aggiorna la campagna con quello che è successo», «cosa cambia dopo l'ultima sessione?».

**Prerequisiti:** esiste un registro della sessione, anche incompleto. Se il registro manca, il processo chiede al master di raccontare la serata in una frase per ogni scena.

**Passi:**

1. **Cronaca.** Scrive la pagina di `Cronaca/` della sessione a partire dal registro: tono narrativo per i giocatori, con le note per il master nel blocco riservato. Non vi scrive fatti che non stanno nel registro.
2. **Canone.** Per ogni fatto, decisione o identità nuova, lo confronta con le schede e la trama. Il risultato è un elenco di modifiche canoniche proposte: aggiornamento di schede, nuovi personaggi, luoghi, eventi. Le promesse e le questioni aperte restano in lista.
3. **Conseguenze.** Calcola quali sessioni o attività cambiano: prerequisiti da aggiornare, scene che non hanno più senso, rami della storia che si aprono o si chiudono.
4. **Nuovi PNG e oggetti.** Per ogni personaggio o creatura nuovi avvia la scheda con la gestione dei PNG (`npc-manager`). Per ogni oggetto nuovo avvia la scheda (`sheets`) e la carta (`cards`). In alternativa apre un compito da completare più tardi.
5. **Scrittura.** Applica le modifiche approvate, compresa la pagina di `Cronaca/`, ciascuna con il cablaggio di scrittura.
6. **Chiusura.** Esegue la verifica deterministica dello stato dei documenti e presenta il riepilogo finale: che cosa è cambiato, che cosa resta da decidere.

**Funzioni di libreria, in ordine:** audit di continuità (`continuity-audit`) sulle modifiche canoniche, prima di scrivere → gestione dei PNG (`npc-manager`) per personaggi e creature nuovi → schede di oggetti (`sheets`) con la loro carta (`cards`), e artwork (`artwork`) se servono ritratti → scrittura (cronaca compresa) → collegamenti (`linker`) → mappa della trama (`plot-map`) quando cambia l'ordine o una scelta della trama → audit di continuità di chiusura, se la sessione ha toccato più documenti.

**Delegato a modelli economici:** stesura della pagina di `Cronaca/` a partire dal registro, aggiornamento dei prerequisiti, creazione di schede in serie, applicazione dei collegamenti approvati. **Decide l'agente principale:** quali fatti diventano canone, come risolvere un conflitto (sempre con il master), quali conseguenze sono rilevanti.

**Cosa vede l'utente:** la pagina della cronaca della serata; l'elenco delle modifiche proposte al canone e alle conseguenze; i nuovi PNG e oggetti; il messaggio finale su che cosa è stato scritto e che cosa resta aperto.

**Output:** pagina di `Cronaca/` della sessione; aggiornamento di schede e della trama; prerequisiti aggiornati; nuove schede e carte; mappa della trama se cambia la struttura; registro chiuso.

**Conferme richieste:** prima della scrittura, il master vede l'elenco delle modifiche canoniche. Non serve conferma per i fatti del registro già confermati dal master durante la sessione e senza conflitti. Ogni conflitto con il canone attende la decisione del master. Proposta: le conseguenze che riscrivono una sessione futura richiedono una conferma esplicita.

**Errori:** se l'audit di continuità trova un conflitto, la scrittura interessata si ferma e il conflitto viene presentato con le due versioni. Se la creazione di una carta non è disponibile, la scheda resta, senza collegamento a un'immagine inesistente, e la carta risulta come compito aperto.

**Fantasia del modello (2026-11-10).** Questo processo non inventa mai, qualunque sia il valore di `allow_model_imagination`: la cronaca racconta solo ciò che il registro contiene, e le schede si aggiornano solo con ciò che il master ha detto o confermato.

## 5. Manutenzione («fai ordine»)

**Frasi che lo attivano:** «fai ordine», «controlla che tutto sia a posto», «ci sono link rotti?», «verifica le contraddizioni», «sistema i riferimenti».

**Prerequisiti:** la campagna è configurata. Se l'utente chiede di limitare il perimetro (una zona, una categoria), il processo lo accetta; in caso contrario il perimetro è l'intero archivio.

**Passi:**

1. **Dottore della campagna** (`campaign-doctor`): rapporto su problemi narrativi, logici e strutturali, con soluzioni proposte. È il primo passo della manutenzione, perché le correzioni che seguono dipendono dal suo rapporto. Le correzioni proposte si trattano così: quelle meccaniche (per esempio un rimando rotto o un'intestazione mancante) si applicano dopo una sola conferma del master, tutte insieme; quelle narrative si scelgono una per una, e quelle che toccano il canone passano dal riordino del canone (vedi sezione 7).
2. Controlli deterministici: riferimenti che non risolvono, file attesi assenti, mappa della trama coerente con i prerequisiti, eventuali controlli automatici degli strumenti.
3. Audit di continuità completo in sola lettura: contraddizioni, lacune, ripetizioni, nomi incoerenti.
4. Controllo dei riferimenti in analisi: ogni menzione di un soggetto che ha una scheda deve avere il suo riferimento, esclusi titoli e testi letti ad alta voce. Le proposte si dividono in `APPLY` (da applicare), `OMIT` (da omettere) e `ASK` (da chiedere).
5. Applica i riferimenti `APPLY` (la revisione indipendente è obbligatoria anche qui); per quelli `ASK` attende la decisione del master.
6. Verifica della mappa della trama, se i documenti di trama sono cambiati.
7. Riepilogo in tre parti: che cosa è stato sistemato, che cosa è stato trovato ma non toccato, che cosa richiede una decisione.

**Funzioni di libreria, in ordine:** dottore della campagna (`campaign-doctor`, rapporto e soluzioni) → controlli deterministici → audit di continuità (`continuity-audit`, lettura) → collegamenti (`linker`, analisi e applicazione) → mappa della trama (`plot-map`, verifica). Le correzioni di contenuto canonico non partono mai da questo processo: si segnalano e si portano nel riordino del canone.

**Delegato a modelli economici:** controlli deterministici, lettura di grandi insiemi di documenti, applicazione dei collegamenti approvati. **Decide l'agente principale:** quali risultati sono errori tecnici da correggere e quali sono decisioni del master; quali proposte portare all'autore.

**Cosa vede l'utente:** il riepilogo in tre parti, con i punti in ordine di importanza e senza gergo.

**Output:** report di manutenzione; riferimenti applicati; mappa della trama aggiornata se necessario.

**Conferme richieste:** nessuna per i riferimenti approvati dalla revisione. Le correzioni meccaniche del dottore richiedono una sola conferma; quelle narrative si scelgono una per una. Il master decide su ogni contraddizione di contenuto, su ogni identità incerta e su ogni riferimento che il revisore non riesce a sostenere con le fonti.

**Errori:** se l'audit di continuità non riesce a leggere un documento, il report dice quali documenti non sono stati letti, e il controllo non viene dichiarato completo. Non si dichiara «nessun problema» se una parte dell'archivio non è stata letta.

## 6. Import di materiale esistente (punto d'ingresso)

**Frasi che lo attivano:** «ho degli appunti da digitalizzare», «ti mando le foto del quaderno», «questo PDF è la mia vecchia campagna», «importa questa scheda», oppure la semplice condivisione di foto, scansioni o documenti.

**Prerequisiti:** la campagna è configurata. Se non lo è, il processo propone prima la nuova campagna (processo 1) con il materiale già in mano.

**Passi:**

1. Inventario: quanti file, quali pagine, quale ordine, quale provenienza dichiarata, quali duplicati. Non si assume che file consecutivi appartengano alla stessa vicenda.
2. Classificazione: il materiale diventa scheda di personaggio giocante (verso l'intreccio, `pc-weaving`), oggetto (verso le schede, `sheets`), luogo, creatura, personaggio non giocante (verso la gestione dei PNG, `npc-manager`), storia o appunti generici, secondo ciò che la campagna prevede.
3. Conservazione degli originali nella cartella `Fonti/`, senza modificarli né rinominarli, con un identificativo stabile.
4. Trascrizione fedele, con localizzatore per ogni passo e marcatura di ciò che non si legge. La trascrizione non viene corretta in silenzio.
5. Scomposizione in affermazioni verificabili e confronto con l'archivio (audit di continuità sulle affermazioni).
6. Riesame delle letture dubbie: la domanda al master è concreta, con le alternative sostenute dalle fonti.
7. Integrazione: le informazioni verificate vanno nelle schede e nei documenti esistenti, senza duplicarli; i soggetti nuovi vanno in categorie coerenti con la configurazione.
8. Cablaggio di scrittura su ogni documento toccato, poi audit di continuità sull'archivio aggiornato.
9. Relazione: fonti acquisite, pagine integrate, parti illeggibili, dubbi residui, azioni che attendono il master.

**Funzioni di libreria, in ordine:** ingest di documenti (`document-ingest`, la funzione che porta in digitale materiale scritto su file, quaderni o foto) → audit di continuità (`continuity-audit`) prima dell'integrazione → intreccio dei personaggi giocanti (`pc-weaving`) e schede (`sheets`, `npc-manager`) secondo la classificazione → collegamenti (`linker`) → mappa della trama (`plot-map`) solo se cambia la trama → audit di continuità di chiusura.

**Delegato a modelli economici:** inventario, trascrizione, confronto fra originale e trascrizione in una seconda lettura, copia degli originali, prima stesura dei documenti integrati. **Decide l'agente principale:** se un materiale è canone, bozza o ricordo; come risolvere un conflitto fra fonti; quando il dubbio blocca l'integrazione.

**Cosa vede l'utente:** la relazione finale in linguaggio comune, con le pagine illeggibili elencate e le domande raggruppate per argomento.

**Output:** cartella `Fonti/` con originali e schede di acquisizione; trascrizioni; documenti della campagna aggiornati; registro dei dubbi e delle verifiche.

**Conferme richieste:** quando un dubbio blocca l'integrazione, il master risponde prima che il passo venga applicato. Un conflitto con il canone attende la decisione del master. Il silenzio del master non vale come conferma.

**Errori:** una pagina illeggibile non viene completata con l'invenzione: resta marcata. Un OCR fallito non blocca la lettura visiva dell'immagine. Un'importazione interrotta lascia le fonti già acquisite e segnala quali parti mancano; non si dichiara l'import completo.

**Fantasia del modello (2026-11-10).** Il processo inventa i dettagli mancanti nelle schede e nei documenti integrati solo quando la fantasia è sbloccata per questa richiesta (vedi il principio 17 di [Principi](Principi.md)). La trascrizione fedele dei documenti non inventa mai: la fantasia riguarda solo ciò che il processo integra quando manca. Il messaggio finale dice in una frase che cosa è stato inventato, per personaggio.

## 7. Riordino del canone

**Frasi che lo attivano:** «cambia il nome di questo luogo», «unisci queste due schede», «sposta questo personaggio sotto quel luogo», «cancella questa creatura», «quel fatto non è vero, correggilo ovunque».

**Prerequisiti:** la campagna è configurata. Il master indica il soggetto o il fatto da cambiare. Se il cambiamento tocca una sessione già giocata, il processo lo dichiara prima di iniziare.

**Passi:**

1. **Piano.** La manutenzione della continuità (`continuity-keeper`) elenca tutti i cambiamenti necessari per rinominare, unire, dividere, spostare, cancellare o correggere il fatto, con i documenti che lo citano e i rimandi da aggiornare. Gli identificativi dei soggetti non cambiano per rinomina e spostamento; la regola completa sta nella scheda della funzione.
2. **Conferma.** Il master vede il piano in frasi e conferma prima di qualunque scrittura. Se un cambiamento contraddice la storia già giocata, lo presenta come conflitto e non lo applica.
3. **Applicazione.** Ogni documento toccato è modificato con il cablaggio di scrittura. Le cancellazioni mostrano che cosa sarà perso e richiedono una conferma esplicita.
4. **Chiusura.** Mappa della trama se cambia la trama, poi audit di continuità di chiusura che verifica assenza di link rotti e di riferimenti al soggetto vecchio.

**Funzioni di libreria, in ordine:** manutenzione della continuità (`continuity-keeper`, piano) → conferma del master → applicazione con il cablaggio di scrittura (collegamenti `linker`) → mappa della trama (`plot-map`, se cambia la trama) → audit di continuità di chiusura (`continuity-audit`).

**Delegato a modelli economici:** ricerca delle citazioni, applicazione delle modifiche approvate, controlli di collegamento. **Decide l'agente principale:** se un cambiamento è davvero un riordino o una nuova decisione di canone, e come presentare i conflitti.

**Cosa vede l'utente:** il piano in frasi, con i documenti coinvolti; la conferma richiesta; il messaggio finale su che cosa è cambiato.

**Output:** documenti aggiornati, senza link rotti; mappa della trama se cambia la trama; versione salvata prima e dopo, per poter tornare indietro.

**Conferme richieste:** prima dell'applicazione, sempre. Le cancellazioni richiedono una conferma esplicita.

**Errori:** se un documento non si può leggere o modificare, il processo si ferma prima di toccare gli altri e dichiara quali documenti restano in stato «da verificare». Un'applicazione interrotta non si dichiara completata.

## 8. Ribilanciamento

**Frasi che lo attivano:** «ribilancia gli scontri», «questo combattimento è troppo facile», «il gruppo è cresciuto, rivedi gli incontri».

**Prerequisiti:** la campagna è configurata e il sistema di gioco dispone di un adattatore con le soglie di difficoltà (vedi [Sistemi di gioco e stili](Sistemi%20di%20gioco%20e%20stili.md)). Il master indica gli scontri da rivedere, oppure la campagna intera.

**Passi:**

1. **Piano.** Il bilanciamento degli incontri (`encounter-balancer`) confronta la difficoltà di ogni scontro indicato con le soglie dell'adattatore e propone modifiche a numero di nemici o statistiche. Gira una volta, quando il master lo chiede.
2. **Conferma.** Il master sceglie quali modifiche applicare.
3. **Applicazione.** Prima di scrivere, l'audit di continuità (`continuity-audit`, lettura) verifica che le modifiche non contraddicano le schede. Poi la gestione dei PNG (`npc-manager`) aggiorna le schede dei nemici interessati, ciascuna con il cablaggio di scrittura.
4. **Chiusura.** Collegamenti sulle schede modificate.

**Funzioni di libreria, in ordine:** bilanciamento degli incontri (`encounter-balancer`, piano) → conferma del master → audit di continuità (`continuity-audit`, lettura) → gestione dei PNG (`npc-manager`, applicazione) → collegamenti (`linker`).

**Delegato a modelli economici:** calcoli di confronto, applicazione delle modifiche approvate. **Decide l'agente principale:** quali scontri proporre, quali modifiche sono coerenti con la storia.

**Cosa vede l'utente:** la difficoltà attuale di ogni scontro in parole semplici, le modifiche proposte e quelle scelte.

**Output:** schede dei nemici aggiornate; piano di ribilanciamento conservato nella versione salvata.

**Conferme richieste:** il master conferma ogni modifica a numeri o statistiche prima dell'applicazione.

**Errori:** se il sistema di gioco non ha un adattatore con le soglie, il processo lo dice e non propone numeri.

## 9. Completa o correggi una scheda

**Proposta.** Il processo nasce da una segnalazione di un tester: il framework crea una scheda, ma non interviene quando il master dice che la scheda non basta. Non è ancora approvato dall'autore.

**Frasi che lo attivano:** «La guardia comune ha una scheda praticamente vuota», «la scheda di Ilde è troppo scarna», «manca l'aspetto del vecchio minatore», «nella scheda Ilde è un uomo ma è una donna». Una segnalazione di un problema su una scheda è una richiesta operativa: il processo parte subito, senza chiedere al master che cosa vuole fare.

**Prerequisiti:** la scheda esiste nella campagna ed è identificabile senza dubbi (per nome, alias o identificativo). Se più schede rispondono, il processo chiede una sola volta quale. Se la scheda non esiste, il processo lo dice e propone la creazione con la gestione dei PNG (`npc-manager`) o con le schede di luoghi e oggetti (`sheets`).

**Passi:**

1. Trova la scheda e ne riconosce il tipo: personaggio, creatura, venditore o luogo.
2. Elenca le lacune con il controllo deterministico `gaps` di `npc-manager`: sezioni vuote o segnaposto, venditore senza righe nell'assortimento, luogo senza apertura in corsivo, scheda quasi vuota.
3. Recupera i fatti narrativi dalla campagna con la ricerca nel canone (`canon-research`): ruolo, aspetto, modi, luoghi, legami e tutto ciò che la campagna già stabilisce. Un fatto trovato nella campagna non si chiede al master.
4. Verifica le regole (statistiche, scorte, prezzi, bottino) solo nelle fonti consentite: cartelle esterne collegate e fonti della campagna, con l'adattatore del sistema (`system-adapter`) quando la campagna ne ha uno. Mai dalla memoria del modello, mai dal web. Ciò che non si trova resta «Da definire».
5. Chiede al master solo le scelte creative necessarie, una alla volta, con poche opzioni e una raccomandazione (per esempio il tono dell'aspetto). Le lacune narrative che non hanno un fatto nella campagna ricevono proposte brevi, con le stesse regole della creazione di una scheda (vedi la gestione dei PNG in [Skill di libreria](Skill%20di%20libreria.md#l14-gestione-dei-png)).
6. Prepara una bozza che cambia solo le parti lacunose: il blocco riservato e il resto della scheda restano intatti.
7. Esegue il cablaggio di scrittura completo (`write-sequence`): versione delle modifiche a mano, controllo di coerenza, revisione indipendente, scrittura, collegamenti, verifica deterministica, versione salvata.
8. Dà un messaggio sul problema concreto: che cosa mancava, che cosa è stato completato, che cosa resta da fare. Se restano lacune, la scheda risulta «da completare».

**Funzioni di libreria, in ordine:** ricerca nel canone (`canon-research`, lettura) → adattatore del sistema (`system-adapter`, solo se la campagna ne ha uno) → gestione dei PNG (`npc-manager`, controllo `gaps`) → cablaggio di scrittura (`write-sequence`), con il controllo di coerenza come controllo preventivo e i collegamenti (`linker`) dopo la scrittura.

**Delegato a modelli economici:** lettura della scheda e delle fonti, elenco delle lacune, bozza delle parti mancanti. **Decide l'agente principale:** quali fatti sono davvero stabiliti dalla campagna, quali scelte creative chiedere, quando una lacuna resta «Da definire», quando una contraddizione va portata al master.

**Cosa vede l'utente:** il problema detto in parole semplici («la scheda non ha aspetto né modi; le statistiche non si trovano nelle fonti»), le domande creative una alla volta, il messaggio finale su che cosa è cambiato.

**Output:** scheda con le sole parti lacunose completate; blocco riservato intatto; esito del controllo (usabile o da completare) detto al master.

**Conferme richieste:** nessuna per ciò che viene dalla campagna. Le proposte creative si segnalano come tali nel messaggio, e il master può cambiarle. Una sola domanda se due fatti stabiliti si contraddicono o se mancano statistiche nelle fonti consentite.

**Errori:** se le statistiche non si trovano nelle fonti consentite restano «Da definire» e la scheda risulta «da completare»; mai statistiche a memoria. Se la scheda è già usabile, il processo lo dice e non scrive nulla. Se due fatti stabiliti si contraddicono, la parte interessata non viene scritta finché il master non risponde. Una correzione d'identità detta dal master (per esempio il sesso di un personaggio) si applica alla scheda solo dopo aver verificato che la campagna non dica altro; se lo dice, è una domanda sola. Se il revisore indipendente non risponde, nulla si applica (vedi «Errori comuni»).

**Fantasia del modello (2026-11-10).** Il processo inventa i dettagli mancanti (nomi, aspetto, modi, storia, relazioni, statistiche, scorte, prezzi) solo quando la fantasia è sbloccata per questa richiesta (vedi il principio 17 di [Principi](Principi.md)). Le regole di gioco restano nelle fonti consentite e nell'adattatore: un valore inventato va dichiarato nel messaggio finale, mai presentato come una fonte. Il canone non si contraddice e i segreti restano nel blocco riservato.

## Tabella riassuntiva: processo → funzioni di libreria

| Processo | Funzioni di libreria, in ordine | Quando l'audit di continuità gira |
|---|---|---|
| Nuova campagna | nessuna oltre al cablaggio di scrittura sulla scheda radice del mondo | Prima della scrittura della scheda radice |
| Preparazione sessione | ricerca nel canone (`canon-research`) → audit di continuità (sola lettura) → artwork (solo ritratti richiesti) → gestione dei PNG (`npc-manager`) → schede di oggetti (`sheets`, se servono oggetti) → collegamenti → mappa della trama (solo se cambia la struttura) | Prima della scrittura e in sola lettura sulla scena |
| Sessione live | registro di sessione (`session-log`) → scontri (`combat-tracker`, solo se c'è uno scontro) → ricerca nel canone (domande) | Non gira: il canone non si tocca durante la sessione |
| Dopo la sessione | cronaca di `Cronaca/` → audit di continuità → gestione dei PNG (`npc-manager`) → schede di oggetti (`sheets`) con la loro carta (`cards`), artwork se servono → collegamenti → mappa della trama (se cambia la trama) → audit di continuità di chiusura | Prima della scrittura e in chiusura |
| Manutenzione | dottore della campagna (`campaign-doctor`, rapporto e soluzioni) → controlli deterministici → audit di continuità (lettura) → collegamenti (analisi e applicazione) → mappa della trama | È il processo stesso |
| Riordino del canone (su richiesta) | manutenzione della continuità (`continuity-keeper`, piano) → conferma del master → applicazione → collegamenti → mappa della trama (se cambia la trama) → audit di continuità di chiusura | Prima dell'applicazione e in chiusura |
| Ribilanciamento (su richiesta) | bilanciamento degli incontri (`encounter-balancer`, piano) → conferma del master → audit di continuità → gestione dei PNG (`npc-manager`, applicazione) → collegamenti | Prima dell'applicazione |
| Import (ingresso) | ingest di documenti (`document-ingest`) → audit di continuità → intreccio dei PG (`pc-weaving`) e schede (`sheets`, `npc-manager`) secondo il tipo → collegamenti → mappa della trama (se cambia la trama) → audit di continuità di chiusura | Prima dell'integrazione e in chiusura |
| Completamento di una scheda (su segnalazione, **Proposta**) | ricerca nel canone (`canon-research`) → adattatore del sistema (`system-adapter`, solo se c'è) → gestione dei PNG (`npc-manager`, controllo `gaps`) → cablaggio di scrittura (`write-sequence`), con collegamenti (`linker`) | Prima della scrittura, nel cablaggio |

## Questioni aperte

- **Nomi dei processi.** Le etichette dei nove processi sono comprensibili per il master? Va verificato con un utente che non ha mai usato un'IA, in [Esperienza utente](Esperienza%20utente.md).
- **Preparazione e dopo la sessione.** La preparazione scrive documenti di sessione: vanno considerati parte del processo dopo la sessione (chiusura) o restano un documento separato?
- **Confini del processo «dopo la sessione».** La creazione di carte degli oggetti appartiene a questo processo o solo alla manutenzione? Proposta: la carta si genera al momento dell'oggetto, non a fine sessione, per evitare di aspettare.
- **Conferme sulle conseguenze.** Quali conseguenze sulle sessioni future richiedono conferma esplicita? La proposta di questo documento è: quelle che riscrivono una sessione già preparata. Aggiunta (2026-11-09): riscrivere una sessione non ancora giocata è esplicito per natura, perché è il master a chiederlo.
- **Revisione dell'import.** L'import di materiale condiviso senza richiesta (autorun) deve sempre chiedere il permesso prima di scrivere, o solo quando il materiale tocca il canone? Un import che parte da solo va limitato: l'autore decide il limite.
- **Ordine dei passi «Canone» e «Conseguenze».** Possono essere invertiti senza danno? Sono separati per chiarezza: resta da verificare se la separazione regge alla prova dell'uso.
- **Fonti consentite per le regole.** Statistiche, scorte e prezzi si verificano solo nelle cartelle esterne collegate e nelle fonti della campagna. Il web è ammesso? Proposta: no, come da sezione 9.
- **Oggetti e annunci.** Il completamento di una scheda vale anche per oggetti e annunci, o solo per personaggi, creature, venditori e luoghi?
- **Conferma delle proposte creative.** Le proposte creative vanno confermate dal master prima di scrivere, o si scrivono e si segnalano come proposte da cambiare dopo?
